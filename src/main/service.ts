import { app, dialog, shell, Notification } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { z } from "zod";
import { agenda, localDate, localToUTC, terminal } from "../domain/calendar";
import {
  boardSchema,
  eventSchema,
  OrbitError,
  repoName,
  requestSchema,
  safeUrl,
  settingsSchema,
  type TransferProgress,
  type AppState,
  type Run,
} from "../domain/model";
import { GitHub, encodeRecord } from "./github";
import { HackerNewsProvider, fetchQuote, fetchIndex } from "./providers";
import { atomicWrite, Store } from "./store";
import { Vault } from "./vault";
import { inQuietHours } from "../domain/notifications";
const now = () => new Date().toISOString();
export class Service {
  private sending = new Set<string>();
  private polling = false;
  private page = 0;
  private failures = 0;
  private nextPoll = 0;
  private newsBusy = false;
  public connectionError = "";
  constructor(
    public store: Store,
    private vault: Vault,
    private changed: () => void,
    private navigate: (id: string) => void,
    private transfer: (progress: TransferProgress) => void = () => {},
  ) {}
  async github(repo?: string) {
    const s = this.store.snapshot();
    if (repo && !s.settings.allowedRepos.includes(repo))
      throw new OrbitError(
        "FORBIDDEN",
        "설정에서 허용한 저장소만 접근할 수 있습니다.",
      );
    const token = await this.vault.get("github");
    if (!token)
      throw new OrbitError("NEEDS_AUTH", "설정에서 GitHub를 연결하세요.");
    return new GitHub(token);
  }
  async call(op: string, data: unknown): Promise<unknown> {
    switch (op) {
      case "help.setup":
        return readFile(join(app.getAppPath(), "docs/SETUP.md"), "utf8");
      case "state":
        return this.store.snapshot();
      case "connection":
        return {
          github: !!(await this.vault.get("github")),
          alpha: !!(await this.vault.get("alpha")),
          login: this.store.snapshot().settings.githubLogin,
          error: this.connectionError,
          chatgpt: "unsupported",
          executor: "GitHub Actions + OpenAI API",
          version: app.getVersion(),
        };
      case "settings.save": {
        const settings = settingsSchema.parse(data);
        const old = this.store.snapshot().settings;
        settings.githubLogin = old.githubLogin;
        await this.store.update((d) => {
          d.settings = settings;
        });
        break;
      }
      case "event.save": {
        const input = z
            .object({
              event: eventSchema,
              scope: z.enum(["all", "this"]),
              occurrence: z.string().optional(),
            })
            .parse(data),
          value = input.event;
        const start = localToUTC(value.localStart, value.timezone),
          end = localToUTC(value.localEnd, value.timezone);
        if (
          Date.parse(start) !== Date.parse(value.start) ||
          Date.parse(end) !== Date.parse(value.end)
        )
          throw new OrbitError(
            "INVALID_TIME",
            "지역 시각과 UTC 시각이 일치하지 않습니다.",
          );
        await this.store.update((d) => {
          const i = d.events.findIndex((e) => e.id === value.id);
          if (i >= 0 && d.events[i].version !== value.version)
            throw new OrbitError(
              "CONFLICT",
              "다른 화면에서 변경된 일정입니다. 다시 열어주세요.",
            );
          if (i >= 0 && input.scope === "this" && input.occurrence) {
            d.events[i].exceptions = [
              ...new Set([...d.events[i].exceptions, input.occurrence]),
            ];
            d.events[i].version++;
            d.events[i].updatedAt = now();
            d.events.push({
              ...value,
              id: crypto.randomUUID(),
              version: 1,
              recurrence: { frequency: "none", weekdays: [] },
              seriesId: value.id,
              exceptions: [],
              createdAt: now(),
              updatedAt: now(),
            });
          } else if (i >= 0)
            d.events[i] = {
              ...value,
              version: value.version + 1,
              updatedAt: now(),
            };
          else d.events.push({ ...value, createdAt: now(), updatedAt: now() });
        });
        break;
      }
      case "event.delete": {
        const input = z
          .object({
            id: z.string(),
            version: z.number(),
            scope: z.enum(["all", "this"]),
            occurrence: z.string().optional(),
          })
          .parse(data);
        await this.store.update((d) => {
          const e = d.events.find((e) => e.id === input.id);
          if (!e || e.version !== input.version)
            throw new OrbitError(
              "CONFLICT",
              "일정이 변경되었습니다. 새로 열어주세요.",
            );
          if (input.scope === "this" && input.occurrence) {
            e.exceptions = [...new Set([...e.exceptions, input.occurrence])];
            e.version++;
            e.updatedAt = now();
          } else d.events = d.events.filter((e) => e.id !== input.id);
        });
        break;
      }
      case "board.save": {
        const board = boardSchema.parse(data);
        await this.store.update((d) => {
          const i = d.boards.findIndex((b) => b.id === board.id);
          if (i >= 0 && d.boards[i].version !== board.version)
            throw new OrbitError(
              "CONFLICT",
              "보드가 변경되었습니다. 저장 전 다시 불러오세요.",
            );
          if (i >= 0) d.boards[i] = { ...board, version: board.version + 1 };
          else d.boards.push(board);
        });
        break;
      }
      case "session.complete": {
        const input = z
          .object({
            widgetId: z.string(),
            title: z.string().trim().min(1).max(200),
            eventId: z.string().optional(),
          })
          .parse(data);
        await this.store.update((d) => {
          if (
            !d.boards.some((b) =>
              b.widgets.some(
                (w) => w.id === input.widgetId && w.type === "learn",
              ),
            )
          )
            throw new OrbitError("NOT_FOUND", "학습 위젯을 찾지 못했습니다.");
          d.sessions.push({ id: crypto.randomUUID(), ...input, at: now() });
        });
        break;
      }
      case "news.refresh":
      case "news.more": {
        if (this.newsBusy)
          throw new OrbitError("BUSY", "뉴스를 불러오는 중입니다.");
        this.newsBusy = true;
        try {
          const page = op === "news.refresh" ? 0 : this.page + 1;
          const articles = await new HackerNewsProvider().fetchPage(page);
          await this.store.update((d) => {
            const items = new Map(d.articles.map((a) => [a.id, a]));
            for (const a of articles) items.set(a.id, a);
            d.articles = [...items.values()]
              .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
              .slice(0, 1000);
            d.newsFetchedAt = now();
          });
          this.page = page;
          return { count: articles.length };
        } finally {
          this.newsBusy = false;
          this.changed();
        }
      }
      case "news.save": {
        const input = z
          .object({ id: z.string(), saved: z.boolean() })
          .parse(data);
        await this.store.update((d) => {
          if (!d.articles.some((a) => a.id === input.id))
            throw new OrbitError("NOT_FOUND", "기사를 찾지 못했습니다.");
          d.savedArticles = d.savedArticles.filter((v) => v !== input.id);
          if (input.saved) d.savedArticles.push(input.id);
        });
        break;
      }
      case "quote": {
        const input = z
          .object({
            symbol: z.string().regex(/^[A-Z0-9.^:-]{1,20}$/),
            kind: z.enum(["stock", "index"]).default("stock"),
          })
          .parse(typeof data === "string" ? { symbol: data } : data);
        const key = `${input.kind}:${input.symbol}`,
          cached = this.store.snapshot().quoteCache[key];
        if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 3600000)
          return cached;
        const secret = await this.vault.get("alpha");
        const quote = await (input.kind === "index"
          ? fetchIndex(input.symbol, secret)
          : fetchQuote(input.symbol, secret));
        await this.store.update((d) => {
          d.quoteCache[key] = quote;
        });
        this.changed();
        return quote;
      }
      case "connect": {
        const input = z
          .object({
            provider: z.enum(["github", "alpha"]),
            token: z.string().trim().min(5).max(500),
          })
          .parse(data);
        if (input.provider === "github") {
          const account = await new GitHub(input.token).account();
          await this.vault.set("github", input.token);
          await this.store.update((d) => {
            d.settings.githubLogin = account.login;
          });
        } else await this.vault.set("alpha", input.token);
        this.connectionError = "";
        break;
      }
      case "disconnect": {
        const provider = z.enum(["github", "alpha"]).parse(data);
        await this.vault.remove(provider);
        if (provider === "github")
          await this.store.update((d) => {
            d.settings.githubLogin = undefined;
            d.settings.allowedRepos = [];
          });
        break;
      }
      case "repos": {
        const page = z
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(data ?? 1);
        return (await this.github()).repositories(page);
      }
      case "branches": {
        const input = z
          .object({
            repo: repoName,
            page: z.number().int().min(1).max(100).default(1),
          })
          .parse(data);
        return (await this.github(input.repo)).branches(input.repo, input.page);
      }
      case "activity": {
        const repo = repoName.parse(data);
        return (await this.github(repo)).activity(repo);
      }
      case "attachment.pick": {
        const selected = await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [
            {
              name: "UTF-8 텍스트 참조",
              extensions: [
                "txt",
                "md",
                "json",
                "ts",
                "tsx",
                "js",
                "py",
                "rs",
                "csv",
              ],
            },
          ],
        });
        if (selected.canceled) return null;
        const path = selected.filePaths[0];
        const info = await stat(path);
        if (!info.isFile() || info.size > 24000)
          throw new OrbitError(
            "FILE_TOO_LARGE",
            "첨부는 24KB 이내의 일반 파일이어야 합니다.",
          );
        const bytes = await readFile(path);
        if (bytes.length > 24000)
          throw new OrbitError(
            "FILE_TOO_LARGE",
            "첨부는 24KB 이내의 UTF-8 텍스트 파일이어야 합니다.",
          );
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.length > 6000)
          throw new OrbitError(
            "FILE_TOO_LARGE",
            "첨부는 6,000자 이내여야 합니다.",
          );
        return {
          id: crypto.randomUUID(),
          name: basename(path),
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          text,
          mediaType: "text/plain",
        };
      }
      case "request.save": {
        const req = requestSchema.parse(data);
        await this.store.update((d) => {
          const i = d.requests.findIndex((r) => r.id === req.id);
          if (i >= 0 && d.requests[i].version !== req.version)
            throw new OrbitError(
              "CONFLICT",
              "요청이 변경되었습니다. 다시 열어주세요.",
            );
          if (i >= 0)
            d.requests[i] = {
              ...req,
              version: req.version + 1,
              updatedAt: now(),
            };
          else d.requests.push(req);
        });
        break;
      }
      case "request.publish": {
        const input = z.object({ id: z.string() }).parse(data);
        let req = this.store.snapshot().requests.find((r) => r.id === input.id);
        if (!req) throw new OrbitError("NOT_FOUND", "먼저 초안을 저장하세요.");
        repoName.parse(req.repository);
        if (!req.consent)
          throw new OrbitError(
            "CONSENT_REQUIRED",
            "GitHub Actions 실행과 API 과금 안내에 동의해야 활성화할 수 있습니다.",
          );
        const gh = await this.github(req.repository);
        await gh.workflow(req.repository);
        const issue = await gh.publishRequest(req);
        req = {
          ...req,
          remoteIssue: issue.number,
          remoteUpdatedAt: issue.updated_at,
          updatedAt: now(),
        };
        await this.store.update((d) => {
          d.requests = d.requests.map((r) => (r.id === req!.id ? req! : r));
        });
        break;
      }
      case "request.remove": {
        const id = z.string().parse(data),
          req = this.store.snapshot().requests.find((r) => r.id === id);
        if (req?.remoteIssue) {
          const gh = await this.github(req.repository);
          await gh.publishRequest({ ...req, enabled: false });
        }
        await this.store.update((d) => {
          d.requests = d.requests.filter((r) => r.id !== id);
        });
        break;
      }
      case "run.enqueue": {
        const id = z.string().parse(data),
          req = this.store.snapshot().requests.find((r) => r.id === id);
        if (!req?.remoteIssue)
          throw new OrbitError(
            "NOT_PUBLISHED",
            "먼저 실행기에 요청을 등록하세요.",
          );
        repoName.parse(req.repository);
        if (!req.consent)
          throw new OrbitError("CONSENT_REQUIRED", "실행 동의가 필요합니다.");
        const gh = await this.github(req.repository);
        const runId = crypto.randomUUID(),
          at = now();
        const run: Run = {
          id: runId,
          requestId: req.id,
          scheduledFor: at,
          idempotencyKey: runId,
          status: "queued",
          createdAt: at,
          updatedAt: at,
          requestSnapshot: structuredClone(req),
          attempts: 0,
          steps: [{ status: "queued", at }],
          summary: "실행기 대기열에 요청을 전송합니다.",
          checks: [],
          artifacts: [],
          changedFiles: [],
          issueNumber: req.remoteIssue,
        };
        await this.store.update((d) => {
          d.runs.push(run);
        });
        await this.deliver(run, gh);
        break;
      }
      case "run.cancel": {
        const run = this.store.snapshot().runs.find((r) => r.id === data);
        if (!run) throw new OrbitError("NOT_FOUND", "실행 기록이 없습니다.");
        if (terminal(run.status))
          throw new OrbitError("ALREADY_FINISHED", "이미 종료된 작업입니다.");
        const gh = await this.github(run.requestSnapshot.repository);
        await gh.api(
          `/repos/${run.requestSnapshot.repository}/issues/${run.issueNumber}/comments`,
          "POST",
          {
            body: encodeRecord("<!-- orbit-cancel:v1 -->", {
              runId: run.id,
              at: now(),
            }),
          },
        );
        if (run.workflowRunId) await gh.cancel(run);
        await this.store.update((d) => {
          const r = d.runs.find((r) => r.id === run.id)!;
          r.status = "cancel_requested";
          r.updatedAt = now();
        });
        break;
      }
      case "run.retryDelivery": {
        const run = this.store.snapshot().runs.find((r) => r.id === data);
        if (!run) throw new OrbitError("NOT_FOUND", "실행 기록이 없습니다.");
        await this.deliver(
          run,
          await this.github(run.requestSnapshot.repository),
        );
        break;
      }
      case "run.read": {
        await this.store.update((d) => {
          const r = d.runs.find((r) => r.id === data);
          if (r) r.readAt = now();
        });
        break;
      }
      case "sync": {
        this.nextPoll = 0;
        await this.poll(true);
        return { error: this.connectionError };
      }
      case "download":
        return this.download(
          z
            .object({ runId: z.string(), artifactId: z.string().optional() })
            .parse(data),
        );
      case "open": {
        const url = safeUrl.parse(data);
        await shell.openExternal(url);
        return;
      }
      case "data.export": {
        const file = await dialog.showSaveDialog({
          defaultPath: "orbit-backup.json",
          filters: [{ name: "Orbit 데이터", extensions: ["json"] }],
        });
        if (file.canceled || !file.filePath) return { cancelled: true };
        await atomicWrite(
          file.filePath,
          JSON.stringify(this.store.snapshot(), null, 2),
        );
        return { saved: true };
      }
      case "data.import": {
        const file = await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [{ name: "Orbit 데이터", extensions: ["json"] }],
        });
        if (file.canceled) return { cancelled: true };
        const raw = await readFile(file.filePaths[0]);
        if (raw.length > 20 * 1024 * 1024)
          throw new OrbitError("TOO_LARGE", "백업은 20MB 이내여야 합니다.");
        await this.store.restore(JSON.parse(raw.toString("utf8")));
        break;
      }
      case "data.reset": {
        await this.store.reset();
        await this.vault.remove("github");
        await this.vault.remove("alpha");
        break;
      }
      case "diagnostics": {
        const state = this.store.snapshot(),
          completed = state.runs.filter((r) => terminal(r.status)),
          succeeded = completed.filter((r) => r.status === "succeeded").length,
          durations = completed.map((r) =>
            Math.max(0, Date.parse(r.updatedAt) - Date.parse(r.createdAt)),
          );
        return {
          version: app.getVersion(),
          platform: process.platform,
          architecture: process.arch,
          storageSchema: 1,
          stateVersion: state.version,
          queueDepth: state.runs.filter((r) => !terminal(r.status)).length,
          completedRuns: completed.length,
          successRate: completed.length ? succeeded / completed.length : null,
          averageLatencyMilliseconds: durations.length
            ? Math.round(
                durations.reduce((a, b) => a + b, 0) / durations.length,
              )
            : null,
          deliveryRetries: state.runs.reduce(
            (n, r) => n + Math.max(0, (r.deliveryAttempts ?? 1) - 1),
            0,
          ),
          connectionError: this.connectionError,
        };
      }
      default:
        throw new OrbitError("UNKNOWN_COMMAND", "지원하지 않는 명령입니다.");
    }
    this.changed();
    return { saved: true };
  }
  async deliver(run: Run, gh: GitHub) {
    if (this.sending.has(run.id)) return;
    this.sending.add(run.id);
    try {
      await this.store.update((d) => {
        const r = d.runs.find((v) => v.id === run.id)!;
        r.deliveryAttempts = (r.deliveryAttempts ?? 0) + 1;
      });
      await gh.enqueue(run);
      await this.store.update((d) => {
        const r = d.runs.find((v) => v.id === run.id)!;
        r.deliveredAt = now();
        r.summary =
          "GitHub의 영속 대기열에 전달했습니다. 실행기 시작을 기다립니다.";
        r.errorCode = undefined;
      });
      try {
        await gh.dispatch(run.requestSnapshot);
      } catch {
        await this.store.update((d) => {
          const r = d.runs.find((v) => v.id === run.id)!;
          r.summary =
            "요청은 GitHub에 저장되었습니다. 수동 시작 확인에 실패해 원격 예약 스캔을 기다립니다.";
        });
      }
    } catch (e) {
      await this.store.update((d) => {
        const r = d.runs.find((v) => v.id === run.id)!;
        r.errorCode = "DELIVERY_FAILED";
        r.summary =
          "전송 여부 확인이 필요합니다. 같은 실행 ID로 전송을 복구할 수 있습니다.";
      });
      throw e;
    } finally {
      this.sending.delete(run.id);
      this.changed();
    }
  }
  async poll(force = false) {
    if (this.polling || (!force && Date.now() < this.nextPoll)) return;
    this.polling = true;
    try {
      for (const repo of this.store.snapshot().settings.allowedRepos) {
        const gh = await this.github(repo);
        const snapshot = this.store.snapshot();
        for (const pending of snapshot.runs.filter(
          (r) =>
            r.requestSnapshot.repository === repo &&
            r.status === "queued" &&
            !r.deliveredAt &&
            (r.deliveryAttempts ?? 0) < 3,
        ))
          await this.deliver(pending, gh);
        const result = await gh.records(
          repo,
          snapshot.deliveryCursors[repo],
          snapshot.requests
            .filter((r) => r.repository === repo && r.remoteIssue)
            .map((r) => r.remoteIssue!),
        );
        await this.store.update((d) => {
          for (const remote of result.requests) {
            const i = d.requests.findIndex((r) => r.id === remote.id);
            if (i < 0) d.requests.push(remote);
            else if (
              d.requests[i].remoteUpdatedAt &&
              remote.remoteUpdatedAt! >= d.requests[i].remoteUpdatedAt!
            )
              d.requests[i] = remote;
          }
          for (const remote of result.runs) {
            const i = d.runs.findIndex((r) => r.id === remote.id);
            if (i < 0) d.runs.push({ ...remote, receivedAt: now() });
            else if (remote.updatedAt >= d.runs[i].updatedAt) {
              const old = d.runs[i];
              d.runs[i] = {
                ...remote,
                readAt: old.readAt,
                notifiedAt: old.notifiedAt,
                receivedAt: old.receivedAt ?? now(),
              };
            }
          }
          d.deliveryCursors[repo] = result.cursor;
        });
      }
      this.failures = 0;
      this.connectionError = "";
      this.nextPoll =
        Date.now() + this.store.snapshot().settings.pollSeconds * 1000;
      await this.notify();
      this.changed();
    } catch (e) {
      this.failures++;
      this.nextPoll = Date.now() + Math.min(900000, 30000 * 2 ** this.failures);
      this.connectionError =
        e instanceof OrbitError
          ? e.message
          : "결과 수신에 실패했습니다. 다시 동기화하세요.";
      this.changed();
      if (force) throw e;
    } finally {
      this.polling = false;
    }
  }
  private quiet(s: AppState) {
    return inQuietHours(s.settings);
  }
  async notify() {
    const s = this.store.snapshot();
    if (
      !s.settings.notifications ||
      this.quiet(s) ||
      !Notification.isSupported()
    )
      return;
    for (const r of s.runs.filter(
      (r) => terminal(r.status) && r.requestSnapshot.notify && !r.notifiedAt,
    )) {
      await this.store.update((d) => {
        d.runs.find((v) => v.id === r.id)!.notifiedAt = now();
      });
      const n = new Notification({
        title:
          r.status === "succeeded"
            ? "Orbit · 결과 도착"
            : "Orbit · 작업 확인 필요",
        body: r.requestSnapshot.title,
      });
      n.on("click", () => this.navigate(r.id));
      n.show();
    }
  }
  async reminders() {
    const s = this.store.snapshot();
    if (
      !s.settings.notifications ||
      this.quiet(s) ||
      !Notification.isSupported()
    )
      return;
    const date = localDate(now(), s.settings.timezone);
    const tomorrow = new Date(Date.parse(date + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    const reminders = new Map(
      [
        ...agenda(s.events, date, s.settings.timezone),
        ...agenda(s.events, tomorrow, s.settings.timezone),
      ].map((o) => [o.id, o]),
    );
    for (const occurrence of reminders.values()) {
      if (occurrence.event.reminder === "none") continue;
      const at =
          Date.parse(occurrence.start) -
          Number(occurrence.event.reminder) * 60000,
        key = `${occurrence.id}:${occurrence.event.reminder}`;
      if (
        Date.now() < at ||
        Date.now() > at + 15 * 60000 ||
        s.reminderReceipts.includes(key)
      )
        continue;
      await this.store.update((d) => {
        d.reminderReceipts.push(key);
        d.reminderReceipts = d.reminderReceipts.slice(-10000);
      });
      new Notification({
        title: "Orbit · 일정 알림",
        body: occurrence.event.title,
      }).show();
    }
  }
  async download(input: { runId: string; artifactId?: string }) {
    const run = this.store.snapshot().runs.find((r) => r.id === input.runId);
    if (!run) throw new OrbitError("NOT_FOUND", "실행 결과가 없습니다.");
    const selected = run.artifacts.filter(
      (a) => !input.artifactId || a.id === input.artifactId,
    );
    if (!selected.length)
      throw new OrbitError("NOT_FOUND", "산출물이 없습니다.");
    const zip = new JSZip();
    for (const a of selected) {
      if (a.expiresAt && Date.parse(a.expiresAt) < Date.now())
        throw new OrbitError(
          "EXPIRED",
          "산출물이 만료되었습니다. 다시 요청해 재발급하세요.",
        );
      if (
        a.name !== basename(a.name) ||
        /[<>:"/\\|?*]/.test(a.name) ||
        Array.from(a.name).some((c) => c.charCodeAt(0) < 32) ||
        a.name === ".." ||
        a.name === "." ||
        /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(a.name) ||
        a.size > 50 * 1024 * 1024
      )
        throw new OrbitError(
          "UNSAFE_FILE",
          "안전하지 않은 산출물 이름 또는 크기입니다.",
        );
      if (!a.githubArtifactId)
        throw new OrbitError(
          "PENDING_ARTIFACT",
          "산출물 업로드가 아직 끝나지 않았습니다. 동기화 후 다시 시도하세요.",
        );
      const archive = await (
        await this.github(run.requestSnapshot.repository)
      ).archive(
        a.githubArtifactId,
        run.requestSnapshot.repository,
        (received, total) =>
          this.transfer({ received, total, stage: "downloading" }),
      );
      this.transfer({
        received: archive.length,
        total: archive.length,
        stage: "verifying",
      });
      const source = await JSZip.loadAsync(archive);
      const entry = source.file(a.storageKey);
      if (!entry)
        throw new OrbitError(
          "DOWNLOAD_FAILED",
          "산출물 파일을 찾지 못했습니다.",
        );
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = entry.nodeStream();
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > a.size || size > 50 * 1024 * 1024) {
            (stream as unknown as { destroy: () => void }).destroy();
            reject(
              new OrbitError(
                "SIZE_MISMATCH",
                "산출물 크기가 일치하지 않습니다.",
              ),
            );
          } else chunks.push(c);
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
      });
      if (
        buffer.length !== a.size ||
        createHash("sha256").update(buffer).digest("hex") !== a.sha256
      )
        throw new OrbitError(
          "CHECKSUM_MISMATCH",
          "산출물 체크섬이 일치하지 않습니다.",
        );
      zip.file(a.name, buffer);
    }
    const single = selected.length === 1;
    const choice = await dialog.showSaveDialog({
      defaultPath: single
        ? selected[0].name
        : `orbit-${run.id.slice(0, 8)}.zip`,
    });
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    const buffer = single
      ? await zip.file(selected[0].name)!.async("nodebuffer")
      : await zip.generateAsync({ type: "nodebuffer" });
    this.transfer({
      received: buffer.length,
      total: buffer.length,
      stage: "saving",
    });
    await atomicWrite(choice.filePath, buffer);
    return { saved: true, size: buffer.length };
  }
}
