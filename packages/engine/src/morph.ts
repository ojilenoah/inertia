import type { Item, Keyframe, Look, Seconds } from "./types";
import { NO_LOOK } from "./types";
import { easeFn, smoothValue } from "./easing";
import type { ShapeSpec } from "./shapes";

/*
 * Keyframes for an item's look (blur, glow, shadow, depth) and its text.
 * They work like position keys: until an item has a keyframe, changes apply to the whole item;
 * after that, a change goes into the keyframe at the playhead.
 */

export type LookKey = keyof Look;
export const LOOK_KEYS: LookKey[] = ["extrude", "shadow", "blur", "glow", "draw", "drawStart"];
export interface TextKey { t: Seconds; text: string }

function sample(keys: Keyframe[] | undefined, t: Seconds, fallback: number) {
  if (!keys?.length) return fallback;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  if (a.ease === "smooth") return smoothValue(keys, i, t);
  return a.v + (b.v - a.v) * easeFn(a.ease)((t - a.t) / (b.t - a.t || 1e-9));
}

/** The item's look at item-local time `local`. */
export function lookAt(item: Item, local: Seconds): Look {
  const base = { ...NO_LOOK, ...item.look };
  if (!item.lookKeys) return base;
  const out = { ...base };
  for (const k of LOOK_KEYS) out[k] = sample(item.lookKeys[k], local, base[k]);
  return out;
}

/* ---------------- text that changes over time ---------------- */
/**
 * One letter while the text changes. `f`: how present it is (0..1). The rest is how it's drawn right now:
 * op opacity, w share of its width in the line, dy shift (em, down is +), sc size, sy extra vertical squash
 * (flips), blur (em). `ch` can be a stand-in letter for a moment (scramble).
 */
export interface MorphChar { ch: string; f: number; kind: "keep" | "del" | "add"; op?: number; w?: number; dy?: number; sc?: number; sy?: number; blur?: number }

/** The ways text can change between two text keyframes. */
export type TextMorphKind = "smooth" | "slide" | "wave" | "drop" | "flip" | "blur" | "pop" | "scramble" | "retype";
export const TEXT_MORPHS: [TextMorphKind, string, string][] = [
  ["smooth", "Smooth", "Old letters fade and close up, new ones grow in"],
  ["slide", "Slide", "Old letters slide up and out, new ones slide up into place"],
  ["wave", "Wave", "Letters change one after another, sliding in a wave"],
  ["drop", "Drop", "Old letters fall away, new ones drop in with a bounce"],
  ["flip", "Flip", "Each letter flips over like a departures board"],
  ["blur", "Blur", "Old letters blur away while new ones come into focus"],
  ["pop", "Pop", "New letters pop in with a little overshoot"],
  ["scramble", "Scramble", "Changing letters shuffle through random ones before they settle"],
  ["retype", "Retype", "The old letters are deleted one by one, then the new ones are typed"],
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const backOut = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghkmnpqrstuvwxyz0123456789#%&@$";
const glyph = (i: number, frame: number) => GLYPHS[Math.floor(Math.abs(Math.sin((i + 1) * 78.233 + frame * 12.9898) * 43758.5453) % GLYPHS.length)];

/**
 * Characters of `from` → `to` lined up (longest common subsequence: letters both share stay put), each with how
 * it looks at progress `u` (0..1, not eased) for the chosen kind of change.
 */
export function morphChars(from: string, to: string, u: number, kind: TextMorphKind = "smooth"): MorphChar[] {
  const a = [...from], b = [...to];
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: MorphChar[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push({ ch: a[i], f: 1, kind: "keep" }); i++; j++; }
    // where both work, the old letter leaves before the new one comes (reads better, and retypes naturally)
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { out.push({ ch: a[i], f: 1, kind: "del" }); i++; }
    else { out.push({ ch: b[j], f: 0, kind: "add" }); j++; }
  }
  const changed = out.filter((c) => c.kind !== "keep");
  const N = changed.length, D = changed.filter((c) => c.kind === "del").length, A = N - D;
  const frame = Math.floor(u * 40);
  let ci = 0, di = 0, ai = 0;
  // retype: deleting takes the first part, typing the rest
  const split = D && A ? 0.45 : D ? 1 : 0;
  for (const c of out) {
    if (c.kind === "keep") continue;
    const del = c.kind === "del", idx = ci++;
    // each letter's own progress: all together, or one after another (wave)
    const p = kind === "wave" ? clamp01((u - (idx / Math.max(1, N)) * 0.55) / 0.45) : u;
    const e = easeIO(p), pres = del ? 1 - e : e; // how present it is
    c.f = pres;
    switch (kind) {
      case "slide": case "wave": {
        const dist = kind === "wave" ? 0.55 : 0.7;
        Object.assign(c, { op: pres, w: pres, dy: (1 - pres) * (del ? -dist : dist) });
        break;
      }
      case "drop":
        if (del) Object.assign(c, { op: pres, w: pres, dy: (1 - pres) * 0.9 });
        else { const bo = backOut(clamp01(p)); Object.assign(c, { op: clamp01(p * 2.5), w: e, dy: -(1 - bo) * 0.9 }); }
        break;
      case "flip": {
        // the old letter folds shut in the first half, the new one opens in the second
        const sy = del ? clamp01(1 - 2 * e) : clamp01(2 * e - 1);
        Object.assign(c, { op: sy > 0.001 ? 1 : 0, w: pres, sy, dy: (1 - sy) * (del ? 0.04 : -0.04) });
        break;
      }
      case "blur":
        Object.assign(c, { op: pres, w: pres, blur: (1 - pres) * 0.35, sc: 1 + (1 - pres) * 0.18 });
        break;
      case "pop":
        if (del) Object.assign(c, { op: pres, w: pres, sc: 0.3 + 0.7 * pres });
        else Object.assign(c, { op: clamp01(p * 3), w: e, sc: Math.max(0, backOut(clamp01(p))) });
        break;
      case "scramble": {
        const settled = del ? false : p >= 0.8;
        if (!settled && pres > 0.02) c.ch = /\s/.test(c.ch) ? c.ch : glyph(idx, frame);
        Object.assign(c, { op: del ? clamp01(pres * 1.4) : clamp01(p * 3), w: pres });
        break;
      }
      case "retype": {
        // deletes from the last changed letter back, then types the new ones in order
        let on: boolean;
        if (del) { const k = di++; on = u < split * ((D - k) / D); }
        else { const k = ai++; on = u >= split + (1 - split) * ((k + 0.5) / A); }
        c.f = on ? 1 : 0;
        Object.assign(c, { op: on ? 1 : 0, w: on ? 1 : 0 });
        break;
      }
      default: // smooth
        Object.assign(c, { op: pres, w: pres, dy: (1 - pres) * (del ? -0.25 : 0.25), sc: 0.6 + 0.4 * pres });
    }
  }
  return out;
}

/** The text at item-local time: a plain string, or a morph between two text keyframes. */
/** The text at item-local time; while it changes between two text keyframes, its letters (`morph`), the two texts and how far along (0..1). */
export function textAt(item: Item, local: Seconds): { text: string; morph?: MorphChar[]; from?: string; to?: string; u?: number } {
  const ks = item.textKeys;
  if (!ks?.length) return { text: item.text ?? "" };
  if (local <= ks[0].t) return { text: ks[0].text };
  const last = ks[ks.length - 1];
  if (local >= last.t) return { text: last.text };
  let i = 0;
  while (i < ks.length - 2 && local >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1];
  if (a.text === b.text) return { text: a.text };
  const u = (local - a.t) / (b.t - a.t || 1e-9);
  if (u <= 0) return { text: a.text };
  if (u >= 1) return { text: b.text };
  return { text: u < 0.5 ? a.text : b.text, morph: morphChars(a.text, b.text, u, item.textMorph ?? "smooth"), from: a.text, to: b.text, u };
}

/* ---------------- editing with the keyframe rule ---------------- */
const EPS = 1e-4;
/** All keyframe times of an item (position/rotation/…, look and text). */
export function allKeyTimes(item: Item): number[] {
  const s = new Set<number>();
  const add = (t: number) => s.add(Math.round(t * 1e4) / 1e4);
  for (const ks of Object.values(item.keys)) ks?.forEach((k) => add(k.t));
  for (const ks of Object.values(item.lookKeys ?? {})) ks?.forEach((k) => add(k.t));
  item.textKeys?.forEach((k) => add(k.t));
  item.shapeKeys?.forEach((k) => add(k.t));
  for (const ks of Object.values(item.numKeys ?? {})) ks?.forEach((k) => add(k.t));
  for (const ks of Object.values(item.colorKeys ?? {})) ks?.forEach((k) => add(k.t));
  item.textRanges?.forEach((rg) => rg.keys?.forEach((k) => add(k.t)));
  item.fx?.forEach((f) => f.keys?.forEach((k) => add(k.t)));
  item.layerKeys?.forEach((k) => add(k.t));
  return [...s].sort((a, b) => a - b);
}

function snapLocal(item: Item, t: Seconds, snapS: number) {
  let local = Math.min(Math.max(t - item.start, 0), item.end - item.start);
  let best: number | null = null, bd = snapS;
  for (const k of allKeyTimes(item)) { const d = Math.abs(k - local); if (d <= bd) { bd = d; best = k; } }
  if (best != null) local = best;
  return local;
}

/** Change a look value (no keyframes: the whole item; otherwise the keyframe at the playhead). */
export function setLook(item: Item, k: LookKey, t: Seconds, v: number, snapS = 0.02) {
  const times = allKeyTimes(item);
  if (!times.length) { item.look = { ...NO_LOOK, ...item.look, [k]: v }; return; }
  const local = snapLocal(item, t, snapS);
  const lk = (item.lookKeys ??= {});
  if (!lk[k]?.length) { const old = { ...NO_LOOK, ...item.look }[k]; lk[k] = times.filter((x) => Math.abs(x - local) >= EPS).map((x) => ({ t: x, v: old, ease: "ease" as const })); }
  const ks = lk[k]!;
  const hit = ks.find((q) => Math.abs(q.t - local) < EPS);
  if (hit) hit.v = v; else { ks.push({ t: local, v, ease: "ease" }); ks.sort((a, b) => a.t - b.t); }
}

/** Change the text (no keyframes: everywhere; otherwise at the keyframe under the playhead, morphing between keyframes). */
export function setText(item: Item, t: Seconds, text: string, snapS = 0.02) {
  const times = allKeyTimes(item);
  if (!times.length) { item.text = text; return; }
  const local = snapLocal(item, t, snapS);
  if (!item.textKeys?.length) item.textKeys = times.filter((x) => Math.abs(x - local) >= EPS).map((x) => ({ t: x, text: item.text ?? "" }));
  const ks = item.textKeys;
  const hit = ks.find((q) => Math.abs(q.t - local) < EPS);
  if (hit) hit.text = text; else { ks.push({ t: local, text }); ks.sort((a, b) => a.t - b.t); }
}

/** Add a look/text keyframe at `local` (for "add keyframe") holding the current values, when those are animated. */
/** The item's layer at its local time (held from one keyframe to the next). */
export function layerAt(item: Item, local: Seconds): number {
  const ks = item.layerKeys;
  if (!ks?.length) return item.layer ?? 0;
  let v = ks[0].v;
  for (const k of ks) { if (k.t <= local + 1e-4) v = k.v; else break; }
  return v;
}
/** Set the layer from the keyframe at `local` on (the first time, every keyframe gets the current layer). */
export function setLayerKey(item: Item, local: Seconds, v: number) {
  if (!item.layerKeys?.length) item.layerKeys = allKeyTimes(item).map((t) => ({ t, v: item.layer ?? 0 }));
  const hit = item.layerKeys.find((k) => Math.abs(k.t - local) < 1e-3);
  if (hit) hit.v = v; else { item.layerKeys.push({ t: local, v }); item.layerKeys.sort((a, b) => a.t - b.t); }
}

export function keyLookAndText(item: Item, local: Seconds) {
  if (item.layerKeys?.length && !item.layerKeys.some((q) => Math.abs(q.t - local) < EPS)) { item.layerKeys.push({ t: local, v: layerAt(item, local) }); item.layerKeys.sort((a, b) => a.t - b.t); }
  if (item.lookKeys) {
    const cur = lookAt(item, local);
    for (const k of LOOK_KEYS) {
      const ks = item.lookKeys[k]; if (!ks?.length) continue;
      if (!ks.some((q) => Math.abs(q.t - local) < EPS)) { ks.push({ t: local, v: cur[k], ease: "ease" }); ks.sort((a, b) => a.t - b.t); }
    }
  }
  if (item.shapeKeys?.length && !item.shapeKeys.some((q) => Math.abs(q.t - local) < EPS)) {
    item.shapeKeys.push({ t: local, spec: JSON.parse(JSON.stringify(shapeAt(item, local).spec)) }); item.shapeKeys.sort((a, b) => a.t - b.t);
  }
  for (const [k, ks] of Object.entries(item.numKeys ?? {}) as [NumKey, Keyframe[]][]) if (ks.length && !ks.some((q) => Math.abs(q.t - local) < EPS)) { ks.push({ t: local, v: numAt(item, k, local), ease: "ease" }); ks.sort((a, b) => a.t - b.t); }
  for (const [k, ks] of Object.entries(item.colorKeys ?? {}) as [ColorKey, { t: number; v: string }[]][]) if (ks.length && !ks.some((q) => Math.abs(q.t - local) < EPS)) { ks.push({ t: local, v: colorAt(item, k, local) }); ks.sort((a, b) => a.t - b.t); }
  for (const rg of item.textRanges ?? []) if (rg.keys?.length && !rg.keys.some((q) => Math.abs(q.t - local) < EPS)) { rg.keys.push({ t: local, v: rangeColorAt(rg, local) }); rg.keys.sort((a, b) => a.t - b.t); }
  if (item.textKeys?.length && !item.textKeys.some((q) => Math.abs(q.t - local) < EPS)) {
    item.textKeys.push({ t: local, text: textAt(item, local).text }); item.textKeys.sort((a, b) => a.t - b.t);
  }
}

/** Remove look/text keyframes at `local`; when the last one goes, its value stays as the item's value. */
export function removeLookAndTextKeys(item: Item, local: Seconds) {
  if (item.layerKeys) {
    const i = item.layerKeys.findIndex((q) => Math.abs(q.t - local) < 1e-3);
    if (i >= 0) { const [g] = item.layerKeys.splice(i, 1); if (!item.layerKeys.length) { item.layer = g.v; delete item.layerKeys; } }
  }
  for (const f of item.fx ?? []) {
    if (!f.keys) continue; const i = f.keys.findIndex((q) => Math.abs(q.t - local) < 1e-3); if (i < 0) continue;
    const [g] = f.keys.splice(i, 1); if (!f.keys.length) { f.amount = g.v; delete f.keys; }
  }
  for (const [k, ks] of Object.entries(item.numKeys ?? {}) as [NumKey, Keyframe[]][]) {
    const i = ks.findIndex((q) => Math.abs(q.t - local) < 1e-3); if (i < 0) continue;
    const [g] = ks.splice(i, 1); if (!ks.length) { (item as unknown as Record<string, number>)[k] = g.v; delete item.numKeys![k]; }
  }
  for (const [k, ks] of Object.entries(item.colorKeys ?? {}) as [ColorKey, { t: number; v: string }[]][]) {
    const i = ks.findIndex((q) => Math.abs(q.t - local) < 1e-3); if (i < 0) continue;
    const [g] = ks.splice(i, 1); if (!ks.length) { setBaseColor(item, k, g.v); delete item.colorKeys![k]; }
  }
  for (const rg of item.textRanges ?? []) {
    if (!rg.keys) continue; const i = rg.keys.findIndex((q) => Math.abs(q.t - local) < 1e-3); if (i < 0) continue;
    const [g] = rg.keys.splice(i, 1); if (!rg.keys.length) { rg.color = g.v; delete rg.keys; }
  }
  if (item.shapeKeys) {
    const i = item.shapeKeys.findIndex((q) => Math.abs(q.t - local) < 1e-3);
    if (i >= 0) { const [gone] = item.shapeKeys.splice(i, 1); if (!item.shapeKeys.length) { item.shape = gone.spec; delete item.shapeKeys; } }
  }
  if (item.strokes) item.strokes = item.strokes.filter((s) => Math.abs(s.a - local) >= 1e-3 && Math.abs(s.b - local) >= 1e-3);
  if (item.lookKeys) for (const k of LOOK_KEYS) {
    const ks = item.lookKeys[k]; if (!ks) continue;
    const i = ks.findIndex((q) => Math.abs(q.t - local) < 1e-3);
    if (i < 0) continue;
    const [gone] = ks.splice(i, 1);
    if (!ks.length) { item.look = { ...NO_LOOK, ...item.look, [k]: gone.v }; delete item.lookKeys[k]; }
  }
  if (item.textKeys) {
    const i = item.textKeys.findIndex((q) => Math.abs(q.t - local) < 1e-3);
    if (i >= 0) { const [gone] = item.textKeys.splice(i, 1); if (!item.textKeys.length) { item.text = gone.text; delete item.textKeys; } }
  }
}

/** Move look/text keyframes at time `from` to `to` (dragging a diamond). */
export function moveLookAndTextKeys(item: Item, from: Seconds, to: Seconds) {
  const lists = [item.layerKeys ?? [], ...Object.values(item.numKeys ?? {}), ...Object.values(item.colorKeys ?? {}), ...(item.textRanges ?? []).map((rg) => rg.keys ?? []), ...(item.fx ?? []).map((f) => f.keys ?? [])].filter(Boolean) as { t: number }[][];
  for (const ks of lists) { const k = ks.find((q) => Math.abs(q.t - from) < 1e-3); if (k && !ks.some((q) => q !== k && Math.abs(q.t - to) < 1e-3)) { k.t = to; ks.sort((a, b) => a.t - b.t); } }
  const sk = item.shapeKeys?.find((q) => Math.abs(q.t - from) < 1e-3);
  if (sk && !item.shapeKeys!.some((q) => q !== sk && Math.abs(q.t - to) < 1e-3)) { sk.t = to; item.shapeKeys!.sort((a, b) => a.t - b.t); }
  for (const s of item.strokes ?? []) { if (Math.abs(s.a - from) < 1e-3) s.a = to; if (Math.abs(s.b - from) < 1e-3) s.b = to; }
  for (const ks of Object.values(item.lookKeys ?? {})) {
    if (!ks) continue;
    const k = ks.find((q) => Math.abs(q.t - from) < 1e-3);
    if (k && !ks.some((q) => q !== k && Math.abs(q.t - to) < 1e-3)) { k.t = to; ks.sort((a, b) => a.t - b.t); }
  }
  const tk = item.textKeys?.find((q) => Math.abs(q.t - from) < 1e-3);
  if (tk && !item.textKeys!.some((q) => q !== tk && Math.abs(q.t - to) < 1e-3)) { tk.t = to; item.textKeys!.sort((a, b) => a.t - b.t); }
}

/** Shift all look/text keyframes by dt (trimming an item's start keeps them in place in time). */
export function shiftLookAndTextKeys(item: Item, dt: Seconds) {
  item.layerKeys?.forEach((k) => (k.t += dt));
  item.fx?.forEach((f) => f.keys?.forEach((k) => (k.t += dt)));
  for (const ks of Object.values(item.numKeys ?? {})) ks?.forEach((k) => (k.t += dt));
  for (const ks of Object.values(item.colorKeys ?? {})) ks?.forEach((k) => (k.t += dt));
  item.textRanges?.forEach((rg) => rg.keys?.forEach((k) => (k.t += dt)));
  item.shapeKeys?.forEach((k) => (k.t += dt));
  for (const s of item.strokes ?? []) { s.a += dt; s.b += dt; }
  for (const ks of Object.values(item.lookKeys ?? {})) ks?.forEach((k) => (k.t += dt));
  item.textKeys?.forEach((k) => (k.t += dt));
}

/* ---------------- shapes that change over time ---------------- */
/** The shape at item-local time: one shape, or two with how far the morph between them has got. */
export function shapeAt(item: Item, local: Seconds): { spec: ShapeSpec; to?: ShapeSpec; p?: number } {
  const ks = item.shapeKeys, base = item.shape ?? { type: "rect" as const };
  if (!ks?.length) return { spec: base };
  if (local <= ks[0].t) return { spec: ks[0].spec };
  const last = ks[ks.length - 1];
  if (local >= last.t) return { spec: last.spec };
  let i = 0;
  while (i < ks.length - 2 && local >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1];
  if (JSON.stringify(a.spec) === JSON.stringify(b.spec)) return { spec: a.spec };
  const p = easeFn("ease")((local - a.t) / (b.t - a.t || 1e-9));
  return p <= 0 ? { spec: a.spec } : p >= 1 ? { spec: b.spec } : { spec: a.spec, to: b.spec, p };
}
/** Change the shape (no keyframes: the whole item; otherwise at the keyframe under the playhead). */
export function setShape(item: Item, t: Seconds, spec: ShapeSpec, snapS = 0.02) {
  const times = allKeyTimes(item);
  if (!times.length) { item.shape = spec; return; }
  const local = snapLocal(item, t, snapS);
  if (!item.shapeKeys?.length) item.shapeKeys = times.filter((x) => Math.abs(x - local) >= EPS).map((x) => ({ t: x, spec: JSON.parse(JSON.stringify(item.shape ?? spec)) }));
  const ks = item.shapeKeys;
  const hit = ks.find((q) => Math.abs(q.t - local) < EPS);
  if (hit) hit.spec = spec; else { ks.push({ t: local, spec }); ks.sort((a, b) => a.t - b.t); }
}

/* ---------------- numbers and colours that change at keyframes ---------------- */
export type NumKey = "fontSize" | "letterSpacing" | "radius" | "pathOffset" | "pathGap" | "pathTilt" | "hollow" | "turn" | "volume" | import("./pin").PinKey;
export type ColorKey = "color" | "fill" | "stroke";
const NUM_DEFAULT: Record<NumKey, number> = { fontSize: 100, letterSpacing: -0.04, radius: 0, pathOffset: 0, pathGap: 0, pathTilt: 0, hollow: 0, turn: 0, volume: 1,
  pin0x: 0, pin0y: 0, pin1x: 0, pin1y: 0, pin2x: 0, pin2y: 0, pin3x: 0, pin3y: 0 };
const numBase = (item: Item, k: NumKey) => ((item as unknown as Record<string, number | undefined>)[k] ?? NUM_DEFAULT[k]);
export function numAt(item: Item, k: NumKey, local: Seconds): number { return sample(item.numKeys?.[k], local, numBase(item, k)); }

function baseColor(item: Item, k: ColorKey): string { return k === "color" ? item.color ?? "#111111" : k === "fill" ? item.fill : item.stroke?.color ?? "#111111"; }
function setBaseColor(item: Item, k: ColorKey, v: string) {
  if (k === "color") item.color = v; else if (k === "fill") item.fill = v; else item.stroke = { width: item.stroke?.width ?? 0, color: v };
}
function hex3(c: string): [number, number, number] | null {
  const mm = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return mm ? [parseInt(mm[1], 16), parseInt(mm[2], 16), parseInt(mm[3], 16)] : null;
}
/** Colour between two colour keyframes (hex colours blend; anything else switches halfway). */
function sampleColor(ks: { t: number; v: string }[] | undefined, t: Seconds, fallback: string): string {
  if (!ks?.length) return fallback;
  if (t <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < ks.length - 2 && t >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1], p = easeFn("ease")((t - a.t) / (b.t - a.t || 1e-9));
  const A = hex3(a.v), B = hex3(b.v);
  if (!A || !B) return p < 0.5 ? a.v : b.v;
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(A[0] + (B[0] - A[0]) * p)}${h(A[1] + (B[1] - A[1]) * p)}${h(A[2] + (B[2] - A[2]) * p)}`;
}
export function colorAt(item: Item, k: ColorKey, local: Seconds): string { return sampleColor(item.colorKeys?.[k], local, baseColor(item, k)); }
export function rangeColorAt(rg: NonNullable<Item["textRanges"]>[number], local: Seconds): string { return sampleColor(rg.keys, local, rg.color); }

/** Change a number setting with the keyframe rule. */
export function setNum(item: Item, k: NumKey, t: Seconds, v: number, snapS = 0.02) {
  const times = allKeyTimes(item);
  if (!times.length) { (item as unknown as Record<string, number>)[k] = v; return; }
  const local = snapLocal(item, t, snapS), nk = (item.numKeys ??= {});
  if (!nk[k]?.length) { const old = numBase(item, k); nk[k] = times.filter((x) => Math.abs(x - local) >= EPS).map((x) => ({ t: x, v: old, ease: "ease" as const })); }
  const ks = nk[k]!, hit = ks.find((q) => Math.abs(q.t - local) < EPS);
  if (hit) hit.v = v; else { ks.push({ t: local, v, ease: "ease" }); ks.sort((a, b) => a.t - b.t); }
}
/** Change a colour with the keyframe rule. */
export function setColor(item: Item, k: ColorKey, t: Seconds, v: string, snapS = 0.02) {
  const times = allKeyTimes(item);
  if (!times.length) { setBaseColor(item, k, v); return; }
  const local = snapLocal(item, t, snapS), ck = (item.colorKeys ??= {});
  if (!ck[k]?.length) { const old = baseColor(item, k); ck[k] = times.filter((x) => Math.abs(x - local) >= EPS).map((x) => ({ t: x, v: old })); }
  const ks = ck[k]!, hit = ks.find((q) => Math.abs(q.t - local) < EPS);
  if (hit) hit.v = v; else { ks.push({ t: local, v }); ks.sort((a, b) => a.t - b.t); }
}
/** Change one letter range's colour with the keyframe rule. */
export function setRangeColor(item: Item, rangeId: string, t: Seconds, v: string, snapS = 0.02) {
  const rg = item.textRanges?.find((q) => q.id === rangeId);
  if (!rg) return;
  const times = allKeyTimes(item);
  if (!times.length) { rg.color = v; return; }
  const local = snapLocal(item, t, snapS);
  if (!rg.keys?.length) rg.keys = times.filter((x) => Math.abs(x - local) >= EPS).map((x) => ({ t: x, v: rg.color }));
  const hit = rg.keys.find((q) => Math.abs(q.t - local) < EPS);
  if (hit) hit.v = v; else { rg.keys.push({ t: local, v }); rg.keys.sort((a, b) => a.t - b.t); }
}
/** Colour of each letter (index into the text) that has its own colour at this moment. */
export function letterColors(item: Item, local: Seconds): Map<number, string> | null {
  if (!item.textRanges?.length) return null;
  const out = new Map<number, string>();
  for (const rg of item.textRanges) { const c = rangeColorAt(rg, local); for (let i = rg.start; i < rg.end; i++) out.set(i, c); }
  return out;
}

/** The item with every keyframed setting worked out for this moment (look, text, numbers, colours). */
export function resolveItem(item: Item, local: Seconds): Item {
  if (!item.lookKeys && !item.textKeys && !item.numKeys && !item.colorKeys) return item;
  const out: Item = { ...item, look: lookAt(item, local), text: textAt(item, local).text };
  for (const k of Object.keys(item.numKeys ?? {}) as NumKey[]) (out as unknown as Record<string, number>)[k] = numAt(item, k, local);
  if (item.colorKeys?.color) out.color = colorAt(item, "color", local);
  if (item.colorKeys?.fill) out.fill = colorAt(item, "fill", local);
  if (item.colorKeys?.stroke && item.stroke) out.stroke = { ...item.stroke, color: colorAt(item, "stroke", local) };
  return out;
}

/* ---------------- effect amounts that change at keyframes ---------------- */
/** Change an effect's amount (no keyframes: the whole item; otherwise at the keyframe under the playhead). */
export function setFxAmount(item: Item, fxId: string, t: Seconds, v: number, snapS = 0.02) {
  const f = item.fx?.find((q) => q.id === fxId);
  if (!f) return;
  const times = allKeyTimes(item);
  if (!times.length) { f.amount = v; delete f.keys; return; }
  const local = snapLocal(item, t, snapS);
  if (!f.keys?.length) f.keys = times.filter((x) => Math.abs(x - local) >= EPS).map((x) => ({ t: x, v: f.amount }));
  const hit = f.keys.find((q) => Math.abs(q.t - local) < EPS);
  if (hit) hit.v = v; else { f.keys.push({ t: local, v }); f.keys.sort((a, b) => a.t - b.t); }
}
/** Is the playhead on one of the item's keyframes? */
export function onKeyframe(item: Item, t: Seconds, snapS = 0.02): boolean {
  const local = t - item.start;
  return allKeyTimes(item).some((k) => Math.abs(k - local) <= snapS);
}

/** Front-to-back comparison at time t (for sorting what's drawn first): layer, then track order. */
export function stackCompare(project: import("./types").Project, t: Seconds) {
  // one number per item: its layer plus a fraction for its track (so layers can sit between two items)
  const N = project.tracks.length + 1;
  const rank = new Map(project.tracks.map((tr, i) => [tr.id, project.tracks.length - i]));
  const z = (it: Item) => layerAt(it, t - it.start) + (rank.get(it.trackId) ?? 0) / N;
  return (a: Item, b: Item) => z(a) - z(b);
}

/** How long a change of layer takes: the item crossfades from its old place in the stack to its new one. */
export const LAYER_FADE = 0.4;
/** While an item changes layer at a keyframe: the old and new layers and how far through the crossfade it is (0 → 1). */
export function layerFade(item: Item, local: Seconds): { from: number; to: number; p: number } | null {
  const ks = item.layerKeys;
  if (!ks || ks.length < 2) return null;
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1], b = ks[i];
    if (a.v === b.v) continue;
    const h = Math.min(LAYER_FADE / 2, (b.t - a.t) / 2, ks[i + 1] ? (ks[i + 1].t - b.t) / 2 : Infinity);
    if (h > 0 && local >= b.t - h && local < b.t + h) { const x = (local - (b.t - h)) / (2 * h); return { from: a.v, to: b.v, p: x * x * (3 - 2 * x) }; }
  }
  return null;
}
/** What's drawn at time t, back to front. An item changing layer is drawn twice for a moment: fading out at its old place, in at its new one. */
export function stackAt(project: import("./types").Project, t: Seconds, items: Item[]): { it: Item; alpha: number; ghost: boolean }[] {
  const N = project.tracks.length + 1;
  const rank = new Map(project.tracks.map((tr, i) => [tr.id, project.tracks.length - i]));
  const out: { it: Item; alpha: number; ghost: boolean; z: number }[] = [];
  for (const it of items) {
    const r = (rank.get(it.trackId) ?? 0) / N, f = layerFade(it, t - it.start);
    if (!f) { out.push({ it, alpha: 1, ghost: false, z: layerAt(it, t - it.start) + r }); continue; }
    // the item stays fully drawn at the lower of its two places; a copy at the higher one fades (in when it's
    // rising, out when it's sinking), so only what it passes changes — the item itself never fades
    const up = f.to > f.from, lo = up ? f.from : f.to, hi = up ? f.to : f.from;
    out.push({ it, alpha: 1, ghost: false, z: lo + r });
    out.push({ it, alpha: up ? f.p : 1 - f.p, ghost: true, z: hi + r + 1e-6 });
  }
  return out.sort((a, b) => a.z - b.z);
}

/* ---------------- text tricks ---------------- */
const SCRAMBLE = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*@$";
/** The text as shown at local time: its keyframed text with any trick applied (counter, scramble, cursor). */
export function textShown(item: Item, local: Seconds): { text: string; morph?: MorphChar[]; from?: string; to?: string; u?: number } {
  const base = textAt(item, local), f = item.textFx;
  if (!f || base.morph) return base;
  const life = Math.max(0.01, item.end - item.start);
  if (f.kind === "count") {
    const p = easeFn("ease")(Math.min(1, Math.max(0, local / (f.dur ?? life))));
    const v = (f.from ?? 0) + ((f.to ?? 100) - (f.from ?? 0)) * p;
    const num = v.toLocaleString("en-US", { minimumFractionDigits: f.decimals ?? 0, maximumFractionDigits: f.decimals ?? 0 });
    return { text: `${f.prefix ?? ""}${num}${f.suffix ?? ""}` };
  }
  if (f.kind === "scramble") {
    const dur = f.dur ?? Math.min(1.2, life), txt = base.text, settled = Math.floor((Math.min(1, local / dur)) * txt.length);
    const fr = Math.floor(local * 24);
    return { text: [...txt].map((ch, i) => (i < settled || /\s/.test(ch) ? ch : SCRAMBLE[Math.floor(Math.abs(Math.sin((i + 1) * 91.7 + fr * 13.1)) * SCRAMBLE.length) % SCRAMBLE.length])).join("") };
  }
  // cursor: a bar after the text that blinks twice a second
  return { text: base.text + (Math.floor(local * 2) % 2 === 0 ? "|" : "\u2009") };
}

/** Move several keyframe times of an item at once (every kind of key): `map` gives a key's new time, or null to leave it. */
export function remapKeyTimes(item: Item, map: (t: Seconds) => Seconds | null) {
  const fix = <K extends { t: number }>(ks: K[] | undefined) => { if (!ks) return; for (const k of ks) { const n = map(k.t); if (n != null) k.t = n; } ks.sort((a, b) => a.t - b.t); };
  for (const ks of Object.values(item.keys)) fix(ks);
  for (const ks of Object.values(item.lookKeys ?? {})) fix(ks);
  for (const ks of Object.values(item.numKeys ?? {})) fix(ks);
  for (const ks of Object.values(item.colorKeys ?? {})) fix(ks);
  fix(item.textKeys); fix(item.shapeKeys); fix(item.layerKeys);
  item.textRanges?.forEach((rg) => fix(rg.keys));
  item.fx?.forEach((f) => fix(f.keys));
  for (const st of item.strokes ?? []) { const a = map(st.a), b = map(st.b); if (a != null) st.a = a; if (b != null) st.b = b; }
}
