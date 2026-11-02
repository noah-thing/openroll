import { describe, expect, it } from "vitest";
import { applyOps, OpError, type Op } from "../../src/core/agent/ops";
import { readProject } from "../../src/core/load";
import { History } from "../../src/core/history";
import { buildScene, frameNeeds } from "../../src/core/scene";
import { itemEnd, type Project } from "../../src/core/project";
import { S, begin, check, grow, rng, type Rng } from "./model-gen";

const SEEDS = Number(process.env.SEEDS ?? 60);

// Rules the loader does not promise, so they are not an op's fault either.
const IGNORED = /source span|short item|^freeze or image|^negative in/;

const SECONDS = (r: Rng): number => r.pick([0, 0, 1, 2.5, 10, 0.000001, 0.05, 0.1, 1e-7, 30, 59.999999, 172_800, 172_801, -1, -0.5, 1e9, r.f() * 12]);
const ODD: unknown[] = [null, "", "x", "$nope", -1, 0, 1e9, true, [], {}, "😀".repeat(20), "__proto__"];
const PROPS = ["x", "y", "scale", "rotation", "opacity", "volume", "speed", "fadeIn", "fadeOut", "reversed", "freeze", "blend", "adjust", "mask", "chroma", "crop", "curves", "hsl", "fill", "cutout", "stabilize", "enhance", "slowMotion", "motionBlur", "audio", "voiceFx", "muteAudio", "name", "color", "highlight", "text", "style", "animationIn", "animationOut"];
const PROP_VALUES = (r: Rng): unknown => r.pick([...ODD, 0.1, 100, 2, "burn", "blend", { exposure: 1 }, { shape: "rect", x: 0, y: 0, width: 1, height: 1, rotation: 0, feather: 0, invert: false }, { left: 0.1, top: 0, right: 0, bottom: 0 }, { kind: "fade" }, { size: "huge" }, { text: 4 }]);

function randomOp(p: Project, r: Rng, named: string[]): Op {
  const items = p.tracks.flatMap(t => t.items);
  const id = (): string => (named.length && r.f() < 0.3 ? "$" + r.pick(named) : items.length && r.f() < 0.98 ? r.pick(items).id : "ghost");
  const as = (): string | undefined => {
    if (r.f() < 0.6) return undefined;
    const n = r.pick(["a", "b", "c", "d", "e", "x_1", "bad name", ""]);
    named.push(n);
    return n;
  };
  const media = () => r.pick(["a", "b", "c", "img", "song", "nope", "/m/a"]);
  const track = () => r.pick([undefined, "main", "auto", p.tracks[r.int(0, p.tracks.length - 1)]?.id, "ghost"]);
  switch (r.int(0, 21)) {
    case 0: return { op: "add_clip", media: media(), at: r.f() < 0.5 ? undefined : SECONDS(r), track: track(), in: r.f() < 0.4 ? SECONDS(r) : undefined, duration: r.f() < 0.4 ? SECONDS(r) : undefined, as: as() };
    case 1: return { op: "add_text", text: r.pick(["hi", "", "😀👨‍👩‍👧".repeat(50), "x".repeat(5000)]), at: SECONDS(r), duration: r.f() < 0.5 ? SECONDS(r) : undefined, style: r.f() < 0.3 ? (r.pick(ODD) as object) : undefined, track: track(), as: as() };
    case 2: return { op: "add_color", color: r.pick(["#ff0000", "red", ""]), at: SECONDS(r), duration: SECONDS(r), track: track(), as: as() };
    case 3: return { op: "move", id: id(), at: SECONDS(r), track: track() };
    case 4: return { op: "trim", id: id(), in: r.f() < 0.5 ? SECONDS(r) : undefined, duration: r.f() < 0.7 ? SECONDS(r) : undefined };
    case 5: return { op: "split", at: SECONDS(r), ids: r.f() < 0.5 ? undefined : [id(), id()], as: as() };
    case 6: return { op: "split", at: items.length ? r.pick(items).start / S : 1, as: as() };
    case 7: return { op: "delete", ids: [id(), id()] };
    case 8: return { op: "remove_range", from: SECONDS(r), to: SECONDS(r) };
    case 9: return { op: "remove_range", from: 0, to: 172_800 };
    case 10: return { op: "set", id: id(), props: Object.fromEntries(Array.from({ length: r.int(1, 3) }, () => [r.pick(PROPS), PROP_VALUES(r)])) };
    case 11: return { op: "set", id: id(), props: { speed: r.pick([0.0001, 0.1, 0.5, 100, 1e9, 1e-9, 3]) } };
    case 12: return { op: "keyframe", id: id(), prop: r.pick(["transform.scale", "transform.x", "adjust.exposure", "__proto__", "fx:abc:amount", "a b"]), at: SECONDS(r), value: r.pick([0, 1, 1e308, -5]), ease: r.pick(["linear", "hold", "bogus" as never]) };
    case 13: return { op: "transition", id: id(), kind: r.pick(["dissolve", null, "wipe", "bogus"]), duration: r.f() < 0.5 ? SECONDS(r) : undefined };
    case 14: return { op: "filter", id: id(), filter: r.pick(["harbour", null, "bogus"]), amount: r.f() < 0.5 ? r.pick([0, 1, 5, -1]) : undefined };
    case 15: return { op: "effect", id: id(), kind: r.pick(["thump", "bogus", "blur", "glow"]), amount: r.pick([undefined, 0.4, 9]), speed: r.pick([undefined, 0, 3]), style: r.pick([undefined, 2]) };
    case 16: return { op: "marker", at: SECONDS(r), label: r.pick([undefined, "m", "😀"]) };
    case 17: return { op: "track", id: r.pick(p.tracks.map(t => t.id)), muted: r.pick([undefined, true, false]), hidden: r.pick([undefined, true]), name: r.pick([undefined, " ", "Cam", "😀"]) };
    case 18: return { op: "add_track", kind: r.pick(["video", "audio", "text", "bogus" as never]), name: r.pick([undefined, "T"]), as: as() };
    case 19: return { op: "project", width: r.pick([undefined, 16, 8192, 17, 5]), height: r.pick([undefined, 1080]), ratio: r.pick([undefined, "9:16", "7:3"]), fps: r.pick([undefined, 1, 240, 23.976, 0]), background: r.pick([undefined, "#00ff00", "green"]) };
    case 20: return { op: "add_shape", kind: r.pick(["rect", "ellipse", "line", "sticker"]), sticker: r.pick([undefined, "nope"]), at: SECONDS(r), duration: r.pick([undefined, 1]), scale: r.pick([undefined, 0, 4]), as: as() };
    default: return { op: "layout", id: id(), layout: r.pick(["pip", "split", "bogus"]) as never };
  }
}

function usable(p: Project): string[] {
  const bad = check(p).filter(b => !IGNORED.test(b));
  const end = Math.max(0, ...p.tracks.flatMap(t => t.items.map(itemEnd)));
  for (let k = 0; k <= 8; k++) frameNeeds(buildScene(p, Math.round((end * k) / 8)));
  const again = readProject(JSON.stringify(p));
  if (!again.ok) bad.push("project does not reload: " + again.error);
  else if (again.repairs.length) bad.push(`reload repairs: ${[...new Set(again.repairs)].join(", ")}`);
  return bad;
}

describe("batches of AI edit ops", { timeout: 60_000 }, () => {
  it("either fail cleanly or leave a project that is valid, reloads untouched and survives undo and redo", () => {
    const failures = new Map<string, string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed * 6007);
      const history = new History();
      let p = r.f() < 0.5 ? begin() : grow(seed, 12);
      const seen: Project[] = [structuredClone(p)];
      for (let batch = 0; batch < 6; batch++) {
        const named: string[] = [];
        const ops: Op[] = [];
        const count = r.pick([1, 1, 1, 2, 3, 8, 20, 200]);
        for (let n = 0; n < count; n++) ops.push(randomOp(p, r, named));
        const frozen = JSON.stringify(p);
        try {
          const out = applyOps(p, ops);
          if (JSON.stringify(p) !== frozen) failures.set("applyOps mutated its input", `seed ${seed}`);
          const bad = usable(out.project);
          for (const b of bad) failures.set(b.replace(/[-\d.]+/g, "#").slice(0, 140), `seed ${seed} batch ${batch} ops ${ops.map(o => o.op).join(",").slice(0, 120)}`);
          history.push(p, "ai");
          p = out.project;
          seen.push(structuredClone(p));
        } catch (e) {
          if (!(e instanceof OpError)) failures.set("threw " + (e as Error).message.slice(0, 100), `seed ${seed}`);
          else if (/Cannot read|is not a function|is not iterable/.test(e.message)) failures.set("leaky error: " + e.message.replace(/\d+/g, "#").slice(0, 120), `seed ${seed}`);
          if (JSON.stringify(p) !== frozen) failures.set("failed batch changed the project", `seed ${seed}`);
        }
      }
      let at = seen.length - 1;
      while (at > 0) {
        p = history.undo(p)!.project;
        expect(p).toEqual(seen[--at]);
      }
      for (let q = history.redo(p); q; q = history.redo(p)) p = q.project;
    }
    expect([...failures].map(([k, v]) => `${k} (${v})`)).toEqual([]);
  });
});
