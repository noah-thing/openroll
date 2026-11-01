// Runs under Electron (not Node): rasterises the placeholder mark to PNG with Chromium's SVG renderer.
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const [outDir, ...sizes] = process.argv.slice(2);

// The reel from the home screen on a 24 unit grid, on a graphite tile with the usual platform margin.
const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2b30"/><stop offset="1" stop-color="#18181a"/></linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#g)"/>
  <g transform="translate(212 212) scale(25.1)" fill="none" stroke="#ececee" stroke-width="1.05">
    <circle cx="12" cy="12" r="8.2"/>
    <circle cx="12" cy="12" r="2.2" stroke="#4b8bf5"/>
    <circle cx="12" cy="6.6" r="1.6"/>
    <circle cx="16.7" cy="14.7" r="1.6"/>
    <circle cx="7.3" cy="14.7" r="1.6"/>
  </g>
</svg>`;

// One window at the largest size; the smaller sizes are scaled down from it.
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, transparent: true, frame: false });
  await win.loadURL("data:text/html," + encodeURIComponent(`<style>html,body{margin:0;background:transparent}</style>${svg(1024)}`));
  await new Promise(r => setTimeout(r, 200));
  const big = await win.webContents.capturePage();
  for (const size of sizes.map(Number)) {
    writeFileSync(join(outDir, `icon-${size}.png`), big.resize({ width: size, height: size, quality: "best" }).toPNG());
  }
  app.quit();
});
