import React, { useCallback, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  AppState,
  OrbitAPI,
  Settings,
  Article,
  Request,
} from "../domain/model";
import { CalendarPage } from "./Calendar";
import { Automations, Results } from "./Work";
import { SettingsPage } from "./Settings";
import { NewsPage } from "./News";
import { Icon } from "./icons";
import {
  BannerWorkspace,
  PersonalSpace,
  useWorkspaceNavigation,
} from "./Workspace";
import { UpdatePanel } from "./Updates";
import { agenda, localDate, monthCells } from "../domain/calendar";
import "./style.css";
import "./workspace.css";
import { inQuietHours } from "../domain/notifications";
declare global {
  interface Window {
    orbit: OrbitAPI;
  }
}
export async function api<T = unknown>(op: string, data?: unknown): Promise<T> {
  if (!window.orbit)
    throw new Error(
      "Windows 앱에서 실행하세요. npm run dev 명령을 이용할 수 있습니다.",
    );
  const result = await window.orbit.call<T>(op, data);
  if (!result.ok)
    throw Object.assign(new Error(result.error.message), {
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
  return result.data;
}
export type Feedback = (message: string) => void;
export function errorText(error: unknown) {
  return error instanceof Error
    ? `${error.message}${"correlationId" in error ? ` · 진단 ${String(error.correlationId).slice(0, 8)}` : ""}`
    : "다시 시도하세요.";
}
export const dateText = (at: string) => new Date(at).toLocaleString("ko-KR");
export function Head({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {action}
    </header>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`btn ${primary ? "primary" : "outline"}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
export function Pill({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
export function App() {
  const [state, setState] = useState<AppState>(),
    [message, setMessage] = useState(""),
    [fatal, setFatal] = useState(""),
    [article, setArticle] = useState<Article>(),
    [articleNavigation, setArticleNavigation] = useState(0),
    [calendarDate, setCalendarDate] = useState<string>(),
    [calendarNavigation, setCalendarNavigation] = useState(0),
    [draftRef, setDraftRef] = useState<Request["refs"]>([]),
    [requestSeed, setRequestSeed] = useState<Request>(),
    [requestNavigation, setRequestNavigation] = useState(0),
    [resultId, setResultId] = useState<string>(),
    [connection, setConnection] = useState<{
      github: boolean;
      alpha: boolean;
      error: string;
      login?: string;
      version: string;
    }>();
  const navigation = useWorkspaceNavigation(
    state?.settings.reduceMotion ?? false,
  );
  const { navigate: go } = navigation;
  const previousRuns = useRef<Map<string, string> | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await api<AppState>("state"));
      setConnection(await api("connection"));
    } catch (e) {
      setFatal(errorText(e));
    }
  }, []);
  useEffect(() => {
    void reload();
    const off = window.orbit?.onChange(() => void reload());
    const nav = window.orbit?.onNavigate((id) => {
      setResultId(id);
      go("results");
    });
    return () => {
      off?.();
      nav?.();
    };
  }, [reload, go]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(t);
  }, [message]);
  useEffect(() => {
    if (state) {
      document.body.classList.toggle("reduce", state.settings.reduceMotion);
      document.documentElement.style.fontSize = `${14 * state.settings.fontScale}px`;
      document.documentElement.lang = "ko";
    }
  }, [state?.settings.reduceMotion, state?.settings.fontScale]);
  async function saveSettings(settings: Settings) {
    const previous = state;
    setState((s) => (s ? { ...s, settings } : s));
    try {
      await api("settings.save", settings);
      await reload();
    } catch (e) {
      setState(previous);
      throw e;
    }
  }
  useEffect(() => {
    if (!state) return;
    const old = previousRuns.current;
    if (old && state.settings.notifications && !inQuietHours(state.settings)) {
      const newResult = state.runs.find(
        (r) =>
          ["succeeded", "failed", "needs_auth", "conflict"].includes(
            r.status,
          ) &&
          old.get(r.id) !== r.status &&
          r.requestSnapshot.notify,
      );
      if (newResult)
        setMessage(
          `${newResult.requestSnapshot.title} · ${newResult.status === "succeeded" ? "결과가 도착했어요." : "확인이 필요해요."}`,
        );
    }
    previousRuns.current = new Map(state.runs.map((r) => [r.id, r.status]));
  }, [state]);
  const ask = (a: Article) => {
    setRequestSeed(undefined);
    setDraftRef([{ title: a.title, url: a.url, topic: a.topics.join(", ") }]);
    setRequestNavigation((value) => value + 1);
    go("auto", true);
  };
  const newRequest = () => {
    setRequestSeed(undefined);
    setDraftRef([]);
    setRequestNavigation((value) => value + 1);
    go("auto", true);
  };
  if (!state)
    return (
      <div className="startup" role="status">
        <div className="mark">o</div>
        <h1>Orbit</h1>
        <p>{fatal || "나의 공간을 불러오고 있어요."}</p>
        {fatal && <Button onClick={() => void reload()}>다시 시도</Button>}
      </div>
    );
  return (
    <div className="app">
      <header className="titlebar">
        <span>ORBIT</span>
        <span>나의 하루를 이어주는 작은 공간</span>
        <span className="caption-space" />
      </header>
      <UpdatePanel banner />
      <BannerWorkspace
        navigation={navigation}
        state={state}
        connection={connection}
        openArticle={(a) => {
          setArticle(a);
          setArticleNavigation((value) => value + 1);
          go("news", true);
        }}
      >
        {(page) => {
          switch (page) {
            case "home":
              return (
                <Home
                  state={state}
                  go={go}
                  newRequest={newRequest}
                  openCalendar={(date) => {
                    setCalendarDate(date);
                    setCalendarNavigation((value) => value + 1);
                    go("calendar");
                  }}
                  openResult={(id) => {
                    setResultId(id);
                    go("results");
                  }}
                />
              );
            case "news":
              return (
                <NewsPage
                  key={articleNavigation}
                  state={state}
                  selected={article}
                  onSelected={setArticle}
                  ask={ask}
                  feedback={setMessage}
                />
              );
            case "calendar":
              return (
                <CalendarPage
                  key={calendarNavigation}
                  state={state}
                  feedback={setMessage}
                  initialDate={calendarDate}
                />
              );
            case "custom":
              return <PersonalSpace />;
            case "auto":
              return (
                <Automations
                  key={requestNavigation}
                  state={state}
                  refs={draftRef}
                  seed={requestSeed}
                  feedback={setMessage}
                />
              );
            case "results":
              return (
                <Results
                  state={state}
                  selectedId={resultId}
                  onSelected={setResultId}
                  feedback={setMessage}
                  again={(r) => {
                    const now = new Date().toISOString();
                    setRequestSeed({
                      ...r,
                      id: crypto.randomUUID(),
                      version: 1,
                      createdAt: now,
                      updatedAt: now,
                      remoteIssue: undefined,
                      remoteUpdatedAt: undefined,
                    });
                    setDraftRef(r.refs);
                    setRequestNavigation((value) => value + 1);
                    go("auto", true);
                  }}
                />
              );
            case "settings":
              return (
                <SettingsPage
                  key={state.workspaceId}
                  state={state}
                  feedback={setMessage}
                  save={saveSettings}
                />
              );
          }
        }}
      </BannerWorkspace>
      {message && (
        <div className="toast" role="status">
          <Icon name="check" />
          <span>{message}</span>
          <button aria-label="알림 닫기" onClick={() => setMessage("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
function Home({
  state,
  go,
  openResult,
  openCalendar,
  newRequest,
}: {
  state: AppState;
  go: (p: string) => void;
  openResult: (id: string) => void;
  openCalendar: (date: string) => void;
  newRequest: () => void;
}) {
  const today = localDate(new Date().toISOString(), state.settings.timezone),
    date = new Date(`${today}T12:00:00`),
    items = agenda(state.events, today, state.settings.timezone),
    last = state.runs.at(-1),
    cells = monthCells(
      date.getFullYear(),
      date.getMonth() + 1,
      state.settings.weekStart,
    );
  return (
    <>
      <Head
        title="오늘도, 나의 궤도대로."
        sub={`${date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })} · 일정 ${items.length}개 · 새 결과 ${state.runs.filter((r) => !r.readAt).length}개`}
        action={
          <Button primary onClick={newRequest}>
            ＋ 새로운 요청
          </Button>
        }
      />
      <div className="today-overview">
        <section className="card today-agenda">
          <div className="row between">
            <h2>오늘의 일정</h2>
            <Pill>{items.length}개</Pill>
          </div>
          {items.length ? (
            items.map((item) => (
              <button
                className="today-agenda-item"
                key={`${item.event.id}:${item.start}`}
                onClick={() => openCalendar(today)}
              >
                <time>
                  {new Date(item.start).toLocaleTimeString("ko-KR", {
                    timeZone: state.settings.timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <span>
                  <strong>{item.event.title}</strong>
                  <small>{item.event.category}</small>
                </span>
                <Icon name="arrow" />
              </button>
            ))
          ) : (
            <Empty>
              아직 오늘 일정이 없어요. 여유로운 하루에 계획을 더해보세요.
            </Empty>
          )}
          <Button onClick={() => openCalendar(today)}>＋ 일정 추가</Button>
        </section>
        <section className="card calendar-mini">
          <div className="row between month">
            <h3>
              {date.getFullYear()}년 {date.getMonth() + 1}월
            </h3>
            <button
              className="text-button"
              onClick={() => go("calendar")}
              aria-label="전체 캘린더"
            >
              ↗
            </button>
          </div>
          <div className="days">
            {(state.settings.weekStart === "monday"
              ? ["월", "화", "수", "목", "금", "토", "일"]
              : ["일", "월", "화", "수", "목", "금", "토"]
            ).map((d) => (
              <span className="week-day" key={d}>
                {d}
              </span>
            ))}
            {cells.map((c) => (
              <button
                className={`day ${c.date === today ? "selected" : ""} ${!c.inMonth ? "muted" : ""}`}
                onClick={() => openCalendar(c.date)}
                key={c.date}
                aria-label={`${c.date} 캘린더`}
              >
                {c.day}
              </button>
            ))}
          </div>
          <div className="upcoming">
            {items.length ? (
              <>
                <Pill>
                  {new Date(items[0].start).toLocaleTimeString("ko-KR", {
                    timeZone: state.settings.timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Pill>
                <div className="truncate">
                  {items[0].event.title}
                  <br />
                  <small>{items[0].event.category}</small>
                </div>
              </>
            ) : (
              <button className="text-button" onClick={() => go("calendar")}>
                여유로운 하루에 일정 더하기 ＋
              </button>
            )}
          </div>
        </section>
      </div>
      <div className="card result-strip">
        <Icon name="inbox" />
        <div>
          <h3>
            {last?.requestSnapshot.title ?? "맡긴 일의 결과가 이곳에 도착해요."}
          </h3>
          <small>
            {last
              ? `${last.status} · ${dateText(last.updatedAt)}`
              : "GitHub와 외부 ChatGPT 예약을 연결해 첫 요청을 보내보세요."}
          </small>
        </div>
        <div className="actions">
          <Button onClick={() => (last ? openResult(last.id) : newRequest())}>
            {last ? "결과 확인" : "요청 작성"} →
          </Button>
        </div>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
