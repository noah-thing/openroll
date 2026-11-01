// Launch the built app under Playwright for scripted checks.
// usage: node qa/launch.mjs <scenario.mjs> [--keep]
import { _electron as electron } from "playwright-core";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const scenario = process.argv[2];
const keep = process.argv.includes("--keep");
const userData = await mkdtemp(join(tmpdir(), "openroll-qa-"));
const app = await electron.launch({
  args: [resolve("."), `--user-data-dir=${userData}`],
  env: { ...process.env, OPENROLL_QA: "1", OPENROLL_PROJECTS_DIR: join(userData, "projects") },
});
const page = await app.firstWindow();
page.on("console", m => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, m.text());
});
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.waitForLoadState("domcontentloaded");
try {
  const run = (await import(resolve(scenario))).default;
  await run({ app, page, shot: name => page.screenshot({ path: `qa/shots/${name}.png` }) });
} finally {
  if (!keep) await app.close();
}
