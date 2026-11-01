// Builds the placeholder icon set in build/: icon.png, icon.icns, icon.ico.
// Electron is only used to rasterise; the container formats are written by hand so this runs on any OS.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electron from "electron";

const out = "build";
const work = mkdtempSync(join(tmpdir(), "openroll-icon-"));
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const r = spawnSync(electron, ["scripts/icon-render.cjs", work, ...sizes], { stdio: "inherit" });
if (r.status) process.exit(r.status);

const png = s => readFileSync(join(work, `icon-${s}.png`));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "icon.png"), png(1024));

// icns is 'icns', total length, then (type, length, PNG) entries. Modern macOS reads PNG for all of them.
const icnsTypes = { 16: "icp4", 32: "icp5", 64: "icp6", 128: "ic07", 256: "ic08", 512: "ic09", 1024: "ic10" };
const parts = Object.entries(icnsTypes).map(([s, type]) => {
  const data = png(s);
  const head = Buffer.alloc(8);
  head.write(type, 0, "ascii");
  head.writeUInt32BE(8 + data.length, 4);
  return Buffer.concat([head, data]);
});
const body = Buffer.concat(parts);
const icnsHead = Buffer.alloc(8);
icnsHead.write("icns", 0, "ascii");
icnsHead.writeUInt32BE(8 + body.length, 4);
writeFileSync(join(out, "icon.icns"), Buffer.concat([icnsHead, body]));

// ico is a directory of PNG entries, which Windows has read since Vista.
const icoSizes = [16, 32, 48, 64, 128, 256];
const dir = Buffer.alloc(6 + icoSizes.length * 16);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(icoSizes.length, 4);
let offset = dir.length;
const images = icoSizes.map((s, i) => {
  const data = png(s);
  const e = 6 + i * 16;
  dir[e] = s === 256 ? 0 : s;
  dir[e + 1] = s === 256 ? 0 : s;
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(data.length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += data.length;
  return data;
});
writeFileSync(join(out, "icon.ico"), Buffer.concat([dir, ...images]));
rmSync(work, { recursive: true, force: true });
console.log("wrote build/icon.png, icon.icns, icon.ico");
