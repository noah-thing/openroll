# Where things stand (2026-11-01, v0.1.0 draft)

## Released
Draft release v0.1.0 on GitHub (private, only Noah sees it): Mac arm64 and x64 (dmg, zip), Windows (installer, portable), Linux (AppImage, deb), SHA256SUMS.txt. Notes from release-notes/0.1.0.md, which the app also shows as What's new.
Checked: the Mac arm64 zip matches its checksum, has a valid ad hoc signature, ships ffmpeg, and starts cleanly from a fresh profile.

## Verified on Windows and Linux (GitHub Actions, verify.yml)
Import, preview, split, all export formats (MP4, WebM, ProRes 422/4444, GIF, M4A, WAV, still), news and updates, timeline gestures on Linux, AI control (MCP) on both (Windows reads the raw stdio handles, since Electron's process.stdin ends at once there; found with a probe on a GitHub Windows runner).
Fixed on the way: software decode fallback when a PC has no hardware decoder (black preview and failed exports before), WASM AAC encoder where Chromium has none, ffmpeg fallback for M4A.

## Not proven yet
- Track height drag on Windows: did not commit on the CI runner, probably frame throttling there. Passes on Mac.
- Long full export (qa/export.mjs) on Linux CI with software rendering is slow; it finishes within the 15 minute limit.
- MCP exports longer than the client's tool timeout need progress notifications.
- Linux bridge needs a desktop session (DISPLAY); over SSH it fails. An actual `--ozone-platform=headless` on the command line may fix it, untested.

## To ship publicly (Noah's calls)
1. Make the repo public: updates and in-app messages read from public GitHub, so a private repo means installed copies never update.
2. Publish the draft release.
3. Signing: Apple Developer ID ($99/year) and a Windows certificate remove the first launch warnings. Without them, the release notes explain the steps.
4. Real app icon (build/README).

## Next round
Bug hunt round 2 (Sonnet), Windows MCP, the unconfirmed suspicions from round 1 listed in the hunters' reports (file association for .openroll, SRT line endings, AppImage sandbox on Ubuntu 24.04, robot voice oscillator, filmstrips of deleted media kept in cache, a reader that fails once stays black).

## Running checks
- Unit: `npx vitest run` (416). Types: `npx tsc --noEmit -p tsconfig.json`. Build: `npm run build`.
- Real app: `node qa/launch.mjs qa/<scenario>.mjs`, env OPENROLL_TESTMEDIA, OPENROLL_QA_OUT, FFPROBE, QA_NO_HW_DECODE (mimics a PC without hardware decode).
- Windows and Linux: `gh workflow run verify.yml`, installers: `gh workflow run release.yml -f draft=true`. Both are manual only.
