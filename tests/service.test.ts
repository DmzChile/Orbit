import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import JSZip from "jszip";
vi.mock("electron", () => ({
  app: { getVersion: () => "0.1.0" },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
}));
import { dialog } from "electron";
import { Service } from "../src/main/service";
import { Store } from "../src/main/store";
import type { Vault } from "../src/main/vault";
import type { GitHub } from "../src/main/github";
import { request } from "./fixtures";
import { makeRun } from "../worker/runtime";
afterEach(() => vi.clearAllMocks());
describe("RES-03/04 · actual files with mock authenticated archive transport", () => {
  it("verifies SHA-256, writes chosen file atomically and reports transfer stages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-download-")),
      store = new Store(dir);
    await store.init();
    const run = makeRun(request(), "2024-03-03T00:00:00Z"),
      bytes = Buffer.from("actual output file");
    run.status = "succeeded";
    run.artifacts = [
      {
        id: "artifact:1",
        name: "summary.txt",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        storageKey: "run/summary.txt",
        format: "text",
        githubArtifactId: 1,
      },
    ];
    await store.update((d) => {
      d.runs.push(run);
      d.settings.allowedRepos = ["example/allowed"];
    });
    const archive = await new JSZip()
      .file("run/summary.txt", bytes)
      .generateAsync({ type: "nodebuffer" });
    const stages: string[] = [];
    const service = new Service(
      store,
      {} as Vault,
      () => {},
      () => {},
      (p) => stages.push(p.stage),
    );
    vi.spyOn(service, "github").mockResolvedValue({
      archive: async (
        _id: number,
        _repo: string,
        progress: (n: number, total: number) => void,
      ) => {
        progress(archive.length, archive.length);
        return archive;
      },
    } as unknown as GitHub);
    const output = join(dir, "result.txt");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: output,
    });
    expect(await service.download({ runId: run.id })).toMatchObject({
      saved: true,
    });
    expect(await readFile(output)).toEqual(bytes);
    expect(stages).toEqual(["downloading", "verifying", "saving"]);
    await store.close();
  });
  it("blocks mismatched files before opening a save dialog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-checksum-")),
      store = new Store(dir);
    await store.init();
    const run = makeRun(request(), "2024-03-03T00:00:00Z");
    run.artifacts = [
      {
        id: "artifact:1",
        name: "summary.txt",
        size: 5,
        sha256: "0".repeat(64),
        storageKey: "summary.txt",
        format: "text",
        githubArtifactId: 1,
      },
    ];
    await store.update((d) => {
      d.runs.push(run);
    });
    const archive = await new JSZip()
        .file("summary.txt", "wrong")
        .generateAsync({ type: "nodebuffer" }),
      service = new Service(
        store,
        {} as Vault,
        () => {},
        () => {},
      );
    vi.spyOn(service, "github").mockResolvedValue({
      archive: async () => archive,
    } as unknown as GitHub);
    await expect(service.download({ runId: run.id })).rejects.toMatchObject({
      code: "CHECKSUM_MISMATCH",
    });
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    await store.close();
  });
  it("keeps version conflicts from overwriting a board", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-version-")),
      store = new Store(dir);
    await store.init();
    const board = store.snapshot().boards[0],
      service = new Service(
        store,
        {} as Vault,
        () => {},
        () => {},
      );
    await service.call("board.save", { ...board, name: "new" });
    await expect(
      service.call("board.save", { ...board, name: "stale" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.snapshot().boards[0].name).toBe("new");
    await store.close();
  });
  it("attaches actual UTF-8 content with checksum and no source path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-attach-")),
      store = new Store(dir);
    await store.init();
    const path = join(dir, "reference.txt");
    await writeFile(path, "실제 참조 파일");
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [path],
    });
    const service = new Service(
        store,
        {} as Vault,
        () => {},
        () => {},
      ),
      file = (await service.call("attachment.pick", undefined)) as {
        name: string;
        sha256: string;
        text: string;
      };
    expect(file.name).toBe("reference.txt");
    expect(file.text).toBe("실제 참조 파일");
    expect(file.sha256).toBe(
      createHash("sha256").update(Buffer.from(file.text)).digest("hex"),
    );
    expect(file).not.toHaveProperty("path");
    const metrics = await service.call("diagnostics", undefined);
    expect(metrics).toMatchObject({
      completedRuns: 0,
      successRate: null,
      averageLatencyMilliseconds: null,
    });
    await store.close();
  });
});
