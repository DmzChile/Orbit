import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GitHub,
  encodeRecord,
  RUN_MARKER,
  REQUEST_MARKER,
} from "../src/main/github";
import { makeRun } from "../worker/runtime";
import { request } from "./fixtures";
import { HackerNewsProvider, fetchQuote } from "../src/main/providers";
afterEach(() => vi.unstubAllGlobals());
describe("GH-05/06/RES-01/SEC-02 · provider contracts (mock HTTP)", () => {
  it("uses ETags and maps expired auth and rate limits", async () => {
    let count = 0;
    const mock = vi.fn(async (_url: string, options: RequestInit) => {
      count++;
      if (count === 1)
        return new Response(JSON.stringify({ login: "owner", id: 1 }), {
          headers: { etag: '"v1"' },
        });
      expect(new Headers(options.headers).get("if-none-match")).toBe('"v1"');
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal("fetch", mock);
    const gh = new GitHub("test-token-for-etag");
    expect((await gh.account()).login).toBe("owner");
    expect((await gh.account()).login).toBe("owner");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(gh.account()).rejects.toMatchObject({ code: "NEEDS_AUTH" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          }),
      ),
    );
    await expect(gh.account()).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });
  it("recovers result changes on a tracked issue even when issue updated_at is older than cursor", async () => {
    const req = request({ remoteIssue: 12 }),
      run = makeRun(req, "2024-03-03T00:00:00Z");
    run.status = "succeeded";
    const comments = [
      {
        id: 1,
        user: { login: "github-actions[bot]" },
        body: encodeRecord(RUN_MARKER, run),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes("/comments?")
                ? comments
                : url.includes("/issues/12")
                  ? {
                      number: 12,
                      body: encodeRecord(REQUEST_MARKER, req),
                      state: "open",
                      updated_at: "2024-01-01T00:00:00Z",
                    }
                  : [],
            ),
          ),
      ),
    );
    const result = await new GitHub("tracked-token").records(
      "example/allowed",
      "2024-03-03T01:00:00Z",
      [12],
    );
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].id).toBe(run.id);
  });
  it("reads before redelivery and does not create a duplicate durable queue record", async () => {
    const req = request({ remoteIssue: 12 }),
      run = { ...makeRun(req, "2024-03-03T00:00:00Z"), issueNumber: 12 };
    const mock = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.method).toBe("GET");
      return new Response(
        JSON.stringify([
          { body: encodeRecord("<!-- orbit-queue:v1 -->", run) },
        ]),
      );
    });
    vi.stubGlobal("fetch", mock);
    await new GitHub("queue-token").enqueue(run);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("ignores malformed external request records and untrusted result authors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { number: 10, body: "<!-- orbit-request:v1 -->\nmalformed" },
            ]),
          ),
      ),
    );
    const result = await new GitHub("malformed-token").records(
      "example/allowed",
    );
    expect(result.requests).toEqual([]);
    expect(result.runs).toEqual([]);
  });
  it("blocks untrusted artifact redirects before downloading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/secret" },
          }),
      ),
    );
    await expect(
      new GitHub("artifact-token").archive(1, "example/allowed"),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });
  });
});
describe("NEWS-05/WID-07 · actual-data adapters with isolated mock transport", () => {
  it("does not replace offline news with fixtures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(new HackerNewsProvider().fetchPage(0)).rejects.toMatchObject({
      code: "OFFLINE",
    });
  });
  it("requires credentials and reports provider rate-limit payloads", async () => {
    await expect(fetchQuote("SPY", "")).rejects.toMatchObject({
      code: "NEEDS_AUTH",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Information: "limit" }))),
    );
    await expect(fetchQuote("SPY", "test-key")).rejects.toMatchObject({
      code: "RATE_LIMIT",
    });
  });
});
