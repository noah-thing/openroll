# Editing with an AI tool

OpenRoll can be driven by Claude Code, Codex, Cursor or any tool that speaks MCP. The AI edits the open project directly; you see every change as it happens and can undo it like your own.

## Connect

Settings, AI tools, shows the exact command for this computer. For a typical install:

```sh
# macOS
claude mcp add openroll -- /Applications/OpenRoll.app/Contents/MacOS/OpenRoll --mcp
# Linux (AppImage)
claude mcp add openroll -- ~/Applications/OpenRoll.AppImage --mcp
```

Windows is not supported yet: Electron's main process cannot read standard input there, which is how MCP talks. It is next on the list.

`OpenRoll --mcp` starts no window. It finds the running app, or starts it, and passes calls through a private socket in your user folder. Each connection proves itself with a token stored next to that socket. Nothing listens on the network. Turn it off in Settings, AI tools.

## What the AI gets

- A playbook with the connection: how to work in few calls and the editing craft (cut on beats and speech, open strong, short transitions, readable text, ducked music).
- `guide` for recipes (talking head, montage, vlog, short, trailer) and reference.
- `catalog`: every operation, property, transition, filter, effect, text and caption style, animation, layout, sticker and voice, each with what it is for.
- `get_project`: the whole project in seconds, plus notes an editor would notice (sound past the picture, black gaps, text out of frame).
- `edit`: a batch of operations applied all or nothing, one undo step, with names (`as`, `$name`) so a whole cut fits in one call. Bad batches explain which operation failed and why, and change nothing.
- `analyze_media`, `transcribe`: speech, beats, loudness, words with times.
- `render_frame`, `contact_sheet`: the AI sees the result.
- `captions`, `smart_cut`, `make_vertical`, `export`, `export_subtitles`, `undo`, `redo`, `show`.

## Test it

```sh
npm run build
node qa/launch.mjs qa/mcp.mjs
```
