import { app, net } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NEWS_FEED } from "../shared/links";
import { appliesTo, newestFirst, parseFeed, type NewsItem } from "../shared/news";

const EVERY = 6 * 60 * 60 * 1000;
const MAX_IMAGE = 3 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/;

/**
 * Messages from the OpenRoll team. One plain GET of a public JSON file a few times a day:
 * no account, no id, nothing sent. The last good copy is kept so the inbox works offline.
 */
export class News {
  private items: NewsItem[] = [];
  private read = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  /** Downloaded pictures by their feed URL, as data URLs the page can show without going online. */
  private images = new Map<string, string>();

  constructor(
    private send: (items: NewsItem[]) => void,
    private enabled: () => boolean,
  ) {}

  private file(name: string): string {
    return join(app.getPath("userData"), name);
  }

  private get feed(): string {
    return process.env.OPENROLL_NEWS_FEED || NEWS_FEED;
  }

  private get parseOptions() {
    return { allowLocalhost: !!process.env.OPENROLL_NEWS_FEED };
  }

  async start(): Promise<void> {
    const [cached, read] = await Promise.all([
      readFile(this.file("news-cache.json"), "utf8").then(t => parseFeed(JSON.parse(t), this.parseOptions)).catch(() => []),
      readFile(this.file("news-read.json"), "utf8").then(t => JSON.parse(t) as unknown).catch(() => []),
    ]);
    this.items = this.visible(cached);
    await this.loadImages(this.items);
    if (Array.isArray(read)) for (const id of read) if (typeof id === "string") this.read.add(id);
    // A local test feed is read at once; the real one waits until startup work is done.
    setTimeout(() => void this.refresh(), process.env.OPENROLL_NEWS_FEED ? 500 : 15_000).unref();
    this.timer = setInterval(() => void this.refresh(), EVERY);
    this.timer.unref();
  }

  private visible(items: NewsItem[]): NewsItem[] {
    const ctx = { version: app.getVersion(), platform: process.platform, now: Date.now() };
    return newestFirst(items.filter(i => appliesTo(i, ctx)));
  }

  async refresh(): Promise<void> {
    if (!this.enabled()) return;
    try {
      const res = await net.fetch(this.feed, { headers: { "User-Agent": `OpenRoll/${app.getVersion()}` }, cache: "no-cache" });
      if (!res.ok) return;
      const raw = await res.json();
      const items = this.visible(parseFeed(raw, this.parseOptions));
      await this.loadImages(items);
      const tmp = this.file("news-cache.json.tmp");
      await writeFile(tmp, JSON.stringify({ items: parseFeed(raw, this.parseOptions) }));
      await rename(tmp, this.file("news-cache.json"));
      if (JSON.stringify(items) !== JSON.stringify(this.items)) {
        this.items = items;
        this.send(this.forPage(items));
      }
    } catch {
      // Offline or a bad file: keep what we had.
    }
  }

  list(): { items: NewsItem[]; read: string[] } {
    return { items: this.enabled() ? this.forPage(this.items) : [], read: [...this.read] };
  }

  /** The page only ever sees pictures we downloaded; one that failed is dropped, not linked. */
  private forPage(items: NewsItem[]): NewsItem[] {
    return items.map(i => {
      if (!i.image) return i;
      const data = this.images.get(i.image.url);
      return data ? { ...i, image: { ...i.image, url: data } } : { ...i, image: undefined };
    });
  }

  private async loadImages(items: NewsItem[]): Promise<void> {
    const dir = this.file("news-media");
    await mkdir(dir, { recursive: true }).catch(() => {});
    for (const item of items) {
      const url = item.image?.url;
      if (!url || this.images.has(url)) continue;
      const name = createHash("sha1").update(url).digest("hex");
      const cached = await readFile(join(dir, name), "utf8").catch(() => null);
      if (cached) {
        this.images.set(url, cached);
        continue;
      }
      try {
        const res = await net.fetch(url, { headers: { "User-Agent": `OpenRoll/${app.getVersion()}` } });
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!res.ok || !IMAGE_TYPES.test(type)) continue;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.byteLength > MAX_IMAGE) continue;
        const data = `data:${type};base64,${bytes.toString("base64")}`;
        this.images.set(url, data);
        await writeFile(join(dir, name), data).catch(() => {});
      } catch {
        // Try again on the next refresh.
      }
    }
  }

  async markRead(ids: unknown): Promise<void> {
    if (!Array.isArray(ids)) return;
    for (const id of ids) if (typeof id === "string" && id.length < 100) this.read.add(id);
    // Forget ids that no longer exist so the file stays small.
    const live = new Set(this.items.map(i => i.id));
    const keep = [...this.read].filter(id => live.has(id) || id.startsWith("release-"));
    await writeFile(this.file("news-read.json"), JSON.stringify(keep.slice(-200))).catch(() => {});
  }
}
