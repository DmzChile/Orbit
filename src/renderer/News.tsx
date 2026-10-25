import { useState } from "react";
import type { AppState, Article } from "../domain/model";
import {
  api,
  Button,
  Empty,
  errorText,
  Head,
  Pill,
  dateText,
  type Feedback,
} from "./main";
import { Sculpture } from "./icons";
export function NewsPage({
  state,
  selected,
  onSelected,
  ask,
  feedback,
}: {
  state: AppState;
  selected?: Article;
  onSelected: (a: Article) => void;
  ask: (a: Article) => void;
  feedback: Feedback;
}) {
  const [query, setQuery] = useState(""),
    [topic, setTopic] = useState("추천"),
    [onlySaved, setOnlySaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const items = state.articles.filter(
    (a) =>
      (!onlySaved || state.savedArticles.includes(a.id)) &&
      (topic === "추천" ||
        a.topics.includes(topic as Article["topics"][number])) &&
      `${a.title} ${a.source}`.toLowerCase().includes(query.toLowerCase()),
  );
  const article = selected ?? items[0];
  async function fetchNews(more = false) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ count: number }>(
        more ? "news.more" : "news.refresh",
      );
      if (!result.count) feedback("더 이상 기사가 없어요.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!article) return;
    try {
      await api("news.save", {
        id: article.id,
        saved: !state.savedArticles.includes(article.id),
      });
      feedback(
        state.savedArticles.includes(article.id)
          ? "저장을 해제했어요."
          : "기사를 저장했어요.",
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function scale(value: number) {
    try {
      await api("settings.save", {
        ...state.settings,
        readerScale: Math.min(2, Math.max(0.8, value)),
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  const stale =
    !!state.newsFetchedAt &&
    Date.now() - Date.parse(state.newsFetchedAt) > 3600000;
  return (
    <>
      <Head
        title="발견하고, 읽고, 연결하세요."
        sub="검색은 수집한 기사 캐시에서 수행합니다. 주제는 제목의 키워드로 분류합니다."
        action={
          <Button onClick={() => void fetchNews()} disabled={busy}>
            {busy ? "불러오는 중…" : "새로고침"}
          </Button>
        }
      />
      <div className="news-layout">
        <section className="card inbox news-list">
          <label className="field">
            기사 검색
            <input
              type="search"
              placeholder="제목 또는 출처 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="row wrap">
            {["추천", "테크", "우주", "금융", "학습"].map((t) => (
              <button
                className={`pill ${topic === t ? "" : "gray"}`}
                aria-pressed={topic === t}
                onClick={() => setTopic(t)}
                key={t}
              >
                {t}
              </button>
            ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={onlySaved}
              onChange={(e) => setOnlySaved(e.target.checked)}
            />
            저장한 기사만
          </label>
          {state.newsFetchedAt && (
            <small>
              {stale ? "오래된 캐시 · " : ""}수집{" "}
              {dateText(state.newsFetchedAt)}
            </small>
          )}
          {error && (
            <p className="error" role="alert">
              {error}{" "}
              {state.articles.length > 0 ? "저장된 캐시를 표시합니다." : ""}
            </p>
          )}
          <div className="article-list" aria-busy={busy}>
            {items.map((a) => (
              <button
                className={`inbox-item ${article?.id === a.id ? "selected" : ""}`}
                key={a.id}
                onClick={() => onSelected(a)}
              >
                <small>{a.topics.join(" · ")}</small>
                <h3>{a.title}</h3>
                <small>
                  {a.source} · {dateText(a.publishedAt)}
                </small>
                {state.savedArticles.includes(a.id) && <Pill>저장됨</Pill>}
              </button>
            ))}
          </div>
          {!items.length && (
            <Empty>
              {busy
                ? "기사를 불러오고 있어요."
                : state.articles.length
                  ? "검색 결과가 없어요."
                  : "아직 뉴스가 없어요. 새로고침으로 실제 기사를 불러오세요."}
            </Empty>
          )}
          <Button onClick={() => void fetchNews(true)} disabled={busy}>
            기사 더 불러오기
          </Button>
          <small>출처: Hacker News 공식 API · 전문은 수집하지 않습니다.</small>
        </section>
        {article ? (
          <article className="card reader">
            <div className="row between wrap">
              <Pill tone="green">{article.topics.join(" · ")}</Pill>
              <div className="row">
                <Button
                  aria-label="글자 작게"
                  onClick={() => void scale(state.settings.readerScale - 0.1)}
                >
                  가−
                </Button>
                <Button
                  aria-label="글자 크게"
                  onClick={() => void scale(state.settings.readerScale + 0.1)}
                >
                  가＋
                </Button>
                <Button onClick={() => void save()}>
                  {state.savedArticles.includes(article.id)
                    ? "저장됨 ✓"
                    : "저장"}
                </Button>
              </div>
            </div>
            <h2>{article.title}</h2>
            <small>
              {article.source} · 게시 {dateText(article.publishedAt)} ·{" "}
              {article.readingMinutes
                ? `${article.readingMinutes}분 읽기`
                : "읽기 시간 미제공"}
            </small>
            <div className="article-visual">
              <Sculpture />
              <p>Beyond the horizon.</p>
            </div>
            <div
              className="article-summary"
              style={{ fontSize: `${state.settings.readerScale}rem` }}
            >
              <h3>
                {article.summaryKind === "publisher"
                  ? "출처 제공 요약"
                  : "기사 링크 안내"}
              </h3>
              {article.summary}
            </div>
            <small>
              수집 {dateText(article.fetchedAt)} · 원문 내용은 외부 출처의
              정보입니다.
            </small>
            <div className="row between wrap">
              <Button
                onClick={() =>
                  void api("open", article.url).catch((e) =>
                    setError(errorText(e)),
                  )
                }
              >
                원문 열기 ↗
              </Button>
              <Button primary onClick={() => ask(article)}>
                이 주제로 요청하기
              </Button>
            </div>
          </article>
        ) : (
          <section className="card reader">
            <Empty>읽고 싶은 기사를 선택하세요.</Empty>
            <div className="article-visual">
              <Sculpture />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
