import { describe, it, expect } from "vitest";
import { articleSchema } from "../src/domain/model";
import { classifyNews, newsSlides, type NewsTopic } from "../src/domain/news";
const article = (
  id: string,
  topics: NewsTopic[],
  at = "2026-10-25T01:00:00Z",
) =>
  articleSchema.parse({
    id,
    title: `[fixture] ${id}`,
    topics,
    publishedAt: at,
    fetchedAt: at,
    url: `https://www.donga.com/news/test/${id}`,
    source: "테스트 전용 fixture",
    sourceUrl: "https://rss.donga.com/",
    summary: "테스트 데이터",
    summaryKind: "metadata",
    readingMinutes: 0,
    image: "orbit",
  });
describe("APP-03/NEWS-02 · balanced news spotlight", () => {
  it("includes politics without treating policy rates or a medical clinic as politics/learning", () => {
    expect(classifyNews("국회 예산안 심의")).toContain("정치");
    expect(classifyNews("정책금리 동결")).toEqual(["금융"]);
    expect(classifyNews("지역 의원 진료 안내")).not.toContain("정치");
    expect(classifyNews("새 발표", "정치")).toEqual(["정치"]);
  });
  it("shows a round of every available field before repeating a dominant field", () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, n) => article(`tech-${n}`, ["테크"])),
      article("space", ["우주"]),
      article("finance", ["금융"]),
      article("learn", ["학습"]),
      article("politics", ["정치"]),
      article("general", []),
    ];
    const slides = newsSlides(rows);
    expect(slides.slice(0, 6).map((slide) => slide.topic)).toEqual([
      "테크",
      "우주",
      "금융",
      "학습",
      "정치",
      "전체",
    ]);
    expect(new Set(slides.map((slide) => slide.article.id)).size).toBe(
      slides.length,
    );
    expect(slides).toHaveLength(30);
  });
  it("skips empty fields, deduplicates cross-listed stories and handles an empty cache", () => {
    const story = article("shared", ["테크", "정치"]);
    expect(newsSlides([])).toEqual([]);
    expect(
      newsSlides([story, story, article("politics", ["정치"])]),
    ).toHaveLength(2);
    expect(newsSlides([article("unclassified", [])])[0].topic).toBe("전체");
  });
});
