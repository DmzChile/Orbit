import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { articleSchema, OrbitError, type Article } from "../domain/model";
import type { NewsProvider } from "./providers";
import { classifyNews, newsSlides, type NewsTopic } from "../domain/news";

const FEEDS: { name: string; url: string; topic?: NewsTopic }[] = [
  { name: "전체", url: "https://rss.donga.com/total.xml" },
  { name: "정치", url: "https://rss.donga.com/politics.xml", topic: "정치" },
  { name: "과학", url: "https://rss.donga.com/science.xml", topic: "테크" },
  { name: "경제", url: "https://rss.donga.com/economy.xml", topic: "금융" },
  { name: "도서", url: "https://rss.donga.com/book.xml", topic: "학습" },
];
const LIMIT = 2 * 1024 * 1024;
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
function plain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (all, entity: string) => {
        if (!entity.startsWith("#"))
          return entities[entity.toLowerCase()] ?? all;
        const n =
          entity[1].toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : "";
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}
export function parseKoreanNews(
  xml: string,
  fetchedAt = new Date().toISOString(),
  section?: NewsTopic,
): Article[] {
  if (
    Buffer.byteLength(xml) > LIMIT ||
    /<!\s*(DOCTYPE|ENTITY)/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new OrbitError(
      "PROVIDER_DATA",
      "뉴스 RSS 형식이 올바르지 않습니다. 기존 캐시를 유지합니다.",
    );
  const data = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    processEntities: false,
    removeNSPrefix: true,
    isArray: (name) => name === "item",
  }).parse(xml);
  if (!data?.rss?.channel || !Array.isArray(data.rss.channel.item))
    throw new OrbitError("PROVIDER_DATA", "뉴스 RSS에 기사 목록이 없습니다.");
  const rows = new Map<string, Article>();
  for (const item of data.rss.channel.item.slice(0, 500)) {
    const title = plain(item.title).slice(0, 500),
      published = Date.parse(plain(item.pubDate));
    let url: URL;
    try {
      url = new URL(plain(item.link));
    } catch {
      continue;
    }
    if (
      !title ||
      !Number.isFinite(published) ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !(url.hostname === "donga.com" || url.hostname.endsWith(".donga.com"))
    )
      continue;
    url.protocol = "https:";
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^(ref|fbclid)$/i.test(key)) url.searchParams.delete(key);
    const topics = classifyNews(title, section);
    const article = articleSchema.parse({
      id: `donga:${createHash("sha256").update(url.href).digest("hex").slice(0, 24)}`,
      title,
      url: url.href,
      source: "동아일보",
      sourceUrl: "https://rss.donga.com/",
      publishedAt: new Date(published).toISOString(),
      fetchedAt,
      topics,
      summary:
        "동아일보 공식 RSS에서 제공한 기사 링크입니다. 기사 전문과 사진은 수집하지 않습니다. 원문에서 내용을 확인하세요.",
      summaryKind: "metadata",
      readingMinutes: 0,
      image: "orbit",
    });
    rows.set(article.id, article);
  }
  if (!rows.size)
    throw new OrbitError(
      "PROVIDER_DATA",
      "유효한 한국 뉴스 기사가 없습니다. 기존 캐시를 유지합니다.",
    );
  return [...rows.values()].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
}
async function fetchFeed(url: string, topic?: NewsTopic): Promise<Article[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "Orbit/0.1 personal RSS reader",
      },
    });
  } catch {
    throw new OrbitError(
      "OFFLINE",
      "한국 뉴스에 연결하지 못했습니다. 네트워크를 확인하세요.",
    );
  }
  if (!response.ok)
    throw new OrbitError(
      response.status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR",
      `한국 뉴스 공급자 응답 오류 (${response.status}).`,
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new OrbitError("PROVIDER_DATA", "뉴스 응답이 비어 있습니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > LIMIT)
        throw new OrbitError(
          "PROVIDER_DATA",
          "뉴스 응답 크기가 한도를 넘었습니다.",
        );
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof OrbitError) throw error;
    throw new OrbitError(
      "OFFLINE",
      "한국 뉴스 전송이 중단되었습니다. 기존 캐시를 유지합니다.",
    );
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parseKoreanNews(
    Buffer.concat(chunks).toString("utf8"),
    new Date().toISOString(),
    topic,
  );
}
export class KoreanNewsProvider implements NewsProvider {
  private rows?: Article[];
  public warning = "";
  async fetchPage(page: number): Promise<Article[]> {
    if (!Number.isInteger(page) || page < 0)
      throw new OrbitError("INVALID_PAGE", "올바르지 않은 뉴스 페이지입니다.");
    if (page === 0 || !this.rows) {
      const results = await Promise.allSettled(
        FEEDS.map((feed) => fetchFeed(feed.url, feed.topic)),
      );
      const rows = new Map<string, Article>(),
        failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          failed.push(FEEDS[index].name);
          return;
        }
        for (const article of result.value) {
          const previous = rows.get(article.id);
          rows.set(article.id, {
            ...article,
            topics: [
              ...new Set([...(previous?.topics ?? []), ...article.topics]),
            ],
          });
        }
      });
      if (!rows.size) {
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        throw new OrbitError(
          "PROVIDER_DATA",
          "뉴스 기사가 없습니다. 기존 캐시를 유지합니다.",
        );
      }
      // A stable, balanced snapshot makes all available fields visible on page one.
      this.rows = newsSlides([...rows.values()], rows.size).map(
        (slide) => slide.article,
      );
      this.warning = failed.length
        ? `${failed.join("·")} RSS를 불러오지 못했습니다. 수집된 기사와 기존 캐시를 표시합니다.`
        : "";
    }
    return this.rows.slice(page * 24, (page + 1) * 24);
  }
}
