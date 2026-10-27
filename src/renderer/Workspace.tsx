import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import type { AppState } from "../domain/model";
import { agenda, localDate } from "../domain/calendar";
import { Icon, Sculpture } from "./icons";
import { NewsSpotlight } from "./NewsSpotlight";
import type { Article } from "../domain/model";

export const workspacePages = {
  news: {
    title: "뉴스",
    eyebrow: "DISCOVER",
    description: "새로운 시선, 오늘의 이야기",
    icon: "news",
  },
  home: {
    title: "오늘",
    eyebrow: "YOUR DAILY ORBIT",
    description: "오늘도, 나의 궤도대로.",
    icon: "home",
  },
  calendar: {
    title: "캘린더",
    eyebrow: "MAKE TIME",
    description: "좋은 하루는, 좋은 계획에서.",
    icon: "calendar",
  },
  auto: {
    title: "자동화",
    eyebrow: "SET IN MOTION",
    description: "생각은 지금. 작업은 제시간에.",
    icon: "spark",
  },
  results: {
    title: "결과함",
    eyebrow: "READY TO REVIEW",
    description: "맡겨둔 일이, 완성되는 곳.",
    icon: "inbox",
  },
  custom: {
    title: "내 공간",
    eyebrow: "ROOM FOR YOU",
    description: "여백으로 남겨둔 나만의 공간",
    icon: "grid",
  },
  settings: {
    title: "설정 및 연결",
    eyebrow: "MAKE IT YOURS",
    description: "나에게 맞게, 편안하게.",
    icon: "settings",
  },
} as const;
export type WorkspacePage = keyof typeof workspacePages;
export type WorkspaceView = WorkspacePage | "hub";

/** Same-document geometry transitions, with immediate accessible fallback. */
export function useWorkspaceNavigation(reduceMotion: boolean) {
  const [page, setPage] = useState<WorkspaceView>("hub");
  const [visited, setVisited] = useState<WorkspacePage[]>([]);
  const [phase, setPhase] = useState("idle");
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<WorkspaceView>("hub");
  const pending = useRef<WorkspaceView>("hub");
  const sequence = useRef(0);
  const transition = useRef<ViewTransition | null>(null);
  const named = useRef(new Set<HTMLElement>());
  const scrolls = useRef(new Map<string, number>());
  const origins = useRef(new Map<WorkspacePage, HTMLElement>());
  const alive = useRef(true);
  const [systemReduced, setSystemReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const clearNames = useCallback(() => {
    for (const node of named.current)
      node.style.removeProperty("view-transition-name");
    named.current.clear();
  }, []);

  const navigate = useCallback(
    (value: string, resetScroll = false) => {
      if (value !== "hub" && !Object.hasOwn(workspacePages, value)) return;
      const next = value as WorkspaceView;
      const previous = current.current;
      if (next === previous && !transition.current) return;
      const ticket = ++sequence.current;
      transition.current?.skipTransition();
      transition.current = null;
      clearNames();
      const host = root.current;
      const content = host?.querySelector<HTMLElement>("#content");
      if (previous !== "hub" && content)
        scrolls.current.set(previous, content.scrollTop);
      const returning =
        previous === "hub"
          ? next === "hub"
            ? pending.current
            : next
          : previous;
      pending.current = next;
      if (previous === "hub" && next !== "hub") {
        const focused = document.activeElement;
        const tile = host?.querySelector(`[data-banner="${next}"]`);
        if (focused instanceof HTMLElement && tile?.contains(focused)) {
          origins.current.set(next, focused);
        }
      }
      const mark = (view: WorkspaceView, banner: WorkspaceView) => {
        const element =
          view === "hub"
            ? host?.querySelector<HTMLElement>(`[data-banner="${banner}"]`)
            : host?.querySelector<HTMLElement>(".workspace-window");
        if (!element) return;
        element.style.viewTransitionName = "orbit-workspace";
        named.current.add(element);
        if ((view === "hub" ? banner : view) === "news") {
          const planet = element.querySelector<HTMLElement>(".sculpture");
          if (planet) {
            planet.style.viewTransitionName = "orbit-planet";
            named.current.add(planet);
          }
        }
      };
      const update = () => {
        if (!alive.current || ticket !== sequence.current) return;
        clearNames();
        const commit = () => {
          current.current = next;
          setPage(next);
          if (next !== "hub") {
            setVisited((pages) =>
              pages.includes(next) ? pages : [...pages, next],
            );
          }
        };
        if (host) flushSync(commit);
        else commit();
        const main = host?.querySelector<HTMLElement>("#content");
        if (main && next !== "hub")
          main.scrollTop = resetScroll ? 0 : (scrolls.current.get(next) ?? 0);
        mark(next, next === "hub" ? returning : next);
      };
      const finish = () => {
        if (!alive.current || ticket !== sequence.current) return;
        transition.current = null;
        clearNames();
        delete document.documentElement.dataset.orbitNavigation;
        delete document.documentElement.dataset.orbitTheme;
        setPhase("idle");
        requestAnimationFrame(() => {
          if (!alive.current || ticket !== sequence.current) return;
          if (next === "hub" && returning !== "hub") {
            const origin = origins.current.get(returning);
            const fallback = host?.querySelector<HTMLElement>(
              `[data-banner="${returning}"] button`,
            );
            (origin?.isConnected ? origin : fallback)?.focus({
              preventScroll: true,
            });
          } else {
            host
              ?.querySelector<HTMLButtonElement>(".workspace-back")
              ?.focus({ preventScroll: true });
          }
        });
      };
      if (
        !host ||
        previous === next ||
        reduceMotion ||
        systemReduced ||
        typeof document.startViewTransition !== "function" ||
        document.hidden
      ) {
        update();
        finish();
        return;
      }
      const direction =
        next === "hub"
          ? "closing"
          : previous === "hub"
            ? "opening"
            : "switching";
      document.documentElement.dataset.orbitNavigation = direction;
      document.documentElement.dataset.orbitTheme =
        next === "hub" ? returning : next;
      setPhase(direction);
      mark(previous, next);
      try {
        const running = document.startViewTransition(update);
        transition.current = running;
        // Skipping an animation rejects ready, but must not reject navigation.
        void running.ready.catch(() => {});
        void running.finished.then(finish, finish);
      } catch {
        update();
        finish();
      }
    },
    [clearNames, reduceMotion, systemReduced],
  );

  useEffect(() => {
    alive.current = true;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => {
      setSystemReduced(media.matches);
      if (media.matches) transition.current?.skipTransition();
    };
    const resize = () => transition.current?.skipTransition();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]"))
        return;
      if (
        event.key === "Escape" ||
        (event.altKey && event.key === "ArrowLeft")
      ) {
        if (current.current === "hub" && !transition.current) return;
        event.preventDefault();
        navigate("hub");
      }
    };
    media.addEventListener("change", motion);
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", keydown);
    return () => {
      alive.current = false;
      ++sequence.current;
      transition.current?.skipTransition();
      clearNames();
      delete document.documentElement.dataset.orbitNavigation;
      delete document.documentElement.dataset.orbitTheme;
      media.removeEventListener("change", motion);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keydown);
    };
  }, [clearNames, navigate]);

  useEffect(() => {
    if (reduceMotion) transition.current?.skipTransition();
  }, [reduceMotion]);

  return { page, visited, phase, root, navigate };
}

function BannerArt({ page }: { page: WorkspacePage }) {
  if (page === "news") return <Sculpture />;
  return (
    <span className={`banner-art banner-art--${page}`} aria-hidden="true">
      {page === "home" ? (
        <span className="banner-moon" />
      ) : (
        <>
          <span className="banner-art-shape" />
          <Icon name={workspacePages[page].icon} />
        </>
      )}
    </span>
  );
}

export function BannerWorkspace({
  navigation,
  state,
  connection,
  openArticle,
  children,
}: {
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  state: AppState;
  connection?: { github: boolean; login?: string; version: string };
  openArticle: (article: Article) => void;
  children: (page: WorkspacePage) => ReactNode;
}) {
  const { page, root, visited, phase, navigate } = navigation;
  const expanded = page !== "hub";
  const currentPage = expanded ? workspacePages[page] : undefined;
  const date = new Date();
  const today = localDate(date.toISOString(), state.settings.timezone);
  const eventCount = agenda(
    state.events,
    today,
    state.settings.timezone,
  ).length;
  const unread = state.runs.filter((run) => !run.readAt).length;
  const details: Record<WorkspacePage, string> = {
    news: "관심 있는 분야의 새로운 이야기",
    home: `오늘의 일정 ${eventCount}개`,
    calendar: "일정과 학습을 한눈에",
    auto: `저장한 요청 ${state.requests.length}개`,
    results: unread
      ? `읽지 않은 결과 ${unread}개`
      : "도착한 결과와 변경안 확인",
    custom: "위젯 없이 비워둔 공간",
    settings: connection?.github
      ? `GitHub · ${connection.login}`
      : "GitHub 연결과 앱 설정",
  };
  return (
    <div
      className="banner-workspace"
      ref={root}
      data-phase={phase}
      data-view={page}
    >
      <div className="banner-hub" inert={expanded} aria-hidden={expanded}>
        <header className="banner-hub-heading">
          <div>
            <div className="banner-brand">
              <span className="mark">o</span>
              <strong>Orbit</strong>
            </div>
            <h1>오늘도, 나의 궤도대로.</h1>
          </div>
          <div className="banner-workspace-info">
            <p>
              {date.toLocaleDateString("ko-KR", {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long",
                timeZone: state.settings.timezone,
              })}
            </p>
            <small>
              개인 워크스페이스
              {connection?.version ? ` · ${connection.version}` : ""}
            </small>
          </div>
        </header>
        <nav className="banner-grid" aria-label="공간 선택">
          {(Object.keys(workspacePages) as WorkspacePage[]).map((key) => (
            <div
              className={`workspace-tile workspace-tile--${key}`}
              data-banner={key}
              key={key}
            >
              {key === "news" ? (
                <NewsSpotlight
                  banner
                  active={!expanded}
                  articles={state.articles}
                  fetchedAt={state.newsFetchedAt}
                  reduceMotion={state.settings.reduceMotion}
                  openArticle={openArticle}
                  openNews={() => navigate("news")}
                />
              ) : (
                <button
                  className={`menu-banner menu-banner--${key}`}
                  aria-label={workspacePages[key].title}
                  onClick={() => navigate(key)}
                >
                  <BannerArt page={key} />
                  <span className="banner-eyebrow">
                    {workspacePages[key].eyebrow}
                  </span>
                  <span className="banner-title">
                    {workspacePages[key].title}
                    {key === "results" && unread > 0 && (
                      <span className="banner-count">{unread}</span>
                    )}
                  </span>
                  <span className="banner-description">
                    {workspacePages[key].description}
                  </span>
                  <span className="banner-meta">{details[key]}</span>
                  <span className="banner-arrow">
                    <Icon name="arrow" />
                  </span>
                </button>
              )}
            </div>
          ))}
        </nav>
        <footer className="banner-hub-footer">
          <p>필요한 공간을 열고, 돌아오면 다시 한눈에.</p>
          <small>{state.settings.timezone}</small>
        </footer>
      </div>
      <section
        className={`workspace-window workspace-window--${expanded ? page : "home"}`}
        hidden={!expanded}
        aria-label={currentPage?.title}
      >
        <header className="workspace-window-chrome">
          <div className="workspace-window-art" aria-hidden="true">
            {expanded && <BannerArt page={page} />}
          </div>
          <div className="workspace-window-topline">
            <button
              className="workspace-back"
              aria-label="배너로 돌아가기"
              onClick={() => navigate("hub")}
            >
              <span aria-hidden="true">‹</span> 뒤로
            </button>
            <span className="workspace-window-brand">ORBIT</span>
          </div>
          <p className="workspace-window-title" id="workspace-title">
            {currentPage?.title}
          </p>
          <p className="workspace-window-description">
            {currentPage?.description}
          </p>
        </header>
        <main
          className="content workspace-content"
          id="content"
          tabIndex={-1}
          aria-labelledby="workspace-title"
        >
          {visited.map((key) => (
            <div className="workspace-page" hidden={key !== page} key={key}>
              {children(key)}
            </div>
          ))}
        </main>
      </section>
      <span className="workspace-announcement" aria-live="polite">
        {phase === "idle"
          ? expanded
            ? `${currentPage?.title} 화면`
            : "공간 선택 화면"
          : ""}
      </span>
    </div>
  );
}

export function PersonalSpace() {
  return (
    <section className="personal-space" aria-label="내 공간">
      <BannerArt page="custom" />
      <h1>여백으로 남겨둔, 나만의 공간.</h1>
      <p>지금은 위젯 없이 편안하게 비워두었습니다.</p>
    </section>
  );
}
