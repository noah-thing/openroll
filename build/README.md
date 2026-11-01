# Build resources

`icon.png`, `icon.icns` and `icon.ico` are placeholders. They are drawn in code by `scripts/make-icons.mjs` from the reel mark on the home screen, so there is something to ship before a real icon exists. Replace the three files with the commissioned set (a 1024 px PNG, an icns with all sizes and an ico that includes 256 px) and the build picks them up. Do not run `npm run icons` afterwards, it overwrites them.

`after-pack.mjs` hardens the Electron binary with fuses. Packaging itself is configured in `electron-builder.yml` at the repo root.
