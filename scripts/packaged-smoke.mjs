import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const output = resolve("work-evidence");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "packaged-data-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => v !== undefined && k !== "ELECTRON_RUN_AS_NODE",
  ),
);
const started = Date.now();
const app = await electron.launch({
  executablePath: resolve("release/win-unpacked/Orbit.exe"),
  env: { ...env, ORBIT_DATA_DIR: directory },
});
try {
  const page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: "오늘도, 나의 궤도대로." }),
  ).toBeVisible();
  const launchMilliseconds = Date.now() - started;
  await page.screenshot({ path: join(output, "packaged-today.png") });
  await page.getByRole("button", { name: "설정 및 연결", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "앱 정보 및 진단" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "연결 안내", exact: true }).click();
  await expect(page.locator(".setup-help")).toContainText("GPT API 키 없이");
  const electronVersion = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  await writeFile(
    join(output, "packaged-smoke.json"),
    JSON.stringify(
      {
        platform: process.platform,
        architecture: process.arch,
        launchMilliseconds,
        ...electronVersion,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      packagedSmoke: "passed",
      launchMilliseconds,
      ...electronVersion,
    }),
  );
} finally {
  await app.close();
}
