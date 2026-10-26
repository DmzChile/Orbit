import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { electronRuntime, openWorkspace, returnToBanners } from "./helpers";

async function launch() {
  const directory = await mkdtemp(join(tmpdir(), "orbit-banner-navigation-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  return electron.launch({
    ...electronRuntime(),
    env: { ...env, ORBIT_DATA_DIR: directory },
  });
}

async function hasGeometryAnimation(page: Page) {
  return page.evaluate(() =>
    document.getAnimations().some((animation) => {
      if (
        !(animation instanceof CSSAnimation) ||
        !animation.animationName.includes("orbit-workspace")
      )
        return false;
      const keys = (animation.effect as KeyframeEffect).getKeyframes();
      return (
        keys.length > 1 &&
        keys[0].width !== undefined &&
        keys[0].width !== keys.at(-1)?.width
      );
    }),
  );
}

test("UX-09/10 · seven banners morph in both directions and restore keyboard focus", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const hub = page.getByRole("navigation", { name: "공간 선택" });
    await expect(page.locator("[data-banner]")).toHaveCount(7);
    await expect(page.locator("aside, .widget, .workspace-grid")).toHaveCount(
      0,
    );
    await hub.getByRole("button", { name: "캘린더", exact: true }).click();
    await expect.poll(() => hasGeometryAnimation(page)).toBe(true);
    await expect(page.locator(".banner-workspace")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await expect(page.locator(".workspace-window")).toHaveClass(
      /workspace-window--calendar/,
    );
    await expect(
      page.getByRole("button", { name: "배너로 돌아가기" }),
    ).toBeFocused();
    await page
      .getByRole("textbox", { name: "일정 제목", exact: true })
      .fill("돌아와도 남아 있는 초안");
    await page.getByRole("button", { name: "배너로 돌아가기" }).click();
    await expect.poll(() => hasGeometryAnimation(page)).toBe(true);
    await expect(
      hub.getByRole("button", { name: "캘린더", exact: true }),
    ).toBeFocused();
    await openWorkspace(page, "캘린더");
    await expect(
      page.getByRole("textbox", { name: "일정 제목", exact: true }),
    ).toHaveValue("돌아와도 남아 있는 초안");
    await page.keyboard.press("Escape");
    await expect(
      hub.getByRole("button", { name: "캘린더", exact: true }),
    ).toBeFocused();
    await openWorkspace(page, "자동화");
    await page
      .getByRole("textbox", { name: "어떤 작업을 맡길까요?", exact: true })
      .fill("전환 후에도 보존할 요청 내용");
    await returnToBanners(page);
    await openWorkspace(page, "자동화");
    await expect(
      page.getByRole("textbox", { name: "어떤 작업을 맡길까요?", exact: true }),
    ).toHaveValue("전환 후에도 보존할 요청 내용");
    await page.screenshot({ path: "test-results/banner-automation.png" });
    await openWorkspace(page, "오늘");
    await page
      .getByRole("button", { name: "＋ 새로운 요청", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "어떤 작업을 맡길까요?", exact: true }),
    ).toHaveValue("");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("UX-06/09/10 · reduced motion, API fallback and interrupted opening remain usable", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const root = page.locator(".banner-workspace");
    await expect(root).toHaveAttribute("data-view", "hub");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkspace(page, "뉴스");
    expect(await hasGeometryAnimation(page)).toBe(false);
    await returnToBanners(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page
      .getByRole("navigation", { name: "공간 선택" })
      .getByRole("button", { name: "캘린더", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-view", "hub");
    await expect(root).toHaveAttribute("data-phase", "idle");
    await expect(
      page
        .getByRole("navigation", { name: "공간 선택" })
        .getByRole("button", { name: "캘린더", exact: true }),
    ).toBeFocused();
    await page.evaluate(() =>
      Object.defineProperty(document, "startViewTransition", {
        value: undefined,
        configurable: true,
      }),
    );
    await openWorkspace(page, "설정 및 연결");
    await expect(
      page.getByRole("button", { name: "설정 저장", exact: true }),
    ).toBeVisible();
    await returnToBanners(page);
    expect(await hasGeometryAnimation(page)).toBe(false);
  } finally {
    await app.close();
  }
});

test("UX-08/09 · theme inheritance, narrow windows and update chrome leave every view reachable", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const title of [
      "뉴스",
      "오늘",
      "캘린더",
      "자동화",
      "결과함",
      "내 공간",
      "설정 및 연결",
    ]) {
      await openWorkspace(page, title);
      await expect(page.locator(".workspace-window-title")).toHaveText(title);
      await expect(page.locator("#content")).toBeVisible();
      await returnToBanners(page);
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 640, height: 540 }),
    );
    await openWorkspace(page, "캘린더");
    await page
      .getByRole("button", { name: "일정 저장", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "일정 저장", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "배너로 돌아가기" }),
    ).toBeInViewport();
    await page.screenshot({ path: "test-results/banner-narrow-calendar.png" });
    await returnToBanners(page);
  } finally {
    await app.close();
  }
});
