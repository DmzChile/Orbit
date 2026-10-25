import { Temporal } from "@js-temporal/polyfill";
import {
  OrbitError,
  type CalendarEvent,
  type Request,
  type Run,
  type RunStatus,
} from "./model";
export function localToUTC(local: string, zone: string) {
  try {
    return Temporal.PlainDateTime.from(local)
      .toZonedDateTime(zone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  } catch {
    throw new OrbitError(
      "INVALID_TIME",
      "시간대에서 존재하지 않거나 중복되는 시각입니다. 다른 시각을 선택하세요.",
    );
  }
}
export function localDate(instant: string, zone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}
export function localDateTime(instant: string, zone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString()
    .slice(0, 16);
}
export type Occurrence = {
  id: string;
  event: CalendarEvent;
  date: string;
  start: string;
  end: string;
};
export function occurrences(
  event: CalendarEvent,
  from: string,
  to: string,
): Occurrence[] {
  const base = Temporal.PlainDateTime.from(event.localStart),
    end = Temporal.PlainDateTime.from(event.localEnd),
    duration = base.until(end, { largestUnit: "days" }),
    baseDate = base.toPlainDate();
  const first = Temporal.PlainDate.from(from),
    last = Temporal.PlainDate.from(to),
    earliest = first.subtract({ days: Math.max(1, duration.days + 1) });
  let date =
    Temporal.PlainDate.compare(earliest, baseDate) > 0 ? earliest : baseDate;
  if (event.recurrence.frequency === "none") date = baseDate;
  const out: Occurrence[] = [];
  if (last.since(first).days > 36600)
    throw new OrbitError("RANGE", "100년 이내 범위를 조회하세요.");
  const weekdays = event.recurrence.weekdays.length
    ? event.recurrence.weekdays
    : [base.dayOfWeek % 7];
  function ordinal(d: Temporal.PlainDate) {
    const days = baseDate.until(d).days;
    if (event.recurrence.frequency !== "weekly") return days + 1;
    const whole = Math.floor((days + 1) / 7),
      remainder = (days + 1) % 7;
    let n = whole * weekdays.length;
    for (let i = 0; i < remainder; i++)
      if (
        weekdays.includes(baseDate.add({ days: whole * 7 + i }).dayOfWeek % 7)
      )
        n++;
    return n;
  }
  for (
    ;
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    const s = date.toString();
    if (event.recurrence.until && s > event.recurrence.until) break;
    if (event.recurrence.frequency === "none" && s !== baseDate.toString())
      break;
    if (
      event.recurrence.frequency === "weekly" &&
      !weekdays.includes(date.dayOfWeek % 7)
    )
      continue;
    const count = ordinal(date);
    if (event.recurrence.count && count > event.recurrence.count) break;
    if (event.exceptions.includes(s)) continue;
    const local = date.toPlainDateTime(base.toPlainTime());
    let start: string, endAt: string;
    try {
      start = localToUTC(local.toString(), event.timezone);
      endAt = localToUTC(local.add(duration).toString(), event.timezone);
    } catch {
      continue;
    }
    if (localDate(endAt, event.timezone) >= first.toString())
      out.push({ id: `${event.id}:${s}`, event, date: s, start, end: endAt });
  }
  return out;
}
export function agenda(events: CalendarEvent[], date: string, zone: string) {
  const from = Temporal.PlainDate.from(date).subtract({ days: 7 }).toString();
  return events
    .flatMap((e) =>
      occurrences(
        e,
        from,
        Temporal.PlainDate.from(date).add({ days: 1 }).toString(),
      ),
    )
    .filter(
      (o) =>
        localDate(o.start, zone) <= date &&
        localDate(
          Temporal.Instant.from(o.end).subtract({ nanoseconds: 1 }).toString(),
          zone,
        ) >= date,
    )
    .sort((a, b) => a.start.localeCompare(b.start));
}
export function monthCells(
  year: number,
  month: number,
  weekStart: "sunday" | "monday",
) {
  const first = Temporal.PlainDate.from({ year, month, day: 1 });
  const offset =
    ((first.dayOfWeek % 7) - (weekStart === "monday" ? 1 : 0) + 7) % 7;
  return Array.from(
    { length: Math.ceil((offset + first.daysInMonth) / 7) * 7 },
    (_, i) => {
      const d = first.add({ days: i - offset });
      return { date: d.toString(), day: d.day, inMonth: d.month === month };
    },
  );
}
function scheduleInstant(
  date: Temporal.PlainDate,
  rule: Request["rule"],
): string | null {
  try {
    return date
      .toPlainDateTime(Temporal.PlainTime.from(rule.time))
      .toZonedDateTime(rule.timezone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  } catch {
    return null;
  }
}
export function nextRun(rule: Request["rule"], after: string): string | null {
  if (rule.frequency === "manual") return null;
  const now = Temporal.Instant.from(after),
    date = now.toZonedDateTimeISO(rule.timezone).toPlainDate();
  for (let i = 0; i < 3700; i++) {
    const d =
      rule.frequency === "once"
        ? Temporal.PlainDate.from(rule.date!)
        : date.add({ days: i });
    if (rule.until && d.toString() > rule.until) return null;
    if (rule.frequency === "weekly" && !rule.weekdays.includes(d.dayOfWeek % 7))
      continue;
    const at = scheduleInstant(d, rule);
    if (at && Temporal.Instant.compare(Temporal.Instant.from(at), now) > 0)
      return at;
    if (rule.frequency === "once") return null;
  }
  return null;
}
export function latestDue(
  request: Request,
  now: string,
  last?: string,
): string | null {
  if (!request.enabled || request.rule.frequency === "manual") return null;
  const rule = request.rule;
  const today = Temporal.Instant.from(now)
    .toZonedDateTimeISO(rule.timezone)
    .toPlainDate();
  for (let i = 0; i < 8; i++) {
    const d =
      rule.frequency === "once"
        ? Temporal.PlainDate.from(rule.date!)
        : today.subtract({ days: i });
    if (rule.until && d.toString() > rule.until) continue;
    if (rule.frequency === "weekly" && !rule.weekdays.includes(d.dayOfWeek % 7))
      continue;
    const at = scheduleInstant(d, rule);
    if (at && at <= now && at >= request.createdAt && (!last || at > last))
      return at;
    if (rule.frequency === "once") return null;
  }
  return null;
}
const transitions: Record<RunStatus, RunStatus[]> = {
  queued: ["syncing", "cancel_requested", "needs_auth", "failed"],
  syncing: ["running", "failed", "needs_auth", "conflict", "cancel_requested"],
  running: ["validating", "failed", "cancel_requested"],
  validating: ["publishing", "failed", "cancel_requested"],
  publishing: [
    "succeeded",
    "failed",
    "needs_auth",
    "conflict",
    "cancel_requested",
  ],
  succeeded: [],
  failed: [],
  needs_auth: [],
  conflict: [],
  cancel_requested: ["cancelled", "failed"],
  cancelled: [],
};
export function transition(
  run: Run,
  status: RunStatus,
  now = new Date().toISOString(),
): Run {
  if (run.status === status) return run;
  if (!transitions[run.status].includes(status))
    throw new OrbitError(
      "INVALID_TRANSITION",
      `${run.status} → ${status} 상태 변경은 허용되지 않습니다.`,
    );
  return {
    ...run,
    status,
    updatedAt: now,
    steps: [...run.steps, { status, at: now }],
  };
}
export const terminal = (s: RunStatus) =>
  ["succeeded", "failed", "cancelled", "needs_auth", "conflict"].includes(s);
