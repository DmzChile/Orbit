import {
  mkdir,
  readFile,
  open,
  rename,
  copyFile,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import {
  initialState,
  OrbitError,
  stateSchema,
  type AppState,
} from "../domain/model";
import { parseStoredState } from "../domain/migrations";
export async function atomicWrite(file: string, content: string | Buffer) {
  await mkdir(join(file, ".."), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, file);
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
}
export class Store {
  private state!: AppState;
  private pending = Promise.resolve();
  private lock?: Awaited<ReturnType<typeof open>>;
  constructor(public directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.lock = await open(join(this.directory, "store.lock"), "wx");
        await this.lock.writeFile(String(process.pid));
        break;
      } catch {
        let pid: number;
        try {
          pid = Number(
            await readFile(join(this.directory, "store.lock"), "utf8"),
          );
          if (!Number.isSafeInteger(pid) || pid <= 0)
            throw new Error("invalid lock");
          process.kill(pid, 0);
          throw new OrbitError(
            "LOCKED",
            "다른 Orbit 인스턴스가 이 데이터 폴더를 사용 중입니다.",
          );
        } catch (e) {
          if (e instanceof OrbitError) throw e;
          if ((e as NodeJS.ErrnoException).code !== "ESRCH")
            throw new OrbitError(
              "LOCKED",
              "데이터 잠금 상태를 확인할 수 없습니다.",
            );
          await unlink(join(this.directory, "store.lock"));
        }
      }
    }
    if (!this.lock)
      throw new OrbitError("LOCKED", "데이터 잠금을 얻지 못했습니다.");
    let originalSchema: number | undefined;
    try {
      const original = JSON.parse(await readFile(this.file, "utf8"));
      this.state = parseStoredState(original);
      originalSchema = original.schemaVersion;
    } catch (e) {
      if (
        e instanceof OrbitError &&
        ["UPGRADE_REQUIRED", "MIGRATION_REQUIRED"].includes(e.code)
      ) {
        await this.close();
        throw e;
      }
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.state = initialState();
        await atomicWrite(this.file, JSON.stringify(this.state));
      } else {
        try {
          this.state = parseStoredState(
            JSON.parse(await readFile(`${this.file}.backup`, "utf8")),
          );
          await copyFile(this.file, `${this.file}.corrupt`).catch(() => {});
          await atomicWrite(this.file, JSON.stringify(this.state));
        } catch {
          await this.close();
          throw new OrbitError(
            "CORRUPT_DATA",
            "저장 데이터와 백업을 읽을 수 없습니다. 원본을 보존했습니다.",
          );
        }
      }
    }
    if (originalSchema && originalSchema < this.state.schemaVersion) {
      try {
        await copyFile(
          this.file,
          `${this.file}.v${originalSchema}.backup`,
          constants.COPYFILE_EXCL,
        ).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        await atomicWrite(this.file, JSON.stringify(this.state));
      } catch {
        await this.close();
        throw new OrbitError(
          "STORAGE_ERROR",
          "데이터 업그레이드를 저장하지 못했습니다. 원본과 버전 백업을 보존했습니다.",
        );
      }
    }
    return this.snapshot();
  }
  get file() {
    return join(this.directory, "state.json");
  }
  snapshot() {
    return structuredClone(this.state);
  }
  update<T>(fn: (draft: AppState) => T): Promise<T> {
    const task = this.pending.then(async () => {
      const draft = this.snapshot();
      const result = fn(draft);
      draft.version++;
      draft.updatedAt = new Date().toISOString();
      stateSchema.parse(draft);
      await copyFile(this.file, `${this.file}.backup`);
      await atomicWrite(this.file, JSON.stringify(draft));
      this.state = draft;
      return result;
    });
    this.pending = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  async restore(value: unknown) {
    const parsed = parseStoredState(value);
    await this.update((d) => {
      Object.assign(d, parsed);
    });
  }
  async reset() {
    await this.update((d) => Object.assign(d, initialState()));
    for (const name of [
      `${this.file}.backup`,
      `${this.file}.corrupt`,
      `${this.file}.v1.backup`,
    ])
      await unlink(name).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
  async close() {
    await this.pending;
    await this.lock?.close();
    if (this.lock) {
      await unlink(join(this.directory, "store.lock")).catch(() => {});
      this.lock = undefined;
    }
  }
}
