# Moshion — notes for later

Ideas and features we've agreed to do later. Newest at the top.

## Rendering (needs the WebGL renderer)

- **Extra blend modes.** The browser's built-in blending (CSS `mix-blend-mode`) only offers the 17 modes that are in the app now. These need custom shaders:
  - Subtract, Divide
  - Linear burn, Linear dodge
  - Vivid light, Linear light, Pin light, Hard mix
  - Darker colour, Lighter colour
- .obj 3D models (the rail button is a placeholder)

## Saving

- Done 2026-11-18: projects (and imported video/audio) are also saved as files: Documents/Moshion in the desktop app, or a folder you pick in the browser. Still to check: the desktop build itself (needs the cloud build, no local Rust).
- Saved `.moshion` files don't include imported video/audio yet (they live in the app's local storage). Bundle them when saving a file.

## Bigger pieces

- Nodes view (transitions between items) and Board view (all scenes on one canvas)
- Export extras: GIF / WebM / PNG sequence, transparent video, export a time range
- GitHub repo + cloud builds for the Windows .exe and Android .apk (workflow is in `.github/workflows/build.yml`)
- Lens blur (2026-11-21): since the looks layer fix it shows again, but its edges look whitish/washed out compared with before (the blur pulls in what's outside the canvas). Revisit: clamp the blur to the canvas so the edges stay true.

## Video plan (agreed 2026-11-22, not started)
Build in this order; each step is usable on its own.
1. **Video engine (foundation)** — decode frames ourselves with WebCodecs (+ an MP4 demuxer) instead of seeking `<video>`: exact frames, fast, same in editor and export. Frame cache for smooth scrubbing/playback. Filmstrip thumbnails on video clips. Later on desktop: bundled ffmpeg for MOV/ProRes/HEVC and low-res proxies.
2. **Editing essentials** — speed ramps (keyframed speed, freeze frame, smooth slow-mo); transitions between clips on the same track (crossfade, dip, wipes, zoom, slide); detach audio from video; volume keyframes; slip/slide edits; scene-cut detection (auto split).
3. **GPU effects pipeline** (shared by editor and export) — colour (exposure, contrast, saturation, temperature, tint, curves, .cube LUTs); chroma key / luma key; blur, sharpen, vignette, film looks, glitch — all keyframable.
4. **Motion tracking** — point tracking forward/back (result = keyframes you can fix); anything can follow a track (text, stickers, blur boxes, masks); 4-corner tracking drives the corner pin; stabilisation; auto-reframe wide → vertical.
5. **Smart extras** — background removal without green screen; auto captions from speech (can drive text animations); face tracking (auto blur faces, attach things to a face).
Suggested order after step 1: tracking (4), then 2 and 3.
