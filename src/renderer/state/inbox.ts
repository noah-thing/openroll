import type { NewsItem } from "../../shared/news";
import type { UpdateState, WhatsNew } from "../../shared/api";

type Listener = () => void;

export interface InboxEntry extends NewsItem {
  /** For entries the app makes itself: what the button does. */
  action?: "install" | "restart";
}

/**
 * Everything the bell shows: messages from the team, release notes for the version you are on,
 * and a pending update. Read state lives in the main process so it survives restarts.
 */
class Inbox {
  news: NewsItem[] = [];
  read = new Set<string>();
  update: UpdateState = { status: "idle" };
  whatsNew: WhatsNew | null = null;
  private listeners = new Set<Listener>();
  private started = false;
  version = 0;

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const api = window.openroll;
    void api.news.list().then(({ items, read }) => {
      this.news = items;
      for (const id of read) this.read.add(id);
      this.bump();
    });
    api.news.onChange(items => {
      this.news = items;
      this.bump();
    });
    void api.updates.state().then(s => this.setUpdate(s));
    api.updates.onState(s => this.setUpdate(s));
    void api.updates.whatsNew().then(w => {
      this.whatsNew = w;
      this.bump();
    });
  }

  private setUpdate(s: UpdateState): void {
    this.update = s;
    this.bump();
  }

  entries(): InboxEntry[] {
    const out: InboxEntry[] = [];
    const u = this.update;
    const today = new Date().toISOString().slice(0, 10);
    if ((u.status === "available" || u.status === "ready") && u.version) {
      out.push({
        id: `update-${u.status}-${u.version}`,
        kind: "release",
        date: today,
        level: "quiet",
        title: u.status === "ready" ? `OpenRoll ${u.version} is ready` : `OpenRoll ${u.version} is available`,
        body: u.notes || (u.status === "ready" ? "It installs when you restart." : ""),
        action: u.status === "ready" ? "restart" : "install",
      });
    }
    if (this.whatsNew) {
      out.push({
        id: `release-${this.whatsNew.version}`,
        kind: "release",
        date: today,
        level: "quiet",
        title: `What's new in ${this.whatsNew.version}`,
        body: this.whatsNew.notes || "This version has fixes and small improvements.",
      });
    }
    return [...out, ...this.news];
  }

  unread(): InboxEntry[] {
    return this.entries().filter(e => !this.read.has(e.id));
  }

  markRead(ids: string[]): void {
    const fresh = ids.filter(id => !this.read.has(id));
    if (!fresh.length) return;
    for (const id of fresh) this.read.add(id);
    void window.openroll.news.markRead(fresh);
    this.bump();
  }
}

export const inbox = new Inbox();
