// What an AI tool is told about OpenRoll. PLAYBOOK arrives with the connection (MCP server
// instructions); the topics are fetched with the guide tool when the task needs them.

export const PLAYBOOK = `OpenRoll is a video editor running on this computer. You edit the open project directly; the person sees every change live and can undo it.

How to work well
1. Look before you cut. Call get_project, then analyze_media on the clips you will use (speech, beats, loudness, scene changes) and transcribe anything with talking. Use contact_sheet to see footage you have not seen.
2. Plan the whole edit, then apply it in as few edit calls as possible. One edit call takes a list of operations, applies them all or none, and is one undo step for the person. Name things you create with "as" and refer to them later as "$name".
3. Check your work like an editor: contact_sheet over the result, render_frame at cuts, titles and transitions, and read get_project's notes, which point out sound running past the picture, black gaps, text out of frame and titles over captions. Fix what is off, then report what you did in plain words.
4. Times are seconds on the project timeline unless a field says source (in = where a clip starts inside its media).

Craft defaults that make edits feel professional
- Cut on beats or on speech boundaries, never mid word. Use analyze_media beats and transcript word times.
- Open strong: the first 1 to 2 seconds decide whether people stay. Put the best moment or line first for social formats.
- Vary shot length with the music: shorter on high energy, longer on calm parts. Remove dead air and filler words in talking videos.
- Prefer plain cuts. Use a transition only where time or place changes, keep it short (0.3 to 0.6 s), and use the same family through a video.
- Text: few words, big, high contrast, held long enough to read twice (about 0.3 s per word, minimum 1.2 s). Keep titles and captions inside the safe area.
- Sound matters more than picture: duck music under speech, end the music with the picture and fade it out, keep speech around -16 LUFS for social.
- Before smart_cut or remove_range, lock tracks that should not be cut (music, titles), or they ripple too.
- Colour: one consistent filter or adjustment across clips from the same scene; subtle amounts (0.3 to 0.7) look intentional.

Call guide with a topic for recipes and full reference: workflow, recipes, captions, audio, colour, motion, platforms, reference.`;

export const GUIDE: Record<string, string> = {
  workflow: `Efficient workflow
- One get_project call gives every id you need. Media ids come from import_media or get_project.
- import_media can place clips straight onto the timeline (place: "append", and it returns their clip ids) or just add them to the library. add_clip also takes a file path, so one edit call can go from files to a cut.
- Build the cut in one edit call: add_clip in order on the main track (it is magnetic, clips sit edge to edge), then overlays, text, audio, looks.
- Use trim to set a clip's in point and duration in source seconds; use split plus delete or remove_range for cuts inside the timeline.
- remove_range ripples every unlocked track. Lock the music track first if it should not be cut.
- After a big change, contact_sheet {count: 12} shows the whole edit at a glance; render_frame for detail.
- export renders the finished file. Ask the person where to save if they did not say; otherwise use their Videos folder.`,

  recipes: `Recipes

Talking head or tutorial
1. transcribe the clip. 2. smart_cut with remove: ["silences", "fillers"] (or build remove_range ops from the word gaps yourself for finer control). 3. Add captions with captions {style: "outline", highlight: true}. 4. Punch in on key sentences: keyframe transform.scale 1 -> 1.12 over 0.3 s, or split and set scale 1.15 on the next segment (jump cut zoom). 5. Duck music under speech: set music props {audio: {duckUnder: true}}. 6. Enhance voice on the speech clip: set props {audio: {voice: true, denoise: 0.6, normalize: true}}.

Montage cut to music
Fast: analyze_media the song (fills its beats), put the clips and the song on the timeline, then one op cut_to_beat {clips, music, every: 2}.
Crafted: pick 1 cut every 2 or 4 beats (every beat only for the drop), choose the strongest part of each shot (contact_sheet the source) and add_clip with in and duration equal to the beat gap. End the song with the picture and fade the last 2 s. Optional: effect "thump" on clips that start on the strongest beats.

Vlog
Order clips by time, cut each to its best 2 to 6 s, keep natural sound under music at volume 0.3 to 0.5, captions for spoken parts, one title at the start, one look across all clips.

Short from a long video (9:16)
project {ratio: "9:16"}, then make_vertical on each clip (subject tracking keeps the person in frame), captions with highlight, first line must hook, 15 to 45 s total.

Picture in picture and split screen
layout {id, layout: pip-br|pip-bl|pip-tr|pip-tl|top|bottom|left|right|full} on an overlay clip. Reaction videos: main clip full, face cam pip-br.

Stickers and shapes
add_shape {kind: "sticker", sticker: id from the catalog, at, duration, x, y, scale} to point at things (arrows, circles, underline). Keep one style per video.

Templates
list_templates shows ready made pieces: hook titles, lower thirds, end cards, cut patterns with punch zooms, split screens and caption styles. apply_template {template, at?, media?} puts one on the timeline with your clips in its slots, in order; a slot without a clip shows as a marked empty box. Caption styles restyle captions that already exist. Prefer a template to building the same thing by hand, then adjust its text with set.

Trailer or teaser
Slow open with a wide shot and a line of text, build with shorter shots, a hard cut to black (add_color #000000 for 0.5 s) before the final title, end on the name.`,

  captions: `Captions
- captions transcribes and places captions for the whole timeline, chunked into readable lines (5 to 7 words, breaking on pauses and punctuation).
- Styles: see catalog captionStyles. Word highlight colours the word being spoken.
- Fonts: catalog fonts lists the families. Pass font to captions, or set {style: {font: "Anton"}} on any text or caption. Display faces (Anton, Bebas Neue) have one weight; use them big, short and in capitals.
- Position "lower" for most videos, "middle" for vertical social content with faces in the lower half.
- Edit a caption's words with set {text: "..."}; timing is kept.
- export_subtitles writes SRT or VTT.`,

  audio: `Audio
- set props.audio: {denoise: 0..1, voice: true (enhance voice), normalize: true (to -16 LUFS), duckUnder: true (this item dips 12 dB while speech plays elsewhere)}.
- set props.volume (1 = original, 0 to 2), fadeIn and fadeOut in seconds.
- voiceFx: pitchUp, pitchDown, robot, radio, echo, bigRoom.
- speed changes pitch; keep music at speed 1.
- muteAudio: true silences a video clip's own sound (keep the picture).`,

  colour: `Colour and look
- filter {filter: id, amount 0..1}: presets in catalog.filters. 0.4 to 0.7 is usually right.
- set props.adjust: {exposure, contrast, saturation, temperature, tint, highlights, shadows, vignette} each -100..100. Small numbers (5 to 25) look natural.
- Match clips from the same scene by giving them the same filter and adjust values.
- effects (catalog.effects) are stylised; use them for intent (impact on a beat, a dream sequence), not decoration.
- mask {shape: rect|ellipse|linear|mirror, x, y, width, height, rotation, feather, invert}; chroma {color, similarity, smoothness, spill} for green screen.
- cutout: true removes the background around people.`,

  motion: `Motion
- Keyframes animate any numeric property: transform.x, transform.y, transform.scale, transform.rotation, transform.opacity, adjust.*, effect amounts. Time is on the timeline; ease is linear, ease, easeIn, easeOut or hold.
- A slow push in (scale 1 -> 1.08 over the whole clip, ease) makes stills and static shots feel alive.
- animationIn and animationOut on text and overlays: fade, slide-up, slide-down, slide-left, slide-right, zoom-in, zoom-out, pop, spin, with duration in seconds (0.25 to 0.5 feels quick).
- speed below 1 with slowMotion "flow" gives smooth slow motion; motionBlur {amount 0..1} for fast moves; stabilize {strength 0..1} for shaky handheld.
- make_vertical reframes a clip on its subject with keyframes when the frame shape changes.`,

  platforms: `Platforms
- TikTok, Reels, Shorts: 9:16, 1080x1920, 30 fps, captions in the middle third, keep text away from the bottom 20% and right edge (app buttons). Hook in 1 s.
- YouTube: 16:9, 1920x1080 or 3840x2160, chapters by markers, longer shots acceptable.
- Instagram feed: 4:5 or 1:1.
- Export: mp4 H.264 plays everywhere; HEVC is smaller; 1080p balanced is right for social.`,
};

export const GUIDE_TOPICS = [...Object.keys(GUIDE), "reference"];
