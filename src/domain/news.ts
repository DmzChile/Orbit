import type { Article } from "./model";

export const NEWS_TOPICS = ["테크", "우주", "금융", "학습", "정치"] as const;
export type NewsTopic = (typeof NEWS_TOPICS)[number];
export function classifyNews(title: string, section?: NewsTopic): NewsTopic[] {
  const topics = new Set<NewsTopic>(section ? [section] : []);
  if (
    /과학|기술|인공지능|반도체|로봇|디지털|소프트웨어|\bAI\b|\bIT\b|테크/i.test(
      title,
    )
  )
    topics.add("테크");
  if (/우주|행성|위성|천문|달\s*탐사|나사|NASA|로켓|은하/i.test(title))
    topics.add("우주");
  if (
    /금융|경제|증시|주식|투자|은행|금리|환율|코스피|코스닥|부동산|물가|기업|증권시장|금융시장|주식시장/i.test(
      title,
    )
  )
    topics.add("금융");
  if (
    /학습|교육|학교|대학|공부|연구|도서|독서|서평|신간|책\s|수능/i.test(title)
  )
    topics.add("학습");
  if (
    /정치|국회|대통령|총리|장관|여당|야당|정당|총선|대선|국정|국감|국무|국회의원|지방의회|선거|외교|대통령실|청와대|정부|민주당|국민의힘|개혁신당|조국혁신당/i.test(
      title,
    )
  )
    topics.add("정치");
  return NEWS_TOPICS.filter((topic) => topics.has(topic));
}
export type NewsSlide = { topic: NewsTopic | "전체"; article: Article };
/** One article per available field in each round; no invented placeholders. */
export function newsSlides(articles: Article[], limit = 30): NewsSlide[] {
  const rows = [
    ...new Map(articles.map((article) => [article.id, article])).values(),
  ].sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id),
  );
  const groups: { topic: NewsSlide["topic"]; rows: Article[] }[] =
    NEWS_TOPICS.map((topic) => ({
      topic,
      rows: rows.filter((article) => article.topics.includes(topic)),
    }));
  groups.push({
    topic: "전체",
    rows: rows.filter((article) => !article.topics.length),
  });
  const slides: NewsSlide[] = [],
    seen = new Set<string>();
  while (slides.length < limit) {
    const before = slides.length;
    for (const group of groups) {
      const article = group.rows.find((row) => !seen.has(row.id));
      if (!article) continue;
      slides.push({ topic: group.topic, article });
      seen.add(article.id);
      if (slides.length >= limit) break;
    }
    if (slides.length === before) break;
  }
  return slides;
}
