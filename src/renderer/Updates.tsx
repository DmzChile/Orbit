import { useEffect, useState } from "react";
import type { UpdateState } from "../domain/updates";
import { api, Button, errorText } from "./main";

export function UpdatePanel({ banner = false }: { banner?: boolean }) {
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const off = window.orbit?.onUpdate((value) => {
      if (active) setState(value);
    });
    void api<UpdateState>("updates.state")
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {});
    const online = () => {
      void api("updates.online").catch(() => {});
    };
    if (banner) window.addEventListener("online", online);
    return () => {
      active = false;
      off?.();
      window.removeEventListener("online", online);
    };
  }, [banner]);
  async function act(op: string) {
    setError("");
    try {
      setState(await api<UpdateState>(op));
    } catch (e) {
      setError(errorText(e));
    }
  }
  if (!state) return null;
  if (
    banner &&
    !(
      ["available", "downloading", "downloaded", "installing"].includes(
        state.status,
      ) ||
      (state.status === "error" && state.version)
    )
  )
    return null;
  const busy = ["checking", "downloading", "installing"].includes(state.status);
  const downloadable =
    state.status === "available" ||
    (state.status === "error" && state.retry === "download");
  return (
    <section
      className={banner ? "update-notice" : "update-panel"}
      aria-label="앱 업데이트"
    >
      <div className="update-copy">
        {!banner && <h3>앱 업데이트</h3>}
        <p role="status">{state.message}</p>
        {state.status === "downloading" && (
          <progress
            aria-label="업데이트 다운로드"
            max={100}
            value={state.percent ?? 0}
          />
        )}
        {state.status === "downloading" && (
          <small>{Math.floor(state.percent ?? 0)}%</small>
        )}
        {!banner && state.checkedAt && (
          <small>
            최근 확인 · {new Date(state.checkedAt).toLocaleString("ko-KR")}
          </small>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="update-actions">
        {downloadable && (
          <Button primary onClick={() => void act("updates.download")}>
            {state.retry === "download"
              ? "다운로드 다시 시도"
              : "업데이트 다운로드"}
          </Button>
        )}
        {state.status === "downloaded" && (
          <Button primary onClick={() => void act("updates.install")}>
            재시작 및 설치
          </Button>
        )}
        {!banner && (
          <Button
            disabled={
              busy ||
              state.status === "unsupported" ||
              state.status === "downloaded"
            }
            onClick={() => void act("updates.check")}
          >
            업데이트 확인
          </Button>
        )}
      </div>
    </section>
  );
}
