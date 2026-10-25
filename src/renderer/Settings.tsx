import { useEffect, useState } from "react";
import type { AppState, Settings } from "../domain/model";
import { api, Button, errorText, Head, Pill, type Feedback } from "./main";
export function SettingsPage({
  state,
  feedback,
  save,
}: {
  state: AppState;
  feedback: Feedback;
  save: (s: Settings) => Promise<void>;
}) {
  const [settings, setSettings] = useState(state.settings),
    [githubToken, setGithubToken] = useState(""),
    [alphaKey, setAlphaKey] = useState(""),
    [connection, setConnection] = useState<{
      github: boolean;
      alpha: boolean;
      error: string;
      login?: string;
      version: string;
    }>(),
    [repos, setRepos] = useState<
      { full_name: string; default_branch: string }[]
    >([]),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [help, setHelp] = useState(""),
    [diagnostics, setDiagnostics] = useState("");
  useEffect(() => {
    void api<typeof connection>("connection")
      .then(setConnection)
      .catch((e) => setError(errorText(e)));
  }, [state.settings.githubLogin, busy]);
  useEffect(() => {
    setSettings(state.settings);
  }, [JSON.stringify(state.settings)]);
  async function task(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (message) feedback(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function connect(provider: "github" | "alpha") {
    await api("connect", {
      provider,
      token: provider === "github" ? githubToken : alphaKey,
    });
    if (provider === "github") {
      setGithubToken("");
      const rows = await api<typeof repos>("repos", 1);
      setRepos(rows);
      setPage(1);
    } else setAlphaKey("");
  }
  async function loadRepos(more = false) {
    const next = more ? page + 1 : 1;
    const rows = await api<typeof repos>("repos", next);
    setRepos(more ? [...repos, ...rows] : rows);
    setPage(next);
    if (!rows.length) feedback("더 이상 저장소가 없어요.");
  }
  async function toggleRepo(repo: string, checked: boolean) {
    const allowed = checked
      ? [...settings.allowedRepos, repo]
      : settings.allowedRepos.filter((r) => r !== repo);
    const updated = {
      ...settings,
      githubLogin: state.settings.githubLogin,
      allowedRepos: allowed,
    };
    await save(updated);
    setSettings(updated);
  }
  return (
    <>
      <Head
        title="나에게 맞게, 편안하게."
        sub="연결과 실행 환경, 알림과 내 데이터를 관리하세요."
      />
      <div className="settings-grid">
        <section className="card form">
          <div className="row between">
            <h2>GitHub</h2>
            <Pill tone={connection?.github ? "green" : "gray"}>
              {connection?.github ? connection.login : "연결 필요"}
            </Pill>
          </div>
          <p className="muted">
            선택한 저장소만 허용하는 fine-grained personal access token을
            사용합니다. 토큰은 Windows DPAPI로 보호하며 화면에 다시 표시하지
            않습니다.
          </p>
          <small>
            최소 권한: Metadata 읽기, Contents 읽기, Issues 읽기/쓰기, Actions
            읽기/쓰기, Pull requests 읽기. 실행기의 PR 쓰기 권한은 별도
            GITHUB_TOKEN을 사용합니다.
          </small>
          <label className="field">
            GitHub 토큰
            <input
              type="password"
              autoComplete="off"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="선택한 저장소에만 권한을 부여하세요."
            />
          </label>
          <div className="row wrap">
            <Button
              primary
              disabled={busy || githubToken.length < 5}
              onClick={() =>
                void task(() => connect("github"), "GitHub를 연결했어요.")
              }
            >
              연결 / 토큰 교체
            </Button>
            <Button
              disabled={busy || !connection?.github}
              onClick={() =>
                void task(
                  () => api("disconnect", "github"),
                  "연결을 해제했어요.",
                )
              }
            >
              연결 해제
            </Button>
            <Button
              onClick={() =>
                void api(
                  "open",
                  "https://github.com/settings/personal-access-tokens/new",
                )
              }
            >
              공식 토큰 설정 ↗
            </Button>
          </div>
          {connection?.github && (
            <>
              <h3>이 앱에서 허용할 저장소</h3>
              <Button
                disabled={busy}
                onClick={() => void task(() => loadRepos())}
              >
                저장소 불러오기
              </Button>
              <div className="repo-list">
                {[
                  ...new Set([
                    ...settings.allowedRepos,
                    ...repos.map((r) => r.full_name),
                  ]),
                ].map((r) => (
                  <label className="checkbox" key={r}>
                    <input
                      type="checkbox"
                      checked={settings.allowedRepos.includes(r)}
                      onChange={(e) =>
                        void task(() => toggleRepo(r, e.target.checked))
                      }
                    />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
              {repos.length >= 100 && (
                <Button
                  disabled={busy}
                  onClick={() => void task(() => loadRepos(true))}
                >
                  저장소 더 불러오기
                </Button>
              )}
            </>
          )}
        </section>
        <section className="card form">
          <h2>AI 및 원격 실행기</h2>
          <Pill tone="purple">ChatGPT 자체 예약 직접 연동 · 미지원</Pill>
          <p>
            GitHub Actions + 공식 OpenAI API를 사용합니다. Orbit 앱에는 AI 운영
            키를 저장하지 않습니다. 저장소의 OPENAI_API_KEY secret과 실행 정책이
            필요합니다.
          </p>
          <ol>
            <li>대상 저장소에 orbit-worker.yml 워크플로를 추가하세요.</li>
            <li>
              GitHub Actions 변수 ORBIT_RUNTIME_REF에 검토한 Orbit 커밋 SHA를
              설정하세요.
            </li>
            <li>OPENAI_API_KEY secret과 .orbit/policy.json을 설정하세요.</li>
            <li>요청 작성에서 실행 경로·비용에 동의한 후 등록하세요.</li>
          </ol>
          <p className="muted">
            스케줄은 GitHub에서 약 5분마다 확인합니다. 앱 종료·PC 전원 꺼짐과
            별도로 실행됩니다. API 사용료와 Actions 사용량이 발생할 수 있으며
            조직 정책과 플랜에 따라 제한됩니다.
          </p>
          <Button
            onClick={() =>
              void api<string>("help.setup")
                .then(setHelp)
                .catch((e) => setError(errorText(e)))
            }
          >
            실행기 설치 안내
          </Button>
          {help && (
            <details open>
              <summary>실행기 설치 안내</summary>
              <pre className="setup-help">{help}</pre>
            </details>
          )}
          <Button
            onClick={() =>
              void api(
                "open",
                "https://developers.openai.com/api/docs/guides/function-calling",
              )
            }
          >
            공식 OpenAI API 문서 ↗
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void task(() => api("sync"), "수신 상태를 확인했어요.")
            }
          >
            연결 상태 확인
          </Button>
          {connection?.error && <p className="error">{connection.error}</p>}
        </section>
        <section className="card form">
          <div className="row between">
            <h2>마켓 워치</h2>
            <Pill tone={connection?.alpha ? "green" : "gray"}>
              {connection?.alpha ? "키 연결됨" : "설정 필요"}
            </Pill>
          </div>
          <p className="muted">
            Alpha Vantage의 일 마감 시세를 표시합니다. 실시간 시세로 표시하지
            않습니다. 조회 결과는 6시간 캐시합니다. 종목 조회는 시세와 통화
            확인에 2회 요청하며, 지수는 INDEX_DATA 이용 권한이 필요합니다. 개인
            이용 권한과 공급자 구독 조건을 확인하세요.
          </p>
          <label className="field">
            Alpha Vantage API 키
            <input
              type="password"
              autoComplete="off"
              value={alphaKey}
              onChange={(e) => setAlphaKey(e.target.value)}
            />
          </label>
          <div className="row wrap">
            <Button
              primary
              disabled={busy || alphaKey.length < 5}
              onClick={() =>
                void task(
                  () => connect("alpha"),
                  "시세 키를 안전하게 저장했어요.",
                )
              }
            >
              키 저장
            </Button>
            <Button
              disabled={busy || !connection?.alpha}
              onClick={() =>
                void task(
                  () => api("disconnect", "alpha"),
                  "시세 연결을 해제했어요.",
                )
              }
            >
              연결 해제
            </Button>
          </div>
          <Button
            onClick={() =>
              void api("open", "https://www.alphavantage.co/documentation/")
            }
          >
            공급자 설명 ↗
          </Button>
        </section>
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void task(
              () =>
                save({ ...settings, githubLogin: state.settings.githubLogin }),
              "환경 설정을 저장했어요.",
            );
          }}
        >
          <h2>표시 및 알림</h2>
          <label className="field">
            기본 IANA 시간대
            <input
              value={settings.timezone}
              onChange={(e) =>
                setSettings({ ...settings, timezone: e.target.value })
              }
              required
            />
          </label>
          <label className="field">
            한 주의 시작
            <select
              value={settings.weekStart}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  weekStart: e.target.value as Settings["weekStart"],
                })
              }
            >
              <option value="sunday">일요일</option>
              <option value="monday">월요일</option>
            </select>
          </label>
          <label className="field">
            글자 배율
            <select
              value={settings.fontScale}
              onChange={(e) =>
                setSettings({ ...settings, fontScale: Number(e.target.value) })
              }
            >
              {[0.85, 1, 1.25, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(e) =>
                setSettings({ ...settings, reduceMotion: e.target.checked })
              }
            />
            모션 줄이기 (시스템 설정도 적용)
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(e) =>
                setSettings({ ...settings, notifications: e.target.checked })
              }
            />
            앱 및 Windows 알림
          </label>
          <div className="two">
            <label className="field">
              조용한 시간 시작
              <input
                type="time"
                value={settings.quietStart}
                onChange={(e) =>
                  setSettings({ ...settings, quietStart: e.target.value })
                }
              />
            </label>
            <label className="field">
              조용한 시간 종료
              <input
                type="time"
                value={settings.quietEnd}
                onChange={(e) =>
                  setSettings({ ...settings, quietEnd: e.target.value })
                }
              />
            </label>
          </div>
          <label className="field">
            결과 조회 간격 (초)
            <input
              type="number"
              min="30"
              max="900"
              value={settings.pollSeconds}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  pollSeconds: Number(e.target.value),
                })
              }
            />
          </label>
          <small>
            Windows 알림이 보이지 않으면 시스템의 Orbit 알림 허용 설정을
            확인하세요. 로컬 일정 알림은 앱 실행 중 지원합니다.
          </small>
          <button className="btn primary" type="submit" disabled={busy}>
            설정 저장
          </button>
        </form>
        <section className="card form">
          <h2>데이터 관리</h2>
          <p className="muted">
            일정·보드·요청·결과·읽음 상태를 내보내고 복원할 수 있습니다.
            백업에는 비밀키가 포함되지 않습니다. 가져오기는 현재 데이터를
            교체하며 이전 상태는 로컬 백업에 남습니다.
          </p>
          <Button
            disabled={busy}
            onClick={() => void task(() => api("data.export"))}
          >
            JSON 백업 내보내기
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (window.confirm("현재 데이터를 백업 파일로 교체할까요?"))
                void task(() => api("data.import"), "데이터를 복원했어요.");
            }}
          >
            백업 가져오기
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "이 PC의 Orbit 데이터와 연결 키를 삭제할까요? GitHub의 원격 예약은 별도로 종료해야 합니다.",
                )
              )
                void task(
                  () => api("data.reset"),
                  "로컬 데이터를 초기화했어요.",
                );
            }}
          >
            로컬 데이터 초기화
          </Button>
        </section>
        <section className="card form">
          <h2>앱 정보 및 진단</h2>
          <p>Orbit {connection?.version ?? "0.1.0"} · Windows 11 x64</p>
          <small>
            현재 빌드는 서명되지 않았습니다. 자동 업데이트는 배포 인프라 설정
            전까지 비활성입니다. 새 설치 파일로 업데이트하거나 이전 설치 파일로
            되돌릴 수 있으며 사용자 데이터는 유지됩니다.
          </small>
          <Button
            onClick={() =>
              void task(async () =>
                setDiagnostics(
                  JSON.stringify(await api("diagnostics"), null, 2),
                ),
              )
            }
          >
            진단 정보 보기
          </Button>
          {diagnostics && <pre>{diagnostics}</pre>}
        </section>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
