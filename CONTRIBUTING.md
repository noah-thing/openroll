# Contributing

Thanks for wanting to help. Bug reports, fixes and small focused features are all welcome. For anything large, open an issue first so we can agree on the shape before you spend the time.

## Setup

Requires Node.js 22 or newer.

```sh
npm install
npm run ffmpeg     # fetch the pinned ffmpeg build for this system into resources/ffmpeg
npm run dev        # run with live reload
```

## Checks

```sh
npm run typecheck
npm test                                 # unit tests (vitest)
npm run build
node qa/launch.mjs qa/smoke.mjs          # drive the real app through a scenario
```

`qa/` holds scenarios that launch the built app and use it like a person would. Each one runs with a fresh profile. They read test footage from `OPENROLL_TESTMEDIA`; `node qa/make-media.mjs <folder>` generates a full set with ffmpeg. Set `OPENROLL_QA_OUT` to skip save dialogs, and `FFPROBE` to the bundled ffprobe for the export checks.

Windows and Linux are checked in CI with the `verify` workflow, which builds the app on both and runs the main scenarios there. It only runs when started by hand.

## Packaging

```sh
npm run dist:mac     # dmg and zip, arm64 and x64
npm run dist:win     # installer and portable exe, x64
npm run dist:linux   # AppImage and deb, x64
```

Output lands in `dist/`. Releases are built by the `release` workflow, which publishes a draft with a `SHA256SUMS.txt`. The in app updater refuses any download that is not listed there.

## Code style

- TypeScript, strict. Small modules with one job.
- Comments explain why, never what.
- Names say what things are. No abbreviations beyond the common ones (`ctx`, `px`, `t`).
- Validate at the edges (IPC, files, the AI control socket) and trust internal calls.
- Every change to a project goes through `Editor.apply` with a short label, which is what Undo shows.
- Times in the project model are integer microseconds.
- Pure logic gets a unit test in `test/`. A user flow gets a scenario in `qa/`.

## Interface copy

Sentence case, plain words, short. No exclamation marks. Say what happened and what to do next, the way a person would explain it.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/core` | The project model and every edit, as pure functions. No DOM, no Electron. |
| `src/engine` | Decoding, the WebGL2 compositor, audio, export and the AI models, mostly in workers. |
| `src/renderer` | The React interface and its state. |
| `src/main` | The Electron main process: files, ffmpeg, updates, the AI control socket. |
| `src/shared` | Types and helpers used by both sides of IPC. |
| `test` | Unit tests. |
| `qa` | Scenarios that drive the real app. |
| `scripts` | Build, dev server, ffmpeg fetch and icon tools. |
| `docs` | AI control, and how updates and in app messages work. |
