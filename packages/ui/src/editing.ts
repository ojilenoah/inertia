import type { Item, Keyframe, Project, Prop } from "@moshion/engine";
import { groupItems, groupOf, groupTracks, ungroupTrack } from "@moshion/engine";
import { LOOK_KEYS, removeLookAndTextKeys, allKeyTimes, colorAt, itemState, keyAt, lookAt, numAt, ownValue, setColor, setLook, setNum, setValue, setShape, setText, shapeAt, textAt } from "@moshion/engine";
import type { ColorKey, LookKey, NumKey, ShapeSpec } from "@moshion/engine";
import { useStore } from "./store";
import { maskFollowers } from "./extras";

/* ---------------- copy / paste a keyframe ---------------- */
interface KeyClip { props: Partial<Record<Prop, number>>; look: Partial<Record<LookKey, number>>; nums: Partial<Record<NumKey, number>>; colors: Partial<Record<ColorKey, string>>; text?: string; shape?: ShapeSpec; from?: string }
let keyClip: KeyClip | null = null;

/** Copy the values of every setting animated on the selected item, at the playhead (or on `itemId` at time `at`). */
export function copyKeyframe(itemId?: string, at?: number) {
  const s = useStore.getState();
  const it = s.project.items.find((i) => i.id === (itemId ?? s.selected));
  if (!it) { s.toast("Select an item first"); return; }
  const T = at ?? s.t;
  const local = T - it.start;
  const clip: KeyClip = { props: {}, look: {}, nums: {}, colors: {} };
  for (const p of Object.keys(it.keys) as Prop[]) if (it.keys[p]?.length) clip.props[p] = ownValue(it, p, T);
  if (!Object.keys(clip.props).length) for (const p of ["x", "y", "rz", "scale", "opacity"] as Prop[]) clip.props[p] = ownValue(it, p, T);
  const look = lookAt(it, local);
  for (const k of LOOK_KEYS) if (it.lookKeys?.[k]?.length) clip.look[k] = look[k];
  for (const k of Object.keys(it.numKeys ?? {}) as NumKey[]) clip.nums[k] = numAt(it, k, local);
  for (const k of Object.keys(it.colorKeys ?? {}) as ColorKey[]) clip.colors[k] = colorAt(it, k, local);
  // what the text says and the shape it has, when those change at keyframes
  if (it.textKeys?.length) clip.text = textAt(it, local).text;
  if (it.shapeKeys?.length) clip.shape = JSON.parse(JSON.stringify(shapeAt(it, local).spec));
  clip.from = it.id;
  keyClip = clip;
  s.toast(itemId ? "Keyframe settings copied · right-click another keyframe › Paste settings" : "Keyframe copied · select an item, move the playhead and paste (Alt+V)");
}
/** Is there a copied keyframe to paste? */
export const hasKeyClip = () => !!keyClip;
/** Paste the copied keyframe at the playhead on the selected item(s). */
export function pasteKeyframe(itemId?: string, at?: number) {
  const s = useStore.getState();
  if (!keyClip) { s.toast("Copy a keyframe first (Alt+C)"); return; }
  const ids = itemId ? [itemId] : s.ui.multi.length ? s.ui.multi : s.selected ? [s.selected] : [];
  if (!ids.length) { s.toast("Select an item first"); return; }
  const c = keyClip, T = at ?? s.t;
  s.edit((p) => {
    for (const id of ids) {
      const it = p.items.find((i) => i.id === id); if (!it) continue;
      // a pasted keyframe is a keyframe: make sure the item has one here before setting values
      if (!allKeyTimes(it).length) for (const pr of Object.keys(c.props) as Prop[]) { (it.keys[pr] ??= []).push({ t: Math.max(0, T - it.start), v: ownValue(it, pr, T), ease: "ease" }); }
      for (const [pr, v] of Object.entries(c.props) as [Prop, number][]) setValue(it, pr, T, v);
      for (const [k, v] of Object.entries(c.look) as [LookKey, number][]) setLook(it, k, T, v);
      for (const [k, v] of Object.entries(c.nums) as [NumKey, number][]) setNum(it, k, T, v);
      for (const [k, v] of Object.entries(c.colors) as [ColorKey, string][]) setColor(it, k, T, v);
      if (c.text != null && it.kind === "text") setText(it, T, c.text);
      if (c.shape && it.kind === "shape") setShape(it, T, JSON.parse(JSON.stringify(c.shape)));
    }
  });
  s.toast(`Keyframe pasted${ids.length > 1 ? ` on ${ids.length} items` : ""}`);
}
/** Is there a keyframe under the playhead on this item? */
export const keyHere = (it: Item, t: number) => keyAt(allKeyTimes(it), t - it.start) != null;

/* ---------------- copy / paste style ---------------- */
const STYLE_KEYS: (keyof Item)[] = ["fill", "stroke", "radius", "look", "fx", "blend", "color", "fontFamily", "fontWeight", "italic", "underline", "letterSpacing",
  "lineHeight", "textCase", "textBg", "textPad", "textGradient", "textShadow", "bgOpacity", "wordSpacing", "fit"];
let styleClip: { from: Item["kind"]; style: Partial<Item> } | null = null;
export function copyStyle() {
  const s = useStore.getState();
  const it = s.project.items.find((i) => i.id === s.selected);
  if (!it) { s.toast("Select an item first"); return; }
  const style: Partial<Item> = {};
  for (const k of STYLE_KEYS) if (it[k] !== undefined) (style as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(it[k]));
  if (it.shape) style.shape = JSON.parse(JSON.stringify(it.shape));
  if (it.line) style.line = { ...it.line, pts: [] } as Item["line"];
  styleClip = { from: it.kind, style };
  s.toast("Style copied");
}
export function pasteStyle() {
  const s = useStore.getState();
  if (!styleClip) { s.toast("Copy a style first (Ctrl+Alt+C)"); return; }
  const ids = s.ui.multi.length ? s.ui.multi : s.selected ? [s.selected] : [];
  if (!ids.length) { s.toast("Select an item first"); return; }
  const c = styleClip;
  s.edit((p) => {
    for (const id of ids) {
      const it = p.items.find((i) => i.id === id); if (!it) continue;
      for (const [k, v] of Object.entries(c.style)) {
        if (k === "shape") { if (it.kind === "shape") it.shape = JSON.parse(JSON.stringify(v)); continue; }
        if (k === "line") { if (it.line && v) { const l = v as NonNullable<Item["line"]>; it.line = { ...it.line, width: l.width, color: l.color, dash: l.dash, arrow: l.arrow, cap: l.cap }; } continue; }
        if (k === "fill" && (it.kind === "text" || it.kind === "line")) continue;
        (it as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(v));
      }
    }
  });
  s.toast(`Style pasted${ids.length > 1 ? ` on ${ids.length} items` : ""}`);
}

/* ---------------- align & distribute ---------------- */
export type AlignHow = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hspread" | "vspread";
function box(project: Project, it: Item, t: number) {
  const s = itemState(project, it, t);
  const w = it.w * s.scale, h = it.h * s.scale;
  return { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - h / 2, y1: s.y + h / 2, cx: s.x, cy: s.y };
}
/** Line up the selected items (or one item with the canvas). */
export function align(how: AlignHow) {
  const s = useStore.getState();
  const ids = s.ui.multi.length ? s.ui.multi : s.selected ? [s.selected] : [];
  const items = s.project.items.filter((i) => ids.includes(i.id));
  if (!items.length) return;
  const boxes = items.map((it) => ({ it, b: box(s.project, it, s.t) }));
  const one = items.length === 1;
  // one item placed inside another lines up with its container; otherwise with the canvas
  const host = one && items[0].mask?.inside ? s.project.items.find((i) => i.id === items[0].mask!.by) : undefined;
  const hb = host ? box(s.project, host, s.t) : null;
  const all = one ? (hb ?? { x0: 0, x1: s.project.width, y0: 0, y1: s.project.height }) : {
    x0: Math.min(...boxes.map((q) => q.b.x0)), x1: Math.max(...boxes.map((q) => q.b.x1)), y0: Math.min(...boxes.map((q) => q.b.y0)), y1: Math.max(...boxes.map((q) => q.b.y1)),
  };
  const moves = new Map<string, [number, number]>();
  if (how === "hspread" || how === "vspread") {
    if (boxes.length < 3) { s.toast("Select three or more items to spread them out"); return; }
    const hz = how === "hspread", sorted = [...boxes].sort((a, b) => (hz ? a.b.cx - b.b.cx : a.b.cy - b.b.cy));
    const first = hz ? sorted[0].b.cx : sorted[0].b.cy, last = hz ? sorted[sorted.length - 1].b.cx : sorted[sorted.length - 1].b.cy;
    sorted.forEach((q, i) => { const target = first + ((last - first) * i) / (sorted.length - 1); moves.set(q.it.id, hz ? [target - q.b.cx, 0] : [0, target - q.b.cy]); });
  } else {
    for (const { it, b } of boxes) {
      const dx = how === "left" ? all.x0 - b.x0 : how === "right" ? all.x1 - b.x1 : how === "hcenter" ? (all.x0 + all.x1) / 2 - b.cx : 0;
      const dy = how === "top" ? all.y0 - b.y0 : how === "bottom" ? all.y1 - b.y1 : how === "vcenter" ? (all.y0 + all.y1) / 2 - b.cy : 0;
      moves.set(it.id, [dx, dy]);
    }
  }
  s.edit((p) => {
    for (const [id, [dx, dy]] of moves) {
      const it = p.items.find((i) => i.id === id); if (!it) continue;
      if (dx) setValue(it, "x", s.t, Math.round(ownValue(it, "x", s.t) + dx));
      if (dy) setValue(it, "y", s.t, Math.round(ownValue(it, "y", s.t) + dy));
    }
  });
}

/** Move the selected items by a few pixels (arrow keys). */
export function nudge(dx: number, dy: number) {
  const s = useStore.getState();
  const sel = s.ui.multi.length ? s.ui.multi : s.selected ? [s.selected] : [];
  if (!sel.length) return false;
  const ids = [...sel, ...maskFollowers(s.project, sel)]; // what they mask comes along
  s.edit((p) => {
    for (const id of ids) {
      const it = p.items.find((i) => i.id === id); if (!it) continue;
      if (dx) setValue(it, "x", s.t, ownValue(it, "x", s.t) + dx);
      if (dy) setValue(it, "y", s.t, ownValue(it, "y", s.t) + dy);
    }
  });
  return true;
}

/* ---------------- several keyframes at once ---------------- */
type KeyCopy = { dt: number; vals: Partial<Record<Prop, { v: number; ease: Keyframe["ease"] }>> }[];
let pickClip: KeyCopy | null = null;
/** Copy the picked keyframes (their position, size, turn and opacity values, and spacing). */
export function copyPickedKeys(): boolean {
  const s = useStore.getState(), all = s.ui.keySel ?? [];
  // copies from one clip: the selected one if it has picked keys, else the first
  const ks = all.find((q) => q.itemId === s.selected) ?? all[0];
  const it = ks && s.project.items.find((i) => i.id === ks.itemId);
  if (!ks || !it || !ks.times.length) return false;
  pickClip = ks.times.map((t) => ({
    dt: t - ks.times[0],
    vals: Object.fromEntries((Object.keys(it.keys) as Prop[]).flatMap((p) => { const k = it.keys[p]?.find((q) => Math.abs(q.t - t) < 1e-3); return k ? [[p, { v: k.v, ease: k.ease }]] : []; })),
  }));
  s.toast(`${ks.times.length} keyframe${ks.times.length === 1 ? "" : "s"} copied`);
  return true;
}
/** Paste copied keyframes into the selected item, starting at the playhead. */
export function pastePickedKeys(): boolean {
  const s = useStore.getState(), it = s.project.items.find((i) => i.id === s.selected);
  if (!pickClip || !it) return false;
  const at = s.t - it.start, clip = pickClip;
  s.edit((p) => {
    const d = p.items.find((i) => i.id === it.id)!;
    for (const c of clip) for (const [pp, kv] of Object.entries(c.vals) as [Prop, { v: number; ease: Keyframe["ease"] }][]) {
      const ks = (d.keys[pp] ??= []), t = Math.min(at + c.dt, d.end - d.start);
      const hit = ks.find((q) => Math.abs(q.t - t) < 1e-3);
      if (hit) { hit.v = kv.v; hit.ease = kv.ease; } else { ks.push({ t, v: kv.v, ease: kv.ease }); ks.sort((a, b) => a.t - b.t); }
    }
  });
  s.toast(`${clip.length} keyframe${clip.length === 1 ? "" : "s"} pasted`);
  return true;
}
/** Delete the picked keyframes. */
export function deletePickedKeys(): boolean {
  const s = useStore.getState(), all = s.ui.keySel ?? [];
  const n = all.reduce((m, q) => m + q.times.length, 0);
  if (!n) return false;
  s.edit((p) => {
    for (const ks of all) {
      const d = p.items.find((i) => i.id === ks.itemId); if (!d) continue;
      for (const t of ks.times) { for (const k of Object.keys(d.keys) as Prop[]) d.keys[k] = d.keys[k]?.filter((q) => Math.abs(q.t - t) >= 1e-3); removeLookAndTextKeys(d, t); }
    }
  });
  s.setUI({ keySel: null });
  s.toast(`${n} keyframe${n === 1 ? "" : "s"} deleted`);
  return true;
}

/** Lock the selected items (one or many) — or unlock them if they're all locked already. */
export function toggleLock(ids?: string[]): boolean {
  const s = useStore.getState();
  const sel = ids ?? (s.ui.multi.length ? s.ui.multi : s.selected ? [s.selected] : []);
  const its = s.project.items.filter((i) => sel.includes(i.id));
  if (!its.length) return false;
  const lock = !its.every((i) => i.locked);
  s.edit((p) => { for (const it of p.items) if (sel.includes(it.id)) { if (lock) it.locked = true; else delete it.locked; } });
  const n = its.length, what = n === 1 ? its[0].name : `${n} items`;
  s.toast(lock ? `${what} locked · can't be clicked on the canvas · unlock: select ${n === 1 ? "it" : "them"} on the timeline, then Ctrl+Shift+L` : `${what} unlocked`);
  return true;
}

/**
 * With several keyframes of an item picked (Ctrl-drag in the tracks, Shift-click diamonds), an edit from its
 * cards goes into every picked keyframe: run() is repeated with the playhead on each one. Returns false (and does
 * nothing) when none of that item's keyframes are picked.
 */
export function atPickedKeys(itemId: string, run: () => void, commit = true): boolean {
  const s = useStore.getState(), it = s.project.items.find((i) => i.id === itemId);
  const times = s.ui.keySel?.find((q) => q.itemId === itemId)?.times ?? [];
  if (!it || !times.length) return false;
  if (commit) s.checkpoint();
  const t0 = s.t;
  for (const lt of times) { useStore.setState({ t: it.start + lt }); run(); }
  useStore.setState({ t: t0 });
  return true;
}

/** A marker at the playhead (M). */
export function addMarker() {
  const s = useStore.getState(), id = "mk" + Math.random().toString(36).slice(2, 8);
  s.edit((p) => { (p.markers ??= []).push({ id, t: s.t, label: `Marker ${(p.markers?.length ?? 0) + 1}` }); p.markers!.sort((a, b) => a.t - b.t); });
  s.toast("Marker added · double-click (double-tap) it to rename");
}
/** The loop starts at the playhead (I). */
export function loopIn() {
  const s = useStore.getState();
  s.setUI({ loop: { a: s.t, b: Math.max(s.t + 0.1, s.ui.loop?.b ?? s.project.duration), on: true } });
  s.toast("Loop starts here (O sets the end, L turns it off)");
}
/** The loop ends at the playhead (O). */
export function loopOut() {
  const s = useStore.getState();
  s.setUI({ loop: { a: Math.min(s.ui.loop?.a ?? 0, s.t - 0.1), b: s.t, on: true } });
  s.toast("Loop ends here");
}
/** Group the selected items (or tracks) (Ctrl+G). */
export function groupSelection() {
  const s = useStore.getState(), sel = s.ui.selTracks;
  if (s.ui.multi.length > 1) {
    let g: string | null = null;
    const ids = s.ui.multi;
    s.edit((p) => { g = groupItems(p, ids); });
    if (g) { s.select(null); s.setUI({ selGroup: g }); s.toast(`${ids.length} items grouped`); }
    return;
  }
  let g: string | null = null; s.edit((p) => { g = groupTracks(p, sel); });
  if (g) { s.setUI({ selTracks: [g] }); s.toast("Tracks grouped"); } else s.toast("Select two or more items first");
}
/** Ungroup the selected group, or the group the selected item is in (Ctrl+Shift+G). */
export function ungroupSelection() {
  const s = useStore.getState(), sel = s.ui.selTracks;
  const item = s.project.items.find((i) => i.id === s.selected);
  const g = s.project.tracks.find((t) => t.id === s.ui.selGroup) ?? (item && groupOf(s.project, item)) ?? s.project.tracks.find((t) => sel.includes(t.id) && t.kind === "group");
  if (g) { s.edit((p) => ungroupTrack(p, g.id)); s.setUI({ selTracks: [], selGroup: null }); s.toast(`${g.name} ungrouped`); }
}
