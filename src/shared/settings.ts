import type { ProxyMode } from "../engine/proxy-policy";

export type PreviewQuality = "auto" | "full" | "half" | "quarter";

export interface Settings {
  previewQuality: PreviewQuality;
  hardwareDecoding: boolean;
  /** Small stand ins for heavy video, used only while editing. Exports always read the originals. */
  proxyMode: ProxyMode;
  /** Null means the default folder inside Videos. */
  projectsDir: string | null;
  autoUpdate: boolean;
  /** Fetch messages from the OpenRoll team for the inbox. */
  news: boolean;
  /** Let AI tools on this computer (Claude Code, Codex, Cursor) edit through the control socket. */
  aiControl: boolean;
  reduceMotion: boolean;
  /** Ask whether to add captions when a clip with speech arrives. */
  offerCaptions: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  previewQuality: "auto",
  hardwareDecoding: true,
  proxyMode: "auto",
  projectsDir: null,
  autoUpdate: true,
  news: true,
  aiControl: true,
  reduceMotion: false,
  offerCaptions: true,
};

const PROXY_MODES: ProxyMode[] = ["off", "auto", "always"];
const QUALITIES: PreviewQuality[] = ["auto", "full", "half", "quarter"];

/** Fraction of project resolution the preview draws at. Auto fits the screen instead. */
export const QUALITY_SCALE: Record<Exclude<PreviewQuality, "auto">, number> = { full: 1, half: 0.5, quarter: 0.25 };

/** Settings come from a file the user can edit, so anything unexpected falls back to the default. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    previewQuality: QUALITIES.includes(r.previewQuality as PreviewQuality) ? (r.previewQuality as PreviewQuality) : d.previewQuality,
    hardwareDecoding: typeof r.hardwareDecoding === "boolean" ? r.hardwareDecoding : d.hardwareDecoding,
    proxyMode: PROXY_MODES.includes(r.proxyMode as ProxyMode) ? (r.proxyMode as ProxyMode) : d.proxyMode,
    projectsDir: typeof r.projectsDir === "string" && r.projectsDir.length ? r.projectsDir : null,
    autoUpdate: typeof r.autoUpdate === "boolean" ? r.autoUpdate : d.autoUpdate,
    news: typeof r.news === "boolean" ? r.news : d.news,
    aiControl: typeof r.aiControl === "boolean" ? r.aiControl : d.aiControl,
    reduceMotion: typeof r.reduceMotion === "boolean" ? r.reduceMotion : d.reduceMotion,
    offerCaptions: typeof r.offerCaptions === "boolean" ? r.offerCaptions : d.offerCaptions,
  };
}
