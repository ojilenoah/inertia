import type { Item, Project } from "@moshion/engine";
import { insertRow, uid } from "@moshion/engine";
import { useStore } from "./store";
import { getBrand } from "./brand";

/*
 * Ready-made scenes: a few items with their animation already set, dropped in at the playhead.
 * Everything in them is ordinary items, so you can change any of it. Brand colours and fonts are used when you have them.
 */
export const TEMPLATES: { id: string; label: string; hint: string }[] = [
  { id: "title", label: "Title card", hint: "A big title with a line under it" },
  { id: "lower", label: "Lower third", hint: "Name and role sliding in at the bottom" },
  { id: "quote", label: "Quote", hint: "A quote and who said it" },
  { id: "number", label: "Big number", hint: "A number counting up, with a caption" },
  { id: "end", label: "End screen", hint: "Thanks for watching, and a button" },
];

export function addTemplate(id: string) {
  const { project, t, edit, selectMany, toast } = useStore.getState();
  const b = getBrand(), ink = b.colors[0] ?? "#111111", accent = b.colors[1] ?? "#E0571A", font = b.fonts[0];
  const W = project.width, H = project.height, S = Math.min(W, H), start = Math.max(0, Math.min(t, project.duration)), len = 4;
  const mk = (o: Partial<Item>): Item => ({
    id: uid("item"), name: "Item", kind: "text", trackId: "", start, end: start + len, w: 300, h: 100, fill: "transparent", tint: "--orange", keys: {},
    base: { x: W / 2, y: H / 2, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, ...o,
  } as Item);
  const text = (name: string, txt: string, size: number, y: number, extra: Partial<Item> = {}) =>
    mk({ name, text: txt, fontSize: Math.round(size), color: ink, fontWeight: 800, fontFamily: font, base: { x: W / 2, y, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, align: "center", ...extra });
  let items: Item[] = [];
  if (id === "title") items = [
    text("Title", "Your title here", S * 0.11, H * 0.46, { anim: { in: { kind: "slideUp", dur: 0.6 }, out: { kind: "fade", dur: 0.4 } } }),
    mk({ name: "Line", kind: "rect", fill: accent, w: S * 0.3, h: Math.max(6, S * 0.012), tint: "--blue", base: { x: W / 2, y: H * 0.46 + S * 0.1, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, anim: { in: { kind: "scale", dur: 0.6, at: 0.2 }, out: { kind: "fade", dur: 0.4 } } }),
  ];
  else if (id === "lower") items = [
    mk({ name: "Bar", kind: "rect", fill: accent, w: S * 0.62, h: S * 0.16, radius: 10, tint: "--blue", base: { x: W * 0.06 + S * 0.31, y: H * 0.82, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, anim: { in: { kind: "slideLeft", dur: 0.5 }, out: { kind: "slideLeft", dur: 0.4 } } }),
    text("Name", "Your Name", S * 0.05, H * 0.82 - S * 0.03, { color: "#FFFFFF", base: { x: W * 0.06 + S * 0.31, y: H * 0.82 - S * 0.025, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, anim: { in: { kind: "fade", dur: 0.4, at: 0.25 }, out: { kind: "fade", dur: 0.3 } } }),
    text("Role", "What they do", S * 0.03, H * 0.82 + S * 0.035, { color: "#FFFFFF", fontWeight: 500, base: { x: W * 0.06 + S * 0.31, y: H * 0.82 + S * 0.04, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, anim: { in: { kind: "fade", dur: 0.4, at: 0.35 }, out: { kind: "fade", dur: 0.3 } } }),
  ];
  else if (id === "quote") items = [
    mk({ name: "Quote mark", text: "“", fontSize: Math.round(S * 0.3), color: accent, fontWeight: 800, align: "center", base: { x: W / 2, y: H * 0.3, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, anim: { in: { kind: "pop", dur: 0.5 } } }),
    text("Quote", "Simple things,\ndone well.", S * 0.075, H * 0.48, { wrap: false, anim: { in: { kind: "fade", dur: 0.7, at: 0.2 } } }),
    text("Author", "— Someone wise", S * 0.035, H * 0.62, { fontWeight: 500, anim: { in: { kind: "fade", dur: 0.6, at: 0.6 } } }),
  ];
  else if (id === "number") items = [
    text("Number", "0", S * 0.22, H * 0.45, { color: accent, textFx: { kind: "count", from: 0, to: 1000, decimals: 0, suffix: "+", dur: 2 } }),
    text("Caption", "happy customers", S * 0.05, H * 0.45 + S * 0.16, { fontWeight: 500, anim: { in: { kind: "slideUp", dur: 0.6, at: 0.3 } } }),
  ];
  else if (id === "end") items = [
    text("Thanks", "Thanks for watching", S * 0.085, H * 0.42, { anim: { in: { kind: "slideUp", dur: 0.6 } } }),
    mk({ name: "Button", kind: "shape", shape: { type: "capsule" }, fill: accent, w: S * 0.42, h: S * 0.12, tint: "--blue", base: { x: W / 2, y: H * 0.42 + S * 0.17, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, anim: { in: { kind: "pop", dur: 0.5, at: 0.4 } } }),
    text("Button text", "Subscribe", S * 0.045, H * 0.42 + S * 0.17, { color: "#FFFFFF", anim: { in: { kind: "fade", dur: 0.4, at: 0.6 } } }),
  ];
  if (!items.length) return;
  edit((p: Project) => {
    // each item on its own new track at the top (later items in front)
    let top = p.tracks.find((tr) => tr.kind !== "group" && !tr.parent)?.id;
    for (const it of [...items].reverse()) {
      if (!top) { p.tracks.unshift({ id: uid("V"), name: "Track", kind: "video" }); top = p.tracks[0].id; it.trackId = top; }
      else { it.trackId = insertRow(p, top, false); top = it.trackId; }
    }
    p.items.push(...items);
  });
  selectMany(items.map((i) => i.id));
  toast(`${TEMPLATES.find((x) => x.id === id)?.label} added · everything in it can be changed`);
}
