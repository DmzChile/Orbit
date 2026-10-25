import { useEffect, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { AppState, Board, Widget } from "../domain/model";
import { agenda, localDate } from "../domain/calendar";
import {
  api,
  Button,
  Empty,
  errorText,
  Head,
  Pill,
  type Feedback,
} from "./main";
import { Icon } from "./icons";
const catalog = [
  {
    type: "finance",
    title: "마켓 워치",
    icon: "chart",
    color: "var(--green)",
    desc: "관심 종목의 마감 시세와 변동",
    category: "금융",
  },
  {
    type: "learn",
    title: "학습 플래너",
    icon: "book",
    color: "var(--purple)",
    desc: "목표, 실제 학습 일정과 완료 기록",
    category: "학습",
  },
  {
    type: "github",
    title: "GitHub 활동",
    icon: "github",
    color: "var(--blue)",
    desc: "접근 가능한 저장소의 PR과 이슈",
    category: "개발",
  },
  {
    type: "space",
    title: "우주 & 과학",
    icon: "spark",
    color: "#327d96",
    desc: "수집한 우주·과학 기사와 연결",
    category: "학습",
  },
  {
    type: "notes",
    title: "빠른 메모",
    icon: "grid",
    color: "#8f6c26",
    desc: "떠오른 아이디어를 안전하게 저장",
    category: "메모",
  },
] as const;
export function Widgets({
  state,
  board,
  feedback,
}: {
  state: AppState;
  board: Board;
  feedback: Feedback;
}) {
  async function change(widget: Widget) {
    try {
      await api("board.save", {
        ...board,
        widgets: board.widgets.map((w) => (w.id === widget.id ? widget : w)),
      });
      feedback("위젯을 저장했어요.");
    } catch (e) {
      feedback(errorText(e));
    }
  }
  return (
    <div className="widget-grid">
      {[...board.widgets]
        .sort((a, b) => a.order - b.order)
        .map((w) => (
          <WidgetCard
            key={w.id}
            widget={w}
            state={state}
            feedback={feedback}
            change={change}
          />
        ))}
    </div>
  );
}
export function BoardPage({
  state,
  board,
  feedback,
}: {
  state: AppState;
  board: Board;
  feedback: Feedback;
}) {
  const [draft, setDraft] = useState(() => structuredClone(board)),
    [history, setHistory] = useState<Board[]>([]),
    [edit, setEdit] = useState(true),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("전체"),
    [drag, setDrag] = useState(""),
    [over, setOver] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [newName, setNewName] = useState(""),
    [showNew, setShowNew] = useState(false);
  const dirty =
    JSON.stringify({ ...draft, version: 0 }) !==
    JSON.stringify({ ...board, version: 0 });
  function update(next: Board) {
    setHistory((h) => [...h.slice(-29), structuredClone(draft)]);
    setDraft({
      ...next,
      widgets: next.widgets.map((w, i) => ({ ...w, order: i })),
    });
    setEdit(true);
  }
  function add(type: Widget["type"], before?: string) {
    const widget: Widget = {
      id: crypto.randomUUID(),
      type,
      size: "M",
      order: draft.widgets.length,
      schemaVersion: 1,
      config:
        type === "finance"
          ? { symbol: "SPY" }
          : type === "learn"
            ? { goal: "이번 주에 배우고 싶은 것", weeklyTarget: 5 }
            : {},
    };
    const i = draft.widgets.findIndex((w) => w.id === before);
    const widgets = [...draft.widgets];
    widgets.splice(i < 0 ? widgets.length : i, 0, widget);
    if (widgets.length > 40) {
      feedback("보드에는 최대 40개 위젯을 둘 수 있어요.");
      return;
    }
    update({ ...draft, widgets });
    feedback("위젯을 추가했어요. 편집 완료를 눌러 저장하세요.");
  }
  function move(id: string, before?: string) {
    const widgets = draft.widgets.filter((w) => w.id !== id),
      item = draft.widgets.find((w) => w.id === id);
    if (!item) return;
    const i = widgets.findIndex((w) => w.id === before);
    widgets.splice(i < 0 ? widgets.length : i, 0, item);
    update({ ...draft, widgets });
  }
  function keyMove(e: React.KeyboardEvent, id: string) {
    if (
      !e.altKey ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    )
      return;
    e.preventDefault();
    const widgets = [...draft.widgets],
      i = widgets.findIndex((w) => w.id === id),
      j = i + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1);
    if (j < 0 || j >= widgets.length) return;
    [widgets[i], widgets[j]] = [widgets[j], widgets[i]];
    update({ ...draft, widgets });
    feedback(`${j + 1}번째 위치로 이동했어요.`);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("board.save", { ...draft, version: board.version });
      setDraft({ ...draft, version: board.version + 1 });
      setHistory([]);
      setEdit(false);
      feedback("공간을 저장했어요. 오늘 화면에도 반영됩니다.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function choose(id: string) {
    if (
      dirty &&
      !window.confirm("저장하지 않은 배치를 버리고 다른 보드로 이동할까요?")
    )
      return;
    try {
      await api("settings.save", { ...state.settings, selectedBoard: id });
    } catch (e) {
      feedback(errorText(e));
    }
  }
  async function create() {
    if (!newName.trim()) return;
    const next: Board = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      version: 1,
      widgets: [],
    };
    try {
      await api("board.save", next);
      await api("settings.save", { ...state.settings, selectedBoard: next.id });
    } catch (e) {
      feedback(errorText(e));
    }
  }
  function drop(e: React.DragEvent, target?: string) {
    e.preventDefault();
    e.stopPropagation();
    const value = e.dataTransfer.getData("application/orbit-widget");
    if (value.startsWith("new:")) add(value.slice(4) as Widget["type"], target);
    else if (value.startsWith("move:")) move(value.slice(5), target);
    setDrag("");
    setOver("");
  }
  return (
    <>
      <Head
        title="나에게 맞는, 나만의 공간."
        sub="메뉴의 관심 주제를 끌어, 원하는 곳에 놓으세요."
        action={
          <Button
            primary
            disabled={busy}
            onClick={() => (edit ? void save() : setEdit(true))}
          >
            {busy ? "저장 중…" : edit ? "편집 완료" : "공간 편집"}
          </Button>
        }
      />
      <div className="split">
        <section>
          <div className="toolbar wrap">
            <label className="field">
              보드
              <select
                value={board.id}
                onChange={(e) => void choose(e.target.value)}
              >
                {state.boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={() => setShowNew(!showNew)}>＋ 새 보드</Button>
            <span className="spacer" />
            <Button
              disabled={!history.length}
              onClick={() => {
                setDraft(history.at(-1)!);
                setHistory(history.slice(0, -1));
              }}
            >
              되돌리기
            </Button>
            <Button
              onClick={() => {
                setDraft(structuredClone(board));
                setHistory([]);
                setEdit(false);
              }}
            >
              취소
            </Button>
            <Button
              onClick={() => {
                if (
                  window.confirm(
                    "이 보드의 위젯 배치를 초기화할까요? 저장 전에는 되돌릴 수 있어요.",
                  )
                )
                  update({ ...draft, widgets: [] });
              }}
            >
              초기화
            </Button>
          </div>
          {showNew && (
            <div className="row new-board">
              <input
                aria-label="새 보드 이름"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                placeholder="새 보드 이름"
              />
              <Button primary onClick={() => void create()}>
                만들기
              </Button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div
            className={`workspace-grid ${drag ? "drag-active" : ""}`}
            aria-label="위젯 보드"
          >
            {draft.widgets.map((w) => (
              <div
                key={w.id}
                className={`widget-slot size-${w.size} ${over === w.id ? "drag-over" : ""} ${drag === w.id ? "dragging" : ""}`}
                tabIndex={0}
                draggable={edit}
                aria-label={`${catalog.find((c) => c.type === w.type)?.title} · Alt 방향키로 이동`}
                onKeyDown={(e) => keyMove(e, w.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/orbit-widget",
                    `move:${w.id}`,
                  );
                  e.dataTransfer.effectAllowed = "move";
                  setDrag(w.id);
                }}
                onDragEnd={() => {
                  setDrag("");
                  setOver("");
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(w.id);
                }}
                onDrop={(e) => drop(e, w.id)}
              >
                <WidgetCard
                  widget={w}
                  state={state}
                  feedback={feedback}
                  change={(value) =>
                    update({
                      ...draft,
                      widgets: draft.widgets.map((v) =>
                        v.id === w.id ? value : v,
                      ),
                    })
                  }
                />
                {edit && (
                  <div className="widget-tools">
                    <span className="muted">
                      <Icon name="grip" />
                    </span>
                    <select
                      aria-label={`${catalog.find((c) => c.type === w.type)?.title} 크기`}
                      value={w.size}
                      onChange={(e) =>
                        update({
                          ...draft,
                          widgets: draft.widgets.map((v) =>
                            v.id === w.id
                              ? { ...v, size: e.target.value as Widget["size"] }
                              : v,
                          ),
                        })
                      }
                    >
                      {["S", "M", "L"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <Button
                      aria-label="앞으로 이동"
                      onClick={() => {
                        const i = draft.widgets.findIndex((v) => v.id === w.id);
                        if (i > 0) move(w.id, draft.widgets[i - 1].id);
                      }}
                      disabled={w.order === 0}
                    >
                      ←
                    </Button>
                    <Button
                      aria-label="뒤로 이동"
                      onClick={() => {
                        const i = draft.widgets.findIndex((v) => v.id === w.id);
                        move(w.id, draft.widgets[i + 2]?.id);
                      }}
                      disabled={w.order === draft.widgets.length - 1}
                    >
                      →
                    </Button>
                    <Button
                      aria-label="위젯 삭제"
                      onClick={() =>
                        update({
                          ...draft,
                          widgets: draft.widgets.filter((v) => v.id !== w.id),
                        })
                      }
                    >
                      ×
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <div
              className={`drop-target ${over === "end" ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver("end");
              }}
              onDragLeave={() => setOver("")}
              onDrop={(e) => drop(e)}
            >
              <Icon name="plus" />
              <h3>{drag ? "여기에 놓아서 배치" : "위젯을 이곳에 놓으세요."}</h3>
              <small>드래그 또는 라이브러리의 ＋ 추가</small>
            </div>
          </div>
          <small>
            같은 종류도 여러 개 배치할 수 있어요. Alt + 방향키로 순서를 바꾸고,
            S / M / L로 크기를 조절하세요.
          </small>
          {dirty && (
            <p className="unsaved" role="status">
              저장하지 않은 변경 사항이 있어요.
            </p>
          )}
        </section>
        <section className="card library">
          <h2>위젯 라이브러리</h2>
          <label className="field">
            위젯 검색
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="주제 또는 위젯 검색"
              type="search"
            />
          </label>
          <div className="row wrap">
            {["전체", "금융", "학습", "개발", "메모"].map((c) => (
              <button
                className={`pill ${category === c ? "" : "gray"}`}
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
              >
                {c}
              </button>
            ))}
          </div>
          {catalog
            .filter(
              (w) =>
                (category === "전체" || w.category === category) &&
                `${w.title} ${w.desc}`.includes(query),
            )
            .map((w) => (
              <div
                className={`library-card ${drag === w.type ? "dragging" : ""}`}
                key={w.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/orbit-widget",
                    `new:${w.type}`,
                  );
                  e.dataTransfer.effectAllowed = "copy";
                  setDrag(w.type);
                }}
                onDragEnd={() => {
                  setDrag("");
                  setOver("");
                }}
              >
                <div className="row">
                  <span style={{ color: w.color }}>
                    <Icon name={w.icon} />
                  </span>
                  <b>{w.title}</b>
                </div>
                <p>{w.desc}</p>
                <div className="row between">
                  <small>S · M · L</small>
                  <button className="add" onClick={() => add(w.type)}>
                    ＋ 추가
                  </button>
                </div>
              </div>
            ))}
          <small>추가·이동 후 편집 완료를 눌러 저장하세요.</small>
        </section>
      </div>
    </>
  );
}
function WidgetCard({
  widget: w,
  state,
  feedback,
  change,
}: {
  widget: Widget;
  state: AppState;
  feedback: Feedback;
  change: (w: Widget) => void;
}) {
  const c = catalog.find((c) => c.type === w.type)!;
  return (
    <section className={`card widget size-${w.size}`}>
      <div className="row">
        <span style={{ color: c.color }}>
          <Icon name={c.icon} />
        </span>
        <h3>{c.title}</h3>
      </div>
      {w.type === "finance" ? (
        <Finance widget={w} state={state} change={change} />
      ) : w.type === "learn" ? (
        <Learn widget={w} state={state} change={change} feedback={feedback} />
      ) : w.type === "notes" ? (
        <Notes widget={w} change={change} />
      ) : w.type === "github" ? (
        <GitHubWidget widget={w} state={state} change={change} />
      ) : (
        <Space state={state} />
      )}
    </section>
  );
}
function Notes({
  widget,
  change,
}: {
  widget: Widget;
  change: (w: Widget) => void;
}) {
  const [value, setValue] = useState(widget.config.note ?? "");
  useEffect(() => {
    setValue(widget.config.note ?? "");
  }, [widget.config.note]);
  return (
    <>
      <textarea
        aria-label="빠른 메모"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="떠오른 아이디어를 잊기 전에 적어두세요."
        maxLength={20000}
      />
      <button
        className="text-button"
        onClick={() =>
          change({ ...widget, config: { ...widget.config, note: value } })
        }
        disabled={value === (widget.config.note ?? "")}
      >
        메모 저장
      </button>
    </>
  );
}
function Finance({
  widget,
  state,
  change,
}: {
  widget: Widget;
  state: AppState;
  change: (w: Widget) => void;
}) {
  const [symbol, setSymbol] = useState(widget.config.symbol ?? "SPY"),
    [kind, setKind] = useState(widget.config.quoteType ?? "stock"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const quote =
    state.quoteCache[
      `${widget.config.quoteType ?? "stock"}:${widget.config.symbol ?? "SPY"}`
    ];
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await api("quote", {
        symbol: widget.config.symbol ?? "SPY",
        kind: widget.config.quoteType ?? "stock",
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <select
        aria-label="금융 자산 종류"
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      >
        <option value="stock">종목 · ETF</option>
        <option value="index">지수 · 유료 데이터 권한 필요</option>
      </select>
      <div className="row">
        <input
          aria-label="관심 종목"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          maxLength={20}
        />
        <button
          className="text-button"
          onClick={() =>
            change({
              ...widget,
              config: { ...widget.config, symbol, quoteType: kind },
            })
          }
          disabled={
            symbol === widget.config.symbol &&
            kind === (widget.config.quoteType ?? "stock")
          }
        >
          선택
        </button>
      </div>
      {quote ? (
        <>
          <div className="row">
            <span className="value">{quote.price.toLocaleString()}</span>
            <Pill tone="green">
              {quote.change > 0 ? "+" : ""}
              {quote.change.toFixed(2)}%
            </Pill>
          </div>
          <small>
            {quote.source} · {quote.asOf}
            <br />
            {quote.currency} · 지연 데이터
          </small>
          <svg
            className="chart"
            viewBox="0 0 300 45"
            role="img"
            aria-label={`이전 종가 ${quote.history[0]}에서 현재 ${quote.history[1]}로 ${quote.change >= 0 ? "상승" : "하락"}`}
          >
            <polyline
              points={quote.history
                .map(
                  (v, i) =>
                    `${(i / Math.max(1, quote.history.length - 1)) * 300},${40 - ((v - Math.min(...quote.history)) / Math.max(0.0001, Math.max(...quote.history) - Math.min(...quote.history))) * 35}`,
                )
                .join(" ")}
              stroke="var(--green)"
              strokeWidth="2.5"
              fill="none"
            />
          </svg>
          <small>
            추세 시작 {quote.history[0]} → 최근 {quote.history.at(-1)}
          </small>
        </>
      ) : (
        <p className="muted">
          아직 시세가 없어요. 설정에서 Alpha Vantage를 연결하세요.
        </p>
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {busy ? "시세 조회 중…" : "시세 불러오기"} ↻
      </button>
    </>
  );
}
function Learn({
  widget,
  state,
  change,
  feedback,
}: {
  widget: Widget;
  state: AppState;
  change: (w: Widget) => void;
  feedback: Feedback;
}) {
  const [goal, setGoal] = useState(widget.config.goal ?? ""),
    [target, setTarget] = useState(widget.config.weeklyTarget ?? 5),
    [busy, setBusy] = useState(false);
  const today = localDate(new Date().toISOString(), state.settings.timezone),
    week = Temporal.PlainDate.from(today)
      .subtract({ days: Temporal.PlainDate.from(today).dayOfWeek - 1 })
      .toString(),
    sessions = state.sessions.filter(
      (s) =>
        s.widgetId === widget.id &&
        localDate(s.at, state.settings.timezone) >= week,
    ),
    next = Array.from({ length: 8 }, (_, i) =>
      Temporal.PlainDate.from(today).add({ days: i }).toString(),
    )
      .flatMap((d) => agenda(state.events, d, state.settings.timezone))
      .find(
        (o) => o.event.category === "학습" && Date.parse(o.end) > Date.now(),
      );
  async function complete() {
    setBusy(true);
    try {
      await api("session.complete", {
        widgetId: widget.id,
        title: goal || "학습 세션",
        eventId: next?.event.id,
      });
      feedback("학습 세션을 기록했어요.");
    } catch (e) {
      feedback(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="row">
        <span className="value">{sessions.length}</span>
        <small>/ {widget.config.weeklyTarget ?? 5} 세션 완료</small>
      </div>
      <div className="progress">
        <span
          style={{
            width: `${Math.min(100, (sessions.length / (widget.config.weeklyTarget ?? 5)) * 100)}%`,
          }}
        />
      </div>
      <div className="row">
        <input
          aria-label="학습 목표"
          value={goal}
          placeholder="이번 주 목표"
          onChange={(e) => setGoal(e.target.value)}
          maxLength={200}
        />
        <input
          aria-label="주간 목표 세션"
          type="number"
          min="1"
          max="100"
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="small-input"
        />
        <button
          className="text-button"
          onClick={() =>
            change({
              ...widget,
              config: { ...widget.config, goal, weeklyTarget: target },
            })
          }
        >
          저장
        </button>
      </div>
      <small>
        {next
          ? `다음 · ${next.event.title} · ${localDate(next.start, state.settings.timezone)}`
          : "캘린더에서 학습 일정을 추가하세요."}
      </small>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void complete()}
      >
        ✓ 세션 완료 기록
      </button>
    </>
  );
}
function GitHubWidget({
  widget,
  state,
  change,
}: {
  widget: Widget;
  state: AppState;
  change: (w: Widget) => void;
}) {
  const [items, setItems] = useState<
      { id: number; title: string; html_url: string; pull_request?: unknown }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      if (!widget.config.repo) throw new Error("저장소를 선택하세요.");
      setItems(await api("activity", widget.config.repo));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (widget.config.repo) void load();
  }, [widget.config.repo]);
  return (
    <>
      <select
        aria-label="GitHub 위젯 저장소"
        value={widget.config.repo ?? ""}
        onChange={(e) =>
          change({
            ...widget,
            config: { ...widget.config, repo: e.target.value || undefined },
          })
        }
      >
        <option value="">허용한 저장소 선택</option>
        {state.settings.allowedRepos.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      {items.slice(0, 3).map((i) => (
        <button
          className="text-button truncate"
          title={i.title}
          onClick={() => void api("open", i.html_url)}
          key={i.id}
        >
          {i.pull_request ? "PR" : "Issue"} · {i.title}
        </button>
      ))}
      {!items.length && !error && (
        <small>열린 PR·이슈가 없거나 아직 불러오지 않았어요.</small>
      )}
      {error && <small className="error">{error}</small>}
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy ? "불러오는 중…" : "새로고침"} ↻
      </button>
    </>
  );
}
function Space({ state }: { state: AppState }) {
  const articles = state.articles.filter((a) => a.topics.includes("우주"));
  return (
    <>
      {articles.length ? (
        articles.slice(0, 3).map((a) => (
          <button
            className="text-button"
            key={a.id}
            onClick={() => void api("open", a.url)}
          >
            {a.title} ↗
          </button>
        ))
      ) : (
        <Empty>
          뉴스에서 실제 기사를 수집하면 우주 관련 기사가 표시됩니다.
        </Empty>
      )}
      <small>Hacker News · 수집 캐시</small>
    </>
  );
}
