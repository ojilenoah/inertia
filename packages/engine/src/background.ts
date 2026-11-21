import type { Background, BgKind, Project, Seconds } from "./types";

export const BG_PRESETS: { name: string; kind: BgKind; colors: string[]; angle?: number; speed?: number }[] = [
  { name: "Sunset drift", kind: "mesh", colors: ["#1b1b3a", "#ff7a59", "#ffb36b", "#7b4dff"] },
  { name: "Ocean", kind: "mesh", colors: ["#032b44", "#0b3d91", "#1fb6ff", "#7ef9ff"] },
  { name: "Aurora", kind: "aurora", colors: ["#0b0f2b", "#21d4a7", "#7b4dff", "#1fb6ff"] },
  { name: "Lava", kind: "mesh", colors: ["#1f1c2c", "#ff512f", "#dd2476", "#ffb347"] },
  { name: "Citrus", kind: "mesh", colors: ["#fff1c9", "#f9d423", "#ff4e50", "#f4c400"] },
  { name: "Candy spin", kind: "conic", colors: ["#ff6ec4", "#7873f5", "#4adede", "#ff6ec4"], speed: 0.6 },
  { name: "Peach", kind: "linear", colors: ["#ffecd2", "#fcb69f"], angle: 135, speed: 0.4 },
  { name: "Lilac", kind: "linear", colors: ["#a18cd1", "#fbc2eb"], angle: 160, speed: 0.4 },
  { name: "Mint", kind: "linear", colors: ["#d4fc79", "#96e6a1"], angle: 120, speed: 0.4 },
  { name: "Deep night", kind: "radial", colors: ["#434343", "#000000"], speed: 0.5 },
  { name: "Spotlight", kind: "radial", colors: ["#fff6e5", "#d9c7a6"], speed: 0.6 },
  { name: "Paper", kind: "solid", colors: ["#EDEAE3"], speed: 0 },
  { name: "Ink", kind: "solid", colors: ["#111111"], speed: 0 },
  { name: "Signal", kind: "solid", colors: ["#E0571A"], speed: 0 },
];

export function activeBackground(project: Project, t: Seconds): Background | undefined {
  return project.backgrounds?.find((b) => t >= b.start && t < b.end);
}

/** CSS for a background at time t. Everything is a pure function of t, so renders match playback. */
export function backgroundCSS(bg: Background, t: Seconds): { background: string; filter?: string } {
  const c = bg.colors.length ? bg.colors : ["#000"];
  const sp = bg.speed;
  switch (bg.kind) {
    case "video": // the video itself is drawn on top; this colour shows until it loads
    case "solid":
      return { background: c[0] };
    case "linear":
      return { background: `linear-gradient(${bg.angle + Math.sin(t * sp * 0.8) * 25}deg, ${c.join(", ")})` };
    case "radial": {
      const x = 50 + Math.sin(t * sp * 0.7) * 22, y = 45 + Math.cos(t * sp * 0.55) * 18;
      return { background: `radial-gradient(circle at ${x}% ${y}%, ${c.join(", ")})` };
    }
    case "conic":
      return { background: `conic-gradient(from ${bg.angle + t * sp * 40}deg at 50% 50%, ${c.join(", ")})` };
    case "mesh":
    case "aurora": {
      const blobs = c.slice(1).map((col, i) => {
        const x = 50 + 38 * Math.sin(t * sp * 0.45 + i * 2.1), y = 50 + 38 * Math.cos(t * sp * 0.38 + i * 1.7);
        return `radial-gradient(${bg.kind === "aurora" ? "ellipse 90% 40%" : "circle"} at ${x.toFixed(1)}% ${y.toFixed(1)}%, ${col} 0%, transparent 58%)`;
      });
      return { background: [...blobs, c[0]].join(", "), filter: bg.kind === "aurora" ? "blur(30px) saturate(1.3)" : "saturate(1.15)" };
    }
  }
}

/** Where in a background video we are at time t (it loops unless told to play once). */
export function bgVideoTime(bg: Background, t: Seconds, dur = bg.mediaDur ?? 0): Seconds {
  const local = Math.max(0, t - bg.start);
  if (!dur) return local;
  return bg.once ? Math.min(local, dur - 0.001) : local % dur;
}

/** Cut the background clip under `t` in two. */
export function splitBackground(project: Project, t: Seconds, newId: string): boolean {
  const b = activeBackground(project, t);
  if (!b || t <= b.start + 0.02 || t >= b.end - 0.02) return false;
  project.backgrounds!.push({ ...b, colors: [...b.colors], id: newId, start: t });
  b.end = t;
  return true;
}
