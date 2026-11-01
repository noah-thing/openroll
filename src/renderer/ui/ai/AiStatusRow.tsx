import type { AiStatus } from "../../state/ai";
import { Icon } from "../kit/Icon";
import "../../styles/ai.css";

/** One line of state under an AI toggle: waiting, working with a bar and a stop button, done, or stuck. */
export function AiStatusRow({ status, onStop, onRetry }: { status: AiStatus; onStop?(): void; onRetry?(): void }) {
  if (status.state === "idle") return null;
  if (status.state === "error") {
    return (
      <div className="ai-row ai-bad" role="status">
        <span className="ai-text">{status.message ?? "Something went wrong."}</span>
        {onRetry && (
          <button className="reset" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }
  if (status.state === "ready") {
    return (
      <div className="ai-row ai-ok" role="status">
        <Icon name="check" size={13} />
        <span className="ai-text">Ready</span>
        {status.detail && <span className="ai-detail num">{status.detail}</span>}
      </div>
    );
  }
  const pct = Math.round(status.progress * 100);
  return (
    <div className="ai-busy" role="status" aria-live="polite">
      <div className="ai-row">
        <span className="ai-spin" aria-hidden />
        <span className="ai-text">Preparing</span>
        <span className="ai-detail">{status.label}</span>
        {status.state === "preparing" && <span className="ai-pct num">{pct}%</span>}
        {onStop && (
          <button className="reset" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      <div className="ai-bar">
        <span style={{ transform: `scaleX(${status.progress})` }} />
      </div>
    </div>
  );
}
