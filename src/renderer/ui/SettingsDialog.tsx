import { useEffect, useState } from "react";
import type { CacheInfo } from "../../shared/api";
import type { PreviewQuality } from "../../shared/settings";
import { bytes } from "../lib/format";
import { updateSettings, useSettings } from "../state/settings";
import type { ProxyMode } from "../../engine/proxy-policy";
import { Segmented } from "./kit/Field";
import { Icon } from "./kit/Icon";

const QUALITIES: { value: PreviewQuality; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "half", label: "Half" },
  { value: "quarter", label: "Quarter" },
];

const PROXIES: { value: ProxyMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "always", label: "Always" },
];

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const s = useSettings();
  const [cache, setCache] = useState<CacheInfo | null>(null);
  const [projectsDir, setProjectsDir] = useState("");
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void window.openroll.cacheInfo().then(setCache);
  }, []);
  useEffect(() => {
    void window.openroll.projects.dir().then(setProjectsDir);
  }, [s.projectsDir]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function clear() {
    setClearing(true);
    await window.openroll.clearCache();
    setCache(await window.openroll.cacheInfo());
    setClearing(false);
  }

  async function pickFolder() {
    const dir = await window.openroll.settings.pickProjectsDir();
    if (dir) updateSettings({ projectsDir: dir });
  }

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-label="Settings">
        <header className="modal-head">
          <h2>Settings</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body settings">
          <section>
            <h3>Playback</h3>
            <div className="set-row">
              <div>
                <b>Preview quality</b>
                <small>Lower quality plays smoother on slower computers. Exports are never affected.</small>
              </div>
              <Segmented<PreviewQuality> options={QUALITIES} value={s.previewQuality} onChange={previewQuality => updateSettings({ previewQuality })} />
            </div>
            <div className="set-row">
              <div>
                <b>Proxies</b>
                <small>Small stand ins for heavy video, made in the background while you edit. Auto only does it for long GOP footage above 1080p and anything that plays choppily. Exports always use the originals.</small>
              </div>
              <Segmented<ProxyMode> options={PROXIES} value={s.proxyMode} onChange={proxyMode => updateSettings({ proxyMode })} />
            </div>
            <div className="set-row">
              <div>
                <b>Hardware decoding</b>
                <small>Uses the graphics card to read video. Turn it off if clips show glitches or the preview stops.</small>
              </div>
              <Switch label="Hardware decoding" value={s.hardwareDecoding} onChange={hardwareDecoding => updateSettings({ hardwareDecoding })} />
            </div>
          </section>

          <section>
            <h3>Storage</h3>
            <div className="set-row">
              <div>
                <b>Projects folder</b>
                <small className="set-path">{projectsDir}</small>
                <small>Projects already saved stay where they are.</small>
              </div>
              <div className="set-actions">
                <button className="textbtn" onClick={pickFolder}>
                  Change…
                </button>
                {s.projectsDir && (
                  <button className="textbtn" onClick={() => updateSettings({ projectsDir: null })}>
                    Use default
                  </button>
                )}
              </div>
            </div>
            <div className="set-row">
              <div>
                <b>Cache</b>
                <small className="set-path">{cache?.dir ?? ""}</small>
                <small>{cache ? `${bytes(cache.bytes)} used. Rebuilt when needed.` : "Measuring…"}</small>
              </div>
              <div className="set-actions">
                {cache && (
                  <button className="textbtn" onClick={() => void window.openroll.revealInFolder(cache.dir)}>
                    Show
                  </button>
                )}
                <button className="textbtn" disabled={clearing || !cache?.bytes} onClick={clear}>
                  Clear cache
                </button>
              </div>
            </div>
          </section>

          <section>
            <h3>General</h3>
            <div className="set-row">
              <div>
                <b>Install updates automatically</b>
                <small>New versions download in the background and install when you quit. When off, you get a message and choose when to install.</small>
              </div>
              <Switch label="Install updates automatically" value={s.autoUpdate} onChange={autoUpdate => updateSettings({ autoUpdate })} />
            </div>
            <div className="set-row">
              <div>
                <b>Messages from the OpenRoll team</b>
                <small>News and tips in the bell. The app reads one public file a few times a day and sends nothing about you.</small>
              </div>
              <Switch label="Messages from the OpenRoll team" value={s.news} onChange={news => updateSettings({ news })} />
            </div>
            <div className="set-row">
              <div>
                <b>Reduce motion</b>
                <small>Turns off interface animations.</small>
              </div>
              <Switch label="Reduce motion" value={s.reduceMotion} onChange={reduceMotion => updateSettings({ reduceMotion })} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Switch({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return <button role="switch" aria-label={label} aria-checked={value} className={"switch" + (value ? " on" : "")} onClick={() => onChange(!value)} />;
}
