import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const activeApps: ElectronApplication[] = [];
test.afterEach(async () => {
  for (const app of activeApps.splice(0)) await app.close().catch(() => {});
});
const launch = async (dir: string) => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (row): row is [string, string] => row[1] !== undefined,
    ),
  );
  env.ORBIT_DATA_DIR = dir;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: join(
      process.cwd(),
      "node_modules/electron/dist/electron.exe",
    ),
    args: ["."],
    env,
  });
  activeApps.push(app);
  return app;
};
test("E2E-02/03/08 · Windows offline CRUD, board, restart, zoom and reduced motion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-e2e-"));
  let app: ElectronApplication = await launch(dir);
  let page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "오늘도, 나의 궤도대로." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/windows-today.png" });
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  await page
    .getByRole("textbox", { name: "일정 제목", exact: true })
    .fill("긴 한국어 일정 · 학습과 구현 확인");
  await page.getByLabel("시작 일시").fill("2028-02-29T23:30");
  await page.getByLabel("종료 일시").fill("2028-03-01T00:30");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("저장했어요");
  await page.getByRole("button", { name: "내 공간", exact: true }).click();
  await page
    .locator(".library-card")
    .filter({ hasText: "마켓 워치" })
    .dragTo(page.locator(".drop-target"));
  await expect(page.locator(".workspace-grid .widget")).toHaveCount(1);
  await page
    .locator(".library-card")
    .filter({ hasText: "빠른 메모" })
    .getByRole("button", { name: "＋ 추가" })
    .click();
  await page
    .getByRole("textbox", { name: "빠른 메모", exact: true })
    .fill("재시작 후에도 남는 실제 메모");
  await page.getByRole("button", { name: "메모 저장" }).click();
  await page.locator(".widget-slot").nth(1).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".widget-slot").first()).toContainText("빠른 메모");
  await page
    .getByRole("combobox", { name: "빠른 메모 크기" })
    .selectOption("L");
  await page.getByRole("button", { name: "편집 완료", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("공간을 저장했어요");
  await page.screenshot({ path: "test-results/windows-board.png" });
  await page.getByRole("button", { name: "오늘", exact: true }).first().click();
  await expect(
    page.getByRole("textbox", { name: "빠른 메모", exact: true }),
  ).toHaveValue("재시작 후에도 남는 실제 메모");
  await page
    .getByRole("checkbox", { name: "모션 줄이기", exact: true })
    .check();
  await expect(page.locator("body")).toHaveClass("reduce");
  await app.close();
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  expect(state.events[0].start).toBe("2028-02-29T14:30:00Z");
  expect(state.boards[0].widgets[0].config.note).toBe(
    "재시작 후에도 남는 실제 메모",
  );
  app = await launch(dir);
  page = await app.firstWindow();
  await expect(
    page.getByRole("textbox", { name: "빠른 메모", exact: true }),
  ).toHaveValue("재시작 후에도 남는 실제 메모");
  await expect(page.locator("body")).toHaveClass("reduce");
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  for (const zoom of [1, 1.5, 2]) {
    await app.evaluate(({ BrowserWindow }, factor) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setBounds({ width: 800, height: 700 });
      w.webContents.setZoomFactor(factor);
    }, zoom);
    await page
      .getByRole("button", { name: "일정 저장", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "일정 저장", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/windows-calendar-${zoom * 100}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
  await app.close();
});
test("SEC-01/02/03 · renderer boundaries and validation errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-security-"));
  const app = await launch(dir),
    page = await app.firstWindow();
  await page.waitForSelector("h1");
  expect(await page.evaluate(() => typeof (window as any).require)).toBe(
    "undefined",
  );
  const result = await page.evaluate(() =>
    window.orbit.call("open", "javascript:alert(1)"),
  );
  expect(result.ok).toBe(false);
  const denied = await page.evaluate(() =>
    window.orbit.call("activity", "unknown/repo"),
  );
  expect(denied.ok).toBe(false);
  await page.getByRole("button", { name: "뉴스", exact: true }).click();
  await expect(
    page.getByText("아직 뉴스가 없어요.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자동화", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "GitHub에 등록", exact: true }),
  ).toBeDisabled();
  await app.close();
});

test("CAL-02/03/07 · weekly occurrence edit and confirmed delete keep series exceptions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-calendar-series-"));
  const app = await launch(dir);
  const page = await app.firstWindow();
  const today = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    return ["year", "month", "day"]
      .map((k) => parts.find((p) => p.type === k)!.value)
      .join("-");
  });
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  await page
    .getByRole("textbox", { name: "일정 제목", exact: true })
    .fill("반복 학습 원본");
  await page.getByLabel("시작 일시").fill(`${today}T14:00`);
  await page.getByLabel("종료 일시").fill(`${today}T15:00`);
  await page
    .getByRole("combobox", { name: "반복", exact: true })
    .selectOption("weekly");
  const day = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(`${today}T12:00:00Z`).getUTCDay()
  ];
  await page
    .getByRole("group", { name: "반복 요일" })
    .getByRole("checkbox", { name: day, exact: true })
    .check();
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await page
    .locator(".agenda-item")
    .filter({ hasText: "반복 학습 원본" })
    .click();
  await page
    .getByRole("textbox", { name: "일정 제목", exact: true })
    .fill("이번 발생만 수정");
  await page
    .getByRole("combobox", { name: "변경 범위", exact: true })
    .selectOption("this");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.locator(".agenda-item")).toContainText("이번 발생만 수정");
  const state = await page.evaluate(() =>
    window.orbit.call<{ events: { title: string; exceptions: string[] }[] }>(
      "state",
    ),
  );
  expect(state.ok && state.data.events).toHaveLength(2);
  if (state.ok) expect(state.data.events[0].exceptions).toContain(today);
  await page.locator(".agenda-item").click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".agenda-item")).toHaveCount(0);
  const after = await page.evaluate(() =>
    window.orbit.call<{ events: { exceptions: string[] }[] }>("state"),
  );
  if (after.ok) {
    expect(after.data.events).toHaveLength(1);
    expect(after.data.events[0].exceptions).toContain(today);
  }
  await app.close();
});

test("UX-05/06 · reference orbit trails reuse the same paths and respect reduced motion", async () => {
  const app = await launch(await mkdtemp(join(tmpdir(), "orbit-trails-"))),
    page = await app.firstWindow();
  const scene = page.locator(".story .orbit-scene"),
    trail = scene.locator(".orbit-trail").first();
  await expect(scene.locator(".orbit-geometry")).toHaveCount(7);
  expect(
    await scene
      .locator(".orbit-trail")
      .evaluateAll(
        (nodes) => new Set(nodes.map((node) => node.getAttribute("href"))).size,
      ),
  ).toBe(7);
  await expect(scene.locator("text, polygon")).toHaveCount(0);
  await expect(page.locator(".satellite-light, .satellite-track")).toHaveCount(
    0,
  );
  const samples = await trail.evaluate(async (el) => {
    const values = new Set<string>();
    for (let n = 0; n < 18; n++) {
      await new Promise(requestAnimationFrame);
      values.add(getComputedStyle(el).strokeDashoffset);
    }
    return values.size;
  });
  expect(samples).toBeGreaterThan(10);
  const start = await trail.evaluate(
    (el) => getComputedStyle(el).strokeDashoffset,
  );
  await expect
    .poll(() => trail.evaluate((el) => getComputedStyle(el).strokeDashoffset))
    .not.toBe(start);
  const lengths = await scene
    .locator(".orbit-back .orbit-lane")
    .first()
    .locator(".orbit-trail")
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        Number(node.getAttribute("stroke-dasharray")?.split(" ")[0]),
      ),
    );
  expect(lengths[0]).toBeGreaterThan(lengths.at(-1)!);
  await page.screenshot({ path: "test-results/windows-orbit-motion.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(trail).toHaveCSS("animation-name", "none");
  await expect(trail).toHaveCSS("visibility", "hidden");
  await expect(scene.locator(".planet")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page
    .getByRole("checkbox", { name: "모션 줄이기", exact: true })
    .check();
  await expect(trail).toHaveCSS("animation-name", "none");
  await expect(trail).toHaveCSS("visibility", "hidden");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ width: 640, height: 540 });
  });
  await expect(page.locator(".story")).toBeVisible();
  const text = await page.locator(".story h2").evaluate((el) => {
    const title = el.getBoundingClientRect(),
      card = el.closest(".story")!.getBoundingClientRect();
    return {
      client: el.clientWidth,
      scroll: el.scrollWidth,
      left: title.left,
      right: title.right,
      cardLeft: card.left,
      cardRight: card.right,
    };
  });
  expect(text.scroll).toBeLessThanOrEqual(text.client);
  expect(text.left).toBeGreaterThanOrEqual(text.cardLeft);
  expect(text.right).toBeLessThanOrEqual(text.cardRight);
  await app.close();
});
