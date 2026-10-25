import { useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { AppState, CalendarEvent } from "../domain/model";
import {
  agenda,
  localDate,
  localDateTime,
  localToUTC,
  monthCells,
  type Occurrence,
} from "../domain/calendar";
import {
  api,
  Button,
  Empty,
  errorText,
  Head,
  Pill,
  type Feedback,
} from "./main";
export function CalendarPage({
  state,
  feedback,
  initialDate,
}: {
  state: AppState;
  feedback: Feedback;
  initialDate?: string;
}) {
  const today = localDate(new Date().toISOString(), state.settings.timezone),
    [selected, setSelected] = useState(initialDate ?? today),
    [month, setMonth] = useState((initialDate ?? today).slice(0, 7)),
    [edit, setEdit] = useState<Occurrence>(),
    [formKey, setFormKey] = useState(0);
  const date = Temporal.PlainDate.from(`${month}-01`),
    cells = monthCells(date.year, date.month, state.settings.weekStart),
    items = agenda(state.events, selected, state.settings.timezone);
  function newEvent(day = selected) {
    setSelected(day);
    setEdit(undefined);
    setFormKey((k) => k + 1);
  }
  return (
    <>
      <Head
        title="좋은 하루는, 좋은 계획에서."
        sub={`개인 일정과 학습을 함께 확인하세요. · ${state.settings.timezone}`}
        action={
          <Button primary onClick={() => newEvent()}>
            ＋ 일정 추가
          </Button>
        }
      />
      <div className="split">
        <section>
          <div className="card">
            <div className="row between wrap">
              <h2>
                {date.year}년 {date.month}월
              </h2>
              <div className="row">
                <Button
                  onClick={() => {
                    setMonth(today.slice(0, 7));
                    newEvent(today);
                  }}
                >
                  오늘
                </Button>
                <Button
                  aria-label="이전 달"
                  onClick={() =>
                    setMonth(
                      date.subtract({ months: 1 }).toString().slice(0, 7),
                    )
                  }
                >
                  ‹
                </Button>
                <Button
                  aria-label="다음 달"
                  onClick={() =>
                    setMonth(date.add({ months: 1 }).toString().slice(0, 7))
                  }
                >
                  ›
                </Button>
              </div>
            </div>
            <div className="month-grid" role="group" aria-label="월간 달력">
              {(state.settings.weekStart === "monday"
                ? ["월", "화", "수", "목", "금", "토", "일"]
                : ["일", "월", "화", "수", "목", "금", "토"]
              ).map((d) => (
                <div className="weekday" key={d}>
                  {d}
                </div>
              ))}
              {cells.map((c) => {
                const entries = agenda(
                  state.events,
                  c.date,
                  state.settings.timezone,
                );
                return (
                  <button
                    type="button"
                    className={`cell ${selected === c.date ? "selected" : ""} ${c.inMonth ? "" : "muted"}`}
                    key={c.date}
                    aria-label={`${c.date}, 일정 ${entries.length}개`}
                    aria-pressed={selected === c.date}
                    onClick={() => newEvent(c.date)}
                  >
                    <b className={c.date === today ? "today-dot" : ""}>
                      {c.day}
                    </b>
                    {entries.slice(0, 2).map((o) => (
                      <div
                        className="event-tag"
                        key={o.id}
                        title={o.event.title}
                      >
                        {o.event.title}
                      </div>
                    ))}
                    {entries.length > 2 && (
                      <small>＋{entries.length - 2}개</small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card agenda">
            <h3>{selected} 일정</h3>
            {items.length ? (
              items.map((o) => (
                <button
                  className="agenda-item"
                  key={o.id}
                  onClick={() => {
                    setEdit(o);
                    setFormKey((k) => k + 1);
                  }}
                >
                  <Pill>
                    {o.event.allDay
                      ? "종일"
                      : new Date(o.start).toLocaleTimeString("ko-KR", {
                          timeZone: state.settings.timezone,
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </Pill>
                  <span>
                    <b>{o.event.title}</b>
                    <br />
                    <small>
                      {o.event.category} ·{" "}
                      {o.event.recurrence.frequency === "none"
                        ? "한 번"
                        : "반복 일정"}
                    </small>
                  </span>
                  <span className="text-button">편집 →</span>
                </button>
              ))
            ) : (
              <Empty>아직 일정이 없어요. 오른쪽에서 하루를 계획해보세요.</Empty>
            )}
          </div>
        </section>
        <EventForm
          key={formKey}
          date={selected}
          zone={state.settings.timezone}
          occurrence={edit}
          feedback={feedback}
          saved={() => {
            setEdit(undefined);
            setFormKey((k) => k + 1);
          }}
        />
      </div>
    </>
  );
}
function EventForm({
  date,
  zone,
  occurrence,
  feedback,
  saved,
}: {
  date: string;
  zone: string;
  occurrence?: Occurrence;
  feedback: Feedback;
  saved: () => void;
}) {
  const original = occurrence?.event,
    now = new Date().toISOString();
  const [title, setTitle] = useState(original?.title ?? ""),
    [start, setStart] = useState(
      occurrence
        ? localDateTime(occurrence.start, original!.timezone)
        : `${date}T09:00`,
    ),
    [end, setEnd] = useState(
      occurrence
        ? localDateTime(occurrence.end, original!.timezone)
        : `${date}T10:00`,
    ),
    [timezone, setTimezone] = useState(original?.timezone ?? zone),
    [allDay, setAllDay] = useState(original?.allDay ?? false),
    [frequency, setFrequency] = useState(
      original?.recurrence.frequency ?? "none",
    ),
    [days, setDays] = useState(original?.recurrence.weekdays ?? []),
    [until, setUntil] = useState(original?.recurrence.until ?? ""),
    [count, setCount] = useState(original?.recurrence.count?.toString() ?? ""),
    [reminder, setReminder] = useState(original?.reminder ?? "none"),
    [category, setCategory] = useState(original?.category ?? "개인"),
    [notes, setNotes] = useState(original?.notes ?? ""),
    [scope, setScope] = useState<"all" | "this">("this"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (frequency === "weekly" && !days.length)
        throw new Error("반복할 요일을 선택하세요.");
      if (until && until < start.slice(0, 10))
        throw new Error("반복 종료일은 시작일 이후여야 합니다.");
      let localStart = start,
        localEnd = end;
      if (
        original &&
        scope === "all" &&
        original.recurrence.frequency !== "none"
      ) {
        const delta = Temporal.PlainDate.from(
          original.localStart.slice(0, 10),
        ).until(Temporal.PlainDate.from(occurrence!.date)).days;
        localStart = Temporal.PlainDateTime.from(start)
          .subtract({ days: delta })
          .toString();
        localEnd = Temporal.PlainDateTime.from(end)
          .subtract({ days: delta })
          .toString();
      }
      const event: CalendarEvent = {
        id: original?.id ?? crypto.randomUUID(),
        version: original?.version ?? 1,
        createdAt: original?.createdAt ?? now,
        updatedAt: now,
        title,
        start: localToUTC(localStart, timezone),
        end: localToUTC(localEnd, timezone),
        localStart,
        localEnd,
        timezone,
        allDay,
        recurrence: {
          frequency,
          weekdays: days,
          ...(until ? { until } : {}),
          ...(count ? { count: Number(count) } : {}),
        },
        exceptions: original?.exceptions ?? [],
        reminder,
        category,
        notes,
      };
      await api("event.save", {
        event,
        scope: original?.recurrence.frequency === "none" ? "all" : scope,
        occurrence: occurrence?.date,
      });
      feedback("일정을 저장했어요.");
      saved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !original ||
      !window.confirm(
        scope === "this"
          ? "이번 일정만 삭제할까요?"
          : "전체 반복 일정을 삭제할까요?",
      )
    )
      return;
    setBusy(true);
    try {
      await api("event.delete", {
        id: original.id,
        version: original.version,
        scope: original.recurrence.frequency === "none" ? "all" : scope,
        occurrence: occurrence?.date,
      });
      feedback("일정을 삭제했어요.");
      saved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card form event-form" onSubmit={submit}>
      <h2>{original ? "일정 편집" : "새 일정"}</h2>
      <label className="field">
        일정 제목
        <input
          aria-label="일정 제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder="어떤 시간을 보내고 싶나요?"
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => {
            setAllDay(e.target.checked);
            if (e.target.checked) {
              setStart(`${start.slice(0, 10)}T00:00`);
              setEnd(
                `${Temporal.PlainDate.from(start.slice(0, 10)).add({ days: 1 })}T00:00`,
              );
            }
          }}
        />
        종일 일정
      </label>
      <label className="field">
        시작
        <input
          aria-label="시작 일시"
          type={allDay ? "date" : "datetime-local"}
          value={allDay ? start.slice(0, 10) : start.slice(0, 16)}
          onChange={(e) => setStart(e.target.value + (allDay ? "T00:00" : ""))}
          required
        />
      </label>
      <label className="field">
        종료{allDay ? " (이 날짜 미포함)" : ""}
        <input
          aria-label="종료 일시"
          type={allDay ? "date" : "datetime-local"}
          value={allDay ? end.slice(0, 10) : end.slice(0, 16)}
          onChange={(e) => setEnd(e.target.value + (allDay ? "T00:00" : ""))}
          required
        />
      </label>
      <label className="field">
        시간대
        <input
          aria-label="일정 시간대"
          list="timezones"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          required
        />
      </label>
      <datalist id="timezones">
        {[
          "Asia/Seoul",
          "Asia/Tokyo",
          "America/New_York",
          "America/Los_Angeles",
          "Europe/London",
          "UTC",
        ].map((z) => (
          <option value={z} key={z} />
        ))}
      </datalist>
      <div className="two">
        <label className="field">
          반복
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          >
            <option value="none">반복 안 함 · 한 번</option>
            <option value="daily">매일</option>
            <option value="weekly">요일 선택 매주</option>
          </select>
        </label>
        <label className="field">
          알림
          <select
            value={reminder}
            onChange={(e) => setReminder(e.target.value as typeof reminder)}
          >
            <option value="none">알림 없음</option>
            <option value="10">10분 전</option>
            <option value="30">30분 전</option>
          </select>
        </label>
      </div>
      {frequency === "weekly" && (
        <fieldset className="weekdays">
          <legend>반복 요일</legend>
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={days.includes(i)}
                onChange={(e) =>
                  setDays(
                    e.target.checked
                      ? [...days, i]
                      : days.filter((n) => n !== i),
                  )
                }
              />
              {d}
            </label>
          ))}
        </fieldset>
      )}
      {frequency !== "none" && (
        <div className="two">
          <label className="field">
            반복 종료일 (선택)
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <label className="field">
            최대 횟수 (선택)
            <input
              type="number"
              min="1"
              max="10000"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
        </div>
      )}
      <label className="field">
        카테고리
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
        >
          {["개인", "학습", "개발", "금융"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="field">
        메모
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={10000}
        />
      </label>
      {original && original.recurrence.frequency !== "none" && (
        <label className="field">
          변경 범위
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="this">이번 일정만</option>
            <option value="all">전체 반복 일정</option>
          </select>
        </label>
      )}
      <small>
        알림은 앱 실행 중 지원하며 절전 복귀 시 15분 이내 누락 알림을
        전달합니다. Windows 알림 허용 여부는 시스템 설정에서 확인하세요.
      </small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {original && (
          <Button disabled={busy} onClick={() => void remove()}>
            삭제
          </Button>
        )}
        <Button onClick={saved} disabled={busy}>
          취소
        </Button>
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? "저장 중…" : "일정 저장"}
        </button>
      </div>
    </form>
  );
}
