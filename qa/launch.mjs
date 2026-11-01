// Launch the built app under Playwright for scripted checks.
// usage: node qa/launch.mjs <scenario.mjs> [--keep]
import { _electron as electron } from "playwright-core";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const scenario = process.argv[2];
const keep = process.argv.includes("--keep");
const userData = await mkdtemp(join(tmpdir(), "openroll-qa-"));
// QA_SEED: a folder copied into the fresh profile first, e.g. to fake the run before an update.
if (process.env.QA_SEED) await cp(process.env.QA_SEED, userData, { recursive: true });
const app = await electron.launch({
  args: [resolve("."), `--user-data-dir=${userData}`],
  env: { ...process.env, OPENROLL_QA: "1", OPENROLL_PROJECTS_DIR: join(userData, "projects") },
});
const page = await app.firstWindow();
page.on("console", m => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, m.text());
});
page.on("pageerror", e => console.log("[pageerror]", e.stack ?? e.message));
await page.waitForLoadState("domcontentloaded");
try {
  const run = (await import(resolve(scenario))).default;
  await run({ app, page, userData, shot: name => page.screenshot({ path: `qa/shots/${name}.png` }) });
} finally {
  if (!keep) await app.close();
}
