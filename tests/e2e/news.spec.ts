import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("E2E-01 · actual public news, saved article, restart and request references", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "orbit-live-news-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (r): r is [string, string] => r[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.ORBIT_DATA_DIR = directory;
  let app = await electron.launch({
    executablePath: join(
      process.cwd(),
      "node_modules/electron/dist/electron.exe",
    ),
    args: ["."],
    env,
  });
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "뉴스", exact: true }).click();
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await expect(page.locator(".article-list .inbox-item").first()).toBeVisible(
      { timeout: 100000 },
    );
    const title = await page.locator(".article-list h3").first().innerText();
    await page.getByRole("searchbox", { name: "기사 검색" }).fill(title);
    await expect(page.locator(".article-list h3").first()).toHaveText(title);
    await page.getByRole("searchbox", { name: "기사 검색" }).fill("");
    await page.locator(".article-list .inbox-item").first().click();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "저장됨 ✓", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "글자 크게", exact: true }).click();
    await page
      .getByRole("button", { name: "이 주제로 요청하기", exact: true })
      .click();
    expect(
      await page
        .getByRole("textbox", { name: "어떤 작업을 맡길까요?", exact: true })
        .inputValue(),
    ).toContain(title);
    await app.close();
    const data = JSON.parse(
      await readFile(join(directory, "state.json"), "utf8"),
    );
    expect(data.articles.length).toBeGreaterThan(0);
    expect(data.savedArticles).toHaveLength(1);
    expect(data.articles[0].source).toBe("Hacker News");
    expect(data.settings.readerScale).toBeGreaterThan(1);
    app = await electron.launch({
      executablePath: join(
        process.cwd(),
        "node_modules/electron/dist/electron.exe",
      ),
      args: ["."],
      env,
    });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "뉴스", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "저장한 기사만", exact: true })
      .check();
    await expect(page.locator(".article-list .inbox-item")).toHaveCount(1);
  } finally {
    await app.close();
  }
});
