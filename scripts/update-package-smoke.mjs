// Isolated loopback fixture using the real packaged app, updater and NSIS bytes.
// It never launches an installer or changes the user's installed Orbit.
import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const output = resolve("work-evidence");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "update-fixture-"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const installer = resolve(`release/Orbit Setup ${pkg.version}.exe`);
const bytes = await readFile(installer);
const sha512 = createHash("sha512").update(bytes).digest("base64");
let mode = "offline";
const server = createServer((req, res) => {
  if (mode === "offline") {
    res.writeHead(503);
    res.end("isolated unavailable fixture");
    return;
  }
  if (req.url?.startsWith("/latest.yml")) {
    const hash =
      mode === "corrupt" ? Buffer.alloc(64).toString("base64") : sha512;
    res.setHeader("Content-Type", "text/yaml");
    // Only the loopback fixture uses this deliberately newer metadata version.
    res.end(
      `version: 99.0.0\nfiles:\n  - url: fixture.exe\n    sha512: ${hash}\n    size: ${bytes.length}\npath: fixture.exe\nsha512: ${hash}\nreleaseDate: '2026-10-25T00:00:00.000Z'\n`,
    );
  } else if (req.url?.startsWith("/fixture.exe")) {
    res.setHeader("Content-Length", bytes.length);
    createReadStream(installer).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const config = join(directory, "app-update-fixture.yml");
await writeFile(
  config,
  `provider: generic\nurl: ${url}\nupdaterCacheDirName: fixture-cache\n`,
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => v !== undefined && k !== "ELECTRON_RUN_AS_NODE",
  ),
);
let app;
try {
  app = await electron.launch({
    executablePath: resolve("release/win-unpacked/Orbit.exe"),
    env: { ...env, ORBIT_DATA_DIR: join(directory, "data") },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: "오늘도, 나의 궤도대로." }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.orbit.call("updates.state"))).data
          .status,
      { timeout: 60000 },
    )
    .not.toBe("checking");
  await app.evaluate(
    async ({ app }, fixture) => {
      const load = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json");
      const updater = load("electron-updater").autoUpdater;
      // Privileged test harness only: public renderer cannot set any of these.
      Object.defineProperty(updater.app, "baseCachePath", {
        get: () => fixture.directory,
      });
      updater.updateConfigPath = fixture.config;
      updater.setFeedURL({ provider: "generic", url: fixture.url });
      updater.disableDifferentialDownload = true;
    },
    { directory, config, url },
  );
  const call = (op) =>
    page.evaluate(async (op) => {
      const result = await window.orbit.call(op);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }, op);
  expect((await call("updates.check")).status).toBe("error");
  mode = "corrupt";
  expect((await call("updates.check")).status).toBe("available");
  await expect(page.locator(".update-notice")).toContainText("99.0.0");
  expect((await call("updates.download")).status).toBe("error");
  await expect(
    page
      .locator(".update-notice")
      .getByRole("button", { name: "다운로드 다시 시도" }),
  ).toBeVisible();
  mode = "valid";
  await call("updates.check");
  expect((await call("updates.download")).status).toBe("downloaded");
  await expect(
    page
      .locator(".update-notice")
      .getByRole("button", { name: "재시작 및 설치" }),
  ).toBeVisible();
  const cached = await app.evaluate(async ({ app }) => {
    const load = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    return load("electron-updater").autoUpdater.downloadedUpdateHelper.file;
  });
  const downloaded = await readFile(cached);
  expect(createHash("sha512").update(downloaded).digest("base64")).toBe(sha512);
  expect((await stat(cached)).size).toBe(bytes.length);
  await page.screenshot({ path: join(output, "packaged-update-ready.png") });
  const policies = await app.evaluate(async ({ app }) => {
    const load = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const updater = load("electron-updater").autoUpdater;
    return {
      automaticDownload: updater.autoDownload,
      installOnQuit: updater.autoInstallOnAppQuit,
      packaged: app.isPackaged,
    };
  });
  expect(policies).toEqual({
    automaticDownload: false,
    installOnQuit: false,
    packaged: true,
  });
  await app.close();
  app = undefined;
  // A normal close must retain the app data without launching this fixture installer.
  expect(
    JSON.parse(await readFile(join(directory, "data/state.json"), "utf8"))
      .schemaVersion,
  ).toBe(3);
  const result = {
    fixture: "loopback only; metadata version 99.0.0, actual NSIS bytes",
    ...policies,
    offlineError: true,
    badChecksumRejected: true,
    downloadedBytes: bytes.length,
    sha512,
    installerExecuted: false,
    dataPreservedOnClose: true,
  };
  await writeFile(
    join(output, "packaged-update-smoke.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
}
