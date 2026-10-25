import { requestSchema } from "../src/domain/model";
export const request = (extra: Record<string, unknown> = {}) =>
  requestSchema.parse({
    id: "r1",
    version: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    title: "실제 요청",
    prompt: "문서를 수정해주세요.",
    refs: [],
    repository: "example/allowed",
    baseBranch: "main",
    outputPolicy: "pr",
    formats: ["text", "pdf", "source"],
    rule: {
      frequency: "daily",
      time: "09:00",
      weekdays: [],
      timezone: "Asia/Seoul",
    },
    enabled: true,
    consent: true,
    notify: true,
    provider: "github-actions-openai",
    requirementVersion: "1.0",
    ...extra,
  });
