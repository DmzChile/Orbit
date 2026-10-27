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

type TransitionCapture = {
  opacities: number[];
  backgroundColor: string;
  backgroundOpacity: number;
  geometryDuration: number;
  incomingEnd: number;
  planetDurations: number[];
};

async function captureWorkspaceTransitions(page: Page) {
  await page.evaluate(() => {
    const original = document.startViewTransition.bind(document);
    const results: Promise<TransitionCapture>[] = [];
    (
      window as unknown as { transitionCaptures: Promise<TransitionCapture>[] }
    ).transitionCaptures = results;
    document.startViewTransition = ((update: ViewTransitionUpdateCallback) => {
      const transition = original(update);
      results.push(
        transition.ready.then(() => {
          const allAnimations = document.getAnimations();
          const pseudo = (animation: Animation) =>
            animation.effect instanceof KeyframeEffect
              ? animation.effect.pseudoElement
              : null;
          const animations = allAnimations.filter((animation) => {
            const effect = animation.effect;
            return (
              effect instanceof KeyframeEffect &&
              effect.pseudoElement?.includes("(orbit-workspace)")
            );
          });
          if (animations.length === 0)
            throw new Error("Workspace transition animations were not created");
          const geometry = animations.find(
            (animation) =>
              pseudo(animation) === "::view-transition-group(orbit-workspace)",
          );
          const incoming = animations.find(
            (animation) =>
              pseudo(animation) === "::view-transition-new(orbit-workspace)",
          );
          if (!geometry?.effect || !incoming?.effect)
            throw new Error("Workspace transition is missing a layer");
          const incomingTiming = incoming.effect.getTiming();
          const geometryDuration = Number(geometry.effect.getTiming().duration);
          const incomingEnd =
            Number(incomingTiming.duration) + (incomingTiming.delay ?? 0);
          const planetDurations = allAnimations
            .filter((animation) =>
              pseudo(animation)?.includes("(orbit-planet)"),
            )
            .map((animation) => Number(animation.effect?.getTiming().duration));
          const root = document.documentElement;
          const groupStyle = getComputedStyle(
            root,
            "::view-transition-group(orbit-workspace)",
          );
          const backgroundColor = groupStyle.backgroundColor;
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Cannot inspect transition background");
          context.fillStyle = backgroundColor;
          context.fillRect(0, 0, 1, 1);
          const backgroundOpacity =
            context.getImageData(0, 0, 1, 1).data[3] / 255;
          const previousTimes = animations.map(
            (animation) => animation.currentTime,
          );
          animations.forEach((animation) => animation.pause());
          try {
            const opacities = [0, 80, 150, 220, 350, 500, 620].map((time) => {
              animations.forEach((animation) => {
                animation.currentTime = time;
              });
              const oldOpacity = Number(
                getComputedStyle(root, "::view-transition-old(orbit-workspace)")
                  .opacity,
              );
              const newOpacity = Number(
                getComputedStyle(root, "::view-transition-new(orbit-workspace)")
                  .opacity,
              );
              // The background also covers areas outside either snapshot.
              const snapshots = newOpacity + oldOpacity * (1 - newOpacity);
              return snapshots + backgroundOpacity * (1 - snapshots);
            });
            return {
              opacities,
              backgroundColor,
              backgroundOpacity,
              geometryDuration,
              incomingEnd,
              planetDurations,
            };
          } finally {
            animations.forEach((animation, index) => {
              animation.currentTime = previousTimes[index];
              animation.play();
            });
          }
        }),
      );
      return transition;
    }) as typeof document.startViewTransition;
  });
}

async function workspaceTransition(page: Page, index: number) {
  return page.evaluate(async (resultIndex) => {
    const results = (
      window as unknown as { transitionCaptures: Promise<TransitionCapture>[] }
    ).transitionCaptures;
    return results[resultIndex];
  }, index);
}

test("UX-05/09 · the expanding and returning surface stays visible throughout", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await captureWorkspaceTransitions(page);
    const hub = page.getByRole("navigation", { name: "공간 선택" });
    await hub.getByRole("button", { name: "캘린더", exact: true }).click();
    const opening = await workspaceTransition(page, 0);
    expect(opening.opacities).toHaveLength(7);
    expect(Math.min(...opening.opacities)).toBeGreaterThan(0.98);
    expect(opening.backgroundOpacity).toBe(1);
    expect(opening.backgroundColor).toBe("rgb(240, 241, 251)");
    expect(opening.geometryDuration).toBe(700);
    await expect(page.locator(".banner-workspace")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await page.getByRole("button", { name: "배너로 돌아가기" }).click();
    const closing = await workspaceTransition(page, 1);
    expect(closing.opacities).toHaveLength(7);
    expect(Math.min(...closing.opacities)).toBeGreaterThan(0.98);
    expect(closing.backgroundOpacity).toBe(1);
    expect(closing.backgroundColor).toBe("rgb(240, 241, 251)");
    expect(closing.geometryDuration).toBe(670);
    await expect(page.locator(".banner-workspace")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await openWorkspace(page, "뉴스");
    await page.getByRole("button", { name: "배너로 돌아가기" }).click();
    const newsClosing = await workspaceTransition(page, 3);
    expect(newsClosing.backgroundOpacity).toBe(1);
    expect(newsClosing.backgroundColor).toBe("rgb(25, 54, 76)");
    expect(newsClosing.planetDurations.length).toBeGreaterThan(0);
    expect(
      newsClosing.planetDurations.every((duration) => duration === 670),
    ).toBe(true);
    await expect(page.locator(".banner-workspace")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await openWorkspace(page, "오늘");
    await page
      .getByRole("button", { name: "＋ 새로운 요청", exact: true })
      .click();
    const switching = await workspaceTransition(page, 5);
    expect(switching.geometryDuration).toBe(320);
    expect(switching.incomingEnd).toBeLessThanOrEqual(320);
    expect(switching.backgroundColor).toBe("rgb(244, 240, 249)");
    await expect(page.locator(".banner-workspace")).toHaveAttribute(
      "data-view",
      "auto",
    );
  } finally {
    await app.close();
  }
});

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
