import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/main/store";
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
