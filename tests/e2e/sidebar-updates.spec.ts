import { electronRuntime, openWorkspace } from "./helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("UX-02/08/SHIP-01 · banner window fits scrollable pages, update notice and trusted IPC", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbit-workspace-update-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    ...electronRuntime(),
    env: { ...env, ORBIT_DATA_DIR: directory },
  });
  try {
    const page = await app.firstWindow();
    await openWorkspace(page, "설정 및 연결");
    await expect(
      page.getByRole("button", { name: "업데이트 확인", exact: true }),
    ).toBeDisabled();
    const rejected = await page.evaluate(() =>
      window.orbit.call("updates.check", {
        url: "https://untrusted.invalid/update",
      }),
    );
    expect(rejected.ok).toBe(false);
    const premature = await page.evaluate(() =>
      window.orbit.call("updates.install"),
    );
    expect(premature.ok).toBe(false);
    for (const [width, height, zoom] of [
      [1280, 800, 1],
      [1000, 600, 1.5],
      [800, 600, 2],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.setSize(size[0], size[1]);
          win.webContents.setZoomFactor(size[2]);
        },
        [width, height, zoom],
      );
      await expect
        .poll(() =>
          page.evaluate(() => {
            const main = document.querySelector("main")!;
            const panel = document.querySelector(".workspace-window")!;
            main.scrollTop = main.scrollHeight;
            const bounds = panel.getBoundingClientRect();
            return {
              windowFits:
                bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1,
              documentFits:
                document.documentElement.scrollHeight <= window.innerHeight + 1,
              scrolls: main.scrollTop > 0,
              widthFits: main.scrollWidth <= main.clientWidth + 1,
            };
          }),
        )
        .toMatchObject({
          windowFits: true,
          documentFits: true,
          scrolls: true,
          widthFits: true,
        });
      await openWorkspace(page, "설정 및 연결");
    }
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1280, 800);
      win.webContents.setZoomFactor(1);
    });
    // Test-only event fixture, not a simulated production update source.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("orbit:update", {
        currentVersion: "0.1.4",
        status: "available",
        version: "0.1.5",
        message: "Orbit 0.1.5 업데이트가 있어요.",
      }),
    );
    const banner = page.locator(".update-notice");
    await expect(banner).toContainText("Orbit 0.1.5 업데이트가 있어요.");
    await expect(
      banner.getByRole("button", { name: "업데이트 다운로드", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("orbit:update", {
        currentVersion: "0.1.4",
        status: "downloading",
        version: "0.1.5",
        percent: 47,
        message: "업데이트를 다운로드하고 있어요.",
      }),
    );
    await expect(banner.getByRole("progressbar")).toHaveAttribute(
      "value",
      "47",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("orbit:update", {
        currentVersion: "0.1.4",
        status: "downloaded",
        version: "0.1.5",
        percent: 100,
        message: "업데이트를 준비했어요.",
      }),
    );
    await expect(
      banner.getByRole("button", { name: "재시작 및 설치", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/banner-workspace-update.png",
    });
  } finally {
    await app.close();
  }
});
