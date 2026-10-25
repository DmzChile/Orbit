import { z } from "zod";
import { createHash } from "node:crypto";
import {
  OrbitError,
  repoName,
  requestSchema,
  runSchema,
  type Request,
  type Run,
} from "../domain/model";
export const REQUEST_MARKER = "<!-- orbit-request:v1 -->";
export const RUN_MARKER = "<!-- orbit-run:v1 -->";
export const encodeRecord = (marker: string, data: unknown) => {
  const body = `${marker}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  if (body.length > 64000)
    throw new OrbitError(
      "RECORD_TOO_LARGE",
      "요청/첨부/요약이 GitHub 본문 한도를 초과했습니다. 내용을 줄여주세요.",
    );
  return body;
};
export function decodeRecord(body: string, marker: string): unknown {
  if (!body.startsWith(marker))
    throw new OrbitError("INVALID_RECORD", "Orbit 레코드 형식이 아닙니다.");
  const raw = body.slice(marker.length).trim();
  if (!raw.startsWith("```json\n") || !raw.endsWith("```"))
    throw new OrbitError("INVALID_RECORD", "레코드 본문이 올바르지 않습니다.");
  return JSON.parse(raw.slice(8, -3));
}
const responseCache = new Map<string, { etag: string; value: unknown }>();
function tryDecode(body: string, marker: string) {
  try {
    return decodeRecord(body, marker);
  } catch {
    return null;
  }
}
export class GitHub {
  constructor(private token: string) {}
  async api(
    path: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) {
    const key = createHash("sha256").update(this.token).digest("hex") + path,
      cached = method === "GET" ? responseCache.get(key) : undefined;
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method,
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          ...(cached ? { "If-None-Match": cached.etag } : {}),
          ...headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch {
      throw new OrbitError(
        "OFFLINE",
        "GitHub에 연결하지 못했습니다. 다시 시도하세요.",
      );
    }
    if (response.status === 304 && cached) return structuredClone(cached.value);
    if (!response.ok) {
      const rate =
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0");
      throw new OrbitError(
        rate
          ? "RATE_LIMIT"
          : response.status === 401
            ? "NEEDS_AUTH"
            : response.status === 404
              ? "NOT_FOUND"
              : response.status === 409 || response.status === 422
                ? "CONFLICT"
                : response.status === 403
                  ? "FORBIDDEN"
                  : "PROVIDER_ERROR",
        rate
          ? "GitHub API 사용 한도에 도달했습니다. 자동 조회 간격을 늘립니다."
          : response.status === 401
            ? "GitHub 인증이 만료되었거나 취소되었습니다. 다시 연결하세요."
            : response.status === 404
              ? "대상을 찾을 수 없거나 접근 권한이 없습니다."
              : response.status === 403
                ? "이 GitHub 작업에 필요한 권한이 없습니다."
                : `GitHub 요청 실패 (${response.status}).`,
      );
    }
    if (response.status === 204) return undefined;
    const value = await response.json();
    if (method === "GET" && response.headers.get("etag")) {
      if (responseCache.size > 1000) responseCache.clear();
      responseCache.set(key, { etag: response.headers.get("etag")!, value });
    } else if (method !== "GET") responseCache.clear();
    return value;
  }
  async account() {
    return z
      .object({ login: z.string(), id: z.number() })
      .parse(await this.api("/user"));
  }
  async repositories(page = 1) {
    return z
      .array(
        z.object({
          full_name: repoName,
          default_branch: z.string(),
          permissions: z.object({ push: z.boolean().optional() }).optional(),
        }),
      )
      .parse(
        await this.api(`/user/repos?per_page=100&page=${page}&sort=updated`),
      );
  }
  async branches(repo: string, page = 1) {
    repoName.parse(repo);
    return z
      .array(z.object({ name: z.string() }))
      .parse(
        await this.api(`/repos/${repo}/branches?per_page=100&page=${page}`),
      );
  }
  async ensureLabels(repo: string) {
    for (const name of ["orbit:request", "orbit:schedule"]) {
      try {
        await this.api(`/repos/${repo}/labels/${encodeURIComponent(name)}`);
      } catch (e) {
        if (!(e instanceof OrbitError) || e.code !== "NOT_FOUND") throw e;
        await this.api(`/repos/${repo}/labels`, "POST", {
          name,
          color: "2765E8",
          description: "Orbit 작업 레코드",
        });
      }
    }
  }
  async publishRequest(request: Request) {
    requestSchema.parse(request);
    await this.ensureLabels(request.repository);
    const body = encodeRecord(REQUEST_MARKER, request);
    if (request.remoteIssue) {
      const current = await this.api(
        `/repos/${request.repository}/issues/${request.remoteIssue}`,
      );
      if (
        request.remoteUpdatedAt &&
        current.updated_at !== request.remoteUpdatedAt
      )
        throw new OrbitError(
          "CONFLICT",
          "원격 예약이 변경되었습니다. 동기화 후 다시 편집하세요.",
        );
      return this.api(
        `/repos/${request.repository}/issues/${request.remoteIssue}`,
        "PATCH",
        {
          title: `[Orbit] ${request.title}`,
          body,
          labels: [
            request.rule.frequency === "manual"
              ? "orbit:request"
              : "orbit:schedule",
          ],
          state: request.enabled ? "open" : "closed",
        },
      );
    }
    return this.api(`/repos/${request.repository}/issues`, "POST", {
      title: `[Orbit] ${request.title}`,
      body,
      labels: [
        request.rule.frequency === "manual"
          ? "orbit:request"
          : "orbit:schedule",
      ],
    });
  }
  async workflow(repo: string) {
    return this.api(`/repos/${repo}/actions/workflows/orbit-worker.yml`);
  }
  async dispatch(request: Request) {
    await this.workflow(request.repository);
    await this.api(
      `/repos/${request.repository}/actions/workflows/orbit-worker.yml/dispatches`,
      "POST",
      {
        ref: request.baseBranch,
        inputs: { issue_number: String(request.remoteIssue) },
      },
    );
  }
  async enqueue(run: Run) {
    const repo = run.requestSnapshot.repository,
      issue = run.issueNumber;
    if (!issue) throw new OrbitError("NOT_PUBLISHED", "요청 Issue가 없습니다.");
    for (let page = 1; page <= 100; page++) {
      const comments = await this.api(
        `/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`,
      );
      if (
        comments.some((c: { body?: string }) => {
          try {
            return (
              c.body?.startsWith("<!-- orbit-queue:v1 -->") &&
              (decodeRecord(c.body, "<!-- orbit-queue:v1 -->") as Run).id ===
                run.id
            );
          } catch {
            return false;
          }
        })
      )
        return;
      if (comments.length < 100) {
        await this.api(`/repos/${repo}/issues/${issue}/comments`, "POST", {
          body: encodeRecord("<!-- orbit-queue:v1 -->", run),
        });
        return;
      }
    }
    throw new OrbitError(
      "PAGINATION_LIMIT",
      "전송 여부를 확인하지 못했습니다. 중복 전송을 중단했습니다.",
    );
  }
  async activity(repo: string) {
    return z
      .array(
        z.object({
          id: z.number(),
          title: z.string(),
          html_url: z.string().url(),
          state: z.string(),
          pull_request: z.unknown().optional(),
        }),
      )
      .parse(await this.api(`/repos/${repo}/issues?state=open&per_page=8`));
  }
  async records(
    repo: string,
    since?: string,
    tracked: number[] = [],
  ): Promise<{ requests: Request[]; runs: Run[]; cursor: string }> {
    const started = new Date().toISOString();
    const requests: Request[] = [],
      runs: Run[] = [];
    const seen = new Set<number>();
    for (let page = 1; page <= 20; page++) {
      const issues = await this.api(
        `/repos/${repo}/issues?state=all&sort=updated&direction=asc&per_page=100&page=${page}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
      );
      if (!Array.isArray(issues))
        throw new OrbitError(
          "PROVIDER_DATA",
          "GitHub 레코드 응답이 올바르지 않습니다.",
        );
      for (const issue of issues) {
        seen.add(issue.number);
        if (issue.pull_request || !issue.body?.startsWith(REQUEST_MARKER))
          continue;
        const parsed = requestSchema.safeParse(
          tryDecode(issue.body, REQUEST_MARKER),
        );
        if (!parsed.success || parsed.data.repository !== repo) continue;
        requests.push({
          ...parsed.data,
          remoteIssue: issue.number,
          remoteUpdatedAt: issue.updated_at,
          enabled: issue.state === "open" && parsed.data.enabled,
        });
        for (let p = 1; p <= 100; p++) {
          const comments = await this.api(
            `/repos/${repo}/issues/${issue.number}/comments?per_page=100&page=${p}`,
          );
          for (const c of comments) {
            if (
              c.user?.login !== "github-actions[bot]" ||
              !c.body?.startsWith(RUN_MARKER)
            )
              continue;
            let record: unknown;
            try {
              record = decodeRecord(c.body, RUN_MARKER);
            } catch {
              continue;
            }
            const r = runSchema.safeParse(record);
            if (
              r.success &&
              r.data.requestId === parsed.data.id &&
              r.data.requestSnapshot.repository === repo
            )
              runs.push({ ...r.data, issueNumber: issue.number });
          }
          if (comments.length < 100) break;
        }
      }
      if (issues.length < 100) {
        for (const number of tracked.filter((n) => !seen.has(n))) {
          const issue = await this.api(`/repos/${repo}/issues/${number}`);
          if (!issue.body?.startsWith(REQUEST_MARKER)) continue;
          const r = requestSchema.safeParse(
            tryDecode(issue.body, REQUEST_MARKER),
          );
          if (r.success)
            requests.push({
              ...r.data,
              remoteIssue: number,
              remoteUpdatedAt: issue.updated_at,
              enabled: issue.state === "open" && r.data.enabled,
            });
          for (let p = 1; p <= 100; p++) {
            const comments = await this.api(
              `/repos/${repo}/issues/${number}/comments?per_page=100&page=${p}`,
            );
            for (const c of comments) {
              if (
                c.user?.login !== "github-actions[bot]" ||
                !c.body?.startsWith(RUN_MARKER)
              )
                continue;
              try {
                const run = runSchema.parse(decodeRecord(c.body, RUN_MARKER));
                if (run.requestSnapshot.repository === repo)
                  runs.push({ ...run, issueNumber: number });
              } catch {
                continue;
              }
            }
            if (comments.length < 100) break;
          }
        }
        return { requests, runs, cursor: started };
      }
    }
    throw new OrbitError(
      "PAGINATION_LIMIT",
      "원격 레코드가 많아 동기화를 완료하지 못했습니다. 커서는 유지됩니다.",
    );
  }
  async cancel(run: Run) {
    if (!run.workflowRunId)
      throw new OrbitError(
        "NOT_STARTED",
        "작업이 아직 실행기에 전달되지 않았습니다.",
      );
    await this.api(
      `/repos/${run.requestSnapshot.repository}/actions/runs/${run.workflowRunId}/cancel`,
      "POST",
    );
  }
  async archive(
    artifactId: number,
    repo: string,
    progress?: (received: number, total?: number) => void,
  ) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/artifacts/${artifactId}/zip`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (response.status === 410)
      throw new OrbitError(
        "EXPIRED",
        "산출물이 만료되었습니다. 결과에서 다시 실행해 새 산출물을 만드세요.",
      );
    if (response.status !== 302)
      throw new OrbitError(
        response.status === 401 ? "NEEDS_AUTH" : "DOWNLOAD_FAILED",
        "산출물에 접근할 수 없습니다.",
      );
    const location = response.headers.get("location");
    if (!location)
      throw new OrbitError("DOWNLOAD_FAILED", "다운로드 주소가 없습니다.");
    const u = new URL(location);
    if (
      u.protocol !== "https:" ||
      ![".blob.core.windows.net", ".githubusercontent.com"].some((s) =>
        u.hostname.endsWith(s),
      )
    )
      throw new OrbitError("UNSAFE_URL", "신뢰할 수 없는 다운로드 주소입니다.");
    const result = await fetch(location, {
      signal: AbortSignal.timeout(120000),
      redirect: "error",
    });
    if (!result.ok || !result.body)
      throw new OrbitError(
        "DOWNLOAD_FAILED",
        "다운로드가 중단되었습니다. 다시 시도하세요.",
      );
    const expected = Number(result.headers.get("content-length")) || undefined;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = result.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 100 * 1024 * 1024)
          throw new OrbitError(
            "TOO_LARGE",
            "산출물 묶음은 100MB를 넘을 수 없습니다.",
          );
        chunks.push(value);
        progress?.(total, expected);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
}
