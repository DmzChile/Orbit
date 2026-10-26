import { expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

export function electronRuntime() {
  const binary =
    process.platform === "win32"
      ? "electron.exe"
      : process.platform === "darwin"
        ? "Electron.app/Contents/MacOS/Electron"
        : "electron";
  return {
    executablePath: resolve("node_modules/electron/dist", binary),
    // Linux CI containers run as root; production app sandbox settings stay on.
    args: process.platform === "linux" ? [".", "--no-sandbox"] : ["."],
  };
}

export async function openWorkspace(page: Page, title: string) {
  const root = page.locator(".banner-workspace");
  await expect(root).toBeVisible();
  if ((await root.getAttribute("data-view")) !== "hub") {
    await page
      .getByRole("button", { name: "배너로 돌아가기", exact: true })
      .click();
    await expect(root).toHaveAttribute("data-view", "hub");
    await expect(root).toHaveAttribute("data-phase", "idle");
  }
  await page
    .getByRole("navigation", { name: "공간 선택" })
    .getByRole("button", { name: title, exact: true })
    .click();
  await expect(page.locator(".workspace-window")).toBeVisible();
  await expect(root).toHaveAttribute("data-phase", "idle");
}

export async function returnToBanners(page: Page) {
  await page
    .getByRole("button", { name: "배너로 돌아가기", exact: true })
    .click();
  await expect(page.locator(".banner-workspace")).toHaveAttribute(
    "data-view",
    "hub",
  );
  await expect(page.locator(".banner-workspace")).toHaveAttribute(
    "data-phase",
    "idle",
  );
}

export async function enableReducedMotion(page: Page) {
  await openWorkspace(page, "설정 및 연결");
  await page
    .getByRole("checkbox", {
      name: "모션 줄이기 (시스템 설정도 적용)",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(page.locator("body")).toHaveClass("reduce");
  await returnToBanners(page);
}
