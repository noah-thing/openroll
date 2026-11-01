// End to end check of the macOS updater against a local fake release feed.
// Copies a packaged app, serves a "newer" copy of it as a release, lets the copy download, verify and
// apply it, and looks for a marker file that only the new bundle has.
// usage: node qa/update.mjs <path to a packaged OpenRoll.app>
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(process.argv[2]);
const work = await mkdtemp(join(tmpdir(), "openroll-upd-"));
const run = join(work, "run", "OpenRoll.app");
const next = join(work, "next", "OpenRoll.app");
for (const d of [run, next]) {
  execFileSync("/bin/mkdir", ["-p", join(d, "..")]);
  execFileSync("/usr/bin/ditto", [source, d]);
}
writeFileSync(join(next, "Contents", "UPDATED"), "yes");
const zipName = `OpenRoll-0.1.1-mac-${process.arch}.zip`;
const zip = join(work, zipName);
execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", next, zip]);
const zipBytes = readFileSync(zip);
const sums = `${createHash("sha256").update(zipBytes).digest("hex")}  ${zipName}\n`;

const badSums = process.argv.includes("--bad-checksum");
const server = createServer((req, res) => {
  if (req.url === "/latest") {
    const base = `http://127.0.0.1:${server.address().port}`;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      tag_name: "v0.1.1", html_url: `${base}/release`, draft: false, prerelease: false,
      assets: [
        { name: zipName, size: zipBytes.length, browser_download_url: `${base}/${zipName}` },
        { name: "SHA256SUMS.txt", size: sums.length, browser_download_url: `${base}/SHA256SUMS.txt` },
      ],
    }));
  } else if (req.url === `/${zipName}`) res.end(zipBytes);
  else if (req.url === "/SHA256SUMS.txt") res.end(badSums ? "0".repeat(64) + `  ${zipName}\n` : sums);
  else (res.statusCode = 404), res.end();
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const feed = `http://127.0.0.1:${server.address().port}/latest`;

const userData = join(work, "data");
const child = spawn(join(run, "Contents/MacOS/OpenRoll"), ["--remote-debugging-port=9334", `--user-data-dir=${userData}`], {
  env: { ...process.env, OPENROLL_UPDATE_FEED: feed },
  stdio: "ignore",
});
let ok = false;
try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9334").catch(() => null);
    if (!browser) await new Promise(r => setTimeout(r, 500));
  }
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector(".home");
  await page.evaluate(() => window.openroll.updates.check());
  const status = async () => (await page.evaluate(() => window.openroll.updates.state())).status;
  for (let i = 0; i < 60 && !["ready", "idle", "unreachable", "current"].includes(await status()); i++) await new Promise(r => setTimeout(r, 500));
  const final = await status();
  console.log("state after check:", final);
  if (badSums) {
    console.log(final !== "ready" ? "BAD CHECKSUM REJECTED" : "FAIL: bad checksum was accepted");
    ok = final !== "ready";
  } else {
    await page.screenshot({ path: "qa/shots/update-ready.png" });
    if (final !== "ready") throw new Error("update never became ready");
    await page.evaluate(() => window.openroll.updates.installNow()).catch(() => {});
    for (let i = 0; i < 40 && !existsSync(join(run, "Contents", "UPDATED")); i++) await new Promise(r => setTimeout(r, 500));
    ok = existsSync(join(run, "Contents", "UPDATED"));
    console.log(ok ? "BUNDLE SWAPPED" : "FAIL: bundle was not replaced");
  }
} finally {
  child.kill();
  // The helper relaunches the app after install; close that copy too.
  try { execFileSync("/usr/bin/pkill", ["-f", work]); } catch { /* nothing left */ }
  server.close();
  await new Promise(r => setTimeout(r, 500));
  await rm(work, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
