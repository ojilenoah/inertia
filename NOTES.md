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
