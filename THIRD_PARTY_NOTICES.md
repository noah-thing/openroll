# Third party notices

## FFmpeg

OpenRoll ships `ffmpeg` and `ffprobe` as separate programs next to the app, never linked into it. They convert files the editor cannot read, make proxies, and encode ProRes, GIF and a few other export formats.

The builds are GPL builds (`--enable-gpl --enable-version3`, with x264 and x265 included), which is compatible with OpenRoll's GPL-3.0-or-later licence. FFmpeg's source is at https://ffmpeg.org/ and the exact release, 9.0.2, is a tagged commit of https://git.ffmpeg.org/ffmpeg.git. Each build's configuration is printed by `ffmpeg -version`, and the licence text is `LICENSE.txt` in the Windows folder and https://www.gnu.org/licenses/gpl-3.0.txt for the others. To use a different build, put it in the app's `resources/ffmpeg` folder or point `OPENROLL_FFMPEG_DIR` at a folder holding `ffmpeg` and `ffprobe`.

The pinned downloads and their sha256 checksums live in `scripts/fetch-ffmpeg.mjs`:

| Platform | Source | Build |
| --- | --- | --- |
| macOS arm64 and x64 | https://ffmpeg.martin-riedl.de | Release 9.0.2, static, GPL. Source and build scripts are linked from that site. |
| Linux x64 | https://ffmpeg.martin-riedl.de | Release 9.0.2, static, GPL. |
| Windows x64 | https://github.com/BtbN/FFmpeg-Builds (MIT build scripts) | `autobuild-2026-10-31-12-59`, `n9.0.2-39-g7adfbe40dc`, win64 gpl shared. Its source commit and patches are in that repository. |

These builds bundle further libraries under their own licences, including x264 (GPL-2.0-or-later), x265 (GPL-2.0-or-later), libvpx (BSD-3-Clause), Opus (BSD-3-Clause), LAME (LGPL-2.0-or-later), dav1d (BSD-2-Clause) and OpenH264 (BSD-2-Clause). H.264, HEVC and AAC are covered by patent pools that are separate from copyright; the same applies to every editor that encodes them.

A smaller build with only the components OpenRoll needs, compiled in CI, would cut the download by about half. That is planned work, not done.
