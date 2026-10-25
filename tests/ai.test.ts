import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceTools, runAI } from "../worker/ai";
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orbit-tools-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "AGENTS.md"), "Read rules\nDo not expose secrets");
  await writeFile(
    join(root, "docs/REQUIREMENTS.md"),
    "Requirements\nReal implementation",
  );
  const check = vi.fn(async () => ({ code: 0, output: "PASS" }));
  const tools = new WorkspaceTools(root, 10000, ["test"], check);
  return { root, tools, check };
}
async function rules(tools: WorkspaceTools) {
  for (const path of ["AGENTS.md", "docs/REQUIREMENTS.md"])
    await tools.call("read_file", { path, startLine: 1, maxLines: 500 });
}
describe("SEC-02/04/AUTO-11 · narrow worker capabilities", () => {
  it("enforces full rule reads before source mutation and checks", async () => {
    const { tools, root, check } = await fixture();
    await expect(
      tools.call("write_file", { path: "src/new.txt", content: "new" }),
    ).rejects.toMatchObject({ code: "RULES_REQUIRED" });
    await tools.call("read_file", {
      path: "AGENTS.md",
      startLine: 1,
      maxLines: 1,
    });
    await expect(
      tools.call("run_check", { script: "test" }),
    ).rejects.toMatchObject({ code: "RULES_REQUIRED" });
    await rules(tools);
    await tools.call("write_file", {
      path: "src/new.txt",
      content: "actual source",
    });
    expect(await readFile(join(root, "src/new.txt"), "utf8")).toBe(
      "actual source",
    );
    await tools.call("run_check", { script: "test" });
    expect(check).toHaveBeenCalledWith("test");
    await expect(
      tools.call("run_check", { script: "build" }),
    ).rejects.toMatchObject({ code: "COMMAND_DENIED" });
  });
  it("denies parent paths, secrets, policy writes, symlinks and unsupported tools", async () => {
    const { tools, root } = await fixture();
    await rules(tools);
    for (const path of [
      "../outside",
      "/etc/passwd",
      ".git/config",
      ".env",
      "key.pem",
      ".github/workflows/exfil.yml",
      ".orbit/policy.json",
      "AGENTS.md",
    ])
      await expect(
        tools.call("write_file", { path, content: "no" }),
      ).rejects.toMatchObject({ code: "PATH_DENIED" });
    const outside = await mkdtemp(join(tmpdir(), "orbit-outside-"));
    await symlink(outside, join(root, "link"), "junction");
    await expect(
      tools.call("write_file", { path: "link/new/file.txt", content: "no" }),
    ).rejects.toMatchObject({ code: "PATH_DENIED" });
    await expect(
      tools.call("arbitrary_shell", { command: "env" }),
    ).rejects.toMatchObject({ code: "TOOL_DENIED" });
    expect(
      ((await tools.call("list_files", { path: "." })) as { files: string[] })
        .files,
    ).toContain("AGENTS.md");
  });
  it("uses the official Responses function loop, bounded usage, and real file tool results", async () => {
    const { tools, root } = await fixture();
    await rules(tools);
    let step = 0;
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body as string);
      expect(body.store).toBe(false);
      expect(body.parallel_tool_calls).toBe(false);
      step++;
      return new Response(
        JSON.stringify(
          step === 1
            ? {
                status: "completed",
                usage: { input_tokens: 20, output_tokens: 10 },
                output: [
                  {
                    type: "function_call",
                    call_id: "c1",
                    name: "write_file",
                    arguments: JSON.stringify({
                      path: "new.txt",
                      content: "verified",
                    }),
                  },
                ],
              }
            : {
                status: "completed",
                usage: { input_tokens: 30, output_tokens: 10 },
                output: [
                  {
                    type: "message",
                    content: [
                      {
                        type: "output_text",
                        text: "Updated new.txt; validation still required.",
                      },
                    ],
                  },
                ],
              },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await runAI({
      key: "test-key-never-a-real-secret",
      model: "test-model",
      prompt: "Task",
      maxTokens: 1000,
      signal: new AbortController().signal,
      tools,
    });
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 20 });
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("verified");
    expect(result.summary).toContain("validation still required");
  });
  it("maps authentication failure without exposing API response bodies", async () => {
    const { tools } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("sensitive provider error", { status: 401 }),
      ),
    );
    await expect(
      runAI({
        key: "test-only",
        model: "test",
        prompt: "Task",
        maxTokens: 1000,
        signal: new AbortController().signal,
        tools,
      }),
    ).rejects.toMatchObject({ code: "NEEDS_AUTH" });
  });
});
