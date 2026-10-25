import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  chooseRuns,
  deterministicRunId,
  isTrustedActor,
  makeArtifacts,
  makeRun,
  mayPublish,
  safeArtifactName,
} from "../worker/runtime";
import { transition } from "../src/domain/calendar";
import { request } from "./fixtures";
import { decodeRecord, encodeRecord, RUN_MARKER } from "../src/main/github";
describe("AUTO/GH/SEC · durable worker planning (no live external execution)", () => {
  it("deduplicates queue redelivery and schedule ticks", () => {
    const req = request(),
      at = "2024-03-03T00:00:00Z",
      run = makeRun(req, at);
    expect(deterministicRunId(req, at)).toBe(run.id);
    expect(chooseRuns(req, [run], [run], "2024-03-03T02:00:00Z")).toEqual([]);
    expect(chooseRuns(req, [], [], "2024-03-03T02:00:00Z")).toHaveLength(1);
  });
  it("does not retry paid failures and respects occurrence limits", () => {
    const req = request({ rule: { ...request().rule, count: 1 } }),
      run = makeRun(req, "2024-03-03T00:00:00Z");
    run.status = "failed";
    expect(chooseRuns(req, [run], [], "2024-03-04T02:00:00Z")).toEqual([]);
  });
  it("requires authorized actors and protects policy/workflows/secrets", () => {
    expect(isTrustedActor("OWNER")).toBe(true);
    expect(isTrustedActor("NONE")).toBe(false);
    for (const p of [
      ".github/workflows/x.yml",
      ".orbit/policy.json",
      ".env",
      "src/key.pem",
      "AGENTS.md",
      "../escape",
    ])
      expect(mayPublish(p)).toBe(false);
    expect(mayPublish("src/app.ts")).toBe(true);
    for (const p of ["../x", "C:\\token", "CON.txt", "a/b", "a?b"])
      expect(safeArtifactName(p)).toBe(false);
  });
  it("rejects false success and stale cancellation transitions", () => {
    const r = makeRun(request(), "2024-03-03T00:00:00Z");
    expect(() => transition(r, "succeeded")).toThrow();
    let next = transition(r, "syncing");
    next = transition(next, "cancel_requested");
    next = transition(next, "cancelled");
    expect(() => transition(next, "succeeded")).toThrow();
  });
  it("round-trips records and generates actual checksum-verifiable PDF/source files", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-artifact-"));
    await writeFile(join(root, "answer.txt"), "실제 소스");
    const run = makeRun(request(), "2024-03-03T00:00:00Z");
    run.summary = "Verified summary";
    run.changedFiles = ["answer.txt"];
    const out = join(root, "out"),
      artifacts = await makeArtifacts(run, root, out);
    expect(artifacts.map((a) => a.format)).toEqual(["text", "pdf", "source"]);
    for (const a of artifacts) {
      const bytes = await readFile(join(out, a.name));
      expect(bytes.length).toBe(a.size);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(a.sha256);
    }
    expect(
      (await readFile(join(out, "summary.pdf"))).subarray(0, 5).toString(),
    ).toBe("%PDF-");
    expect(decodeRecord(encodeRecord(RUN_MARKER, run), RUN_MARKER)).toEqual(
      run,
    );
  });
});
