import { useEffect, useState } from "react";
import type {
  AppState,
  Request,
  Run,
  TransferProgress,
  Attachment,
} from "../domain/model";
import { nextRun, terminal } from "../domain/calendar";
import {
  api,
  Button,
  Empty,
  errorText,
  Head,
  Pill,
  dateText,
  type Feedback,
} from "./main";
import { Icon } from "./icons";
export const statusLabels: Record<string, string> = {
  draft: "초안",
  scheduled: "예약됨",
  queued: "대기 중",
  syncing: "저장소 동기화",
  running: "작업 중",
  validating: "검증 중",
  publishing: "결과 게시 중",
  succeeded: "완료",
  failed: "실패",
  cancel_requested: "취소 요청",
  cancelled: "취소됨",
  needs_auth: "다시 연결 필요",
  conflict: "충돌",
};
export function Automations({
  state,
  refs,
  feedback,
  seed,
}: {
  state: AppState;
  refs: Request["refs"];
  feedback: Feedback;
  seed?: Request;
}) {
  const [selected, setSelected] = useState<string>(),
    [generation, setGeneration] = useState(0);
  const request = state.requests.find((r) => r.id === selected);
  return (
    <>
      <Head
        title="생각은 지금. 작업은 제시간에."
        sub="요청은 GitHub에 보관하고, 사용자가 설정한 외부 ChatGPT 예약 작업이 실행합니다."
        action={
          <Button
            onClick={() => {
              setSelected(undefined);
              setGeneration((n) => n + 1);
            }}
          >
            ＋ 새 요청
          </Button>
        }
      />
      <div className="split">
        <RequestForm
          key={`${selected ?? (generation === 0 ? seed?.id : undefined) ?? `new-${generation}`}:${JSON.stringify(refs)}`}
          state={state}
          initial={request ?? (generation === 0 ? seed : undefined)}
          refs={refs}
          feedback={feedback}
        />
        <div className="side-stack">
          <div className="card flow-card">
            <h2>작업은 이렇게 이어져요</h2>
            <div className="flow-list">
              {[
                ["요청과 규칙 보관", "Issue · 요청 스냅샷 · 실행 ID"],
                ["외부 ChatGPT 예약", "ChatGPT에서 직접 만든 작업이 요청 확인"],
                ["검증 후 변경 제안", "실제 빌드·테스트와 Pull Request"],
                ["결과함으로 자동 수신", "인증된 조회 · 체크섬 검증 다운로드"],
              ].map(([t, s], i) => (
                <div className="flow-step" key={t}>
                  <span className="flow-number">{i + 1}</span>
                  <div>
                    <h3>{t}</h3>
                    <small>{s}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <section className="card">
            <h2>내 요청과 예약</h2>
            {state.requests.length ? (
              state.requests.map((r) => {
                const at = nextRun(r.rule, new Date().toISOString());
                const last = state.runs
                  .filter((v) => v.requestId === r.id)
                  .at(-1);
                return (
                  <div className="schedule-record" key={r.id}>
                    <button
                      className="text-button"
                      onClick={() => setSelected(r.id)}
                    >
                      <b>{r.title}</b>
                    </button>
                    <small>
                      {r.remoteIssue
                        ? r.enabled
                          ? "GitHub 등록됨"
                          : "일시정지"
                        : "로컬 초안"}{" "}
                      · {r.rule.timezone}
                      <br />
                      {at
                        ? `예정 ${dateText(at)} · 외부 예약 설정 필요`
                        : "수동 / 예약 종료"}
                      {last && (
                        <>
                          <br />
                          최근 {statusLabels[last.status]}
                        </>
                      )}
                    </small>
                    <div className="row wrap">
                      <button
                        className="text-button"
                        onClick={() => setSelected(r.id)}
                      >
                        편집
                      </button>
                      {r.remoteIssue && (
                        <button
                          className="text-button"
                          onClick={() =>
                            void api("run.enqueue", r.id)
                              .then(() =>
                                feedback(
                                  "실행을 요청했어요. 결과함에서 확인하세요.",
                                ),
                              )
                              .catch((e) => feedback(errorText(e)))
                          }
                        >
                          지금 실행
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => {
                          if (
                            window.confirm(
                              "예약과 요청을 삭제할까요? 원격 레코드는 닫히고 실행 기록은 남습니다.",
                            )
                          )
                            void api("request.remove", r.id).catch((e) =>
                              feedback(errorText(e)),
                            );
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty>아직 요청이 없어요. 초안부터 시작하세요.</Empty>
            )}
          </section>
          <div className="card info">
            <h3>외부 ChatGPT 예약</h3>
            <p>
              ChatGPT 예약은 사용자가 ChatGPT에서 직접 작성합니다. Orbit은
              GitHub에 요청·예약 정의를 전달하고 결과를 수신합니다. 등록 후 예약
              프롬프트를 복사해 외부 작업에 붙여 넣으세요.
            </p>
            <p>
              GPT API 키가 필요하지 않습니다. 실행 가능 도구·이용 한도와 실행
              환경은 사용자의 ChatGPT 설정을 따릅니다. 예약 저장이나 지금
              실행만으로 ChatGPT 예약이 생성되지는 않습니다.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
function RequestForm({
  state,
  initial,
  refs,
  feedback,
}: {
  state: AppState;
  initial?: Request;
  refs: Request["refs"];
  feedback: Feedback;
}) {
  const [id] = useState(initial?.id ?? crypto.randomUUID()),
    [attachments, setAttachments] = useState<Attachment[]>(
      initial?.attachments ?? [],
    ),
    [title, setTitle] = useState(initial?.title ?? ""),
    [prompt, setPrompt] = useState(
      initial?.prompt ??
        (refs.length
          ? `다음 기사와 관련한 내용을 조사하고 정리해주세요.\n${refs.map((r) => r.title).join("\n")}`
          : ""),
    ),
    [repository, setRepository] = useState(
      initial?.repository ?? state.settings.allowedRepos[0] ?? "",
    ),
    [baseBranch, setBaseBranch] = useState(initial?.baseBranch ?? "main"),
    [branches, setBranches] = useState<string[]>([]),
    [frequency, setFrequency] = useState(initial?.rule.frequency ?? "manual"),
    [date, setDate] = useState(initial?.rule.date ?? ""),
    [time, setTime] = useState(initial?.rule.time ?? "09:00"),
    [zone, setZone] = useState(
      initial?.rule.timezone ?? state.settings.timezone,
    ),
    [weekdays, setWeekdays] = useState(initial?.rule.weekdays ?? [0]),
    [until, setUntil] = useState(initial?.rule.until ?? ""),
    [count, setCount] = useState(initial?.rule.count?.toString() ?? ""),
    [policy, setPolicy] = useState(initial?.outputPolicy ?? "pr"),
    [formats, setFormats] = useState<Request["formats"]>(
      initial?.formats ?? ["text", "pdf"],
    ),
    [enabled, setEnabled] = useState(initial?.enabled ?? true),
    [consent, setConsent] = useState(
      initial?.provider === "chatgpt-external" ? initial.consent : false,
    ),
    [notify, setNotify] = useState(initial?.notify ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    void api<{ name: string }[]>("branches", { repo: repository })
      .then((v) => {
        if (!cancelled) setBranches(v.map((b) => b.name));
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);
  function value(): Request {
    const now = new Date().toISOString(),
      current = state.requests.find((r) => r.id === id);
    return {
      id,
      version: current?.version ?? 1,
      createdAt: current?.createdAt ?? initial?.createdAt ?? now,
      updatedAt: now,
      title,
      prompt,
      attachments,
      refs: initial?.refs.length ? initial.refs : refs,
      repository,
      baseBranch,
      rule: {
        frequency,
        date: date || undefined,
        time,
        timezone: zone,
        weekdays,
        until: until || undefined,
        count: count ? Number(count) : undefined,
      },
      enabled,
      consent,
      notify,
      provider: "chatgpt-external",
      requirementVersion: "1.1",
      outputPolicy: policy,
      formats,
      remoteIssue: current?.remoteIssue,
      remoteUpdatedAt: current?.remoteUpdatedAt,
    };
  }
  async function save(publish = false) {
    setBusy(true);
    setError("");
    try {
      await api("request.save", value());
      if (publish) await api("request.publish", { id });
      feedback(
        publish
          ? "GitHub에 등록했어요. 예약 프롬프트를 외부 ChatGPT 작업에 연결하세요."
          : "초안을 로컬에 저장했어요.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const saved = state.requests.find((r) => r.id === id);
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(true);
      }}
    >
      <div className="row between">
        <div className="row">
          <Icon name="spark" />
          <h2>{initial ? "요청 편집" : "새로운 작업 요청"}</h2>
        </div>
        <Pill>{saved?.remoteIssue ? "GitHub 등록됨" : "초안"}</Pill>
      </div>
      <label className="field">
        요청 제목
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder="이번 주에 맡기고 싶은 일"
        />
      </label>
      <label className="field">
        어떤 작업을 맡길까요?
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          maxLength={20000}
          placeholder="원하는 변경, 기대 결과, 확인할 내용을 구체적으로 적어주세요."
          className="request-prompt"
        />
      </label>
      <div className="form">
        <div className="row between">
          <h3>참조 파일</h3>
          <Button
            disabled={busy || attachments.length >= 2}
            onClick={() =>
              void api<Attachment | null>("attachment.pick")
                .then((file) => {
                  if (file) setAttachments((list) => [...list, file]);
                })
                .catch((e) => setError(errorText(e)))
            }
          >
            ＋ 파일 첨부
          </Button>
        </div>
        <small>
          UTF-8 텍스트 · 최대 2개 · 파일당 24KB/6,000자. 선택한 저장소의 요청
          공개 범위를 따릅니다.
        </small>
        {attachments.map((file) => (
          <div className="row between" key={file.id}>
            <span>
              {file.name}
              <br />
              <small>
                {file.size} bytes · SHA-256 {file.sha256.slice(0, 8)}
              </small>
            </span>
            <Button
              aria-label={`${file.name} 첨부 제거`}
              onClick={() =>
                setAttachments((list) => list.filter((v) => v.id !== file.id))
              }
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      {(initial?.refs ?? refs).map((r) => (
        <div className="info" key={r.url}>
          참조 · {r.title}
          <br />
          <small>{r.url} · 외부 정보</small>
        </div>
      ))}
      <label className="field">
        연결할 저장소
        <select
          required
          value={repository}
          onChange={(e) => {
            setRepository(e.target.value);
            setBranches([]);
          }}
        >
          <option value="">설정에서 GitHub와 저장소를 연결하세요.</option>
          {state.settings.allowedRepos.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label className="field">
        기준 브랜치
        <input
          list="branches"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          required
          maxLength={180}
        />
        <datalist id="branches">
          {branches.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <div className="two">
        <label className="field">
          실행 방식
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          >
            <option value="manual">수동 실행</option>
            <option value="once">한 번 예약</option>
            <option value="daily">매일</option>
            <option value="weekly">요일 선택 매주</option>
          </select>
        </label>
        <label className="field">
          실행 시간
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </label>
      </div>
      {frequency === "once" && (
        <label className="field">
          실행 날짜
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      )}
      {frequency === "weekly" && (
        <fieldset className="weekdays">
          <legend>실행 요일</legend>
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={weekdays.includes(i)}
                onChange={(e) =>
                  setWeekdays(
                    e.target.checked
                      ? [...weekdays, i]
                      : weekdays.filter((v) => v !== i),
                  )
                }
              />
              {d}
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">
        IANA 시간대
        <input
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          required
        />
      </label>
      {["daily", "weekly"].includes(frequency) && (
        <div className="two">
          <label className="field">
            예약 종료일 (선택)
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <label className="field">
            실행 횟수 (선택)
            <input
              type="number"
              min="1"
              max="10000"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
        </div>
      )}
      <label className="field">
        작업 반영
        <select
          value={policy}
          onChange={(e) => setPolicy(e.target.value as typeof policy)}
        >
          <option value="pr">작업 브랜치 + Pull Request</option>
          <option value="artifacts">결과물만 생성</option>
        </select>
      </label>
      <fieldset className="weekdays">
        <legend>결과 형식</legend>
        {[
          ["text", "텍스트"],
          ["pdf", "PDF"],
          ["source", "소스 묶음"],
        ].map(([v, t]) => (
          <label key={v}>
            <input
              type="checkbox"
              checked={formats.includes(v as Request["formats"][number])}
              onChange={(e) =>
                setFormats(
                  e.target.checked
                    ? [...formats, v as Request["formats"][number]]
                    : formats.filter((f) => f !== v),
                )
              }
            />
            {t}
          </label>
        ))}
      </fieldset>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        예약 활성화 (해제하면 일시정지)
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
        />
        완료 알림 받기
      </label>
      <div className="info">
        <h3>ChatGPT 예약은 직접 연결하세요</h3>
        <p>
          GPT API 키 없이 사용합니다. 요청 등록 후 예약 프롬프트를 복사해 GitHub
          접근이 가능한 ChatGPT 작업에 붙여 넣고 예약을 설정하세요. 지금 실행은
          GitHub 대기열로 전달하며 외부 작업의 다음 확인을 기다립니다. 요청과
          첨부·결과는 선택한 저장소의 공개 범위에 따라 공유됩니다.
        </p>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        GitHub에 요청·첨부를 공유하고 외부 ChatGPT 작업에 전달하는 데
        동의합니다.
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions wrap">
        {saved?.remoteIssue && (
          <Button
            disabled={busy}
            onClick={() =>
              void api("request.copyPrompt", id)
                .then(() =>
                  feedback(
                    "예약 프롬프트를 복사했어요. ChatGPT에 붙여 넣으세요.",
                  ),
                )
                .catch((e) => setError(errorText(e)))
            }
          >
            예약 프롬프트 복사
          </Button>
        )}
        <Button disabled={busy} onClick={() => void save()}>
          초안 저장
        </Button>
        {saved?.remoteIssue && (
          <Button
            disabled={busy}
            onClick={() =>
              void api("run.enqueue", id)
                .then(() =>
                  feedback("실행을 요청했어요. 결과함에서 확인하세요."),
                )
                .catch((e) => setError(errorText(e)))
            }
          >
            지금 실행
          </Button>
        )}
        <button
          className="btn primary"
          type="submit"
          disabled={busy || !consent}
        >
          {busy
            ? "저장 중…"
            : saved?.remoteIssue
              ? "예약 변경 반영"
              : "GitHub에 등록"}
        </button>
      </div>
    </form>
  );
}
export function Results({
  state,
  selectedId,
  onSelected,
  feedback,
  again,
}: {
  state: AppState;
  selectedId?: string;
  onSelected: (id: string) => void;
  feedback: Feedback;
  again: (r: Request) => void;
}) {
  const [progress, setProgress] = useState<TransferProgress>();
  useEffect(() => window.orbit.onTransfer(setProgress), []);
  const [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const runs = [...state.runs]
      .reverse()
      .filter(
        (r) =>
          filter === "all" ||
          (filter === "unread" ? !r.readAt : r.status === filter),
      ),
    selected = state.runs.find((r) => r.id === selectedId) ?? runs[0];
  async function select(r: Run) {
    onSelected(r.id);
    if (!r.readAt)
      await api("run.read", r.id).catch((e) => feedback(errorText(e)));
  }
  async function sync() {
    setBusy(true);
    setError("");
    try {
      await api("sync");
      feedback("결과를 동기화했어요.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(artifactId?: string) {
    if (!selected) return;
    setProgress(undefined);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ cancelled?: boolean }>("download", {
        runId: selected.id,
        artifactId,
      });
      if (!result.cancelled) feedback("체크섬을 검증하고 파일을 저장했어요.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Head
        title="맡겨둔 일이, 완성되는 곳."
        sub="작업 진행과 결과 수신은 별도로 기록됩니다. PR 병합·앱 설치는 자동으로 수행하지 않습니다."
        action={
          <Button disabled={busy} onClick={() => void sync()}>
            {busy ? "처리 중…" : "지금 동기화"}
          </Button>
        }
      />
      {busy && progress && (
        <div className="transfer" role="status">
          <progress
            value={progress.total ? progress.received : undefined}
            max={progress.total ?? 1}
          />
          <span>
            {progress.stage === "downloading"
              ? "다운로드"
              : progress.stage === "verifying"
                ? "체크섬 검증"
                : "파일 저장"}{" "}
            · {progress.received.toLocaleString()} bytes
            {progress.total
              ? ` / ${progress.total.toLocaleString()} bytes`
              : ""}
          </span>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="result-layout">
        <section className="card inbox">
          <label className="field">
            결과 필터
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">전체</option>
              <option value="unread">읽지 않음</option>
              {Object.entries(statusLabels)
                .filter(([k]) => !["draft", "scheduled"].includes(k))
                .map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          {runs.map((r) => (
            <button
              key={r.id}
              className={`inbox-item ${selected?.id === r.id ? "selected" : ""}`}
              onClick={() => void select(r)}
            >
              <Pill
                tone={
                  r.status === "succeeded"
                    ? "green"
                    : terminal(r.status)
                      ? "purple"
                      : ""
                }
              >
                {statusLabels[r.status]}
              </Pill>
              <h3>
                {r.requestSnapshot.title}
                {!r.readAt ? " · 새 결과" : ""}
              </h3>
              <small>{dateText(r.updatedAt)}</small>
            </button>
          ))}
          {!runs.length && <Empty>아직 도착한 결과가 없어요.</Empty>}
          <small>
            자동 수신 간격 {state.settings.pollSeconds}초 · 오류 시 최대 15분
            backoff
          </small>
        </section>
        {selected ? (
          <section className="card detail">
            <div className="row between wrap">
              <Pill tone={selected.status === "succeeded" ? "green" : "purple"}>
                {statusLabels[selected.status]}
              </Pill>
              {!selected.readAt && (
                <Button onClick={() => void select(selected)}>읽음 표시</Button>
              )}
              <small>실행 {selected.id.slice(0, 8)}</small>
            </div>
            <h2>{selected.requestSnapshot.title}</h2>
            <p className="summary-text">{selected.summary}</p>
            <small>
              생성 {dateText(selected.createdAt)} · 대기 포함{" "}
              {Math.max(
                0,
                Math.round(
                  (Date.parse(selected.updatedAt) -
                    Date.parse(selected.createdAt)) /
                    1000,
                ),
              )}
              초
              <br />
              수신{" "}
              {selected.receivedAt
                ? dateText(selected.receivedAt)
                : "실행기 결과 대기"}
              <br />
              예정 {dateText(selected.scheduledFor)}
            </small>
            <div className="row wrap">
              {selected.steps.map((s, i) => (
                <Pill key={`${s.status}:${i}`}>
                  {statusLabels[s.status]} ·{" "}
                  {new Date(s.at).toLocaleTimeString("ko-KR")}
                </Pill>
              ))}
            </div>
            {selected.errorCode && (
              <div className="info">
                <h3>{selected.errorCode}</h3>인증·실행기 설정·검증 결과를
                확인하세요. 원격 작업이 이미 완료되었을 수 있으므로 동기화 후 새
                실행을 요청하세요.
              </div>
            )}
            <h3>검증 결과</h3>
            {selected.checks.length ? (
              <div className="check-list">
                {selected.checks.map((c, i) => (
                  <div key={i}>
                    <span>{c.passed ? "✓" : "✕"}</span>
                    <span>
                      {c.name}
                      <br />
                      <small>{c.detail}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <small>아직 검증 결과가 없습니다.</small>
            )}
            {selected.prUrl && (
              <div className="pr">
                <Icon name="github" />
                <div>
                  <b>Pull Request #{selected.prNumber}</b>
                  <br />
                  <small>
                    {selected.requestSnapshot.repository} · 검토 대기
                  </small>
                </div>
                <Button onClick={() => void api("open", selected.prUrl)}>
                  변경 보기 ↗
                </Button>
              </div>
            )}
            {selected.baseSHA && (
              <small>
                기준 {selected.baseSHA}
                <br />
                출력 {selected.outputSHA ?? "없음"}
                <br />
                작업 브랜치 {selected.branch ?? "없음"}
              </small>
            )}
            {selected.changedFiles.length > 0 && (
              <details>
                <summary>변경 파일 {selected.changedFiles.length}개</summary>
                <ul>
                  {selected.changedFiles.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </details>
            )}
            <h3>도착한 결과물</h3>
            <div className="files">
              {selected.artifacts.map((a) => (
                <div className="file-card" key={a.id}>
                  <Pill>{a.format.toUpperCase()}</Pill>
                  <div>
                    <b>{a.name}</b>
                    <br />
                    <small>
                      {a.size.toLocaleString()} bytes · SHA-256{" "}
                      {a.sha256.slice(0, 8)}
                      <br />
                      {a.expiresAt
                        ? `만료 ${dateText(a.expiresAt)}`
                        : "만료 시각 미수신"}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    aria-label={`${a.name} 다운로드`}
                    onClick={() => void download(a.id)}
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
            {!selected.artifacts.length && (
              <small>게시된 산출물이 없습니다.</small>
            )}
            {selected.usage && (
              <small>
                토큰 · 입력 {selected.usage.inputTokens} / 출력{" "}
                {selected.usage.outputTokens}
              </small>
            )}
            <div className="row between wrap">
              <Button onClick={() => again(selected.requestSnapshot)}>
                다시 요청
              </Button>
              {selected.errorCode === "DELIVERY_FAILED" && (
                <Button
                  onClick={() =>
                    void api("run.retryDelivery", selected.id)
                      .then(() => feedback("같은 실행 ID로 전송을 복구했어요."))
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  전송 복구
                </Button>
              )}
              {!terminal(selected.status) && (
                <Button
                  onClick={() =>
                    void api("run.cancel", selected.id)
                      .then(() =>
                        feedback("취소를 요청했어요. 원격 상태를 확인합니다."),
                      )
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  실행 취소
                </Button>
              )}
              <Button
                primary
                disabled={busy || !selected.artifacts.length}
                onClick={() => void download()}
              >
                {busy ? "다운로드·검증 중…" : "모두 다운로드"}
              </Button>
            </div>
          </section>
        ) : (
          <section className="card">
            <Empty>
              결과를 선택하면 실제 실행 단계·검증·PR·산출물을 볼 수 있어요.
            </Empty>
          </section>
        )}
      </div>
    </>
  );
}
