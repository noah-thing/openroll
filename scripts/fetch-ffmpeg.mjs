// Downloads the pinned ffmpeg and ffprobe builds into resources/ffmpeg/<os>-<arch>/,
// where electron-builder picks them up as extra resources and dev runs find them.
//
//   node scripts/fetch-ffmpeg.mjs              this machine
//   node scripts/fetch-ffmpeg.mjs --os mac     both mac architectures
//   node scripts/fetch-ffmpeg.mjs --all        every target
//   node scripts/fetch-ffmpeg.mjs --force      download again even if the stamp matches
//
// Every archive is checked against a sha256 pinned here, so a changed or tampered
// download stops the build. To move to a newer ffmpeg, change the urls and hashes together.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipCommand } from "./unzip-command.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "resources", "ffmpeg");

const RIEDL = "https://ffmpeg.martin-riedl.de/download";
const BTBN = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59";
const BTBN_WIN = "ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-shared-9.0";

// Both providers build FFmpeg 9.0.x with --enable-gpl and --enable-version3, which fits
// an app that is GPL-3.0-or-later. Source and licence details live in THIRD_PARTY_NOTICES.md.
const TARGETS = {
  "mac-arm64": {
    version: "9.0.2",
    archives: [
      { url: `${RIEDL}/macos/arm64/1789931890_9.0.2/ffmpeg.zip`, sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924", pick: ["ffmpeg"] },
      { url: `${RIEDL}/macos/arm64/1789931890_9.0.2/ffprobe.zip`, sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6", pick: ["ffprobe"] },
    ],
  },
  "mac-x64": {
    version: "9.0.2",
    archives: [
      { url: `${RIEDL}/macos/amd64/1789931006_9.0.2/ffmpeg.zip`, sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4", pick: ["ffmpeg"] },
      { url: `${RIEDL}/macos/amd64/1789931006_9.0.2/ffprobe.zip`, sha256: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd", pick: ["ffprobe"] },
    ],
  },
  "linux-x64": {
    version: "9.0.2",
    archives: [
      { url: `${RIEDL}/linux/amd64/1789931100_9.0.2/ffmpeg.zip`, sha256: "fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f", pick: ["ffmpeg"] },
      { url: `${RIEDL}/linux/amd64/1789931100_9.0.2/ffprobe.zip`, sha256: "3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32", pick: ["ffprobe"] },
    ],
  },
  "win-x64": {
    version: "9.0.2",
    archives: [
      {
        url: `${BTBN}/${BTBN_WIN}.zip`,
        sha256: "1d9823c35c7a7e2f54d1438cf61030d6efabe3278de01c191309d1e828bb74df",
        // A shared build: two small exes and the libraries they load. ffplay is left out.
        pick: [/\.dll$/, "ffmpeg.exe", "ffprobe.exe"],
        inside: `${BTBN_WIN}/bin`,
        extra: { [`${BTBN_WIN}/LICENSE.txt`]: "LICENSE.txt" },
      },
    ],
  },
};

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => args[args.indexOf(`--${name}`) + 1];

function hostKey() {
  const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform];
  return `${os}-${process.arch}`;
}

function wanted() {
  if (flag("all")) return Object.keys(TARGETS);
  if (flag("os")) return Object.keys(TARGETS).filter(k => k.startsWith(option("os") + "-"));
  if (flag("target")) return [option("target")];
  return [hostKey()];
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}. The pinned build may have been removed; see scripts/fetch-ffmpeg.mjs.`);
  const hash = createHash("sha256");
  const chunks = [];
  for await (const chunk of res.body) {
    hash.update(chunk);
    chunks.push(chunk);
  }
  writeFileSync(dest, Buffer.concat(chunks));
  return hash.digest("hex");
}

function unzip(archive, into) {
  // Windows 10 and later ship bsdtar, which reads zip; elsewhere unzip is everywhere.
  const { command, args } = unzipCommand(process.platform, process.env, archive, into);
  const r = spawnSync(command, args, { windowsHide: true });
  if (r.status !== 0) throw new Error(`could not unpack ${basename(archive)}: ${r.stderr?.toString() ?? r.error}`);
}

function find(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    } else if (e.name === name) return p;
  }
  return null;
}

async function fetchTarget(key) {
  const t = TARGETS[key];
  if (!t) throw new Error(`unknown target ${key}`);
  const out = join(outRoot, key);
  const stamp = join(out, ".stamp.json");
  const want = JSON.stringify(t.archives.map(a => a.sha256));
  if (!flag("force") && existsSync(stamp) && readFileSync(stamp, "utf8") === want) {
    console.log(`${key}: up to date`);
    return;
  }
  const work = mkdtempSync(join(tmpdir(), "openroll-ffmpeg-"));
  try {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const a of t.archives) {
      const file = join(work, basename(new URL(a.url).pathname));
      process.stdout.write(`${key}: ${basename(file)} `);
      const got = await download(a.url, file);
      if (got !== a.sha256) throw new Error(`\nchecksum mismatch for ${a.url}\n  expected ${a.sha256}\n  got      ${got}`);
      const dir = mkdtempSync(join(work, "x-"));
      unzip(file, dir);
      const base = a.inside ? join(dir, a.inside) : dir;
      for (const p of a.pick) {
        const names = p instanceof RegExp ? readdirSync(base).filter(n => p.test(n)) : [p];
        for (const n of names) {
          const src = a.inside ? join(base, n) : find(base, n);
          if (!src || !existsSync(src)) throw new Error(`${n} is not in ${basename(file)}`);
          copyFileSync(src, join(out, n));
          if (!n.endsWith(".dll")) chmodSync(join(out, n), 0o755);
        }
      }
      for (const [from, to] of Object.entries(a.extra ?? {})) copyFileSync(join(dir, from), join(out, to));
      console.log("ok");
    }
    writeFileSync(stamp, want);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

for (const key of wanted()) await fetchTarget(key);
