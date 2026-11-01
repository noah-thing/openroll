import { useEffect, useState } from "react";
import type { UpdateState } from "../../shared/api";

/** Update status in the corner. Quiet by default: only a finished download, or an answer to a check the person asked for. */
export function UpdateNotice() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    void window.openroll.updates.state().then(setState);
    return window.openroll.updates.onState(s => {
      setState(s);
      setHidden(null);
    });
  }, []);

  // Answers to a manual check fade on their own.
  useEffect(() => {
    if (state.status !== "current" && state.status !== "unreachable") return;
    const t = setTimeout(() => setState({ status: "idle" }), 4500);
    return () => clearTimeout(t);
  }, [state]);

  const key = `${state.status}:${state.version ?? ""}`;
  if (hidden === key) return null;

  let body: React.ReactNode = null;
  switch (state.status) {
    case "ready":
      body = (
        <>
          <span>Update ready, restart to finish{state.version ? ` (${state.version})` : ""}.</span>
          <button className="toast-undo" onClick={() => void window.openroll.updates.installNow()}>
            Restart
          </button>
          <button className="toast-undo quiet" onClick={() => setHidden(key)}>
            Later
          </button>
        </>
      );
      break;
    case "available":
      body = (
        <>
          <span>OpenRoll {state.version} is available.</span>
          <button className="toast-undo" onClick={() => void window.openroll.updates.download()}>
            Install
          </button>
          <button className="toast-undo quiet" onClick={() => setHidden(key)}>
            Later
          </button>
        </>
      );
      break;
    case "manual":
      body = (
        <>
          <span>OpenRoll {state.version} is available.</span>
          {state.pageUrl && (
            <button className="toast-undo" onClick={() => window.open(state.pageUrl, "_blank")}>
              Download
            </button>
          )}
          <button className="toast-undo quiet" onClick={() => setHidden(key)}>
            Later
          </button>
        </>
      );
      break;
    case "checking":
      body = <span>Checking for updates…</span>;
      break;
    case "downloading":
      if (!state.asked) return null;
      body = <span>Downloading OpenRoll {state.version}, {Math.round((state.progress ?? 0) * 100)}%</span>;
      break;
    case "current":
      body = <span>You have the latest version.</span>;
      break;
    case "unreachable":
      body = <span>Could not check for updates. Try again later.</span>;
      break;
    default:
      return null;
  }
  return (
    <div className="update-notice" role="status">
      {body}
    </div>
  );
}
