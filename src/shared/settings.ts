export type PreviewQuality = "auto" | "full" | "half" | "quarter";

export interface Settings {
  previewQuality: PreviewQuality;
  hardwareDecoding: boolean;
  /** Null means the default folder inside Videos. */
  projectsDir: string | null;
  autoUpdate: boolean;
  /** Fetch messages from the OpenRoll team for the inbox. */
  news: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  previewQuality: "auto",
  hardwareDecoding: true,
  projectsDir: null,
  autoUpdate: true,
  news: true,
  reduceMotion: false,
};

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
    projectsDir: typeof r.projectsDir === "string" && r.projectsDir.length ? r.projectsDir : null,
    autoUpdate: typeof r.autoUpdate === "boolean" ? r.autoUpdate : d.autoUpdate,
    news: typeof r.news === "boolean" ? r.news : d.news,
    reduceMotion: typeof r.reduceMotion === "boolean" ? r.reduceMotion : d.reduceMotion,
  };
}
