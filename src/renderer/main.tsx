import React, { useCallback, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  AppState,
  OrbitAPI,
  Settings,
  Article,
  Board,
  Request,
} from "../domain/model";
import { CalendarPage } from "./Calendar";
import { BoardPage, Widgets } from "./Widgets";
import { Automations, Results } from "./Work";
import { SettingsPage } from "./Settings";
import { NewsPage } from "./News";
import { Icon } from "./icons";
import { NewsSpotlight } from "./NewsSpotlight";
import { agenda, localDate, monthCells } from "../domain/calendar";
import "./style.css";
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
    [page, setPage] = useState("home"),
    [message, setMessage] = useState(""),
    [fatal, setFatal] = useState(""),
    [article, setArticle] = useState<Article>(),
    [articleNavigation, setArticleNavigation] = useState(0),
    [calendarDate, setCalendarDate] = useState<string>(),
    [draftRef, setDraftRef] = useState<Request["refs"]>([]),
    [requestSeed, setRequestSeed] = useState<Request>(),
    [resultId, setResultId] = useState<string>(),
    [connection, setConnection] = useState<{
      github: boolean;
      alpha: boolean;
      error: string;
      login?: string;
      version: string;
    }>();
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
      setPage("results");
    });
    return () => {
      off?.();
      nav?.();
    };
  }, [reload]);
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
  function go(value: string) {
    setPage(value);
    document.getElementById("content")?.scrollTo({ top: 0 });
  }
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
    go("auto");
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
  const board =
      state.boards.find((b) => b.id === state.settings.selectedBoard) ??
      state.boards[0],
    unread = state.runs.filter((r) => !r.readAt).length;
  return (
    <div className="app">
      <header className="titlebar">
        <span>ORBIT</span>
        <span>나의 하루를 이어주는 작은 공간</span>
        <span className="caption-space" />
      </header>
      <div className="shell">
        <aside>
          <div className="brand">
            <div className="mark">o</div>
            <span>Orbit</span>
          </div>
          <div className="eyebrow">WORKSPACE</div>
          <nav aria-label="주 메뉴">
            {[
              ["home", "home", "오늘"],
              ["news", "news", "뉴스"],
              ["calendar", "calendar", "캘린더"],
              ["custom", "grid", "내 공간"],
              ["auto", "spark", "자동화"],
              ["results", "inbox", "결과함"],
            ].map(([key, icon, label]) => (
              <button
                className={`nav ${page === key ? "active" : ""}`}
                aria-label={label}
                aria-current={page === key ? "page" : undefined}
                onClick={() => go(key)}
                key={key}
              >
                <Icon name={icon} />
                <span>
                  {label}
                  {key === "results" && unread > 0 && (
                    <b className="badge">{unread}</b>
                  )}
                </span>
              </button>
            ))}
          </nav>
          <button className="btn quiet" onClick={() => go("custom")}>
            ＋ <span className="browse-label">위젯 둘러보기</span>
          </button>
          <div className="connect">
            <Icon name="github" />
            <b>개인 워크스페이스</b>
            <small>
              {connection?.github
                ? `GitHub · ${connection.login}`
                : "GitHub 연결 필요"}
            </small>
            {connection?.error && (
              <small className="error">{connection.error}</small>
            )}
            <button className="text-button" onClick={() => go("settings")}>
              {connection?.github ? "연결 관리" : "연결하기"} →
            </button>
          </div>
          <div className="sidebar-actions">
            <button
              className={`nav ${page === "settings" ? "active" : ""}`}
              onClick={() => go("settings")}
            >
              <Icon name="settings" />
              <span>설정 및 연결</span>
            </button>
            <label>
              <input
                type="checkbox"
                checked={state.settings.reduceMotion}
                onChange={(e) =>
                  void saveSettings({
                    ...state.settings,
                    reduceMotion: e.target.checked,
                  }).catch((e) => setMessage(errorText(e)))
                }
              />
              모션 줄이기
            </label>
          </div>
          <div className="profile">
            <span className="avatar">O</span>
            <div>
              나의 워크스페이스
              <br />
              <small>Personal · {connection?.version}</small>
            </div>
          </div>
        </aside>
        <main className="content" id="content" tabIndex={-1}>
          {page === "home" && (
            <Home
              state={state}
              board={board}
              go={go}
              openCalendar={(date) => {
                setCalendarDate(date);
                go("calendar");
              }}
              openArticle={(a) => {
                setArticle(a);
                setArticleNavigation((value) => value + 1);
                go("news");
              }}
              feedback={setMessage}
              openResult={(id) => {
                setResultId(id);
                go("results");
              }}
            />
          )}
          <div hidden={page !== "news"}>
            <NewsPage
              key={articleNavigation}
              state={state}
              selected={article}
              onSelected={setArticle}
              ask={ask}
              feedback={setMessage}
            />
          </div>
          {page === "calendar" && (
            <CalendarPage
              state={state}
              feedback={setMessage}
              initialDate={calendarDate}
            />
          )}
          {page === "custom" && (
            <BoardPage
              key={board.id}
              state={state}
              board={board}
              feedback={setMessage}
            />
          )}
          {page === "auto" && (
            <Automations
              state={state}
              refs={draftRef}
              seed={requestSeed}
              feedback={setMessage}
            />
          )}
          {page === "results" && (
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
                go("auto");
              }}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              key={state.workspaceId}
              state={state}
              feedback={setMessage}
              save={saveSettings}
            />
          )}
        </main>
      </div>
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
  board,
  go,
  openArticle,
  feedback,
  openResult,
  openCalendar,
}: {
  state: AppState;
  board: Board;
  go: (p: string) => void;
  openArticle: (a: Article) => void;
  feedback: Feedback;
  openResult: (id: string) => void;
  openCalendar: (date: string) => void;
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
          <Button primary onClick={() => go("auto")}>
            ＋ 새로운 요청
          </Button>
        }
      />
      <div className="top-grid">
        <NewsSpotlight
          articles={state.articles}
          fetchedAt={state.newsFetchedAt}
          reduceMotion={state.settings.reduceMotion}
          openArticle={openArticle}
          openNews={() => go("news")}
        />
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
      <div className="section-head">
        <h2>{board.name}</h2>
        <small>나에게 필요한 것만, 한곳에.</small>
        <Button onClick={() => go("custom")}>공간 편집</Button>
      </div>
      <Widgets state={state} board={board} feedback={feedback} />
      {!board.widgets.length && (
        <button className="card add-widget full" onClick={() => go("custom")}>
          <Icon name="plus" />
          <h3>나만의 공간을 만들어보세요.</h3>
          <p>금융 · 학습 · GitHub · 우주 · 메모</p>
        </button>
      )}
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
          <Button onClick={() => (last ? openResult(last.id) : go("auto"))}>
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
