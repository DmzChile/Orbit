import {
  electronRuntime,
  openWorkspace,
  returnToBanners,
  enableReducedMotion,
} from "./helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initialState, articleSchema } from "../../src/domain/model";
import { NEWS_TOPICS } from "../../src/domain/news";

test("APP-03/NEWS-02/UX-06 · isolated fixture politics filter, balanced rotation and reading controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbit-carousel-fixture-")),
    state = initialState();
  state.articles = NEWS_TOPICS.map((topic, n) =>
    articleSchema.parse({
      id: `fixture:${n}`,
      title: `[테스트 fixture] ${topic} 기사`,
      topics: [topic],
      publishedAt: "2026-10-25T00:00:00Z",
      fetchedAt: "2026-10-25T01:00:00Z",
      source: "테스트 전용 fixture",
      sourceUrl: "https://rss.donga.com/",
      url: `https://www.donga.com/news/fixture/${n}`,
      summary: "격리된 테스트 기사입니다.",
      summaryKind: "metadata",
      readingMinutes: 0,
      image: "orbit",
    }),
  );
  await writeFile(join(directory, "state.json"), JSON.stringify(state));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    ...electronRuntime(),
    env: { ...env, ORBIT_DATA_DIR: directory },
  });
  try {
    const page = await app.firstWindow();
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openWorkspace(page, "뉴스");
    await page.getByRole("button", { name: "정치", exact: true }).click();
    await expect(page.locator(".article-list .inbox-item")).toHaveCount(1);
    await expect(page.locator(".reader h2")).toHaveText(
      "[테스트 fixture] 정치 기사",
    );
    await returnToBanners(page);
    await page
      .getByRole("heading", { name: "오늘도, 나의 궤도대로.", exact: true })
      .click();
    await page.mouse.move(0, 0);
    await expect(page.locator(".story .pill")).toHaveText("테크");
    await page.clock.fastForward(8100);
    await expect(page.locator(".story .pill")).toHaveText("우주");
    await page.locator(".story").hover();
    await page.clock.fastForward(16000);
    await expect(page.locator(".story .pill")).toHaveText("우주");
    await page.mouse.move(0, 0);
    await page.clock.fastForward(8100);
    await expect(page.locator(".story .pill")).toHaveText("금융");
    await page.getByRole("button", { name: "다음 뉴스", exact: true }).click();
    await page
      .getByRole("heading", { name: "오늘도, 나의 궤도대로.", exact: true })
      .click();
    await page.mouse.move(0, 0);
    await expect(page.locator(".story .pill")).toHaveText("학습");
    await page.clock.fastForward(16000);
    await expect(page.locator(".story .pill")).toHaveText("학습");
    await page
      .getByRole("button", { name: "뉴스 자동 전환 재개", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "오늘도, 나의 궤도대로.", exact: true })
      .click();
    await page.mouse.move(0, 0);
    await page.clock.fastForward(8100);
    await expect(page.locator(".story .pill")).toHaveText("정치");
    await page
      .getByRole("button", { name: "테크 뉴스 보기", exact: true })
      .click();
    await page.locator(".story").click();
    await expect(page.locator(".reader h2")).toHaveText(
      "[테스트 fixture] 테크 기사",
    );
    await returnToBanners(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("heading", { name: "오늘도, 나의 궤도대로.", exact: true })
      .click();
    await page.mouse.move(0, 0);
    await page.clock.fastForward(16000);
    await expect(page.locator(".story .pill")).toHaveText("테크");
    await expect(
      page.getByRole("button", {
        name: "모션 줄이기로 자동 전환 꺼짐",
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "다음 뉴스", exact: true }).click();
    await expect(page.locator(".story .pill")).toHaveText("우주");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await enableReducedMotion(page);
    await expect(
      page.getByRole("button", {
        name: "모션 줄이기로 자동 전환 꺼짐",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await app.close();
  }
});
