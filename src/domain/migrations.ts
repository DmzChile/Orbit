import { OrbitError, stateSchema, type AppState } from "./model";
export const CURRENT_SCHEMA_VERSION = 3;
// External-provider records are not readable by 0.1.0. Mark them as a future
// schema so older apps preserve the data instead of treating it as corruption.
const migrations: Record<
  number,
  (record: Record<string, unknown>) => Record<string, unknown>
> = {
  1: (record) => ({ ...record, schemaVersion: 2 }),
  2: (record) => ({ ...record, schemaVersion: 3 }),
};
export function parseStoredState(value: unknown): AppState {
  if (!value || typeof value !== "object")
    throw new OrbitError("CORRUPT_DATA", "저장 레코드가 올바르지 않습니다.");
  let record = value as Record<string, unknown>;
  const version = record.schemaVersion;
  if (typeof version !== "number" || version > CURRENT_SCHEMA_VERSION)
    throw new OrbitError(
      "UPGRADE_REQUIRED",
      "이 데이터는 다른 앱 버전으로 작성되었습니다. 원본을 보존하고 호환되는 버전을 설치하세요.",
    );
  while ((record.schemaVersion as number) < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[record.schemaVersion as number];
    if (!migrate)
      throw new OrbitError(
        "MIGRATION_REQUIRED",
        "지원되지 않는 이전 스키마입니다. 데이터를 보존했습니다.",
      );
    record = migrate(record);
  }
  return stateSchema.parse(record);
}
