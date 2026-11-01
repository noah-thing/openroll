import { useEffect, useRef, useState } from "react";
import { ISSUES_NEW_URL } from "../../shared/links";
import { Icon } from "./kit/Icon";

const CODECS: { name: string; string: string }[] = [
  { name: "H.264", string: "avc1.640028" },
  { name: "HEVC", string: "hvc1.1.6.L120.B0" },
  { name: "VP9", string: "vp09.00.40.08" },
  { name: "AV1", string: "av01.0.08M.08" },
];

async function codecSupport(): Promise<string> {
  const lines: string[] = [];
  for (const kind of ["decode", "encode"] as const) {
    const parts: string[] = [];
    for (const c of CODECS) {
      const config = { codec: c.string, codedWidth: 1920, codedHeight: 1080, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 };
      const probe = async (hardwareAcceleration: HardwareAcceleration) => {
        try {
          const r = kind === "decode" ? await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration }) : await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration });
          return !!r.supported;
        } catch {
          return false;
        }
      };
      const hw = await probe("prefer-hardware");
      const any = hw || (await probe("no-preference"));
      parts.push(`${c.name} ${hw ? "hardware" : any ? "software" : "no"}`);
    }
    lines.push(`Video ${kind}: ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

async function systemSummary(): Promise<string> {
  const info = await window.openroll.systemInfo();
  return [
    `OpenRoll ${info.app}`,
    `Electron ${info.electron}, Chrome ${info.chrome}`,
    `${info.os} (${info.arch})`,
    info.gpu.length ? `Graphics: ${info.gpu.join("; ")}` : "Graphics: not reported",
    await codecSupport(),
  ].join("\n");
}

/** Everything that goes in a report. Nothing leaves the computer until the person opens the issue page themselves. */
export function ReportDialog({ onClose }: { onClose(): void }) {
  const [text, setText] = useState("");
  const [withSystem, setWithSystem] = useState(true);
  const [system, setSystem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    void systemSummary().then(setSystem);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const details = [text.trim() || "(no description)", withSystem && system ? `\n---\n${system}` : ""].join("\n");

  async function copy() {
    await navigator.clipboard.writeText(details);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openIssue() {
    const title = text.trim().split("\n")[0].slice(0, 70) || "Problem report";
    // Long URLs get refused by GitHub; the full text is still on the clipboard through Copy details.
    const body = details.length > 4500 ? details.slice(0, 4500) + "\n(cut short)" : details;
    const url = `${ISSUES_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-label="Report a problem">
        <header className="modal-head">
          <h2>Report a problem</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <label className="report-field">
            <span>What happened?</span>
            <textarea ref={area} value={text} onChange={e => setText(e.target.value)} rows={6} placeholder="What you did, what you expected, what you saw instead." />
          </label>
          <label className="report-check">
            <input type="checkbox" checked={withSystem} onChange={e => setWithSystem(e.target.checked)} />
            <span>Include system details</span>
          </label>
          {withSystem && <pre className="report-system">{system ?? "Collecting…"}</pre>}
          <p className="insp-note">Nothing is sent from here. Opening the issue page shows you the full text first, and you decide whether to post it.</p>
          <div className="modal-actions">
            <button className="textbtn" onClick={copy}>
              {copied ? "Copied" : "Copy details"}
            </button>
            <button className="export" onClick={openIssue}>
              Open issue page
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
