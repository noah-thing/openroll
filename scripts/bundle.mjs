import { build, context } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "warning",
};

const targets = [
  { ...shared, entryPoints: ["src/main/main.ts"], outfile: "out/main/main.js", format: "esm" },
  // Sandboxed preloads must be CommonJS.
  { ...shared, entryPoints: ["src/preload/preload.ts"], outfile: "out/preload/preload.cjs", format: "cjs" },
];

export async function bundleMain({ watch = false, onRebuild } = {}) {
  if (!watch) {
    await Promise.all(targets.map(t => build(t)));
    return;
  }
  const plugin = { name: "rebuilt", setup: b => b.onEnd(r => !r.errors.length && onRebuild?.()) };
  const contexts = await Promise.all(targets.map(t => context({ ...t, plugins: [plugin] })));
  await Promise.all(contexts.map(c => c.watch()));
}
