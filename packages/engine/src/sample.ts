import type { Item, Project, Prop } from "./types";

const base = (o: Partial<Record<Prop, number>> = {}): Record<Prop, number> => ({
  x: 540, y: 960, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1, ...o,
});

export const DUSK = "linear-gradient(180deg,#FFD08A 0%,#F7915E 38%,#B65F8E 68%,#3E3466 100%)";
export const LAKE = "linear-gradient(160deg,#9FD3FF 0%,#4B7BEA 50%,#1B2550 100%)";

/** Demo scene that matches the design prototype. */
export function sampleProject(): Project {
  const items: Item[] = [
    {
      id: "circle", name: "Circle", kind: "ellipse", trackId: "H2", start: 0.4, end: 6.5,
      w: 520, h: 520, fill: DUSK, tint: "--violet", base: base({ x: 740, y: 840 }),
      keys: { scale: [{ t: 0, v: 0, ease: "back" }, { t: 0.7, v: 1, ease: "ease" }, { t: 2.4, v: 1.08, ease: "ease" }] },
    },
    {
      id: "headline", name: "Text", anim: { in: { kind: "slideUp", dur: 0.6 } }, kind: "text", trackId: "H1", start: 0, end: 11.2,
      w: 900, h: 480, fill: "transparent", text: "MOSH\nION.", fontSize: 250, fontWeight: 800, letterSpacing: -0.06, color: "#111111", tint: "--violet",
      base: base({ x: 520, y: 400 }),
      keys: { opacity: [{ t: 0, v: 0, ease: "ease" }, { t: 0.5, v: 1, ease: "ease" }], y: [{ t: 0, v: 470, ease: "expo" }, { t: 0.9, v: 400, ease: "ease" }] },
    },
    {
      id: "card", name: "Image", kind: "image", trackId: "H3", start: 1, end: 7.4,
      w: 360, h: 450, fill: LAKE, radius: 32, tint: "--teal", base: base({ x: 270, y: 1300 }),
      keys: { ry: [{ t: 0, v: 0, ease: "linear" }, { t: 6.4, v: 360, ease: "linear" }] },
    },
    {
      id: "pill", name: "Rectangle", anim: { in: { kind: "pop", dur: 0.5 }, loop: { kind: "pulse", speed: 1, amount: 1 } }, kind: "rect", trackId: "V2", start: 3, end: 12,
      w: 370, h: 120, fill: "#E0571A", radius: 999, text: "OUT NOW →", fontSize: 38, color: "#ffffff", tint: "--orange",
      base: base({ x: 780, y: 1460 }),
      keys: { scale: [{ t: 0, v: 0.6, ease: "back" }, { t: 0.5, v: 1, ease: "ease" }], opacity: [{ t: 0, v: 0, ease: "ease" }, { t: 0.3, v: 1, ease: "ease" }] },
    },
    {
      id: "star", name: "Star", kind: "star", trackId: "V2", start: 0, end: 2.8,
      w: 150, h: 150, fill: "#111111", tint: "--pink", base: base({ x: 920, y: 260 }),
      keys: { rz: [{ t: 0, v: 0, ease: "ease" }, { t: 2.8, v: 144, ease: "ease" }] },
    },
  ];
  return {
    id: "demo", name: "Launch Reel — Hero", width: 1080, height: 1920, fps: 60, duration: 12,
    background: "radial-gradient(120% 70% at 80% 10%,#F6E7D0 0%,transparent 60%),radial-gradient(90% 60% at 0% 100%,#D8DCF5 0%,transparent 60%),#EDEAE3",
    tracks: [
      { id: "G1", name: "Hero", kind: "group", open: true, keys: { y: [{ t: 9, v: 0, ease: "expo" }, { t: 10.2, v: -1400, ease: "ease" }] } },
      { id: "H1", name: "Track 1", kind: "video", parent: "G1" },
      { id: "H2", name: "Track 2", kind: "video", parent: "G1" },
      { id: "H3", name: "Track 3", kind: "video", parent: "G1" },
      { id: "V2", name: "Graphics", kind: "video" },
      { id: "V1", name: "Media", kind: "video" },
      { id: "A1", name: "Audio 1", kind: "audio" },
    ],
    items,
    transitions: [],
    effects: [{ id: "fx_grain", kind: "grain", start: 0, end: 12, amount: 0.22 }],
    backgrounds: [
      { id: "bg_1", name: "Paper", start: 0, end: 7, kind: "solid", colors: ["#EDEAE3"], angle: 0, speed: 0 },
      { id: "bg_2", name: "Sunset drift", start: 7, end: 12, kind: "mesh", colors: ["#1b1b3a", "#ff7a59", "#ffb36b", "#7b4dff"], angle: 0, speed: 1 },
    ],
  };
}

export function emptyProject(aspect: "9:16" | "16:9" = "9:16"): Project {
  const [width, height] = aspect === "9:16" ? [1080, 1920] : [1920, 1080];
  return {
    id: "untitled", name: "Untitled", width, height, fps: 60, duration: 10, background: "#EDEAE3",
    tracks: [{ id: "V2", name: "Graphics", kind: "video" }, { id: "V1", name: "Media", kind: "video" }, { id: "A1", name: "Music", kind: "audio" }],
    items: [], transitions: [], effects: [],
  };
}

/** A blank project from the start screen. */
export function newProject(o: { name: string; width: number; height: number; fps: number; duration: number; background: string }): Project {
  const id = "proj_" + Math.random().toString(36).slice(2, 10);
  return {
    id, name: o.name || "Untitled", width: o.width, height: o.height, fps: o.fps, duration: o.duration, background: o.background,
    tracks: [{ id: "V2", name: "Track 2", kind: "video" }, { id: "V1", name: "Track 1", kind: "video" }, { id: "A1", name: "Audio 1", kind: "audio" }],
    items: [], transitions: [], effects: [],
    backgrounds: [{ id: "bg_1", name: "Background", start: 0, end: o.duration, kind: "solid", colors: [o.background], angle: 0, speed: 0 }],
  };
}
