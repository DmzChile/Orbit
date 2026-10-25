import { safeStorage } from "electron";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { OrbitError } from "../domain/model";
import { atomicWrite } from "./store";
export class Vault {
  constructor(private directory: string) {}
  async get(provider: "github" | "alpha") {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable()))
        throw new OrbitError(
          "SECRET_STORE",
          "Windows 보안 저장소를 사용할 수 없습니다.",
        );
      return (
        await safeStorage.decryptStringAsync(
          await readFile(join(this.directory, `${provider}.secret`)),
        )
      ).result;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw e;
    }
  }
  async set(provider: "github" | "alpha", value: string) {
    z.string().min(5).max(500).parse(value);
    if (!(await safeStorage.isAsyncEncryptionAvailable()))
      throw new OrbitError(
        "SECRET_STORE",
        "Windows 보안 저장소를 사용할 수 없습니다.",
      );
    await atomicWrite(
      join(this.directory, `${provider}.secret`),
      await safeStorage.encryptStringAsync(value),
    );
  }
  async remove(provider: "github" | "alpha") {
    await unlink(join(this.directory, `${provider}.secret`)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
