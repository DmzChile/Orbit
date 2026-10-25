import { describe, it, expect } from "vitest";
import {
  agenda,
  localToUTC,
  occurrences,
  monthCells,
  nextRun,
  latestDue,
} from "../src/domain/calendar";
import {
  eventSchema,
  initialState,
  requestSchema,
  safeUrl,
} from "../src/domain/model";
const event = (extra: Record<string, unknown> = {}) =>
  eventSchema.parse({
    id: "e1",
    version: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    title: "윤년 학습",
    start: localToUTC("2024-02-28T23:30", "Asia/Seoul"),
    end: localToUTC("2024-02-29T00:30", "Asia/Seoul"),
    localStart: "2024-02-28T23:30",
    localEnd: "2024-02-29T00:30",
    timezone: "Asia/Seoul",
    allDay: false,
    recurrence: { frequency: "none", weekdays: [] },
    exceptions: [],
    reminder: "10",
    category: "학습",
    notes: "",
    ...extra,
  });
import { request } from "./fixtures";
describe("CAL-01/02/03/04 · calendar", () => {
  it("computes leap years and week starts without a fixed date", () => {
    expect(monthCells(2024, 2, "sunday").filter((c) => c.inMonth)).toHaveLength(
      29,
    );
    expect(monthCells(2025, 2, "monday").filter((c) => c.inMonth)).toHaveLength(
      28,
    );
    expect(monthCells(2024, 2, "monday")[0].date).toBe("2024-01-29");
  });
  it("stores UTC separately and spans midnight on both days", () => {
    expect(event().start).toBe("2024-02-28T14:30:00Z");
    expect(agenda([event()], "2024-02-28", "Asia/Seoul")).toHaveLength(1);
    expect(agenda([event()], "2024-02-29", "Asia/Seoul")).toHaveLength(1);
    expect(agenda([event()], "2024-03-01", "Asia/Seoul")).toHaveLength(0);
  });
  it("rejects invalid end times", () =>
    expect(() => event({ end: "2024-02-28T12:00:00Z" })).toThrow());
  it("handles weekday recurrence, count, until, and individual exceptions", () => {
    const recurring = event({
      recurrence: {
        frequency: "weekly",
        weekdays: [3, 4],
        count: 3,
        until: "2024-03-10",
      },
      exceptions: ["2024-02-29"],
    });
    expect(
      occurrences(recurring, "2024-02-28", "2024-03-10").map((o) => o.date),
    ).toEqual(["2024-02-28", "2024-03-06"]);
  });
  it("rejects missing and ambiguous DST wall times", () => {
    expect(() => localToUTC("2026-03-08T02:30", "America/New_York")).toThrow();
    expect(() => localToUTC("2026-11-01T01:30", "America/New_York")).toThrow();
    expect(localToUTC("2026-03-08T03:30", "America/New_York")).toBe(
      "2026-03-08T07:30:00Z",
    );
  });
  it("all-day exclusive end does not appear the following day", () => {
    const e = event({
      localStart: "2024-02-28T00:00",
      localEnd: "2024-02-29T00:00",
      start: localToUTC("2024-02-28T00:00", "Asia/Seoul"),
      end: localToUTC("2024-02-29T00:00", "Asia/Seoul"),
      allDay: true,
    });
    expect(agenda([e], "2024-02-28", "Asia/Seoul")).toHaveLength(1);
    expect(agenda([e], "2024-02-29", "Asia/Seoul")).toHaveLength(0);
  });
});
describe("AUTO-07/08 · scheduling", () => {
  it("coalesces missed occurrences to the latest due time", () => {
    const r = request();
    expect(latestDue(r, "2024-03-03T02:00:00Z", "2024-02-28T00:00:00Z")).toBe(
      "2024-03-03T00:00:00Z",
    );
    expect(
      latestDue(r, "2024-03-03T02:00:00Z", "2024-03-03T00:00:00Z"),
    ).toBeNull();
  });
  it("finds weekly and one-shot schedules", () => {
    const r = request({
      rule: {
        frequency: "weekly",
        time: "09:00",
        weekdays: [0],
        timezone: "Asia/Seoul",
      },
    });
    expect(nextRun(r.rule, "2024-03-01T00:00:00Z")).toBe(
      "2024-03-03T00:00:00Z",
    );
    expect(
      nextRun(
        { ...r.rule, frequency: "once", date: "2024-02-29" },
        "2024-03-01T00:00:00Z",
      ),
    ).toBeNull();
  });
  it("never schedules manual, paused, or expired requests", () => {
    expect(
      latestDue(request({ enabled: false }), "2024-03-03T02:00:00Z"),
    ).toBeNull();
    expect(
      nextRun(
        { ...request().rule, frequency: "manual" },
        "2024-03-01T00:00:00Z",
      ),
    ).toBeNull();
    expect(
      nextRun(
        { ...request().rule, until: "2024-02-29" },
        "2024-03-01T00:00:00Z",
      ),
    ).toBeNull();
  });
});
describe("SEC-03 · contracts", () => {
  it("rejects scripts, HTTP, credentials and command-like branches", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://example.com",
      "https://user:password@example.com",
    ])
      expect(safeUrl.safeParse(url).success).toBe(false);
    expect(
      requestSchema.safeParse({
        ...request(),
        baseBranch: "--upload-pack=evil",
      }).success,
    ).toBe(false);
  });
  it("starts with real empty state", () => {
    const s = initialState();
    expect(s.events).toEqual([]);
    expect(s.runs).toEqual([]);
    expect(s.articles).toEqual([]);
    expect(s.boards[0].widgets).toEqual([]);
  });
});

import { inQuietHours } from "../src/domain/notifications";
describe("RES-05 · quiet hours", () => {
  it("handles quiet hours across midnight in the user timezone", () => {
    const settings = initialState().settings;
    expect(inQuietHours(settings, new Date("2026-10-25T14:00:00Z"))).toBe(true);
    expect(inQuietHours(settings, new Date("2026-10-25T01:00:00Z"))).toBe(
      false,
    );
    expect(
      inQuietHours(
        { ...settings, quietStart: "08:00", quietEnd: "08:00" },
        new Date(),
      ),
    ).toBe(false);
  });
});
