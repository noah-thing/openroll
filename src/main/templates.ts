import { app, dialog, net, type BrowserWindow } from "electron";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { isTemplateId, parseTemplate, serializeTemplate, TEMPLATE_EXT, TEMPLATE_LIMITS, sanitizeTemplate, type Template } from "../core/template";
import { parseIndex } from "../core/template-index";
import { safeFileName } from "../shared/paths";
import { TEMPLATES_BASE } from "../shared/links";
import type { CommunityState, SaveTemplateResult, TemplateImport } from "../shared/templates";
import { writeFileAtomic } from "./project-files";
import { readCapped } from "./read-capped";

const FETCH_AT_ONCE = 4;
/** One file of a slow connection should not hold the panel on its spinner. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * The person's template files, and the community list read from the repository. Every file
 * that comes in, from disk, a drop, a dialog or the internet, goes through the same strict
 * reader before anything is kept.
 */
export class Templates {
  private community: CommunityState = { templates: [], updated: null };
  private loaded = false;
  private refreshing: Promise<CommunityState> | null = null;

  constructor(
    private win: () => BrowserWindow | null,
    private online: () => boolean,
  ) {}

  private get dir(): string {
    return join(app.getPath("userData"), "templates");
  }

  private get base(): string {
    return process.env.OPENROLL_TEMPLATES_URL || TEMPLATES_BASE;
  }

  private path(id: string): string {
    if (!isTemplateId(id)) throw new Error("not a template id");
    return join(this.dir, `${id}.${TEMPLATE_EXT}`);
  }

  async list(): Promise<Template[]> {
    const out: Template[] = [];
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (extname(name) !== `.${TEMPLATE_EXT}` || name.startsWith(".")) continue;
      const t = await this.read(join(this.dir, name));
      if (t.ok) out.push(t.template);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async read(path: string): Promise<{ ok: true; template: Template } | { ok: false; error: string }> {
    const s = await stat(path).catch(() => null);
    if (!s?.isFile()) return { ok: false, error: "The file could not be read." };
    if (s.size > TEMPLATE_LIMITS.bytes) return { ok: false, error: "This template is too large to be a real one." };
    return parseTemplate(await readFile(path, "utf8"));
  }

  async save(raw: unknown): Promise<SaveTemplateResult> {
    const r = sanitizeTemplate(raw);
    if (!r.ok) return r;
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.path(r.template.id), serializeTemplate(r.template));
    return { ok: true, template: r.template };
  }

  async remove(id: unknown): Promise<void> {
    if (isTemplateId(id)) await rm(this.path(id), { force: true });
  }

  async pick(): Promise<TemplateImport> {
    const qa = process.env.OPENROLL_QA_OUT;
    // The QA harness has no one to click the dialog: it takes the newest template in its output folder.
    if (qa) {
      const files = (await readdir(qa).catch(() => [] as string[])).filter(f => f.endsWith(`.${TEMPLATE_EXT}`));
      const dated = await Promise.all(files.map(async f => ({ f, t: (await stat(join(qa, f))).mtimeMs })));
      const newest = dated.sort((a, b) => b.t - a.t)[0];
      return this.importPaths(newest ? [join(qa, newest.f)] : []);
    }
    const r = await dialog.showOpenDialog(this.win()!, {
      title: "Import templates",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "OpenRoll templates", extensions: [TEMPLATE_EXT] }],
    });
    return this.importPaths(r.canceled ? [] : r.filePaths);
  }

  async importPaths(paths: unknown): Promise<TemplateImport> {
    const result: TemplateImport = { added: [], duplicates: 0, problems: [] };
    if (!Array.isArray(paths)) return result;
    const have = await this.list();
    for (const path of paths.slice(0, 50)) {
      if (typeof path !== "string" || extname(path).toLowerCase() !== `.${TEMPLATE_EXT}`) continue;
      const name = basename(path);
      const read = await this.read(path);
      if (!read.ok) {
        result.problems.push(`${name}: ${read.error}`);
        continue;
      }
      let t = read.template;
      const same = have.find(h => h.id === t.id);
      if (same) {
        if (JSON.stringify(same) === JSON.stringify(t)) {
          result.duplicates++;
          continue;
        }
        // A different template under a taken id is kept beside the old one, never over it.
        t = { ...t, id: `${t.id.slice(0, 56)}-${Math.random().toString(36).slice(2, 6)}` };
      }
      const saved = await this.save(t);
      if (saved.ok) {
        result.added.push(saved.template);
        have.push(saved.template);
      } else result.problems.push(`${name}: ${saved.error}`);
    }
    return result;
  }

  async export(raw: unknown): Promise<string | null> {
    const r = sanitizeTemplate(raw);
    if (!r.ok) return null;
    const file = `${safeFileName(r.template.name, "Template")}.${TEMPLATE_EXT}`;
    const qa = process.env.OPENROLL_QA_OUT;
    let target: string | undefined;
    if (qa) target = join(qa, file);
    else {
      const pick = await dialog.showSaveDialog(this.win()!, {
        title: "Export template",
        defaultPath: join(app.getPath("documents"), file),
        filters: [{ name: "OpenRoll templates", extensions: [TEMPLATE_EXT] }],
      });
      target = pick.canceled ? undefined : pick.filePath;
    }
    if (!target) return null;
    if (extname(target).toLowerCase() !== `.${TEMPLATE_EXT}`) target += `.${TEMPLATE_EXT}`;
    await writeFileAtomic(target, serializeTemplate(r.template));
    return target;
  }

  private cacheFile(): string {
    return join(app.getPath("userData"), "templates-community.json");
  }

  async cached(): Promise<CommunityState> {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const doc = JSON.parse(await readFile(this.cacheFile(), "utf8")) as { updated?: unknown; templates?: unknown };
        const templates = (Array.isArray(doc.templates) ? doc.templates : []).flatMap(t => {
          const r = sanitizeTemplate(t);
          return r.ok ? [r.template] : [];
        });
        this.community = { templates, updated: typeof doc.updated === "number" ? doc.updated : null };
      } catch {
        /* nothing cached yet */
      }
    }
    return this.community;
  }

  /** One plain GET of a public index and the files it lists. Offline or a bad file leaves the last copy in place. */
  refresh(): Promise<CommunityState> {
    if (!this.online()) return this.cached();
    this.refreshing ??= this.fetchAll().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async fetchAll(): Promise<CommunityState> {
    const before = await this.cached();
    try {
      const get = async (name: string): Promise<unknown> => {
        // The files sit at fixed addresses, so a redirect means something is wrong.
        const res = await net.fetch(this.base + name, { headers: { "User-Agent": `OpenRoll/${app.getVersion()}` }, cache: "no-cache", redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`${res.status}`);
        return JSON.parse(await readCapped(res, TEMPLATE_LIMITS.bytes));
      };
      const entries = parseIndex(await get("index.json"));
      const templates: Template[] = [];
      for (let i = 0; i < entries.length; i += FETCH_AT_ONCE) {
        const batch = await Promise.all(
          entries.slice(i, i + FETCH_AT_ONCE).map(async e => {
            let raw: unknown;
            try {
              raw = await get(e.file);
            } catch {
              // The network failed, not the file: keep the copy from last time instead of dropping it.
              return before.templates.find(t => t.id === e.id && t.kind === e.kind) ?? null;
            }
            const r = sanitizeTemplate(raw);
            // The index describes the file; a file that is something else is not trusted under that description.
            return r.ok && r.template.id === e.id && r.template.kind === e.kind ? r.template : null;
          }),
        );
        templates.push(...batch.filter((t): t is Template => !!t));
      }
      this.community = { templates, updated: Date.now() };
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFileAtomic(this.cacheFile(), JSON.stringify(this.community));
      return this.community;
    } catch {
      return before;
    }
  }
}
