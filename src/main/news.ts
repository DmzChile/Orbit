import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { articleSchema, OrbitError, type Article } from "../domain/model";
import type { NewsProvider } from "./providers";

const FEED = "https://rss.donga.com/total.xml";
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
    const topics: Article["topics"] = [];
    if (
      /과학|기술|인공지능|반도체|로봇|디지털|소프트웨어|AI|IT|테크/i.test(title)
    )
      topics.push("테크");
    if (/우주|행성|위성|천문|달\s*탐사|나사|NASA|로켓|은하/i.test(title))
      topics.push("우주");
    if (
      /금융|경제|증시|주식|투자|은행|금리|환율|코스피|코스닥|부동산|물가|기업|시장/i.test(
        title,
      )
    )
      topics.push("금융");
    if (/학습|교육|학교|대학|공부|연구|도서|독서|책|수능/i.test(title))
      topics.push("학습");
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
export class KoreanNewsProvider implements NewsProvider {
  private rows?: Article[];
  async fetchPage(page: number): Promise<Article[]> {
    if (!Number.isInteger(page) || page < 0)
      throw new OrbitError("INVALID_PAGE", "올바르지 않은 뉴스 페이지입니다.");
    if (page === 0 || !this.rows) {
      let response: Response;
      try {
        response = await fetch(FEED, {
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
      this.rows = parseKoreanNews(Buffer.concat(chunks).toString("utf8"));
    }
    return this.rows.slice(page * 24, (page + 1) * 24);
  }
}
