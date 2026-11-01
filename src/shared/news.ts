import { isNewer, parseVersion } from "./update-logic";

/** One message from the OpenRoll team, as written in news/feed.json. */
export interface NewsItem {
  id: string;
  /** ISO date, shown as written. */
  date: string;
  title: string;
  /** Plain text with a small markdown subset: paragraphs, "- " lists, **bold**, [links](https://…). */
  body: string;
  /**
   * How loudly it arrives. quiet: only behind the bell. toast: also slides in at the top right
   * for a few seconds. popup: a centred card, once, for launches and big news.
   */
  level: NewsLevel;
  /** Up to two buttons. Only https links are kept. The first is the main one. */
  buttons?: { label: string; url: string }[];
  /** A picture for toasts and popups. The app downloads it; `url` becomes a data URL before it reaches the page. */
  image?: { url: string; alt: string; aspect?: number };
  /** Show only on these platforms: "darwin", "win32", "linux". */
  platforms?: string[];
  /** Show only to versions in this range, inclusive. */
  minVersion?: string;
  maxVersion?: string;
  /** Stop showing after this ISO date. */
  expires?: string;
  /** Set by the app for release notes, never read from the feed. */
  kind?: "news" | "release";
}

export type NewsLevel = "quiet" | "toast" | "popup";
const LEVELS: NewsLevel[] = ["quiet", "toast", "popup"];

export interface NewsContext {
  version: string;
  platform: string;
  now: number;
}

const MAX_ITEMS = 50;

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export interface ParseOptions {
  /** Test feeds served from this machine may use plain http on localhost. */
  allowLocalhost?: boolean;
}

/** The feed is fetched from the internet, so every field is checked and anything odd is dropped. */
export function parseFeed(raw: unknown, opts: ParseOptions = {}): NewsItem[] {
  const safe = (url: string) => /^https:\/\//.test(url) || (!!opts.allowLocalhost && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url));
  const items = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: NewsItem[] = [];
  for (const entry of items.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = text(e.id, 80);
    const title = text(e.title, 120);
    const date = text(e.date, 30);
    if (!id || !/^[\w.-]+$/.test(id) || !title || !date || Number.isNaN(Date.parse(date))) continue;
    const level = LEVELS.includes(e.level as NewsLevel) ? (e.level as NewsLevel) : "quiet";
    const item: NewsItem = { id, title, date, body: text(e.body, 4000) ?? "", kind: "news", level };
    // "link" was the first shape of this field; still accepted as a single button.
    const rawButtons = Array.isArray(e.buttons) ? e.buttons : e.link ? [e.link] : [];
    const buttons = rawButtons
      .map(b => {
        const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        const label = text(r.label, 40), url = text(r.url, 500);
        return label && url && safe(url) ? { label, url } : null;
      })
      .filter((b): b is { label: string; url: string } => !!b)
      .slice(0, 2);
    if (buttons.length) item.buttons = buttons;
    const img = e.image as Record<string, unknown> | undefined;
    const imgUrl = text(img?.url, 500);
    if (imgUrl && safe(imgUrl)) {
      const aspect = typeof img?.aspect === "number" && img.aspect > 0.2 && img.aspect < 5 ? img.aspect : undefined;
      item.image = { url: imgUrl, alt: text(img?.alt, 200) ?? "", aspect };
    }
    if (Array.isArray(e.platforms)) item.platforms = e.platforms.filter((p): p is string => typeof p === "string");
    if (typeof e.minVersion === "string" && parseVersion(e.minVersion)) item.minVersion = e.minVersion;
    if (typeof e.maxVersion === "string" && parseVersion(e.maxVersion)) item.maxVersion = e.maxVersion;
    if (typeof e.expires === "string" && !Number.isNaN(Date.parse(e.expires))) item.expires = e.expires;
    out.push(item);
  }
  return out;
}

export function appliesTo(item: NewsItem, ctx: NewsContext): boolean {
  if (item.platforms?.length && !item.platforms.includes(ctx.platform)) return false;
  if (item.minVersion && isNewer(item.minVersion, ctx.version)) return false;
  if (item.maxVersion && isNewer(ctx.version, item.maxVersion)) return false;
  if (item.expires && Date.parse(item.expires) < ctx.now) return false;
  return true;
}

export function newestFirst(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/** Inline pieces of one line of the markdown subset. */
export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "link"; text: string; url: string };
export type Block = { kind: "p"; parts: Inline[] } | { kind: "list"; items: Inline[][] } | { kind: "heading"; parts: Inline[] };

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ kind: "text", text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "link", text: m[2], url: m[3] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

/** Release notes and news bodies: enough markdown for notes, never raw HTML. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", parts: parseInline(para.join(" ")) });
    if (list.length) blocks.push({ kind: "list", items: list });
    para = [];
    list = [];
  };
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", parts: parseInline(heading[1]) });
    } else if (bullet) {
      if (para.length) flush();
      list.push(parseInline(bullet[1]));
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}
