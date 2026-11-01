import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FOLD_MS, Journal, KEEP } from "../../src/main/journal";

let dir: string;
let journal: Journal;
const doc = (n: number) => JSON.stringify({ format: "openroll", id: "p1", n });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openroll-journal-"));
  journal = new Journal(join(dir, "history"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("Journal", () => {
  const meta = () => ({ path: join(dir, "a.openroll"), name: "a" });

  it("folds saves that come close together into one version", async () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) await journal.record(doc(i), meta(), { now: t + i * 1000 });
    const list = await journal.list(meta().path);
    expect(list).toHaveLength(1);
    expect(await journal.read(meta().path, list[0].file)).toBe(doc(9));
  });

  it("starts a new version after the fold window and keeps the last 20", async () => {
    for (let i = 0; i < 30; i++) await journal.record(doc(i), meta(), { now: 1_000_000 + i * (FOLD_MS + 1) });
    const list = await journal.list(meta().path);
    expect(list).toHaveLength(KEEP);
    expect(await journal.read(meta().path, list[0].file)).toBe(doc(29));
    expect(await journal.read(meta().path, list[KEEP - 1].file)).toBe(doc(10));
  });

  it("skips text that has not changed", async () => {
    await journal.record(doc(1), meta(), { now: 1 });
    await journal.record(doc(1), meta(), { now: FOLD_MS * 5, force: true });
    expect(await journal.list(meta().path)).toHaveLength(1);
  });

  it("ignores documents without a safe id", async () => {
    await journal.record(JSON.stringify({ id: "../escape" }), meta());
    await journal.record("not json", meta());
    expect(await journal.list(meta().path)).toHaveLength(0);
  });

  it("restores a version and keeps what it replaced", async () => {
    const path = meta().path;
    await journal.record(doc(1), meta(), { now: 1 });
    await writeFile(path, doc(2));
    const [v1] = await journal.list(path);
    expect(await journal.restore(path, v1.file)).toBe(true);
    expect(await readFile(path, "utf8")).toBe(doc(1));
    const texts = await Promise.all((await journal.list(path)).map(e => journal.read(path, e.file)));
    expect(texts).toContain(doc(2));
    expect(await readFile(path + ".bak", "utf8")).toBe(doc(2));
  });

  it("refuses file names that are not versions", async () => {
    await journal.record(doc(1), meta());
    expect(await journal.read(meta().path, "../meta.json")).toBeNull();
  });
});
