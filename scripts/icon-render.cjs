// Runs under Electron (not Node): scales the 1024 px artwork to each icon size with Chromium's resampler.
const { app, nativeImage } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const [source, outDir, ...sizes] = process.argv.slice(2);

app.whenReady().then(() => {
  const art = nativeImage.createFromPath(source);
  if (art.isEmpty()) {
    console.error(`could not read ${source}`);
    app.exit(1);
    return;
  }
  for (const size of sizes.map(Number)) {
    writeFileSync(join(outDir, `icon-${size}.png`), art.resize({ width: size, height: size, quality: "best" }).toPNG());
  }
  app.quit();
});
