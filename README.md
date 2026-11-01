# OpenRoll

A free, open source video editor for macOS, Windows and Linux.

OpenRoll is built for the edits people make every day: cutting a vlog, captioning a short, putting music under a trip. It runs fully on your computer, needs no account, and exports without a watermark.

> OpenRoll is early. Expect rough edges.

## Building from source

Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # run with live reload
npm test           # unit tests
npm run build      # production build into out/
```

## How it works

- **Engine.** Media is decoded with WebCodecs through [Mediabunny](https://mediabunny.dev), which uses the hardware decoder when there is one. A WebGL2 compositor draws every frame, in a worker, so the interface never waits on video.
- **Clock.** Audio drives playback time. Video follows it and drops frames rather than drifting.
- **Projects.** A project is one JSON file. Times are integer microseconds. Every edit is a pure function from one project to the next, which is what makes undo exact.
- **Export.** The exporter renders the same scene description as the preview, so what you see is what you get, and encodes with the hardware encoder.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
