import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
export const iso = z.string().datetime();
export const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/)
  .refine((v) => !v.includes(".."));
export const timezone = z
  .string()
  .max(80)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("ko", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "올바른 IANA 시간대를 입력하세요.");
export const safeUrl = z
  .string()
  .max(2048)
  .url()
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "HTTPS 링크만 허용됩니다.");
export const repoName = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .max(210);
export const recurrenceSchema = z.object({
  frequency: z.enum(["none", "daily", "weekly"]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  count: z.number().int().min(1).max(10000).optional(),
});
export const eventSchema = z
  .object({
    id,
    version: z.number().int().min(1),
    createdAt: iso,
    updatedAt: iso,
    title: z.string().trim().min(1).max(200),
    start: iso,
    end: iso,
    localStart: z.string().min(16).max(30),
    localEnd: z.string().min(16).max(30),
    timezone,
    allDay: z.boolean(),
    recurrence: recurrenceSchema,
    exceptions: z.array(z.string()).max(10000).default([]),
    reminder: z.enum(["none", "10", "30"]),
    category: z.enum(["개인", "학습", "개발", "금융"]),
    notes: z.string().max(10000),
    seriesId: id.optional(),
  })
  .refine(
    (v) => Date.parse(v.end) > Date.parse(v.start),
    "종료는 시작 이후여야 합니다.",
  )
  .refine((v) => {
    try {
      const start = Temporal.PlainDateTime.from(v.localStart),
        end = Temporal.PlainDateTime.from(v.localEnd);
      if (
        v.allDay &&
        (!start.toPlainTime().equals("00:00") ||
          !end.toPlainTime().equals("00:00"))
      )
        return false;
      return (
        Date.parse(
          start
            .toZonedDateTime(v.timezone, { disambiguation: "reject" })
            .toInstant()
            .toString(),
        ) === Date.parse(v.start) &&
        Date.parse(
          end
            .toZonedDateTime(v.timezone, { disambiguation: "reject" })
            .toInstant()
            .toString(),
        ) === Date.parse(v.end)
      );
    } catch {
      return false;
    }
  }, "UTC 시각과 지역 시각·시간대가 일치해야 합니다.");
export type CalendarEvent = z.infer<typeof eventSchema>;
export const widgetTypes = [
  "finance",
  "learn",
  "github",
  "space",
  "notes",
] as const;
export const widgetSchema = z.object({
  id,
  type: z.enum(widgetTypes),
  size: z.enum(["S", "M", "L"]),
  order: z.number().int().min(0),
  config: z.object({
    note: z.string().max(20000).optional(),
    quoteType: z.enum(["stock", "index"]).optional(),
    symbol: z
      .string()
      .regex(/^[A-Z0-9.^:-]{1,20}$/)
      .optional(),
    goal: z.string().max(200).optional(),
    weeklyTarget: z.number().int().min(1).max(100).optional(),
    repo: repoName.optional(),
  }),
  schemaVersion: z.literal(1),
});
export type Widget = z.infer<typeof widgetSchema>;
export const boardSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    version: z.number().int().min(1),
    widgets: z.array(widgetSchema).max(40),
  })
  .refine(
    (b) => new Set(b.widgets.map((w) => w.id)).size === b.widgets.length,
    "위젯 ID가 중복되었습니다.",
  );
export type Board = z.infer<typeof boardSchema>;
export const articleSchema = z.object({
  id,
  title: z.string().max(500),
  url: safeUrl,
  source: z.string().max(120),
  sourceUrl: safeUrl,
  publishedAt: iso,
  fetchedAt: iso,
  topics: z.array(z.enum(["테크", "우주", "금융", "학습"])),
  summary: z.string().max(10000),
  summaryKind: z.enum(["publisher", "metadata"]),
  readingMinutes: z.number().int().min(0),
  image: z.literal("orbit"),
});
export type Article = z.infer<typeof articleSchema>;
export const scheduleRuleSchema = z
  .object({
    frequency: z.enum(["manual", "once", "daily", "weekly"]),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7),
    timezone,
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    count: z.number().int().min(1).max(10000).optional(),
  })
  .refine(
    (v) => v.frequency !== "weekly" || v.weekdays.length > 0,
    "요일을 선택하세요.",
  )
  .refine((v) => v.frequency !== "once" || !!v.date, "실행 날짜를 선택하세요.");
export const attachmentSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  size: z.number().int().min(0).max(24000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().max(6000),
  mediaType: z.literal("text/plain"),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const requestSchema = z.object({
  id,
  version: z.number().int().min(1),
  createdAt: iso,
  updatedAt: iso,
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(20000),
  attachments: z.array(attachmentSchema).max(2).default([]),
  refs: z
    .array(
      z.object({
        title: z.string().max(500),
        url: safeUrl,
        topic: z.string().max(80),
      }),
    )
    .max(4),
  repository: repoName.or(z.literal("")),
  baseBranch: z
    .string()
    .min(1)
    .max(180)
    .refine(
      (v) =>
        !v.startsWith("-") &&
        !/[\s~^:?*[\\]/.test(v) &&
        !v.includes("..") &&
        !v.includes("@{"),
    ),
  outputPolicy: z.enum(["pr", "artifacts"]),
  formats: z
    .array(z.enum(["text", "pdf", "source"]))
    .min(1)
    .max(3),
  rule: scheduleRuleSchema,
  enabled: z.boolean(),
  consent: z.boolean(),
  notify: z.boolean(),
  provider: z.literal("github-actions-openai"),
  requirementVersion: z.literal("1.0"),
  remoteIssue: z.number().int().positive().optional(),
  remoteUpdatedAt: iso.optional(),
});
export type Request = z.infer<typeof requestSchema>;
export const runStatuses = [
  "queued",
  "syncing",
  "running",
  "validating",
  "publishing",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "needs_auth",
  "conflict",
] as const;
export type RunStatus = (typeof runStatuses)[number];
export const artifactSchema = z.object({
  id,
  name: z.string().max(200),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: iso.optional(),
  githubArtifactId: z.number().int().positive().optional(),
  format: z.enum(["text", "pdf", "source"]),
  storageKey: z.string().max(300),
});
export type Artifact = z.infer<typeof artifactSchema>;
export const runSchema = z.object({
  id,
  requestId: id,
  scheduledFor: iso,
  idempotencyKey: id,
  status: z.enum(runStatuses),
  createdAt: iso,
  updatedAt: iso,
  requestSnapshot: requestSchema,
  attempts: z.number().int().min(0).max(3),
  steps: z.array(z.object({ status: z.enum(runStatuses), at: iso })),
  summary: z.string().max(50000),
  checks: z.array(
    z.object({
      name: z.string().max(500),
      passed: z.boolean(),
      detail: z.string().max(2000),
    }),
  ),
  artifacts: z.array(artifactSchema),
  baseSHA: z.string().optional(),
  outputSHA: z.string().optional(),
  branch: z.string().optional(),
  prUrl: safeUrl.optional(),
  prNumber: z.number().int().positive().optional(),
  changedFiles: z.array(z.string()).default([]),
  workflowRunId: z.number().int().positive().optional(),
  issueNumber: z.number().int().positive().optional(),
  errorCode: z.string().optional(),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number() })
    .optional(),
  readAt: iso.optional(),
  receivedAt: iso.optional(),
  notifiedAt: iso.optional(),
  lease: z
    .object({ owner: z.string(), heartbeatAt: iso, expiresAt: iso })
    .optional(),
  deliveryAttempts: z.number().int().min(0).optional(),
  deliveredAt: iso.optional(),
  ruleHashes: z.record(z.string(), z.string()).optional(),
});
export type Run = z.infer<typeof runSchema>;
export const settingsSchema = z.object({
  timezone,
  reduceMotion: z.boolean(),
  notifications: z.boolean(),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  readerScale: z.number().min(0.8).max(2),
  weekStart: z.enum(["sunday", "monday"]),
  selectedBoard: id,
  githubLogin: z.string().optional(),
  allowedRepos: z.array(repoName),
  pollSeconds: z.number().int().min(30).max(900),
  fontScale: z.number().min(0.85).max(2),
  window: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().min(600).max(10000),
      height: z.number().min(400).max(10000),
      maximized: z.boolean(),
    })
    .optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const stateSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().min(0),
  workspaceId: id,
  createdAt: iso,
  updatedAt: iso,
  settings: settingsSchema,
  events: z.array(eventSchema),
  boards: z.array(boardSchema).min(1),
  articles: z.array(articleSchema),
  savedArticles: z.array(id),
  requests: z.array(requestSchema),
  runs: z.array(runSchema),
  sessions: z.array(
    z.object({
      id,
      eventId: id.optional(),
      widgetId: id,
      at: iso,
      title: z.string().max(200),
    }),
  ),
  quoteCache: z.record(
    z.string(),
    z.object({
      symbol: z.string(),
      price: z.number(),
      change: z.number(),
      currency: z.string(),
      asOf: z.string(),
      fetchedAt: iso,
      history: z.array(z.number()),
      source: z.string(),
      delayed: z.boolean(),
    }),
  ),
  newsFetchedAt: iso.optional(),
  deliveryCursors: z.record(z.string(), z.string()),
  reminderReceipts: z.array(id),
});
export type AppState = z.infer<typeof stateSchema>;
export function initialState(): AppState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    version: 0,
    workspaceId: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    settings: {
      timezone: "Asia/Seoul",
      reduceMotion: false,
      notifications: true,
      quietStart: "22:00",
      quietEnd: "08:00",
      readerScale: 1,
      weekStart: "sunday",
      selectedBoard: "personal",
      allowedRepos: [],
      pollSeconds: 60,
      fontScale: 1,
    },
    events: [],
    boards: [{ id: "personal", name: "나의 공간", version: 1, widgets: [] }],
    articles: [],
    savedArticles: [],
    requests: [],
    runs: [],
    sessions: [],
    quoteCache: {},
    deliveryCursors: {},
    reminderReceipts: [],
  };
}
export class OrbitError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrbitError";
  }
}
export type Reply<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: string; message: string; correlationId: string };
    };
export type TransferProgress = {
  received: number;
  total?: number;
  stage: "downloading" | "verifying" | "saving";
};
export interface OrbitAPI {
  call<T = unknown>(op: string, data?: unknown): Promise<Reply<T>>;
  onChange(fn: () => void): () => void;
  onTransfer(fn: (progress: TransferProgress) => void): () => void;
  onNavigate(fn: (id: string) => void): () => void;
  window(action: "minimize" | "maximize" | "close"): void;
}
