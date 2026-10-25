import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readdir,
  readFile,
  mkdir,
  mkdtemp,
  writeFile,
  lstat,
} from "node:fs/promises";
import { basename, join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { runAI, WorkspaceTools } from "./ai";
import { z } from "zod";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { latestDue, terminal, transition } from "../src/domain/calendar";
import {
  OrbitError,
  repoName,
  requestSchema,
  runSchema,
  type Artifact,
  type Request,
  type Run,
  type RunStatus,
} from "../src/domain/model";
import {
  decodeRecord,
  encodeRecord,
  GitHub,
  REQUEST_MARKER,
  RUN_MARKER,
} from "../src/main/github";
export const QUEUE_MARKER = "<!-- orbit-queue:v1 -->";
export const CANCEL_MARKER = "<!-- orbit-cancel:v1 -->";
export const policySchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  repository: repoName,
  model: z.string().min(1).max(100),
  maxMinutes: z.number().int().min(1).max(30),
  maxTokens: z.number().int().min(1000).max(500000),
  validationScripts: z
    .array(z.enum(["test", "build", "typecheck", "lint"]))
    .min(1)
    .max(4),
  allowDependencyInstall: z.boolean(),
  maxFileBytes: z.number().int().min(1024).max(5000000),
  maxSourceBytes: z.number().int().min(1024).max(50000000),
});
export function deterministicRunId(request: Request, at: string) {
  return createHash("sha256")
    .update(`${request.id}:${at}`)
    .digest("hex")
    .slice(0, 32);
}
export function isTrustedActor(association: string) {
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(association);
}
export function safeArtifactName(value: string) {
  return (
    value === basename(value) &&
    !/[<>:"/\\|?*]/.test(value) &&
    !Array.from(value).some((c) => c.charCodeAt(0) < 32) &&
    value !== "." &&
    value !== ".." &&
    !/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(value)
  );
}
export function mayPublish(path: string) {
  return (
    !/(^|\/)(\.git|\.github|\.orbit|node_modules|\.env[^/]*)(\/|$)/i.test(
      path,
    ) &&
    !/(^|\/)(AGENTS\.md|.*\.(pem|key|pfx|p12))$/i.test(path) &&
    !path.includes("..") &&
    !path.startsWith("/")
  );
}
export function makeRun(request: Request, at: string): Run {
  const id = deterministicRunId(request, at),
    now = new Date().toISOString();
  return {
    id,
    requestId: request.id,
    scheduledFor: at,
    idempotencyKey: `${request.id}:${at}`,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    requestSnapshot: request,
    attempts: 0,
    steps: [{ status: "queued", at: now }],
    summary: "예약 실행 대기",
    checks: [],
    artifacts: [],
    changedFiles: [],
  };
}
export function chooseRuns(
  request: Request,
  records: Run[],
  queued: Run[],
  now: string,
) {
  const runs: Run[] = [];
  for (const q of queued) {
    if (
      q.requestId !== request.id ||
      q.requestSnapshot.id !== request.id ||
      q.requestSnapshot.repository !== request.repository ||
      !q.requestSnapshot.consent ||
      q.status !== "queued" ||
      records.some((r) => r.id === q.id) ||
      runs.some((r) => r.id === q.id)
    )
      continue;
    runs.push(q);
  }
  const history = records.filter((r) => r.requestId === request.id),
    last = history
      .filter((r) => r.id === deterministicRunId(request, r.scheduledFor))
      .map((r) => r.scheduledFor)
      .sort()
      .at(-1);
  if (
    request.rule.count &&
    history.filter((r) => r.id === deterministicRunId(request, r.scheduledFor))
      .length >= request.rule.count
  )
    return runs;
  const due = latestDue(request, now, last);
  if (due) {
    const run = makeRun(request, due);
    if (!records.some((r) => r.id === run.id)) runs.push(run);
  }
  return runs;
}
function exec(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = 120000,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let output = "",
      overflow = false;
    const add = (d: Buffer) => {
      if (output.length + d.length > 1048576) {
        overflow = true;
        child.kill("SIGKILL");
      } else output += d.toString();
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeout);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: overflow ? 1 : (code ?? 1), output });
    });
  });
}
const cleanEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: home,
  LANG: "C.UTF-8",
  CI: "true",
  GIT_TERMINAL_PROMPT: "0",
});
export async function makeArtifacts(
  run: Run,
  root: string,
  out: string,
  maxSourceBytes = 50000000,
): Promise<Artifact[]> {
  await mkdir(out, { recursive: true });
  const files: { name: string; format: Artifact["format"]; data: Buffer }[] =
    [];
  const summary = `Orbit · ${run.requestSnapshot.title}\nRun: ${run.id}\nRepository: ${run.requestSnapshot.repository}\nBase SHA: ${run.baseSHA ?? ""}\n\n${run.summary}\n\nChecks\n${run.checks.map((c) => `${c.passed ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`).join("\n")}\n\nChanged files\n${run.changedFiles.join("\n")}`;
  if (run.requestSnapshot.formats.includes("text"))
    files.push({
      name: "summary.txt",
      format: "text",
      data: Buffer.from(summary),
    });
  if (run.requestSnapshot.formats.includes("pdf")) {
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 48 }),
        chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const font = process.env.ORBIT_PDF_FONT;
      if (font) doc.font(font);
      doc.fontSize(19).text("Orbit");
      doc.moveDown().fontSize(11).text(summary);
      doc.end();
    });
    files.push({ name: "summary.pdf", format: "pdf", data: pdf });
  }
  if (run.requestSnapshot.formats.includes("source")) {
    const archive = new JSZip();
    let total = 0;
    for (const path of run.changedFiles) {
      if (!mayPublish(path)) continue;
      const absolute = resolve(root, path);
      if (
        relative(root, absolute).startsWith("..") ||
        isAbsolute(relative(root, absolute))
      )
        throw new OrbitError("UNSAFE_FILE", "허용되지 않은 소스 경로입니다.");
      let stat;
      try {
        stat = await lstat(absolute);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new OrbitError(
          "UNSAFE_FILE",
          "일반 소스 파일만 묶을 수 있습니다.",
        );
      total += stat.size;
      if (total > maxSourceBytes)
        throw new OrbitError("TOO_LARGE", "소스 묶음 한도를 초과했습니다.");
      archive.file(path, await readFile(absolute));
    }
    archive.file(
      "orbit-manifest.json",
      JSON.stringify(
        { runId: run.id, baseSHA: run.baseSHA, changedFiles: run.changedFiles },
        null,
        2,
      ),
    );
    files.push({
      name: "source.zip",
      format: "source",
      data: await archive.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      }),
    });
  }
  const artifacts: Artifact[] = [];
  for (const f of files) {
    await writeFile(join(out, f.name), f.data, { mode: 0o600 });
    artifacts.push({
      id: `${run.id}:${f.name}`,
      name: f.name,
      format: f.format,
      size: f.data.length,
      sha256: createHash("sha256").update(f.data).digest("hex"),
      storageKey: f.name,
    });
  }
  return artifacts;
}
async function comments(gh: GitHub, repo: string, issue: number) {
  const result: Record<string, any>[] = [];
  for (let p = 1; p <= 100; p++) {
    const rows = await gh.api(
      `/repos/${repo}/issues/${issue}/comments?per_page=100&page=${p}`,
    );
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw new OrbitError(
    "PAGINATION_LIMIT",
    "요청 댓글 조회 한도를 초과했습니다.",
  );
}
async function executeRun(
  gh: GitHub,
  repo: string,
  issue: number,
  run: Run,
  commentId?: number,
) {
  const jobId = Number(process.env.GITHUB_RUN_ID);
  run = {
    ...run,
    workflowRunId: jobId,
    issueNumber: issue,
    attempts: run.attempts + 1,
  };
  let messageId = commentId;
  async function persist(status?: RunStatus) {
    if (status) run = transition(run, status);
    run.updatedAt = new Date().toISOString();
    run.lease = terminal(run.status)
      ? undefined
      : {
          owner: String(jobId),
          heartbeatAt: run.updatedAt,
          expiresAt: new Date(Date.now() + 90000).toISOString(),
        };
    const body = encodeRecord(RUN_MARKER, run);
    if (messageId)
      await gh.api(`/repos/${repo}/issues/comments/${messageId}`, "PATCH", {
        body,
      });
    else
      messageId = (
        await gh.api(`/repos/${repo}/issues/${issue}/comments`, "POST", {
          body,
        })
      ).id;
    console.log(
      JSON.stringify({
        event: "run_status",
        runId: run.id,
        requestId: run.requestId,
        status: run.status,
        attempt: run.attempts,
      }),
    );
  }
  const root = await mkdtemp(join(tmpdir(), "orbit-run-")),
    checkout = join(root, "repository"),
    home = join(root, "home");
  await mkdir(home);
  const env = cleanEnv(home),
    authEnv = {
      ...env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString("base64")}`,
    };
  const git = async (args: string[], auth = false) => {
    const r = await exec(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "credential.helper=",
        ...args,
      ],
      checkout,
      auth ? authEnv : env,
    );
    if (r.code)
      throw new OrbitError(
        "GIT_FAILED",
        "Git 작업에 실패했습니다. 권한·브랜치·보호 정책을 확인하세요.",
      );
    return r.output;
  };
  async function changedPaths() {
    const output = await git([
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
    ]);
    const entries = output.split("\0"),
      paths: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      if (entry.length < 4)
        throw new OrbitError("GIT_STATUS", "Git 상태 응답이 잘렸습니다.");
      paths.push(entry.slice(3));
      if (
        entry[0] === "R" ||
        entry[1] === "R" ||
        entry[0] === "C" ||
        entry[1] === "C"
      ) {
        const source = entries[++i];
        if (source) paths.push(source);
      }
    }
    return [...new Set(paths)];
  }
  try {
    await persist("syncing");
    await mkdir(checkout);
    const commit = await gh.api(
      `/repos/${repo}/commits/${encodeURIComponent(run.requestSnapshot.baseBranch)}`,
    );
    run.baseSHA = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(commit.sha);
    await git(["init"]);
    await git(["remote", "add", "origin", `https://github.com/${repo}.git`]);
    await git(["fetch", "--depth=1", "origin", run.baseSHA!], true);
    await git(["checkout", "--detach", run.baseSHA!]);
    run.branch = `orbit/run-${run.id}`;
    await git(["switch", "-c", run.branch]);
    const rules = await readFile(join(checkout, "AGENTS.md"), "utf8"),
      requirements = await readFile(
        join(checkout, "docs", "REQUIREMENTS.md"),
        "utf8",
      );
    if (!rules.trim() || !requirements.trim())
      throw new OrbitError(
        "RULES_MISSING",
        "실행기의 AGENTS.md와 docs/REQUIREMENTS.md가 필요합니다.",
      );
    const policy = policySchema.parse(
      JSON.parse(
        await readFile(join(checkout, ".orbit", "policy.json"), "utf8"),
      ),
    );
    if (!policy.enabled || policy.repository !== repo)
      throw new OrbitError(
        "POLICY_DISABLED",
        "실행 정책이 비활성화되었거나 저장소가 일치하지 않습니다.",
      );
    run.ruleHashes = {
      "AGENTS.md": createHash("sha256").update(rules).digest("hex"),
      "docs/REQUIREMENTS.md": createHash("sha256")
        .update(requirements)
        .digest("hex"),
      ".orbit/policy.json": createHash("sha256")
        .update(JSON.stringify(policy))
        .digest("hex"),
    };
    const cancelled = async () => {
      const rows = await comments(gh, repo, issue);
      return rows.some(
        (c) =>
          isTrustedActor(c.author_association) &&
          c.body?.startsWith(CANCEL_MARKER) &&
          (() => {
            try {
              return (
                (decodeRecord(c.body, CANCEL_MARKER) as { runId?: string })
                  .runId === run.id
              );
            } catch {
              return false;
            }
          })(),
      );
    };
    if (await cancelled()) {
      await persist("cancel_requested");
      await persist("cancelled");
      return;
    }
    if (!process.env.OPENAI_API_KEY)
      throw new OrbitError(
        "NEEDS_AUTH",
        "실행기 OPENAI_API_KEY secret이 필요합니다.",
      );
    if (policy.allowDependencyInstall) {
      const install = await exec(
        "npm",
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        checkout,
        env,
        180000,
      );
      if (install.code)
        throw new OrbitError(
          "DEPENDENCY_FAILED",
          "허용된 의존성 설치가 실패했습니다.",
        );
    }
    await persist("running");
    const controller = new AbortController();
    let cancel = false;
    let timeoutReached = false;
    const timeout = setTimeout(() => {
      timeoutReached = true;
      controller.abort();
    }, policy.maxMinutes * 60000);
    let heartbeat = Promise.resolve();
    const beat = setInterval(() => {
      heartbeat = heartbeat
        .then(async () => {
          if (await cancelled()) {
            cancel = true;
            controller.abort();
          } else await persist();
        })
        .catch(() => controller.abort());
    }, 30000);
    async function isolatedCheck(script: string) {
      const name = `orbit-check-${run.id}-${crypto.randomUUID().slice(0, 8)}`;
      try {
        return await exec(
          "docker",
          [
            "run",
            "--rm",
            "--name",
            name,
            "--network",
            "none",
            "--cpus",
            "2",
            "--memory",
            "2g",
            "--pids-limit",
            "256",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=256m",
            "-e",
            "CI=true",
            "-e",
            "HOME=/tmp",
            "-v",
            `${checkout}:/work`,
            "-v",
            `${join(checkout, ".git")}:/work/.git:ro`,
            "-w",
            "/work",
            "node:24-bookworm-slim",
            "npm",
            "run",
            script,
          ],
          root,
          env,
          Math.min(120000, policy.maxMinutes * 60000),
        );
      } finally {
        await exec("docker", ["rm", "-f", name], root, env).catch(() => {});
      }
    }
    try {
      const result = await runAI({
        key: process.env.OPENAI_API_KEY,
        model: policy.model,
        maxTokens: policy.maxTokens,
        signal: controller.signal,
        tools: new WorkspaceTools(
          checkout,
          policy.maxFileBytes,
          policy.validationScripts,
          isolatedCheck,
        ),
        prompt: `Repository ${repo}, base SHA ${run.baseSHA}, rule SHA-256 hashes ${JSON.stringify(run.ruleHashes)}. Read the actual AGENTS.md and docs/REQUIREMENTS.md with read_file before edits, and inspect scoped nested rules. User request ${run.requestId}, run ${run.id}: ${JSON.stringify({ prompt: run.requestSnapshot.prompt, refs: run.requestSnapshot.refs })}. Implement real source/document changes using only file tools. No arbitrary shell, network, package installation, policy/rule edits or publication is permitted. run_check is available only for explicitly allowed scripts. Finish with changes, failed checks and remaining work.`,
      });
      run.summary = result.summary;
      run.usage = result.usage;
    } catch (e) {
      if (cancel)
        throw new OrbitError("CANCELLED", "사용자가 실행을 취소했습니다.");
      if (timeoutReached)
        throw new OrbitError("TIMEOUT", "실행 시간 제한을 초과했습니다.");
      throw e;
    } finally {
      clearTimeout(timeout);
      clearInterval(beat);
      await heartbeat;
    }
    if (cancel || (await cancelled())) {
      await persist("cancel_requested");
      await persist("cancelled");
      return;
    }
    await persist("validating");
    let changes = await changedPaths();
    for (const path of changes) {
      if (!mayPublish(path))
        throw new OrbitError(
          "UNSAFE_CHANGE",
          `보호 경로의 변경을 게시할 수 없습니다: ${path}`,
        );
      const st = await lstat(join(checkout, path)).catch(() => null);
      if (st && (st.isSymbolicLink() || st.size > policy.maxFileBytes))
        throw new OrbitError(
          "UNSAFE_CHANGE",
          "심볼릭 링크 또는 과도한 파일 크기를 발견했습니다.",
        );
    }
    run.changedFiles = changes;
    const pkg = JSON.parse(
      await readFile(join(checkout, "package.json"), "utf8"),
    );
    for (const script of policy.validationScripts) {
      if (!pkg.scripts?.[script]) {
        run.checks.push({
          name: `npm run ${script}`,
          passed: false,
          detail: "실행 정책에 지정된 스크립트가 없습니다.",
        });
        throw new OrbitError(
          "VALIDATION_FAILED",
          "필수 검증 스크립트가 없습니다.",
        );
      }
      const result = await isolatedCheck(script);
      run.checks.push({
        name: `npm run ${script}`,
        passed: result.code === 0,
        detail:
          result.code === 0
            ? "실제 격리 실행 통과"
            : `종료 코드 ${result.code} · 로그에 민감 정보가 포함될 수 있어 원문은 게시하지 않습니다.`,
      });
      if (result.code)
        throw new OrbitError(
          "VALIDATION_FAILED",
          "필수 검증이 실패했습니다. PR을 게시하지 않았습니다.",
        );
    }
    if (await cancelled()) {
      await persist("cancel_requested");
      await persist("cancelled");
      return;
    }
    changes = await changedPaths();
    for (const path of changes) {
      if (!mayPublish(path))
        throw new OrbitError(
          "UNSAFE_CHANGE",
          "검증 후 보호 경로 변경을 발견했습니다.",
        );
      const st = await lstat(join(checkout, path)).catch(() => null);
      if (st && (st.isSymbolicLink() || st.size > policy.maxFileBytes))
        throw new OrbitError(
          "UNSAFE_CHANGE",
          "검증 후 안전하지 않은 파일을 발견했습니다.",
        );
    }
    run.changedFiles = changes;
    await persist("publishing");
    if (changes.length && run.requestSnapshot.outputPolicy === "pr") {
      await git(["config", "user.name", "orbit[bot]"]);
      await git(["config", "user.email", "orbit-bot@users.noreply.github.com"]);
      await git(["add", "--all"]);
      await git([
        "commit",
        "-m",
        `Orbit: ${run.requestSnapshot.title}\n\nRequest: ${run.requestId}\nRun: ${run.id}`,
      ]);
      run.outputSHA = (await git(["rev-parse", "HEAD"])).trim();
      const existing = await gh.api(
        `/repos/${repo}/pulls?head=${encodeURIComponent(`${repo.split("/")[0]}:${run.branch}`)}&state=all`,
      );
      if (existing.length) {
        run.prUrl = existing[0].html_url;
        run.prNumber = existing[0].number;
      } else {
        await git(["push", "origin", `HEAD:refs/heads/${run.branch}`], true);
        const pr = await gh.api(`/repos/${repo}/pulls`, "POST", {
          title: run.requestSnapshot.title,
          head: run.branch,
          base: run.requestSnapshot.baseBranch,
          body: `Request: ${run.requestId}\nRun: ${run.id}\nBase: ${run.baseSHA}\n\n${run.summary.slice(0, 10000)}\n\nChecks:\n${run.checks.map((c) => `- ${c.passed ? "PASS" : "FAIL"} ${c.name}`).join("\n")}\n\nResult issue: #${issue}`,
          draft: true,
        });
        run.prUrl = pr.html_url;
        run.prNumber = pr.number;
      }
    } else if (!changes.length)
      run.summary += "\n\n변경 없음 · 빈 PR은 만들지 않았습니다.";
    const out = join(
      process.env.ORBIT_ARTIFACT_ROOT ?? join(root, "artifacts"),
      run.id,
    );
    run.artifacts = await makeArtifacts(
      run,
      checkout,
      out,
      policy.maxSourceBytes,
    );
    await persist();
    await writeFile(join(out, "run.json"), JSON.stringify(run, null, 2));
    // The finalize step marks success only after GitHub confirms artifact upload.
  } catch (e) {
    const code =
      e instanceof OrbitError
        ? e.code
        : e instanceof z.ZodError
          ? "POLICY_INVALID"
          : "EXECUTION_FAILED";
    run.errorCode = code;
    run.summary =
      code === "NEEDS_AUTH"
        ? "실행기 인증 설정을 확인하세요."
        : `작업을 완료하지 못했습니다 (${code}). ${e instanceof OrbitError ? e.message : "실행 정책과 GitHub Actions 상태를 확인하세요."}`;
    if (code === "CANCELLED") {
      if (run.status !== "cancel_requested") await persist("cancel_requested");
      await persist("cancelled");
    } else if (run.status === "cancel_requested") await persist("cancelled");
    else if (!terminal(run.status))
      await persist(
        code === "NEEDS_AUTH" &&
          ["queued", "syncing", "publishing"].includes(run.status)
          ? "needs_auth"
          : code === "CONFLICT"
            ? "conflict"
            : "failed",
      );
  }
}
export async function scan() {
  const repo = repoName.parse(process.env.GITHUB_REPOSITORY),
    gh = new GitHub(z.string().min(1).parse(process.env.GITHUB_TOKEN));
  const only = Number(process.env.ORBIT_ISSUE_NUMBER ?? 0);
  const issues: Record<string, any>[] = [];
  if (only) issues.push(await gh.api(`/repos/${repo}/issues/${only}`));
  else
    for (let p = 1; p <= 20; p++) {
      const batch = await gh.api(
        `/repos/${repo}/issues?state=open&per_page=100&page=${p}`,
      );
      issues.push(...batch);
      if (batch.length < 100) break;
    }
  for (const issue of issues) {
    if (
      !isTrustedActor(issue.author_association) ||
      !issue.body?.startsWith(REQUEST_MARKER) ||
      !issue.labels?.some((l: { name: string }) =>
        ["orbit:request", "orbit:schedule"].includes(l.name),
      )
    )
      continue;
    let req: Request;
    try {
      req = requestSchema.parse(decodeRecord(issue.body, REQUEST_MARKER));
    } catch {
      continue;
    }
    if (
      req.repository !== repo ||
      !req.consent ||
      req.provider !== "github-actions-openai"
    )
      continue;
    const rows = await comments(gh, repo, issue.number),
      records: Run[] = [],
      queued: Run[] = [];
    for (const c of rows) {
      try {
        if (
          c.user?.login === "github-actions[bot]" &&
          c.body?.startsWith(RUN_MARKER)
        ) {
          const r = runSchema.parse(decodeRecord(c.body, RUN_MARKER));
          records.push(r);
          if (
            !terminal(r.status) &&
            r.workflowRunId !== Number(process.env.GITHUB_RUN_ID)
          ) {
            const status = await gh.api(
              `/repos/${repo}/actions/runs/${r.workflowRunId}`,
            );
            if (status.status === "completed") {
              let recovery: Run;
              if (r.status === "publishing") {
                const uploads = await gh.api(
                    `/repos/${repo}/actions/runs/${r.workflowRunId}/artifacts?per_page=100`,
                  ),
                  actual = uploads.artifacts.find(
                    (a: { name: string }) =>
                      a.name === `orbit-results-${r.workflowRunId}`,
                  );
                if (actual && r.artifacts.length) {
                  recovery = transition(
                    {
                      ...r,
                      artifacts: r.artifacts.map((a) => ({
                        ...a,
                        githubArtifactId: actual.id,
                        expiresAt: actual.expires_at,
                        storageKey: `${r.id}/${a.name}`,
                      })),
                    },
                    "succeeded",
                  );
                } else
                  recovery = {
                    ...r,
                    status: "failed",
                    errorCode: "RESULT_UPLOAD_FAILED",
                    summary:
                      r.summary +
                      "\n\nPR 작업 상태는 유지되지만 산출물 업로드를 확인하지 못했습니다. 모델 작업을 자동 재실행하지 않습니다.",
                    updatedAt: new Date().toISOString(),
                  };
              } else
                recovery = {
                  ...r,
                  status:
                    status.conclusion === "cancelled" ? "cancelled" : "failed",
                  errorCode: "INTERRUPTED",
                  summary:
                    "이전 실행기가 중단되었습니다. 중복 과금을 막기 위해 자동 재실행하지 않습니다. 결과와 PR을 확인한 후 새 실행을 요청하세요.",
                  updatedAt: new Date().toISOString(),
                };
              await gh.api(`/repos/${repo}/issues/comments/${c.id}`, "PATCH", {
                body: encodeRecord(RUN_MARKER, recovery),
              });
            }
          }
        } else if (
          isTrustedActor(c.author_association) &&
          c.body?.startsWith(QUEUE_MARKER)
        )
          queued.push(runSchema.parse(decodeRecord(c.body, QUEUE_MARKER)));
      } catch (e) {
        if (e instanceof OrbitError) throw e;
      }
    }
    const todo = chooseRuns(req, records, queued, new Date().toISOString());
    for (const run of todo.slice(0, 5))
      await executeRun(gh, repo, issue.number, run);
  }
}
export async function finalize() {
  const repo = repoName.parse(process.env.GITHUB_REPOSITORY),
    gh = new GitHub(z.string().min(1).parse(process.env.GITHUB_TOKEN));
  const root = process.env.ORBIT_ARTIFACT_ROOT!;
  for (const dir of await readdir(root).catch(() => [])) {
    const file = join(root, dir, "run.json");
    const run = runSchema.parse(JSON.parse(await readFile(file, "utf8")));
    if (run.status !== "publishing") continue;
    const artifacts = await gh.api(
      `/repos/${repo}/actions/runs/${run.workflowRunId}/artifacts?per_page=100`,
    );
    const actual = artifacts.artifacts.find(
      (a: { name: string }) => a.name === `orbit-results-${run.workflowRunId}`,
    );
    if (!actual) continue;
    run.artifacts = run.artifacts.map((a) => ({
      ...a,
      githubArtifactId: actual.id,
      expiresAt: actual.expires_at,
      storageKey: `${run.id}/${a.name}`,
    }));
    const success = transition(run, "succeeded");
    const rows = await comments(gh, repo, run.issueNumber!);
    const comment = rows.find(
      (c) =>
        c.user?.login === "github-actions[bot]" &&
        c.body?.startsWith(RUN_MARKER) &&
        (() => {
          try {
            return (decodeRecord(c.body, RUN_MARKER) as Run).id === run.id;
          } catch {
            return false;
          }
        })(),
    );
    if (!comment)
      throw new OrbitError("RESULT_MISSING", "결과 댓글을 찾을 수 없습니다.");
    await gh.api(`/repos/${repo}/issues/comments/${comment.id}`, "PATCH", {
      body: encodeRecord(RUN_MARKER, success),
    });
  }
}
