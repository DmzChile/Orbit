import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  dialog,
  powerMonitor,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { OrbitError, type Reply } from "../domain/model";
import { Store } from "./store";
import { Vault } from "./vault";
import { Service } from "./service";
import { writeDiagnostic } from "./log";
import { autoUpdater } from "electron-updater";
import { Updates } from "./updates";
let window: BrowserWindow | undefined, store: Store, service: Service;
let quitting = false;
let timer: NodeJS.Timeout;
if (process.env.ORBIT_DATA_DIR)
  app.setPath("userData", process.env.ORBIT_DATA_DIR);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on("second-instance", () => {
  if (window?.isMinimized()) window.restore();
  window?.focus();
});
async function start() {
  app.setAppUserModelId("io.orbit.workspace");
  Menu.setApplicationMenu(null);
  store = new Store(app.getPath("userData"));
  try {
    await store.init();
  } catch (e) {
    dialog.showErrorBox("Orbit 데이터 확인", (e as Error).message);
    app.quit();
    return;
  }
  const saved = store.snapshot().settings.window;
  const display = screen.getDisplayMatching({
    x: saved?.x ?? 0,
    y: saved?.y ?? 0,
    width: saved?.width ?? 1440,
    height: saved?.height ?? 1000,
  });
  const area = display.workArea;
  window = new BrowserWindow({
    title: "Orbit",
    width: Math.min(saved?.width ?? 1440, area.width),
    height: Math.min(saved?.height ?? 1000, area.height),
    x:
      saved?.x === undefined
        ? undefined
        : Math.max(area.x, Math.min(saved.x, area.x + area.width - 300)),
    y:
      saved?.y === undefined
        ? undefined
        : Math.max(area.y, Math.min(saved.y, area.y + area.height - 200)),
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: "#F5F6F8",
    icon: join(__dirname, "../resources/orbit.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#ffffff", symbolColor: "#485468", height: 44 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  const change = () => window?.webContents.send("orbit:changed");
  // app-update.yml fixes the provider; renderer input cannot select feeds or paths.
  autoUpdater.logger = null;
  const updates = new Updates(
    autoUpdater,
    app.getVersion(),
    app.isPackaged && process.platform === "win32",
    (state) => window?.webContents.send("orbit:update", state),
  );
  const startTimer = () =>
    setInterval(() => {
      void service.poll();
      void service.reminders().catch(() => {});
      void updates.check(false);
    }, 15000);
  service = new Service(
    store,
    new Vault(app.getPath("userData")),
    change,
    (id) => {
      window?.show();
      window?.focus();
      window?.webContents.send("orbit:navigate", id);
    },
    (progress) => window?.webContents.send("orbit:transfer", progress),
  );
  const dev = process.env.ORBIT_DEV_URL;
  const expected =
    dev && !app.isPackaged
      ? "http://127.0.0.1:5173"
      : pathToFileURL(join(__dirname, "renderer/index.html")).href;
  function trusted(url: string) {
    return dev && !app.isPackaged
      ? new URL(url).origin === expected
      : url.split("#")[0] === expected;
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e, url) => {
    if (!trusted(url)) e.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  ipcMain.handle("orbit:call", async (e, payload): Promise<Reply> => {
    const correlationId = crypto.randomUUID();
    try {
      if (
        e.sender !== window?.webContents ||
        !e.senderFrame ||
        !trusted(e.senderFrame.url)
      )
        throw new OrbitError("FORBIDDEN", "허용되지 않은 화면입니다.");
      const p = z
        .object({ op: z.string().max(80), data: z.unknown().optional() })
        .parse(payload);
      if (quitting)
        throw new OrbitError(
          "VALIDATION",
          "앱을 종료하고 있어요. 잠시 기다려 주세요.",
        );
      if (p.op.startsWith("updates.")) {
        z.undefined().parse(p.data);
        let data;
        if (p.op === "updates.state") data = updates.snapshot();
        else if (p.op === "updates.check") data = await updates.check();
        else if (p.op === "updates.online") data = await updates.check(false);
        else if (p.op === "updates.download") data = await updates.download();
        else if (p.op === "updates.install") {
          if (updates.snapshot().status !== "downloaded")
            throw new OrbitError(
              "VALIDATION",
              "먼저 업데이트를 다운로드하세요.",
            );
          const answer = await dialog.showMessageBox(window!, {
            type: "question",
            title: "Orbit 업데이트",
            message: "Orbit을 재시작하고 업데이트를 설치할까요?",
            detail:
              "저장된 일정과 보드는 유지됩니다. 작성 중인 내용은 먼저 저장하세요.",
            buttons: ["취소", "재시작 및 설치"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (answer.response !== 1) data = updates.snapshot();
          else
            data = await updates.install(
              async () => {
                quitting = true;
                clearInterval(timer);
                const bounds = window!.getNormalBounds();
                await store.update((d) => {
                  d.settings.window = {
                    ...bounds,
                    maximized: window!.isMaximized(),
                  };
                });
                await store.close();
              },
              async () => {
                await store.close();
                await store.init();
                quitting = false;
                timer = startTimer();
              },
            );
        } else
          throw new OrbitError(
            "VALIDATION",
            "지원하지 않는 업데이트 동작입니다.",
          );
        return { ok: true, data };
      }
      return { ok: true, data: await service.call(p.op, p.data) };
    } catch (error) {
      const code =
        error instanceof OrbitError
          ? error.code
          : error instanceof z.ZodError
            ? "VALIDATION"
            : "INTERNAL";
      const message =
        error instanceof OrbitError
          ? error.message
          : error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .slice(0, 3)
                .join(" · ")
            : "처리하지 못했습니다. 입력은 유지됩니다. 다시 시도하세요.";
      console.error(
        JSON.stringify({ event: "command_failed", code, correlationId }),
      );
      void writeDiagnostic(app.getPath("userData"), {
        event: "command_failed",
        code,
        correlationId,
      }).catch(() => {});
      return { ok: false, error: { code, message, correlationId } };
    }
  });
  ipcMain.on("orbit:window", (e, action) => {
    if (e.sender !== window?.webContents) return;
    if (action === "minimize") window.minimize();
    else if (action === "maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === "close") window.close();
  });
  window.once("ready-to-show", () => {
    window?.show();
    if (saved?.maximized) window?.maximize();
  });
  await window.loadURL(expected);
  timer = startTimer();
  void updates.check(false);
  void service.poll();
  powerMonitor.on("resume", () => {
    void updates.check(false);
    void service.poll(true).catch(() => {});
    void service.reminders().catch(() => {});
  });
  window.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    clearInterval(timer);
    const bounds = window!.getNormalBounds();
    void store
      .update((d) => {
        d.settings.window = { ...bounds, maximized: window!.isMaximized() };
      })
      .finally(async () => {
        await store.close();
        window?.destroy();
        app.quit();
      });
  });
}
if (single)
  void app
    .whenReady()
    .then(start)
    .catch((e) => {
      dialog.showErrorBox(
        "Orbit 시작 실패",
        e instanceof Error ? e.message : "앱을 시작할 수 없습니다.",
      );
      app.quit();
    });
app.on("window-all-closed", () => app.quit());
