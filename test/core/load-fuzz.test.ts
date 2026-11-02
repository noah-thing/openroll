import { describe, expect, it } from "vitest";
import { readProject } from "../../src/core/load";
import { buildScene, frameNeeds } from "../../src/core/scene";
import { itemEnd, type Project } from "../../src/core/project";
import { STEPS, begin, check, grow, rng, type Rng } from "./model-gen";

const SEEDS = Number(process.env.SEEDS ?? 80);

const ODD: unknown[] = [null, "", "x", "😀".repeat(40), -1, 0, 0.5, 1e308, -1e308, 2 ** 53, 1e-9, true, [], {}, [null], { a: 1 }, "NaN", -0];

/** Picks a random node anywhere in the document and breaks it in one of a few ways. */
function mangle(doc: any, r: Rng): void {
  const nodes: { parent: any; key: string }[] = [];
  const walk = (v: any) => {
    if (!v || typeof v !== "object") return;
    for (const k of Object.keys(v)) {
      nodes.push({ parent: v, key: k });
      walk(v[k]);
    }
  };
  walk(doc);
  if (!nodes.length) return;
  const { parent, key } = r.pick(nodes);
  const how = r.int(0, 5);
  if (how === 0) delete parent[key];
  else if (how === 1 && Array.isArray(parent[key])) parent[key].reverse();
  else if (how === 2 && Array.isArray(parent[key]) && parent[key].length) parent[key].push(structuredClone(r.pick(parent[key])));
  else if (how === 3) {
    const src = r.pick(nodes);
    parent[key] = structuredClone(src.parent[src.key] ?? null);
  } else parent[key] = structuredClone(r.pick(ODD));
}

function blowUp(p: Project) {
  const end = Math.max(0, ...p.tracks.flatMap(t => t.items.map(itemEnd)));
  for (let k = 0; k <= 12; k++) frameNeeds(buildScene(p, Math.round((end * k) / 12)));
  buildScene(p, -1);
  buildScene(p, end + 5);
  JSON.parse(JSON.stringify(p));
}

describe("hostile project files", { timeout: 60_000 }, () => {
  it("are repaired or refused, and what loads can be drawn and edited without throwing", () => {
    const failures = new Map<string, string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed * 104729);
      const doc = JSON.parse(JSON.stringify(grow(seed, 18)));
      const hits = r.int(1, 6);
      for (let n = 0; n < hits; n++) mangle(doc, r);
      let text = JSON.stringify(doc);
      if (r.f() < 0.1) text = text.slice(0, r.int(0, text.length));
      try {
        const res = readProject(text);
        if (!res.ok) {
          expect(res.error.length).toBeGreaterThan(5);
          continue;
        }
        // The steps pick from the fixture media by name, which the damage may have removed.
        let p: Project = { ...res.project, media: { ...begin().media, ...res.project.media } };
        const problems = check(p).filter(b => !/source span|short item|^missing media|^freeze or image|^negative in/.test(b));
        if (problems.length) throw new Error(`loaded project breaks a rule: ${problems[0].replace(/[-\d.]+/g, "#")}`);
        blowUp(p);
        for (let n = 0; n < 8; n++) {
          const s = r.pick(STEPS);
          try {
            p = s.run(p, r);
          } catch (e) {
            throw new Error(`step ${s.name}: ${(e as Error).message}`);
          }
        }
        blowUp(p);
      } catch (e) {
        failures.set(String((e as Error).message).replace(/[-\d.]+/g, "#").slice(0, 160), `seed ${seed}`);
      }
    }
    expect([...failures].map(([k, v]) => `${k} (${v})`)).toEqual([]);
  });
});
