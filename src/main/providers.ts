import { z } from "zod";
import { articleSchema, OrbitError, type Article } from "../domain/model";
export async function jsonFetch(url: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(20000),
    });
  } catch {
    throw new OrbitError(
      "OFFLINE",
      "서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.",
    );
  }
  if (!response.ok) {
    const rate =
      response.status === 429 ||
      (response.status === 403 &&
        response.headers.get("x-ratelimit-remaining") === "0");
    throw new OrbitError(
      rate
        ? "RATE_LIMIT"
        : response.status === 401
          ? "NEEDS_AUTH"
          : response.status === 404
            ? "NOT_FOUND"
            : response.status === 409 || response.status === 422
              ? "CONFLICT"
              : response.status === 403
                ? "FORBIDDEN"
                : "PROVIDER_ERROR",
      rate
        ? "API 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요."
        : response.status === 401
          ? "인증이 만료되었거나 취소되었습니다. 다시 연결하세요."
          : response.status === 404
            ? "대상을 찾을 수 없거나 접근 권한이 없습니다."
            : response.status === 403
              ? "이 작업에 필요한 권한이 없습니다."
              : `공급자가 요청을 거절했습니다 (${response.status}).`,
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}
export interface NewsProvider {
  fetchPage(page: number): Promise<Article[]>;
}
const hnItem = z.object({
  id: z.number(),
  title: z.string().optional(),
  url: z.string().optional(),
  by: z.string().optional(),
  time: z.number(),
  type: z.string(),
  deleted: z.boolean().optional(),
  dead: z.boolean().optional(),
});
export class HackerNewsProvider implements NewsProvider {
  async fetchPage(page: number) {
    const ids = z
      .array(z.number())
      .parse(
        await jsonFetch(
          "https://hacker-news.firebaseio.com/v0/topstories.json",
        ),
      );
    const selected = ids.slice(page * 24, (page + 1) * 24);
    const rows: Article[] = [];
    for (let i = 0; i < selected.length; i += 6) {
      const batch = await Promise.allSettled(
        selected.slice(i, i + 6).map(async (n) => {
          const item = hnItem.parse(
            await jsonFetch(
              `https://hacker-news.firebaseio.com/v0/item/${n}.json`,
            ),
          );
          if (item.deleted || item.dead || !item.title) return null;
          const topics: Article["topics"] = ["테크"];
          if (/space|orbit|nasa|moon|astronom|rocket|mars/i.test(item.title))
            topics.push("우주");
          if (/learn|teach|course|study|math|book|education/i.test(item.title))
            topics.push("학습");
          if (
            /financ|market|stock|bank|econom|invest|money|trading/i.test(
              item.title,
            )
          )
            topics.push("금융");
          const url = item.url?.startsWith("https://")
            ? item.url
            : `https://news.ycombinator.com/item?id=${item.id}`;
          return articleSchema.parse({
            id: `hn:${item.id}`,
            title: item.title,
            url,
            source: "Hacker News",
            sourceUrl: `https://news.ycombinator.com/item?id=${item.id}`,
            publishedAt: new Date(item.time * 1000).toISOString(),
            fetchedAt: new Date().toISOString(),
            topics,
            summary:
              "Hacker News에서 수집한 기사 링크입니다. 본문과 읽기 시간은 제공되지 않습니다. 원문에서 내용을 확인하세요.",
            summaryKind: "metadata",
            readingMinutes: 0,
            image: "orbit",
          });
        }),
      );
      for (const v of batch)
        if (v.status === "fulfilled" && v.value) rows.push(v.value);
    }
    if (selected.length && rows.length === 0)
      throw new OrbitError(
        "PROVIDER_ERROR",
        "기사를 불러오지 못했습니다. 캐시를 유지합니다.",
      );
    return rows;
  }
}
export async function fetchQuote(symbol: string, key: string) {
  if (!key)
    throw new OrbitError(
      "NEEDS_AUTH",
      "설정에서 Alpha Vantage API 키를 연결하세요.",
    );
  const data = await jsonFetch(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`,
  );
  const q = z
    .object({
      "Global Quote": z.object({
        "01. symbol": z.string(),
        "05. price": z.string(),
        "07. latest trading day": z.string(),
        "08. previous close": z.string(),
        "10. change percent": z.string(),
      }),
    })
    .safeParse(data);
  if (!q.success)
    throw new OrbitError(
      "RATE_LIMIT",
      "시세가 제공되지 않습니다. 종목·API 한도·구독 권한을 확인하세요.",
    );
  const v = q.data["Global Quote"],
    price = Number(v["05. price"]),
    previous = Number(v["08. previous close"]),
    change = Number(v["10. change percent"].replace("%", ""));
  if (![price, previous, change].every(Number.isFinite))
    throw new OrbitError(
      "PROVIDER_DATA",
      "시세 응답 형식이 올바르지 않습니다.",
    );
  const matches = await jsonFetch(
    `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`,
  );
  const list = z
    .object({
      bestMatches: z.array(
        z.object({ "1. symbol": z.string(), "8. currency": z.string() }),
      ),
    })
    .safeParse(matches);
  const currency = list.success
    ? list.data.bestMatches.find((m) => m["1. symbol"] === symbol)?.[
        "8. currency"
      ]
    : undefined;
  if (!currency)
    throw new OrbitError(
      "CURRENCY_UNAVAILABLE",
      "종목 통화를 확인하지 못했습니다. API 한도 또는 지원 종목을 확인하세요.",
    );
  return {
    symbol: v["01. symbol"],
    price,
    change,
    currency,
    asOf: v["07. latest trading day"],
    fetchedAt: new Date().toISOString(),
    history: [previous, price],
    source: "Alpha Vantage · 일 마감 시세",
    delayed: true,
  };
}
export async function fetchIndex(symbol: string, key: string) {
  if (!key)
    throw new OrbitError(
      "NEEDS_AUTH",
      "설정에서 Alpha Vantage API 키를 연결하세요. 지수 데이터는 공급자의 유료 권한이 필요합니다.",
    );
  let response: Response;
  try {
    response = await fetch(
      `https://www.alphavantage.co/query?function=INDEX_DATA&symbol=${encodeURIComponent(symbol)}&interval=daily&datatype=csv&apikey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(20000) },
    );
  } catch {
    throw new OrbitError("OFFLINE", "지수 공급자에 연결하지 못했습니다.");
  }
  if (!response.ok)
    throw new OrbitError(
      "PROVIDER_ERROR",
      `지수 조회 실패 (${response.status}).`,
    );
  const text = await response.text();
  if (text.length > 5000000)
    throw new OrbitError("TOO_LARGE", "지수 응답이 너무 큽니다.");
  if (text.trimStart().startsWith("{"))
    throw new OrbitError(
      "SUBSCRIPTION_REQUIRED",
      "지수 데이터 이용 권한 또는 공급자 API 한도를 확인하세요.",
    );
  const lines = text.trim().split(/\r?\n/),
    header = lines
      .shift()!
      .toLowerCase()
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, "")),
    dateIndex = header.findIndex((v) => v === "timestamp" || v === "date"),
    closeIndex = header.indexOf("close");
  if (dateIndex < 0 || closeIndex < 0)
    throw new OrbitError(
      "PROVIDER_DATA",
      "지수 CSV 열 구성이 올바르지 않습니다.",
    );
  const rows = lines
    .map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      return { date: values[dateIndex], close: Number(values[closeIndex]) };
    })
    .filter(
      (r) =>
        /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
        Number.isFinite(r.close) &&
        r.close > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2)
    throw new OrbitError(
      "PROVIDER_DATA",
      "지수 변동률을 계산할 데이터가 부족합니다.",
    );
  const latest = rows.at(-1)!,
    previous = rows.at(-2)!;
  return {
    symbol,
    price: latest.close,
    change: (latest.close / previous.close - 1) * 100,
    currency: "포인트 (지수)",
    asOf: latest.date,
    fetchedAt: new Date().toISOString(),
    history: rows.slice(-30).map((r) => r.close),
    source: "Alpha Vantage INDEX_DATA · 일 마감",
    delayed: true,
  };
}
