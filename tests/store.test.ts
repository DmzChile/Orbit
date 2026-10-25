import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/main/store";
import { request } from "./fixtures";
describe("DATA-01/APP-02/REL-01 · durable storage", () => {
  it("serializes concurrent transactions and persists restart state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-store-")),
      store = new Store(dir);
    await store.init();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update((d) => {
          d.savedArticles.push(`article:${i}`);
        }),
      ),
    );
    expect(store.snapshot().savedArticles).toHaveLength(20);
    expect(store.snapshot().version).toBe(20);
    await store.close();
    const reopened = new Store(dir);
    expect((await reopened.init()).savedArticles).toHaveLength(20);
    await reopened.close();
    expect((await readdir(dir)).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
  it("rolls back schema errors and recovers a corrupt file from backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-store-")),
      store = new Store(dir);
    await store.init();
    await store.update((d) => {
      d.settings.reduceMotion = true;
    });
    await expect(
      store.update((d) => {
        d.settings.timezone = "not/a-zone";
      }),
    ).rejects.toThrow();
    expect(store.snapshot().settings.timezone).toBe("Asia/Seoul");
    await store.close();
    await writeFile(join(dir, "state.json"), "{broken");
    const recovered = new Store(dir);
    await recovered.init();
    expect(recovered.snapshot().settings.timezone).toBe("Asia/Seoul");
    expect(await readFile(join(dir, "state.json.corrupt"), "utf8")).toBe(
      "{broken",
    );
    await recovered.close();
  });
  it("protects active owners and retains corrupt data when all backups fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-store-")),
      store = new Store(dir);
    await store.init();
    await expect(new Store(dir).init()).rejects.toMatchObject({
      code: "LOCKED",
    });
    await store.close();
    await writeFile(join(dir, "state.json"), "bad");
    await expect(new Store(dir).init()).rejects.toMatchObject({
      code: "CORRUPT_DATA",
    });
    expect(await readFile(join(dir, "state.json"), "utf8")).toBe("bad");
  });
  it("recovers a lock left by a dead process without discarding data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-stale-lock-")),
      store = new Store(dir);
    await store.init();
    await store.update((d) => {
      d.savedArticles = ["retained"];
    });
    await store.close();
    await writeFile(join(dir, "store.lock"), "2147483647");
    const restored = new Store(dir);
    expect((await restored.init()).savedArticles).toEqual(["retained"]);
    await restored.close();
  });
  it("never rolls a future schema back to a stale backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-future-")),
      store = new Store(dir);
    await store.init();
    await store.update((d) => {
      d.savedArticles = ["backup"];
    });
    await store.close();
    const future = JSON.stringify({ schemaVersion: 99 });
    await writeFile(join(dir, "state.json"), future);
    await expect(new Store(dir).init()).rejects.toMatchObject({
      code: "UPGRADE_REQUIRED",
    });
    expect(await readFile(join(dir, "state.json"), "utf8")).toBe(future);
  });
});

it("DATA-01 · preserves prior API requests while adding the default external-result allowlist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-compatible-")),
    store = new Store(dir);
  await store.init();
  await store.close();
  const previous = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  delete previous.settings.resultAuthors;
  previous.schemaVersion = 1;
  previous.savedArticles = ["hn:saved"];
  previous.requests = [request()];
  await writeFile(join(dir, "state.json"), JSON.stringify(previous));
  const reopened = new Store(dir);
  const restored = await reopened.init();
  expect(restored.settings.resultAuthors).toEqual([]);
  expect(restored.savedArticles).toEqual(["hn:saved"]);
  expect(restored.requests[0].provider).toBe("github-actions-openai");
  expect(restored.schemaVersion).toBe(2);
  expect(
    JSON.parse(await readFile(join(dir, "state.json.v1.backup"), "utf8")),
  ).toMatchObject({ schemaVersion: 1, savedArticles: ["hn:saved"] });
  expect(
    JSON.parse(await readFile(join(dir, "state.json"), "utf8")),
  ).toMatchObject({ schemaVersion: 2 });
  await reopened.reset();
  await expect(
    readFile(join(dir, "state.json.v1.backup")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await reopened.close();
});
