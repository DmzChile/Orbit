import { OrbitError } from "../domain/model";
import type { UpdateState } from "../domain/updates";

/** Small boundary so state transitions can be tested without running an installer. */
export interface UpdateBackend {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  disableWebInstaller: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export class Updates {
  private state: UpdateState;
  private busy = false;
  private nextCheck = 0;
  private failures = 0;
  constructor(
    private backend: UpdateBackend,
    version: string,
    private enabled: boolean,
    private changed: (state: UpdateState) => void,
    private clock = () => Date.now(),
  ) {
    backend.autoDownload = false;
    backend.autoInstallOnAppQuit = false;
    backend.allowDowngrade = false;
    backend.allowPrerelease = false;
    backend.disableWebInstaller = true;
    this.state = {
      currentVersion: version,
      status: enabled ? "idle" : "unsupported",
      message: enabled
        ? "업데이트를 확인할 수 있어요."
        : "설치된 Windows 앱에서 업데이트를 사용할 수 있어요.",
    };
    backend.on("update-available", (info: { version: string }) => {
      this.set({
        status: "available",
        version: info.version,
        message: `Orbit ${info.version} 업데이트가 있어요.`,
      });
    });
    backend.on("update-not-available", () =>
      this.set({
        status: "idle",
        version: undefined,
        message: "최신 버전이에요.",
      }),
    );
    backend.on("download-progress", (progress: { percent: number }) => {
      if (this.state.status !== "downloading") return;
      this.set({
        percent: Number.isFinite(progress.percent)
          ? Math.max(0, Math.min(100, progress.percent))
          : 0,
      });
    });
    backend.on("update-downloaded", (info: { version: string }) => {
      this.set({
        status: "downloaded",
        version: info.version,
        percent: 100,
        message: "업데이트를 준비했어요. 재시작하면 설치할 수 있어요.",
        retry: undefined,
      });
    });
    backend.on("error", (error: unknown) => this.fail(error));
  }
  snapshot(): UpdateState {
    return { ...this.state };
  }
  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.snapshot());
  }
  private fail(error: unknown) {
    const code = (error as { code?: string })?.code;
    const downloading =
      this.state.status === "downloading" || this.state.retry === "download";
    const missing =
      code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" ||
      code === "ERR_UPDATER_NO_PUBLISHED_VERSIONS";
    this.nextCheck =
      this.clock() +
      Math.min(900000, 60000 * 2 ** Math.min(this.failures++, 4));
    this.set({
      status: missing ? "unavailable" : "error",
      retry: downloading ? "download" : "check",
      message: missing
        ? "아직 배포된 업데이트가 없어요. 나중에 다시 확인하세요."
        : downloading
          ? "업데이트를 받지 못했어요. 인터넷 연결과 저장 공간을 확인하고 다시 시도하세요."
          : "업데이트를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도하세요.",
    });
  }
  async check(force = true) {
    if (
      !this.enabled ||
      this.busy ||
      ["downloaded", "installing"].includes(this.state.status) ||
      (!force && this.clock() < this.nextCheck)
    )
      return this.snapshot();
    // A failed download needs a user retry, not a background check that loses its action.
    if (
      !force &&
      (this.state.status === "available" || this.state.retry === "download")
    )
      return this.snapshot();
    this.busy = true;
    this.set({
      status: "checking",
      message: "업데이트를 확인하고 있어요.",
      percent: undefined,
      retry: undefined,
    });
    try {
      const result = await this.backend.checkForUpdates();
      if (result === null)
        this.set({
          status: "unsupported",
          message: "이 실행 방식에서는 업데이트를 사용할 수 없어요.",
        });
      if (
        this.state.status !== "error" &&
        this.state.status !== "unavailable"
      ) {
        this.failures = 0;
        this.nextCheck = this.clock() + 4 * 60 * 60000;
        this.set({ checkedAt: new Date(this.clock()).toISOString() });
      }
    } catch (error) {
      if (this.state.status === "checking") this.fail(error);
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }
  async download() {
    if (!this.enabled || this.busy) return this.snapshot();
    if (
      this.state.status !== "available" &&
      !(this.state.status === "error" && this.state.retry === "download")
    )
      throw new OrbitError("VALIDATION", "먼저 새 업데이트를 확인하세요.");
    this.busy = true;
    this.set({
      status: "downloading",
      percent: 0,
      message: "업데이트를 다운로드하고 있어요.",
      retry: undefined,
    });
    try {
      await this.backend.downloadUpdate();
    } catch (error) {
      if (this.snapshot().status === "downloading") this.fail(error);
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }
  async install(prepare = async () => {}, recover = async () => {}) {
    if (!this.enabled || this.state.status !== "downloaded")
      throw new OrbitError(
        "VALIDATION",
        "업데이트 다운로드가 완료된 뒤 설치할 수 있어요.",
      );
    this.set({
      status: "installing",
      message: "업데이트를 설치하기 위해 재시작하고 있어요.",
    });
    try {
      await prepare();
      this.backend.quitAndInstall(false, true);
      if (this.snapshot().status === "error")
        throw new OrbitError("INTERNAL", "설치를 시작하지 못했어요.");
    } catch (error) {
      await recover();
      this.set({
        status: "downloaded",
        message: "설치를 시작하지 못했어요. 다시 시도하세요.",
      });
      throw error;
    }
    return this.snapshot();
  }
}
