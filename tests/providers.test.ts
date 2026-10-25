import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GitHub,
  encodeRecord,
  RUN_MARKER,
  REQUEST_MARKER,
} from "../src/main/github";
import { makeRun } from "../worker/runtime";
import { request } from "./fixtures";
import { fetchQuote } from "../src/main/providers";
import { parseKoreanNews, KoreanNewsProvider } from "../src/main/news";
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
    await expect(new KoreanNewsProvider().fetchPage(0)).rejects.toMatchObject({
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

describe("NEWS-01/02/05 · Korean official RSS, isolated fixture XML", () => {
  const item = (n: number, title = "반도체 우주 교육 투자") =>
    `<item><title><![CDATA[${title} &amp; 한국]]></title><link>https://www.donga.com/news/article/all/20261025/${n}/1?utm_source=test</link><pubDate>Sun, 25 Oct 2026 10:00:00 +0900</pubDate></item>`;
  const xml = (...items: string[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${items.join("")}</channel></rss>`;
  it("decodes Korean metadata, separates UTC publication/collection and deduplicates", () => {
    const at = "2026-10-25T12:00:00Z",
      rows = parseKoreanNews(xml(item(1), item(1)), at);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "반도체 우주 교육 투자 & 한국",
      source: "동아일보",
      publishedAt: "2026-10-25T01:00:00.000Z",
      fetchedAt: at,
      topics: ["테크", "우주", "금융", "학습"],
      readingMinutes: 0,
    });
    expect(rows[0].url).not.toContain("utm_source");
  });
  it("rejects DTD/entity input, HTML errors and unsafe external links", () => {
    for (const value of [
      "<html>error</html>",
      '<!DOCTYPE rss [<!ENTITY bad SYSTEM "file:///secret">]>' + xml(item(1)),
      xml(item(1).replace("www.donga.com", "evil.example")),
      xml(item(1).replace("Sun, 25 Oct 2026 10:00:00 +0900", "invalid")),
    ])
      expect(() => parseKoreanNews(value)).toThrow();
  });
  it("pages a stable feed snapshot without network or skipped items between pages", async () => {
    const mock = vi.fn(
      async () =>
        new Response(xml(...Array.from({ length: 50 }, (_, n) => item(n)))),
    );
    vi.stubGlobal("fetch", mock);
    const provider = new KoreanNewsProvider(),
      first = await provider.fetchPage(0),
      second = await provider.fetchPage(1),
      third = await provider.fetchPage(2);
    expect([first.length, second.length, third.length]).toEqual([24, 24, 2]);
    expect(new Set([...first, ...second, ...third].map((a) => a.id)).size).toBe(
      50,
    );
    expect(mock).toHaveBeenCalledTimes(1);
    await provider.fetchPage(0);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("RES-01/SEC-02 · external result account verification, mock HTTP", () => {
  it.each([false, true])(
    "accepts only configured authors and matching request snapshots (tracked=%s)",
    async (tracked) => {
      const req = request({ provider: "chatgpt-external", remoteIssue: 12 }),
        run = makeRun(req, "2024-03-03T00:00:00Z");
      run.status = "succeeded";
      const issue = {
        number: 12,
        body: encodeRecord(REQUEST_MARKER, req),
        state: "open",
        updated_at: req.updatedAt,
      };
      const comments = [
        {
          user: { login: "unknown" },
          body: encodeRecord(RUN_MARKER, { ...run, id: "untrusted" }),
        },
        {
          user: { login: "owner" },
          body: encodeRecord(RUN_MARKER, {
            ...run,
            id: "wrong-request",
            requestId: "another",
          }),
        },
        {
          user: { login: "owner" },
          body: encodeRecord(RUN_MARKER, {
            ...run,
            id: "failed-check",
            checks: [{ name: "test", passed: false, detail: "failed" }],
          }),
        },
        { user: { login: "owner" }, body: encodeRecord(RUN_MARKER, run) },
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
                    ? issue
                    : tracked
                      ? []
                      : [issue],
              ),
            ),
        ),
      );
      const gh = new GitHub(`external-${tracked}`);
      expect(
        (
          await gh.records("example/allowed", undefined, tracked ? [12] : [], [
            "OWNER",
          ])
        ).runs.map((r) => r.id),
      ).toEqual([run.id]);
      expect(
        (
          await gh.records(
            "example/allowed",
            undefined,
            tracked ? [12] : [],
            [],
          )
        ).runs,
      ).toEqual([]);
    },
  );
});

it("NEWS-05 · maps an interrupted RSS stream to offline instead of replacing data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("<rss>"));
              controller.error(new Error("connection interrupted"));
            },
          }),
        ),
    ),
  );
  await expect(new KoreanNewsProvider().fetchPage(0)).rejects.toMatchObject({
    code: "OFFLINE",
  });
});
