// Launch the built app under Playwright for scripted checks.
// usage: node qa/launch.mjs <scenario.mjs> [--keep]
import { _electron as electron } from "playwright-core";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scenario = process.argv[2];
const keep = process.argv.includes("--keep");
const userData = await mkdtemp(join(tmpdir(), "openroll-qa-"));
// QA_SEED: a folder copied into the fresh profile first, e.g. to fake the run before an update.
if (process.env.QA_SEED) await cp(process.env.QA_SEED, userData, { recursive: true });
const app = await electron.launch({
  // CI Linux runners have no setuid sandbox helper.
  args: [resolve("."), `--user-data-dir=${userData}`, ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : []), ...(process.env.QA_NO_GPU ? ["--use-gl=angle", "--use-angle=swiftshader"] : []), ...(process.env.QA_NO_HW_DECODE ? ["--disable-accelerated-video-decode"] : []), ...(process.env.CI && process.platform === "win32" ? ["--disable-features=CalculateNativeWinOcclusion"] : [])],
  env: { ...process.env, OPENROLL_QA: "1", OPENROLL_PROJECTS_DIR: join(userData, "projects") },
});
const page = await app.firstWindow();
page.on("console", m => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, m.text());
});
page.on("pageerror", e => console.log("[pageerror]", e.stack ?? e.message));
await page.waitForLoadState("domcontentloaded");
try {
  const run = (await import(pathToFileURL(resolve(scenario)).href)).default;
  await run({ app, page, userData, shot: name => page.screenshot({ path: `qa/shots/${name}.png`, timeout: 10000 }).catch(() => console.log(`screenshot ${name} skipped: the window did not draw in time`)) });
} finally {
  if (!keep) await app.close();
}
