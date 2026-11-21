import type { Background, Item, ItemState, Project, Seconds } from "./types";

/*
 * Canvases and transitions. Each part of the canvas row is its own canvas: it has a place on the
 * board (an endless flat plane) and, from the second one on, a transition into it from the one before.
 * A transition is centred on the join: the outgoing canvas holds its last frame for the second half,
 * the incoming one holds its first frame for the first half.
 */
export type TransKind = "fade" | "slide" | "push" | "zoom" | "wipe" | "blur" | "board" | "magic";
export type TransDir = "l" | "r" | "u" | "d";
export interface CanvasTrans { kind: TransKind; dur: Seconds; dir?: TransDir }

export const TRANSITIONS: { kind: TransKind; label: string; dir?: boolean }[] = [
  { kind: "fade", label: "Fade" },
  { kind: "slide", label: "Slide", dir: true },
  { kind: "push", label: "Push", dir: true },
  { kind: "zoom", label: "Zoom" },
  { kind: "wipe", label: "Wipe", dir: true },
  { kind: "blur", label: "Blur" },
  { kind: "board", label: "Board move" },
  { kind: "magic", label: "Magic move" },
];

/** The canvases in time order (a project with no parts is one canvas). */
export function canvases(p: Project): Background[] {
  const bgs = p.backgrounds?.length ? [...p.backgrounds] : [{ id: "", name: "Canvas", start: 0, end: p.duration, kind: "solid" as const, colors: [p.background], angle: 0, speed: 0 }];
  return bgs.sort((a, b) => a.start - b.start);
}
const GAP = 0.18;
/** Where a canvas sits on the board (top-left, in video pixels). */
export function boardPos(p: Project, c: Background): { x: number; y: number } {
  if (c.board) return c.board;
  const i = canvases(p).findIndex((q) => q.id === c.id);
  return { x: Math.max(0, i) * p.width * (1 + GAP), y: 0 };
}

export interface TransState {
  from: Background; to: Background; kind: TransKind; dir: TransDir;
  /** 0 → 1 through the transition (eased). */
  p: number;
  /** The times to draw each side at. */
  tA: Seconds; tB: Seconds;
}
const ease = (x: number) => x * x * (3 - 2 * x);
/** The transition playing at time t, if any. */
export function transitionAt(p: Project, t: Seconds): TransState | null {
  const cs = canvases(p);
  for (let i = 1; i < cs.length; i++) {
    const to = cs[i], tr = to.trans;
    if (!tr || tr.dur <= 0) continue;
    const j = to.start, h = tr.dur / 2;
    if (t < j - h || t >= j + h) continue;
    const from = cs[i - 1];
    return { from, to, kind: tr.kind, dir: tr.dir ?? "l", p: ease((t - (j - h)) / tr.dur), tA: Math.min(t, j - 1e-3), tB: Math.max(t, j) };
  }
  return null;
}

/** How one side of a transition is drawn: moved (in video pixels), scaled about the centre, faded, blurred, clipped. */
export interface Layer { x: number; y: number; scale: number; opacity: number; blur: number; clip?: [number, number, number, number] }
const L = (o: Partial<Layer> = {}): Layer => ({ x: 0, y: 0, scale: 1, opacity: 1, blur: 0, ...o });
/** Both sides of a transition at its progress. The incoming side (b) is drawn on top. */
export function transLayers(p: Project, s: TransState): { a: Layer; b: Layer } {
  const W = p.width, H = p.height, q = s.p;
  const v = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] }[s.dir]; // the way things move
  switch (s.kind) {
    case "fade": return { a: L(), b: L({ opacity: q }) };
    case "slide": return { a: L(), b: L({ x: -v[0] * W * (1 - q), y: -v[1] * H * (1 - q) }) };
    case "push": return { a: L({ x: v[0] * W * q, y: v[1] * H * q }), b: L({ x: -v[0] * W * (1 - q), y: -v[1] * H * (1 - q) }) };
    case "zoom": return { a: L({ scale: 1 + q * 0.6, opacity: 1 - q }), b: L({ scale: 0.6 + 0.4 * q, opacity: q }) };
    case "blur": return { a: L({ blur: q * 24 }), b: L({ blur: (1 - q) * 24, opacity: q }) };
    case "wipe": {
      // the incoming canvas is uncovered from one side
      const c: [number, number, number, number] = s.dir === "l" ? [1 - q, 0, 1, 1] : s.dir === "r" ? [0, 0, q, 1] : s.dir === "u" ? [0, 1 - q, 1, 1] : [0, 0, 1, q];
      return { a: L(), b: L({ clip: c }) };
    }
    case "magic": return { a: L(), b: L({ opacity: q }) }; // (drawn by magicFrame instead)
    case "board": {
      // the camera travels across the board from one canvas to the next, pulling back a little on the way
      const A = boardPos(p, s.from), B = boardPos(p, s.to);
      const cx = A.x + (B.x - A.x) * q, cy = A.y + (B.y - A.y) * q;
      const z = 1 - 0.3 * Math.sin(Math.PI * q);
      return { a: L({ x: (A.x - cx) * z, y: (A.y - cy) * z, scale: z }), b: L({ x: (B.x - cx) * z, y: (B.y - cy) * z, scale: z }) };
    }
  }
}

/** Add a new canvas right after the last one (the video gets longer). */
export function addCanvas(p: Project, id: string, len = 3): Background {
  if (!p.backgrounds?.length) p.backgrounds = [{ id: id + "a", name: "Canvas 1", start: 0, end: p.duration, kind: "solid", colors: [p.background], angle: 0, speed: 0 }];
  const last = canvases(p).at(-1)!;
  const pos = boardPos(p, last);
  const c: Background = { id, name: `Canvas ${p.backgrounds.length + 1}`, start: last.end, end: last.end + len, kind: last.kind, colors: [...last.colors], angle: last.angle, speed: last.speed, board: { x: pos.x + p.width * (1 + GAP), y: pos.y }, trans: { kind: "fade", dur: 0.6 } };
  p.backgrounds.push(c);
  if (p.autoLength === false) p.duration = Math.max(p.duration, c.end);
  return c;
}

/* ---------------- adding, copying and removing canvases (the timeline makes room or closes up) ---------------- */
const at = (a: number, b: number) => a >= b - 1e-4;
/** Move everything that starts at or after time T by d seconds (d < 0 closes a gap). */
export function rippleShift(p: Project, T: Seconds, d: number) {
  for (const i of p.items) if (at(i.start, T)) { i.start += d; i.end += d; }
  for (const b of p.backgrounds ?? []) if (at(b.start, T)) { b.start += d; b.end += d; }
  for (const f of p.effects) { if (at(f.start, T)) { f.start += d; f.end += d; } f.keys?.forEach((k) => { if (at(k.t, T)) k.t += d; }); }
  for (const f of p.canvasFx ?? []) f.keys?.forEach((k) => { if (at(k.t, T)) k.t += d; });
  if (p.canvasKeys) p.canvasKeys = p.canvasKeys.map((k) => (at(k, T) ? k + d : k));
  for (const m of p.markers ?? []) if (at(m.t, T)) m.t += d;
  if (p.autoLength === false) p.duration = Math.max(0.1, p.duration + d);
}
/** Make sure the canvas row has real parts (a project starts as one implicit canvas). */
function ensureParts(p: Project, id: string) {
  if (!p.backgrounds?.length) p.backgrounds = [{ id, name: "Canvas 1", start: 0, end: p.duration, kind: "solid", colors: [p.background], angle: 0, speed: 0 }];
}
/** A new empty canvas right after another one (later canvases move along to make room). */
export function insertCanvasAfter(p: Project, afterId: string, id: string, len = 3, pos?: { x: number; y: number }): Background | null {
  ensureParts(p, afterId || id + "a");
  const src = canvases(p).find((c) => c.id === afterId) ?? canvases(p).at(-1)!;
  const T = src.end, sp = boardPos(p, src);
  rippleShift(p, T, len);
  const c: Background = { ...JSON.parse(JSON.stringify(src)), id, name: `Canvas ${p.backgrounds!.length + 1}`, start: T, end: T + len, board: pos ?? { x: sp.x + p.width * (1 + GAP), y: sp.y }, trans: { kind: "fade", dur: 0.6 } };
  p.backgrounds!.push(c);
  return c;
}
/** A copy of a canvas with everything on it, placed right after it in time and beside it on the board. */
export function duplicateCanvas(p: Project, srcId: string, id: string, newItemId: () => string): Background | null {
  ensureParts(p, srcId || id + "a");
  const src = canvases(p).find((c) => c.id === srcId) ?? canvases(p)[0];
  const len = src.end - src.start, T = src.end, sp = boardPos(p, src);
  const inside = p.items.filter((i) => i.start >= src.start - 1e-4 && i.start < src.end - 1e-4);
  const looks = p.effects.filter((f) => f.start >= src.start - 1e-4 && f.start < src.end - 1e-4);
  rippleShift(p, T, len);
  const ids = new Map<string, string>();
  for (const i of inside) ids.set(i.id, newItemId());
  for (const i of inside) {
    const c = JSON.parse(JSON.stringify(i));
    c.id = ids.get(i.id); c.start = i.start + len; c.end = Math.min(i.end, src.end) + len;
    if (c.follow) c.follow.motionId = ids.get(c.follow.motionId) ?? c.follow.motionId;
    if (c.mask) c.mask.by = ids.get(c.mask.by) ?? c.mask.by;
    if (c.onPath) c.onPath = ids.get(c.onPath) ?? c.onPath;
    p.items.push(c);
  }
  for (const f of looks) p.effects.push({ ...JSON.parse(JSON.stringify(f)), id: f.id + "c" + Math.random().toString(36).slice(2, 6), start: f.start + len, end: Math.min(f.end, src.end) + len, keys: undefined });
  const c: Background = { ...JSON.parse(JSON.stringify(src)), id, name: `${src.name || "Canvas"} copy`, start: T, end: T + len, board: { x: sp.x + p.width * (1 + GAP), y: sp.y }, trans: src.trans ?? { kind: "fade", dur: 0.6 } };
  p.backgrounds!.push(c);
  return c;
}
/** Remove a canvas and everything that starts on it; later canvases move up to close the gap. */
export function deleteCanvas(p: Project, id: string): boolean {
  const cs = canvases(p);
  const c = cs.find((q) => q.id === id);
  if (!c || cs.length < 2) return false;
  const len = c.end - c.start;
  const gone = new Set(p.items.filter((i) => i.start >= c.start - 1e-4 && i.start < c.end - 1e-4).map((i) => i.id));
  p.items = p.items.filter((i) => !gone.has(i.id));
  for (const i of p.items) {
    if (i.follow && gone.has(i.follow.motionId)) delete i.follow;
    if (i.mask && gone.has(i.mask.by)) delete i.mask;
    if (i.onPath && gone.has(i.onPath)) delete i.onPath;
  }
  p.effects = p.effects.filter((f) => !(f.start >= c.start - 1e-4 && f.start < c.end - 1e-4));
  p.backgrounds = p.backgrounds!.filter((b) => b.id !== id);
  rippleShift(p, c.end, -len);
  const first = canvases(p)[0]; if (first) delete first.trans;
  return true;
}

/* ---------------- magic move ---------------- */
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
function mixHex(a: string, b: string, p: number): string | null {
  const A = /^#([0-9a-f]{6})$/i.exec(a), B = /^#([0-9a-f]{6})$/i.exec(b);
  if (!A || !B) return null;
  const x = parseInt(A[1], 16), y = parseInt(B[1], 16);
  const ch = (s: number) => Math.round(lerp((x >> s) & 255, (y >> s) & 255, p));
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
}
/**
 * One frame of a "Magic move" transition: items with the same name on both canvases glide, resize and
 * change colour from where they are at the end of the first canvas to where they are at the start of
 * the next; the rest fade out or in. Returns a stand-in project that draws exactly that frame.
 */
export function magicFrame(p: Project, s: TransState, t: Seconds, state: (p: Project, it: Item, t: Seconds) => ItemState): Project {
  const vis = (tt: Seconds) => p.items.filter((i) => i.kind !== "audio" && i.kind !== "motion" && i.kind !== "camera" && tt >= i.start && tt < i.end);
  const A = vis(s.tA), B = vis(s.tB);
  const row = p.tracks.find((tr) => tr.kind !== "group" && !tr.parent)?.id ?? p.tracks[0]?.id ?? "V1";
  const used = new Set<string>(), out: Item[] = [];
  const flat = (it: Item, st: ItemState, extra: Partial<Item>): Item => ({
    ...it, ...extra, trackId: row, start: t - 1, end: t + 1, keys: {}, anim: undefined, follow: undefined, parentLink: undefined, links: undefined,
    layerKeys: undefined, lookKeys: it.lookKeys, mask: undefined,
    base: { x: st.x, y: st.y, z: st.z, rx: st.rx, ry: st.ry, rz: st.rz, scale: st.scale, opacity: st.opacity },
  });
  const q = s.p;
  for (const b of B) {
    const a = A.find((x) => x.name === b.name && !used.has(x.id));
    const sb = state(p, b, s.tB);
    if (!a) { out.push(flat(b, { ...sb, opacity: sb.opacity * q }, { id: b.id + "~in" })); continue; }
    used.add(a.id);
    const sa = state(p, a, s.tA), src = q < 0.5 ? a : b;
    const mixed: ItemState = { ...sb, x: lerp(sa.x, sb.x, q), y: lerp(sa.y, sb.y, q), z: lerp(sa.z, sb.z, q), rx: lerp(sa.rx, sb.rx, q), ry: lerp(sa.ry, sb.ry, q), rz: lerp(sa.rz, sb.rz, q), scale: lerp(sa.scale, sb.scale, q), opacity: lerp(sa.opacity, sb.opacity, q), visible: true };
    out.push(flat(src, mixed, {
      id: b.id + "~mm", w: lerp(a.w, b.w, q), h: lerp(a.h, b.h, q),
      fill: mixHex(a.fill, b.fill, q) ?? src.fill, color: a.color && b.color ? mixHex(a.color, b.color, q) ?? src.color : src.color,
      fontSize: a.fontSize && b.fontSize ? lerp(a.fontSize, b.fontSize, q) : src.fontSize,
    }));
  }
  for (const a of A) if (!used.has(a.id)) { const sa = state(p, a, s.tA); out.unshift(flat(a, { ...sa, opacity: sa.opacity * (1 - q) }, { id: a.id + "~out" })); }
  out.forEach((it, i) => { it.layer = i; });
  return { ...p, items: out };
}
