import type { Background, Project, Seconds } from "./types";

/*
 * Canvas keyframes: the canvas is one item on its own track. Its keyframes (absolute times)
 * let look amounts and whole-frame effect amounts change over time, like an item's effects.
 */
type Amt = { amount: number; keys?: { t: number; v: number }[] };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

export function amountAt(e: Amt, t: Seconds): number {
  const ks = e.keys;
  if (!ks?.length) return e.amount;
  if (t <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < ks.length - 2 && t >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1], p = (t - a.t) / (b.t - a.t || 1e-9), s = p * p * (3 - 2 * p);
  return a.v + (b.v - a.v) * s;
}

/* ---- colours between keyframes ---- */
const hexRGB = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export function mixColor(a: string, b: string, p: number): string {
  const A = hexRGB(a), B = hexRGB(b);
  if (!A || !B) return p < 0.5 ? a : b;
  return "#" + A.map((x, i) => Math.round(x + (B[i] - x) * p).toString(16).padStart(2, "0")).join("");
}
const smooth = (x: number) => x * x * (3 - 2 * x);
/** Find the two keyframes around t and how far between them we are. */
function around<K extends { t: number }>(ks: K[], t: Seconds): [K, K, number] {
  if (t <= ks[0].t) return [ks[0], ks[0], 0];
  const last = ks[ks.length - 1];
  if (t >= last.t) return [last, last, 0];
  let i = 0; while (i < ks.length - 2 && t >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1];
  return [a, b, smooth((t - a.t) / (b.t - a.t || 1e-9))];
}
/** A canvas part's colours, angle and movement at time t (from its keyframes). */
export function bgStateAt(b: Background, t: Seconds): { colors: string[]; angle: number; speed: number } {
  const ks = b.keys;
  if (!ks?.length) return { colors: b.colors, angle: b.angle, speed: b.speed };
  const [a, c, q] = around(ks, t);
  const n = Math.max(a.colors.length, c.colors.length);
  const colors = Array.from({ length: n }, (_, i) => mixColor(a.colors[i] ?? a.colors[a.colors.length - 1], c.colors[i] ?? c.colors[c.colors.length - 1], q));
  return { colors, angle: a.angle + (c.angle - a.angle) * q, speed: a.speed + (c.speed - a.speed) * q };
}
export function baseColorAt(p: Project, t: Seconds): string {
  const ks = p.bgColorKeys;
  if (!ks?.length) return p.background;
  const [a, c, q] = around(ks, t);
  return mixColor(a.v, c.v, q);
}

/** The project with the canvas's look and effect amounts — and its colours — worked out for time t. */
export function resolveScene(p: Project, t: Seconds): Project {
  const bgKeyed = p.backgrounds?.some((b) => b.keys?.length) || !!p.bgColorKeys?.length;
  if (!bgKeyed && !p.effects.some((e) => e.keys?.length) && !p.canvasFx?.some((f) => f.keys?.length)) return p;
  return {
    ...p,
    background: baseColorAt(p, t),
    backgrounds: p.backgrounds?.map((b) => (b.keys?.length ? { ...b, ...bgStateAt(b, t) } : b)),
    effects: p.effects.map((e) => (e.keys?.length ? { ...e, amount: amountAt(e, t) } : e)),
    canvasFx: p.canvasFx?.map((f) => (f.keys?.length ? { ...f, amount: amountAt(f, t) } : f)),
  };
}

/**
 * Change a canvas part's look with the keyframe rule: no canvas keyframes → it changes everywhere;
 * otherwise the change belongs to the canvas keyframe under the playhead (and blends to its neighbours).
 */
export function setBgState(p: Project, bgId: string, t: Seconds, fn: (b: { colors: string[]; angle: number; speed: number }) => void) {
  const b = p.backgrounds?.find((q) => q.id === bgId);
  if (!b) return;
  const keys = p.canvasKeys ?? [];
  if (!keys.length) { fn(b); delete b.keys; return; }
  const at = snapT(p, t);
  if (!b.keys?.length) b.keys = keys.map((k) => ({ t: k, colors: [...b.colors], angle: b.angle, speed: b.speed }));
  let k = b.keys.find((q) => near(q.t, at));
  if (!k) { const st = bgStateAt(b, at); k = { t: at, colors: [...st.colors], angle: st.angle, speed: st.speed }; b.keys.push(k); b.keys.sort((x, y) => x.t - y.t); }
  fn(k);
}
/** The base colour, with the same keyframe rule. */
export function setBaseColor(p: Project, t: Seconds, v: string) {
  const keys = p.canvasKeys ?? [];
  if (!keys.length) { p.background = v; delete p.bgColorKeys; return; }
  const at = snapT(p, t);
  if (!p.bgColorKeys?.length) p.bgColorKeys = keys.map((k) => ({ t: k, v: p.background }));
  const hit = p.bgColorKeys.find((q) => near(q.t, at));
  if (hit) hit.v = v; else { p.bgColorKeys.push({ t: at, v }); p.bgColorKeys.sort((a, b) => a.t - b.t); }
}

const snapT = (p: Project, t: Seconds) => (p.canvasKeys ?? []).find((k) => Math.abs(k - t) <= 0.02) ?? t;
/** Set an amount with the keyframe rule: no canvas keyframes → everywhere; otherwise at the canvas keyframe under the playhead. */
function setAmt(p: Project, e: Amt, t: Seconds, v: number) {
  const keys = p.canvasKeys ?? [];
  if (!keys.length) { e.amount = v; delete e.keys; return; }
  const at = snapT(p, t);
  if (!e.keys?.length) e.keys = keys.filter((k) => !near(k, at)).map((k) => ({ t: k, v: e.amount }));
  const hit = e.keys.find((q) => near(q.t, at));
  if (hit) hit.v = v; else { e.keys.push({ t: at, v }); e.keys.sort((a, b) => a.t - b.t); }
}
export function setLookAmount(p: Project, id: string, t: Seconds, v: number) { const e = p.effects.find((q) => q.id === id); if (e) setAmt(p, e, t, v); }
export function setCanvasFxAmount(p: Project, id: string, t: Seconds, v: number) { const f = p.canvasFx?.find((q) => q.id === id); if (f) setAmt(p, f, t, v); }

/** Add a canvas keyframe at t (every animated amount gets a key holding its current value). */
export function addCanvasKey(p: Project, t: Seconds) {
  const keys = (p.canvasKeys ??= []);
  if (keys.some((k) => Math.abs(k - t) <= 0.02)) return;
  for (const e of [...p.effects, ...(p.canvasFx ?? [])] as Amt[]) if (e.keys?.length) { e.keys.push({ t, v: amountAt(e, t) }); e.keys.sort((a, b) => a.t - b.t); }
  for (const b of p.backgrounds ?? []) if (b.keys?.length) { const st = bgStateAt(b, t); b.keys.push({ t, colors: [...st.colors], angle: st.angle, speed: st.speed }); b.keys.sort((x, y) => x.t - y.t); }
  if (p.bgColorKeys?.length) { p.bgColorKeys.push({ t, v: baseColorAt(p, t) }); p.bgColorKeys.sort((a, b) => a.t - b.t); }
  keys.push(t); keys.sort((a, b) => a - b);
}
/** Remove the canvas keyframe at t (when an amount loses its last key, it keeps that value). */
export function removeCanvasKey(p: Project, t: Seconds) {
  const at = snapT(p, t);
  p.canvasKeys = (p.canvasKeys ?? []).filter((k) => !near(k, at));
  for (const e of [...p.effects, ...(p.canvasFx ?? [])] as Amt[]) {
    if (!e.keys) continue;
    const i = e.keys.findIndex((q) => near(q.t, at)); if (i < 0) continue;
    const [g] = e.keys.splice(i, 1); if (!e.keys.length) { e.amount = g.v; delete e.keys; }
  }
  for (const b of p.backgrounds ?? []) {
    if (!b.keys) continue;
    const i = b.keys.findIndex((q) => near(q.t, at)); if (i < 0) continue;
    const [g] = b.keys.splice(i, 1); if (!b.keys.length) { b.colors = g.colors; b.angle = g.angle; b.speed = g.speed; delete b.keys; }
  }
  if (p.bgColorKeys) {
    const i = p.bgColorKeys.findIndex((q) => near(q.t, at));
    if (i >= 0) { const [g] = p.bgColorKeys.splice(i, 1); if (!p.bgColorKeys.length) { p.background = g.v; delete p.bgColorKeys; } }
  }
  if (!p.canvasKeys.length) delete p.canvasKeys;
}
export function moveCanvasKey(p: Project, from: Seconds, to: Seconds) {
  const keys = p.canvasKeys ?? [];
  const i = keys.findIndex((k) => near(k, from));
  if (i < 0 || keys.some((k, j) => j !== i && near(k, to))) return;
  keys[i] = to; keys.sort((a, b) => a - b);
  for (const e of [...p.effects, ...(p.canvasFx ?? [])] as Amt[]) { const k = e.keys?.find((q) => near(q.t, from)); if (k) { k.t = to; e.keys!.sort((a, b) => a.t - b.t); } }
  for (const b of p.backgrounds ?? []) { const k = b.keys?.find((q) => near(q.t, from)); if (k) { k.t = to; b.keys!.sort((x, y) => x.t - y.t); } }
  const ck = p.bgColorKeys?.find((q) => near(q.t, from)); if (ck) { ck.t = to; p.bgColorKeys!.sort((a, b) => a.t - b.t); }
}
