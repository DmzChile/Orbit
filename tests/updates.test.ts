import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import { Updates } from "../src/main/updates";

class Backend extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  disableWebInstaller = false;
  checkForUpdates = vi.fn(async (): Promise<unknown> => {
    this.emit("update-available", { version: "0.2.0" });
    return {};
  });
  downloadUpdate = vi.fn(async (): Promise<unknown> => {
    this.emit("download-progress", { percent: 53 });
    this.emit("update-downloaded", { version: "0.2.0" });
    return [];
  });
  quitAndInstall = vi.fn();
}

describe("SHIP-01/API-01 · real updater boundary with isolated backend", () => {
  it("requires explicit download and install, with automatic quit installation disabled", async () => {
    const backend = new Backend(),
      changed = vi.fn();
    const updates = new Updates(backend, "0.1.4", true, changed);
    expect(backend).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      allowPrerelease: false,
      disableWebInstaller: true,
    });
    await updates.check();
    expect(updates.snapshot()).toMatchObject({
      status: "available",
      version: "0.2.0",
    });
    expect(backend.downloadUpdate).not.toHaveBeenCalled();
    await updates.download();
    expect(changed.mock.calls.some(([s]) => s.percent === 53)).toBe(true);
    expect(updates.snapshot().status).toBe("downloaded");
    await updates.check();
    expect(updates.snapshot().status).toBe("downloaded");
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    const prepare = vi.fn(async () => {
      expect(backend.quitAndInstall).not.toHaveBeenCalled();
    });
    await updates.install(prepare);
    expect(prepare).toHaveBeenCalledOnce();
    expect(backend.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
  it("never connects in an unpackaged or unsupported app", async () => {
    const backend = new Backend(),
      updates = new Updates(backend, "0.1.4", false, () => {});
    await updates.check();
    await updates.download();
    expect(updates.snapshot().status).toBe("unsupported");
    expect(backend.checkForUpdates).not.toHaveBeenCalled();
    await expect(updates.install()).rejects.toThrow();
  });
  it("deduplicates concurrent checks and applies reconnect backoff", async () => {
    const backend = new Backend();
    let at = 0;
    const updates = new Updates(
      backend,
      "0.1.4",
      true,
      () => {},
      () => at,
    );
    let done!: () => void;
    backend.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = () => {
            backend.emit("update-not-available");
            resolve({});
          };
        }),
    );
    const first = updates.check();
    await updates.check();
    expect(backend.checkForUpdates).toHaveBeenCalledOnce();
    done();
    await first;
    await updates.check(false);
    expect(backend.checkForUpdates).toHaveBeenCalledOnce();
    at = 4 * 60 * 60000;
    await updates.check(false);
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it("keeps download retry and never installs after offline or checksum failure", async () => {
    const backend = new Backend(),
      updates = new Updates(backend, "0.1.4", true, () => {});
    await updates.check();
    backend.downloadUpdate.mockImplementationOnce(async () => {
      backend.emit("error", new Error("checksum mismatch"));
      throw new Error("checksum mismatch");
    });
    await updates.download();
    expect(updates.snapshot()).toMatchObject({
      status: "error",
      retry: "download",
      version: "0.2.0",
    });
    await updates.check(false);
    expect(updates.snapshot().retry).toBe("download");
    await expect(updates.install()).rejects.toThrow();
    await updates.download();
    expect(updates.snapshot().status).toBe("downloaded");
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
  });
  it("recovers failed checks after backoff and distinguishes unpublished releases", async () => {
    const backend = new Backend();
    let at = 0;
    const updates = new Updates(
      backend,
      "0.1.4",
      true,
      () => {},
      () => at,
    );
    backend.checkForUpdates.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await updates.check();
    expect(updates.snapshot().status).toBe("error");
    await updates.check(false);
    expect(backend.checkForUpdates).toHaveBeenCalledOnce();
    at = 60000;
    await updates.check(false);
    expect(updates.snapshot().status).toBe("available");
    backend.checkForUpdates.mockImplementationOnce(async () => {
      throw { code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS" };
    });
    await updates.check();
    expect(updates.snapshot().status).toBe("unavailable");
  });
  it("recovers the app if saving fails or the installer cannot start", async () => {
    const backend = new Backend(),
      updates = new Updates(backend, "0.1.4", true, () => {});
    await updates.check();
    await updates.download();
    const recover = vi.fn(async () => {});
    await expect(
      updates.install(async () => {
        throw new Error("disk full");
      }, recover),
    ).rejects.toThrow("disk full");
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    expect(updates.snapshot().status).toBe("downloaded");
    backend.quitAndInstall.mockImplementationOnce(() => {
      backend.emit("error", new Error("installer failed"));
    });
    await expect(updates.install(async () => {}, recover)).rejects.toThrow();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(updates.snapshot().status).toBe("downloaded");
  });
});
