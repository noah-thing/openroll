# Build resources

`icon.png` is the 1024 px app icon artwork. `npm run icons` scales it into `icon.icns` (macOS) and `icon.ico` (Windows); Linux uses the PNG directly. Replace the PNG and run the script again to change the icon everywhere.

`after-pack.mjs` hardens the Electron binary with fuses. Packaging itself is configured in `electron-builder.yml` at the repo root.
