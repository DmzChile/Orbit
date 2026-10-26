import { useEffect, useMemo, useRef, useState } from "react";
import type { Article } from "../domain/model";
import { newsSlides } from "../domain/news";
import { Button, Pill, dateText } from "./main";
import { Sculpture } from "./icons";

export function NewsSpotlight({
  banner = false,
  active = true,
  articles,
  fetchedAt,
  reduceMotion,
  openArticle,
  openNews,
}: {
  banner?: boolean;
  active?: boolean;
  articles: Article[];
  fetchedAt?: string;
  reduceMotion: boolean;
  openArticle: (article: Article) => void;
  openNews: () => void;
}) {
  const slides = useMemo(() => newsSlides(articles), [articles]);
  const [position, setPosition] = useState(0),
    [paused, setPaused] = useState(false),
    [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false),
    [visible, setVisible] = useState(!document.hidden),
    [inView, setInView] = useState(true),
    [systemReduced, setSystemReduced] = useState(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [announcement, setAnnouncement] = useState("");
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)"),
      motion = () => setSystemReduced(media.matches),
      visibility = () => setVisible(!document.hidden);
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    if (region.current) observer.observe(region.current);
    return () => {
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
    };
  }, []);
  const index = slides.length ? position % slides.length : 0,
    current = slides[index],
    article = current?.article;
  const reduced = reduceMotion || systemReduced;
  const running =
    active &&
    slides.length > 1 &&
    !paused &&
    !hovered &&
    !focused &&
    visible &&
    inView &&
    !reduced;
  const signature = slides
    .map((slide) => `${slide.topic}:${slide.article.id}`)
    .join("|");
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(
      () => setPosition((value) => (value + 1) % slides.length),
      8000,
    );
    return () => clearTimeout(timer);
  }, [running, position, signature, slides.length]);
  function show(next: number) {
    const safe = (next + slides.length) % slides.length;
    setPosition(safe);
    setPaused(true);
    const selected = slides[safe];
    if (selected)
      setAnnouncement(`${selected.topic} · ${selected.article.title}`);
  }
  const topics = [...new Set(slides.map((slide) => slide.topic))];
  return (
    <section
      ref={region}
      className={`card news-card${banner ? " news-banner" : ""}`}
      role="region"
      aria-label="분야별 뉴스"
      aria-roledescription="캐러셀"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <div className="row between wrap">
        {banner ? (
          <button
            className="news-banner-title"
            aria-label="뉴스"
            onClick={openNews}
          >
            <span className="banner-eyebrow">DISCOVER</span>
            <span className="banner-title">뉴스</span>
          </button>
        ) : (
          <h2>새로운 시선, 오늘의 이야기</h2>
        )}
        <button className="text-button" onClick={openNews}>
          뉴스 모두 보기 →
        </button>
      </div>
      <button
        className="story story-button"
        onClick={() => (article ? openArticle(article) : openNews())}
        aria-label={
          article
            ? `${current.topic} · ${article.title} 기사 읽기`
            : "뉴스 불러오기"
        }
      >
        <Sculpture />
        <div className="spotlight-copy" key={article?.id ?? "empty"}>
          <Pill>{current?.topic ?? "DISCOVER"}</Pill>
          <h2 title={article?.title}>
            {article?.title ?? (
              <>
                관심 있는 이야기에서,
                <br />
                새로운 가능성으로.
              </>
            )}
          </h2>
          <p>
            {article
              ? `${article.source} · ${dateText(article.publishedAt)}`
              : "실제 기사를 불러오고, 다음 아이디어로 연결하세요."}
          </p>
        </div>
      </button>
      {topics.length > 0 && (
        <nav className="spotlight-topics" aria-label="메인 뉴스 분야">
          {topics.map((topic) => (
            <button
              key={topic}
              className={`pill ${current?.topic === topic ? "" : "gray"}`}
              aria-label={`${topic} 뉴스 보기`}
              aria-pressed={current?.topic === topic}
              onClick={() =>
                show(slides.findIndex((slide) => slide.topic === topic))
              }
            >
              {topic}
            </button>
          ))}
        </nav>
      )}
      <div className="story-bottom spotlight-footer">
        <div className="spotlight-caption">
          <h3>
            {!article
              ? "아직 수집한 뉴스가 없어요."
              : reduced
                ? "모션 줄이기 · 직접 넘겨보세요."
                : paused
                  ? "자동 전환을 멈췄어요."
                  : hovered || focused
                    ? "읽는 동안 잠시 멈춰요."
                    : "8초마다 분야별 소식을 전해요."}
          </h3>
          <small>
            {fetchedAt
              ? `수집 ${dateText(fetchedAt)}`
              : "뉴스에서 새로고침을 눌러 시작하세요."}
          </small>
        </div>
        {article && (
          <div className="spotlight-controls" aria-label="뉴스 순환 제어">
            <small
              aria-label={`전체 ${slides.length}개 중 ${index + 1}번째 기사`}
            >
              {index + 1}/{slides.length}
            </small>
            <Button
              aria-label="이전 뉴스"
              disabled={slides.length < 2}
              onClick={() => show(index - 1)}
            >
              ‹
            </Button>
            <Button
              aria-label={
                reduced
                  ? "모션 줄이기로 자동 전환 꺼짐"
                  : paused
                    ? "뉴스 자동 전환 재개"
                    : "뉴스 자동 전환 일시정지"
              }
              disabled={slides.length < 2 || reduced}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? "▶" : "Ⅱ"}
            </Button>
            <Button
              aria-label="다음 뉴스"
              disabled={slides.length < 2}
              onClick={() => show(index + 1)}
            >
              ›
            </Button>
          </div>
        )}
      </div>
      <span className="spotlight-announcement" role="status" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}
