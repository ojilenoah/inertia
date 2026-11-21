import type { Item, Keyframe, Project, Seconds } from "./types";
import { easeFn, smoothValue } from "./easing";

/*
 * Motion paths. A "motion" item is an invisible clip whose x/y keyframes split it into blocks
 * (keyframe → next keyframe). For each block you can draw a line; during that block the motion
 * travels along the line instead of straight. Other items follow a motion (exactly where it was
 * drawn, or relative to where they are), optionally turning to face where they're going.
 */

export type Pt = [number, number];
/**
 * open: the last block's line, which ends wherever it was drawn (no keyframe at the clip's end).
 * ctrl: a pen segment — a curve from its start node to its end node, with handles [out of the start, into the end]
 * measured from those nodes ([0,0] each = straight). Its pts are just a sampling of that curve.
 */
export interface Stroke { a: Seconds; b: Seconds; pts: Pt[]; open?: boolean; ctrl?: [Pt, Pt] }

/** Points along a pen segment from A to B with handles (c1 from A, c2 from B). */
export function segPts(A: Pt, B: Pt, ctrl: [Pt, Pt], n = 40): Pt[] {
  const P1: Pt = [A[0] + ctrl[0][0], A[1] + ctrl[0][1]], P2: Pt = [B[0] + ctrl[1][0], B[1] + ctrl[1][1]];
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n, v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    return [a * A[0] + b * P1[0] + c * P2[0] + d * B[0], a * A[1] + b * P1[1] + c * P2[1] + d * B[1]] as Pt;
  });
}
/** letters: text bends along the path, letter after letter (default for text); false moves it as one block. */
export interface Follow { motionId: string; mode: "exact" | "relative"; orient?: boolean; letters?: boolean }

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

/** The keyframe times of a motion clip (local), in order. */
export function motionTimes(m: Item): Seconds[] {
  const s = new Set<number>();
  for (const k of [...(m.keys.x ?? []), ...(m.keys.y ?? [])]) s.add(Math.round(k.t * 1e4) / 1e4);
  return [...s].sort((a, b) => a - b);
}
/**
 * Blocks: each pair of neighbouring keyframes — plus, after the last keyframe, an open block to the clip's end:
 * a path only needs a keyframe where it starts (and one per extra node); its end is wherever its line ends.
 */
export function motionBlocks(m: Item): [Seconds, Seconds][] {
  const ts = motionTimes(m), life = m.end - m.start;
  const out: [Seconds, Seconds][] = ts.slice(0, -1).map((t, i) => [t, ts[i + 1]]);
  const last = ts.length ? ts[ts.length - 1] : 0;
  if (last < life - 0.01) out.push([last, life]);
  return out;
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
/** Is there a keyframe (node) at this time? */
export const motionHasKey = (m: Item, t: Seconds) => !!(m.keys.x?.some((k) => near(k.t, t)) || m.keys.y?.some((k) => near(k.t, t)));
export function strokeFor(m: Item, a: Seconds, b: Seconds): Stroke | undefined {
  // the open last block keeps its line when the clip is made longer or shorter
  return m.strokes?.find((s) => near(s.a, a) && near(s.b, b)) ?? (motionHasKey(m, b) ? undefined : m.strokes?.find((s) => s.open && near(s.a, a)));
}
/** A node's place: its keyframe, or (for the open end) where the last line ends. */
export function nodePos(m: Item, t: Seconds): Pt {
  if (motionHasKey(m, t)) return keyPos(m, t);
  const blocks = motionBlocks(m), last = blocks[blocks.length - 1];
  const st = last && near(last[1], t) ? strokeFor(m, last[0], last[1]) : undefined;
  return st && st.pts.length > 1 ? st.pts[st.pts.length - 1] : keyPos(m, t);
}
/** The nodes of a path: one per keyframe, and its open end. */
export function motionNodes(m: Item): { t: Seconds; key: boolean; p: Pt }[] {
  const ts = motionTimes(m), life = m.end - m.start;
  const out = ts.map((t) => ({ t, key: true, p: keyPos(m, t) }));
  const last = ts.length ? ts[ts.length - 1] : 0;
  if (last < life - 0.01 && strokeFor(m, last, life)) out.push({ t: life, key: false, p: nodePos(m, life) });
  return out;
}
/** A block's line as it's shown: its drawn points, bent so its ends sit on its nodes (they may have been moved). */
export function blockLine(m: Item, a: Seconds, b: Seconds): Pt[] | null {
  const st = strokeFor(m, a, b);
  if (!st || st.pts.length < 2) return null;
  const A = nodePos(m, a), B = nodePos(m, b), s0 = st.pts[0], s1 = st.pts[st.pts.length - 1];
  if (st.ctrl) return segPts(A, B, st.ctrl); // a pen curve: always exactly between its nodes
  const len = lengths(st.pts), total = len[len.length - 1] || 1;
  return st.pts.map(([x, y], i) => { const f = len[i] / total; return [x + (A[0] - s0[0]) * (1 - f) + (B[0] - s1[0]) * f, y + (A[1] - s0[1]) * (1 - f) + (B[1] - s1[1]) * f] as Pt; });
}
/** Where the motion's keyframes put it at local time t (straight between keyframes). */
export function keyPos(m: Item, t: Seconds): Pt {
  return [sample(m.keys.x, t, m.base.x), sample(m.keys.y, t, m.base.y)];
}

/** Running lengths along a line (cached, the lines don't change while playing). */
const lenCache = new WeakMap<Pt[], number[]>();
function lengths(pts: Pt[]): number[] {
  let len = lenCache.get(pts);
  if (!len) {
    len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    lenCache.set(pts, len);
  }
  return len;
}
/** Point at fraction f (0..1) of the way along a line, by distance, and the direction there (degrees). */
export function pointAlong(pts: Pt[], f: number): { x: number; y: number; angle: number } {
  if (pts.length < 2) return { x: pts[0]?.[0] ?? 0, y: pts[0]?.[1] ?? 0, angle: 0 };
  const len = lengths(pts);
  const total = len[len.length - 1] || 1, d = Math.min(Math.max(f, 0), 1) * total;
  // binary search for the segment
  let lo = 1, hi = len.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (len[mid] < d) lo = mid + 1; else hi = mid; }
  const i = lo, seg = len[i] - len[i - 1] || 1, u = (d - len[i - 1]) / seg;
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI };
}
const pathLen = (m: Item, a: Seconds, b: Seconds) => {
  const line = blockLine(m, a, b);
  if (line) { const l = lengths(line); return l[l.length - 1]; }
  const A = nodePos(m, a), B = nodePos(m, b);
  return Math.hypot(B[0] - A[0], B[1] - A[1]);
};

/**
 * How far along block i the motion is at fraction u of its time. With the default (linear) ease
 * the speed glides from one block's pace into the next instead of jumping at each keyframe.
 */
function progress(m: Item, blocks: [Seconds, Seconds][], i: number, u: number): number {
  const [a, b] = blocks[i];
  const kx = m.keys.x?.find((k) => near(k.t, a)) ?? m.keys.y?.find((k) => near(k.t, a));
  const ease = kx?.ease ?? "linear";
  if (ease !== "linear") return easeFn(ease)(u);
  const speed = (j: number) => { const [p, q] = blocks[j]; return pathLen(m, p, q) / (q - p || 1e-9); };
  const v = speed(i), L = pathLen(m, a, b), dur = b - a || 1e-9;
  if (L < 1e-6) return u;
  const v0 = i > 0 ? (speed(i - 1) + v) / 2 : v;
  const v1 = i < blocks.length - 1 ? (speed(i + 1) + v) / 2 : v;
  // cubic Hermite in distance, tangents capped so it never runs backwards
  const m0 = Math.min((v0 * dur) / L, 3), m1 = Math.min((v1 * dur) / L, 3);
  const u2 = u * u, u3 = u2 * u;
  return Math.min(Math.max((u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) + (u3 - u2) * m1, 0), 1);
}

function motionPos(m: Item, t: Seconds): { x: number; y: number; angle: number } | null {
  const blocks = motionBlocks(m);
  if (!blocks.length) return null;
  let i = blocks.findIndex(([a, b]) => t >= a && t <= b);
  if (i < 0) i = t < blocks[0][0] ? 0 : blocks.length - 1;
  const [a, b] = blocks[i];
  const f = progress(m, blocks, i, Math.min(Math.max((t - a) / (b - a || 1e-9), 0), 1));
  const A = nodePos(m, a), B = nodePos(m, b);
  // the line as shown: pinned to its nodes (they may have been moved after drawing), or the pen curve between them
  const line = blockLine(m, a, b);
  if (line) {
    const p = pointAlong(line, f);
    return { x: p.x, y: p.y, angle: p.angle };
  }
  return { x: A[0] + (B[0] - A[0]) * f, y: A[1] + (B[1] - A[1]) * f, angle: (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI };
}

/** Where a motion is at its local time t, and which way it's heading (smoothed, so turning never jitters). */
export function motionAt(m: Item, t: Seconds): { x: number; y: number; angle: number } {
  const p = motionPos(m, t);
  if (!p) { const [x, y] = keyPos(m, t); return { x, y, angle: 0 }; }
  // heading from a little behind to a little ahead, so it turns smoothly through corners and keyframes
  const life = m.end - m.start, d = 0.06;
  const p0 = motionPos(m, Math.max(0, t - d))!, p1 = motionPos(m, Math.min(life, t + d))!;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  return { x: p.x, y: p.y, angle: Math.hypot(dx, dy) > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : p.angle };
}

/**
 * A path's own turn, 3D tilt and size (its rx, ry, rz and scale — keyframable like any item's), around the
 * middle of its nodes. The nodes stay as placed; this maps them onto the canvas. Null when it changes nothing.
 */
export function pathTransform(m: Item, local: Seconds): ((p: Pt) => Pt) | null {
  if (!m.pathV2) return null;
  const rx = sample(m.keys.rx, local, m.base.rx ?? 0), ry = sample(m.keys.ry, local, m.base.ry ?? 0), rz = sample(m.keys.rz, local, m.base.rz ?? 0);
  const sc = sample(m.keys.scale, local, m.base.scale ?? 1);
  if (Math.abs(rx) < 1e-6 && Math.abs(ry) < 1e-6 && Math.abs(rz) < 1e-6 && Math.abs(sc - 1) < 1e-6) return null;
  const [cx, cy] = pathPivot(m), r = Math.PI / 180;
  const cz = Math.cos(rz * r), sz = Math.sin(rz * r), cyy = Math.cos(ry * r), syy = Math.sin(ry * r), cxx = Math.cos(rx * r), sxx = Math.sin(rx * r);
  return ([x, y]) => {
    let X = (x - cx) * sc, Y = (y - cy) * sc, Z = 0;
    [X, Y] = [X * cz - Y * sz, X * sz + Y * cz];
    [X, Z] = [X * cyy + Z * syy, -X * syy + Z * cyy];
    [Y, Z] = [Y * cxx - Z * sxx, Y * sxx + Z * cxx];
    const k = 1400 / Math.max(1, 1400 - Z);
    return [cx + X * k, cy + Y * k];
  };
}
/** Like pathTransform, for a point `z` off the path's plane (towards you before tilting). Null when the path is plain. */
export function pathTransformZ(m: Item, local: Seconds, [x, y]: Pt, z: number): Pt | null {
  if (!m.pathV2) return null;
  const rx = sample(m.keys.rx, local, m.base.rx ?? 0), ry = sample(m.keys.ry, local, m.base.ry ?? 0), rz = sample(m.keys.rz, local, m.base.rz ?? 0);
  const sc = sample(m.keys.scale, local, m.base.scale ?? 1);
  const [cx, cy] = pathPivot(m), r = Math.PI / 180;
  let X = (x - cx) * sc, Y = (y - cy) * sc, Z = z * sc;
  [X, Y] = [X * Math.cos(rz * r) - Y * Math.sin(rz * r), X * Math.sin(rz * r) + Y * Math.cos(rz * r)];
  [X, Z] = [X * Math.cos(ry * r) + Z * Math.sin(ry * r), -X * Math.sin(ry * r) + Z * Math.cos(ry * r)];
  [Y, Z] = [Y * Math.cos(rx * r) - Z * Math.sin(rx * r), Y * Math.sin(rx * r) + Z * Math.cos(rx * r)];
  const k = 1400 / Math.max(1, 1400 - Z);
  return [cx + X * k, cy + Y * k];
}
/** The point a path turns, tilts and grows around: the middle of its nodes. */
export function pathPivot(m: Item): Pt {
  if (m.pivot) return [m.pivot[0], m.pivot[1]];
  return nodesMiddle(m);
}
function nodesMiddle(m: Item): Pt {
  const ps = motionNodes(m).map((n) => n.p);
  if (!ps.length) return [m.base.x, m.base.y];
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
/**
 * Keep each path's turning point still: once a path is turned, tilted or sized it gets a fixed one (the middle of
 * its nodes at that moment); back to plain, it goes. Run after every edit.
 */
export function fixPathPivots(project: Project) {
  for (const m of project.items) {
    if (m.kind !== "motion" || !m.pathV2) continue;
    const used = (["rx", "ry", "rz"] as const).some((p) => m.keys[p]?.length || Math.abs(m.base[p] ?? 0) > 1e-6) || !!m.keys.scale?.length || Math.abs((m.base.scale ?? 1) - 1) > 1e-6;
    if (used && !m.pivot) m.pivot = nodesMiddle(m);
    else if (!used && m.pivot) delete m.pivot;
  }
}

/** Undo pathTransform: the point on the path's own plane that shows up at `p` (a few steps of Newton's method). */
export function pathUntransform(f: (p: Pt) => Pt, p: Pt): Pt {
  let q: Pt = [p[0], p[1]];
  for (let n = 0; n < 8; n++) {
    const F = f(q), e = 1, A = f([q[0] + e, q[1]]), B = f([q[0], q[1] + e]);
    const a = A[0] - F[0], b = B[0] - F[0], c = A[1] - F[1], d = B[1] - F[1], det = a * d - b * c || 1e-9;
    const rx = p[0] - F[0], ry = p[1] - F[1];
    q = [q[0] + (d * rx - b * ry) / det, q[1] + (-c * rx + a * ry) / det];
    if (Math.hypot(rx, ry) < 0.01) break;
  }
  return q;
}
/** Where a motion shows on the canvas at local time t (with the path's own turn, tilt and size), and its heading. */
export function motionShown(m: Item, t: Seconds): { x: number; y: number; angle: number } {
  const p = motionAt(m, t), f = pathTransform(m, t);
  if (!f) return p;
  const q = f([p.x, p.y]), r = (p.angle * Math.PI) / 180, ahead = f([p.x + Math.cos(r) * 5, p.y + Math.sin(r) * 5]);
  return { x: q[0], y: q[1], angle: (Math.atan2(ahead[1] - q[1], ahead[0] - q[0]) * 180) / Math.PI };
}

/** Where an item following a motion is (x, y and extra rotation), or null. */
export function followOffset(project: Project, item: Item, t: Seconds, ownX: number, ownY: number): { x: number; y: number; rz: number } | null {
  const f = item.follow;
  if (!f) return null;
  const m = project.items.find((i) => i.id === f.motionId && i.kind === "motion");
  if (!m) return null;
  const life = m.end - m.start;
  const local = Math.min(Math.max(t - m.start, 0), life);
  const p = motionShown(m, local);
  // each node can carry a turn (the node's turn knob): followers turn by it, blending between nodes
  const turn = sample(m.numKeys?.turn, local, 0);
  if (f.mode === "exact") return { x: p.x, y: p.y, rz: (f.orient ? p.angle : 0) + turn };
  const p0 = motionShown(m, 0);
  return { x: ownX + p.x - p0.x, y: ownY + p.y - p0.y, rz: (f.orient ? p.angle : 0) + turn };
}

/** Turn a raw freehand stroke into a smooth, evenly spaced line. */
export function smoothStroke(raw: Pt[], spacing = 4): Pt[] {
  let pts = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 0.5);
  if (pts.length < 3) return pts.length === 2 ? resample(pts, spacing) : pts;
  // a light moving average removes hand jitter, then Chaikin corner cutting rounds it off
  for (let pass = 0; pass < 8; pass++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : [(pts[i - 1][0] + p[0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + p[1] * 2 + pts[i + 1][1]) / 4] as Pt));
  for (let pass = 0; pass < 3; pass++) {
    const out: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return resample(pts, spacing);
}
function resample(pts: Pt[], spacing: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (acc + seg >= spacing) {
      const u = (spacing - acc) / seg;
      x0 = x0 + (x1 - x0) * u; y0 = y0 + (y1 - y0) * u;
      out.push([Math.round(x0 * 10) / 10, Math.round(y0 * 10) / 10]);
      seg = Math.hypot(x1 - x0, y1 - y0); acc = 0;
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > 0.5) out.push(last);
  return out;
}

/** Put a drawn line on block [a, b]: the block's end keyframe moves to where the line ends. */
export function setStroke(m: Item, a: Seconds, b: Seconds, raw: Pt[]) {
  if (raw.length < 2) return;
  const start = nodePos(m, a);
  const pts = smoothStroke([start, ...raw.slice(1)]);
  pts[0] = start;
  const open = !motionHasKey(m, b);
  m.strokes = (m.strokes ?? []).filter((s) => !(near(s.a, a) && (near(s.b, b) || (open && s.open))));
  m.strokes.push({ a, b, pts, ...(open ? { open: true } : {}) });
  // a node in the middle moves to where the line ends; the open end needs no keyframe
  if (open) return;
  const end = pts[pts.length - 1];
  for (const [p, v] of [["x", end[0]], ["y", end[1]]] as const) { const k = m.keys[p]?.find((q) => near(q.t, b)); if (k) k.v = v; }
}

/**
 * A new keyframe (node) on a path at local time t: it goes exactly where the motion already is, and the drawn
 * line is cut in two there — so adding nodes never moves anything.
 */
export function splitMotionAt(m: Item, t: Seconds) {
  if (motionHasKey(m, t)) return;
  const blocks = motionBlocks(m), i = blocks.findIndex(([a, b]) => t > a + 1e-3 && t < b - 1e-3);
  const p = motionAt(m, t);
  if (i >= 0) {
    const [a, b] = blocks[i], st = strokeFor(m, a, b), line = blockLine(m, a, b);
    if (st && line) {
      // where along the line the motion is at t (by distance), and the two halves
      const len = lengths(line), total = len[len.length - 1] || 1;
      let best = 0, bd = Infinity;
      for (let j = 0; j < line.length; j++) { const d = Math.hypot(line[j][0] - p.x, line[j][1] - p.y); if (d < bd) { bd = d; best = j; } }
      void total;
      const first = [...line.slice(0, best + 1)], second = [...line.slice(best)];
      first[first.length - 1] = [p.x, p.y]; second[0] = [p.x, p.y];
      m.strokes = (m.strokes ?? []).filter((s) => s !== st);
      if (first.length > 1) m.strokes.push({ a, b: t, pts: first });
      if (second.length > 1) m.strokes.push({ a: t, b, pts: second, ...(st.open ? { open: true } : {}) });
    }
  }
  for (const [pr, v] of [["x", p.x], ["y", p.y]] as const) {
    const ks = (m.keys[pr] ??= []);
    ks.push({ t, v: Math.round(v * 10) / 10, ease: ks[0]?.ease ?? "linear" }); ks.sort((q, r) => q.t - r.t);
  }
}

/**
 * The pen: add a node at p after the path's last node. Every node but the last is a keyframe, spread evenly
 * over the clip; the last is the open end. The new segment curves out of the previous node by `prevOut` and into
 * this one by `inHandle` (both measured from their nodes; none = straight). Earlier segments keep their shape.
 */
export function penAddNode(m: Item, p: Pt, prevOut?: Pt, inHandle?: Pt) {
  const life = m.end - m.start;
  const nodes = motionNodes(m), blocks = motionBlocks(m);
  // the segments there are now, in order, as they look (pen curves keep their handles)
  const segs = blocks.slice(0, Math.max(0, nodes.length - 1)).map(([a, b]) => ({ st: strokeFor(m, a, b), line: blockLine(m, a, b) }));
  const P = [...nodes.map((n) => n.p), p], N = P.length;
  const t = (i: number) => (i >= N - 1 ? life : Math.round(((life * i) / (N - 1)) * 1e4) / 1e4);
  const ease = m.keys.x?.[0]?.ease ?? "linear";
  if (m.numKeys?.turn?.length) { const turns = nodes.map((n) => m.numKeys!.turn!.find((k) => Math.abs(k.t - n.t) < 1e-3)?.v); m.numKeys!.turn = turns.flatMap((v, i) => (v == null ? [] : [{ t: t(i), v, ease: "linear" as const }])); }
  m.keys.x = P.slice(0, N - 1).map((q, i) => ({ t: t(i), v: q[0], ease }));
  m.keys.y = P.slice(0, N - 1).map((q, i) => ({ t: t(i), v: q[1], ease }));
  m.base.x = P[0][0]; m.base.y = P[0][1];
  const strokes: Stroke[] = [];
  for (let i = 0; i < N - 1; i++) {
    const a = t(i), b = t(i + 1), open = i === N - 2 ? { open: true } : {};
    const old = segs[i];
    const ctrl: [Pt, Pt] = old?.st?.ctrl ?? (i === N - 2 ? [prevOut ?? [0, 0], inHandle ?? [0, 0]] : [[0, 0], [0, 0]]);
    if (old && !old.st?.ctrl && old.line) strokes.push({ a, b, pts: old.line, ...open });
    else strokes.push({ a, b, pts: segPts(P[i], P[i + 1], ctrl), ctrl, ...open });
  }
  m.strokes = strokes;
}

/**
 * Insert a node at p as node number idx (1 = right after the start). The piece it lands on becomes two straight
 * pieces through it; the others keep their shape. Nodes stay spread evenly over the clip, the last is the end.
 */
export function penInsertNode(m: Item, idx: number, p: Pt) {
  const nodes = motionNodes(m);
  if (idx >= nodes.length) { penAddNode(m, p); return; }
  const life = m.end - m.start, blocks = motionBlocks(m);
  const segs = blocks.slice(0, Math.max(0, nodes.length - 1)).map(([a, b]) => ({ st: strokeFor(m, a, b), line: blockLine(m, a, b) }));
  const P = [...nodes.map((n) => n.p)];
  P.splice(idx, 0, p);
  const N = P.length, t = (i: number) => (i >= N - 1 ? life : Math.round(((life * i) / (N - 1)) * 1e4) / 1e4);
  const ease = m.keys.x?.[0]?.ease ?? "linear";
  // turns at nodes move with their nodes
  const turns = nodes.map((n) => m.numKeys?.turn?.find((k) => Math.abs(k.t - n.t) < 1e-3)?.v);
  turns.splice(idx, 0, undefined);
  m.keys.x = P.slice(0, N - 1).map((q, i) => ({ t: t(i), v: q[0], ease }));
  m.keys.y = P.slice(0, N - 1).map((q, i) => ({ t: t(i), v: q[1], ease }));
  if (m.numKeys?.turn?.length) m.numKeys!.turn = turns.flatMap((v, i) => (v == null ? [] : [{ t: t(i), v, ease: "linear" as const }]));
  const strokes: Stroke[] = [];
  for (let i = 0; i < N - 1; i++) {
    const a = t(i), b = t(i + 1), open = i === N - 2 ? { open: true } : {};
    const old = i < idx - 1 ? segs[i] : i > idx ? segs[i - 1] : undefined; // the two around the new node start straight
    if (old?.st?.ctrl) strokes.push({ a, b, pts: segPts(P[i], P[i + 1], old.st.ctrl), ctrl: old.st.ctrl, ...open });
    else if (old?.line) strokes.push({ a, b, pts: old.line, ...open });
    else strokes.push({ a, b, pts: segPts(P[i], P[i + 1], [[0, 0], [0, 0]]), ctrl: [[0, 0], [0, 0]], ...open });
  }
  m.strokes = strokes;
}
/** Reshape a whole path point by point: its nodes, lines and curve handles all go through f. */
export function transformPath(m: Item, f: (p: Pt) => Pt) {
  // handles are measured from their nodes: work them out from where the nodes are now
  for (const s of m.strokes ?? []) {
    if (!s.ctrl) continue;
    const A = nodePos(m, s.a), B = nodePos(m, s.b);
    const A2 = f(A), B2 = f(B), h1 = f([A[0] + s.ctrl[0][0], A[1] + s.ctrl[0][1]]), h2 = f([B[0] + s.ctrl[1][0], B[1] + s.ctrl[1][1]]);
    s.ctrl = [[h1[0] - A2[0], h1[1] - A2[1]], [h2[0] - B2[0], h2[1] - B2[1]]];
  }
  for (const t of motionTimes(m)) {
    const p = f(keyPos(m, t));
    const kx = m.keys.x?.find((k) => near(k.t, t)), ky = m.keys.y?.find((k) => near(k.t, t));
    if (kx) kx.v = Math.round(p[0] * 10) / 10;
    if (ky) ky.v = Math.round(p[1] * 10) / 10;
  }
  const b = f([m.base.x, m.base.y]); m.base.x = b[0]; m.base.y = b[1];
  for (const s of m.strokes ?? []) s.pts = s.pts.map((q) => { const r = f(q); return [Math.round(r[0] * 10) / 10, Math.round(r[1] * 10) / 10] as Pt; });
}
/** Turn a path around (cx, cy) by deg in 2D. */
export const turnPath = (m: Item, cx: number, cy: number, deg: number) => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  transformPath(m, ([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
};
/** Tilt a path in 3D around (cx, cy): rx tips it forward/back, ry turns it sideways; seen with the editor's perspective. */
export const tiltPath = (m: Item, cx: number, cy: number, rx: number, ry: number) => {
  const ax = (rx * Math.PI) / 180, ay = (ry * Math.PI) / 180;
  transformPath(m, ([x, y]) => {
    let X = x - cx, Y = y - cy, Z = 0;
    [X, Z] = [X * Math.cos(ay) + Z * Math.sin(ay), -X * Math.sin(ay) + Z * Math.cos(ay)];
    [Y, Z] = [Y * Math.cos(ax) - Z * Math.sin(ax), Y * Math.sin(ax) + Z * Math.cos(ax)];
    const k = 1400 / Math.max(1, 1400 - Z);
    return [cx + X * k, cy + Y * k];
  });
};

/**
 * Delete node number idx. The two lines either side of it join into one (two pen curves keep their outer
 * handles; otherwise the drawn points run on). The nodes left stay spread evenly, the last is the end.
 * A path keeps at least its start node.
 */
export function penDeleteNode(m: Item, idx: number) {
  const nodes = motionNodes(m);
  if (nodes.length <= 1 || idx < 0 || idx >= nodes.length) return;
  const life = m.end - m.start, blocks = motionBlocks(m);
  const segs = blocks.slice(0, nodes.length - 1).map(([a, b]) => ({ st: strokeFor(m, a, b), line: blockLine(m, a, b) }));
  const turns = nodes.map((n) => m.numKeys?.turn?.find((k) => Math.abs(k.t - n.t) < 1e-3)?.v);
  const P = nodes.map((n) => n.p).filter((_, i) => i !== idx);
  turns.splice(idx, 1);
  // the lines between the nodes that are left
  const joined: ({ ctrl?: [Pt, Pt]; line?: Pt[] | null } | undefined)[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (i === idx - 1 && idx < nodes.length - 1) {
      // the node in between goes: join this line and the next
      const L = segs[i], R = segs[i + 1];
      if (L?.st?.ctrl && R?.st?.ctrl) joined.push({ ctrl: [L.st.ctrl[0], R.st.ctrl[1]] });
      else joined.push({ line: [...(L?.line ?? [nodes[i].p, nodes[idx].p]), ...(R?.line ?? [nodes[idx].p, nodes[idx + 1].p]).slice(1)] });
      i++;
    } else if (i === idx || (idx === nodes.length - 1 && i === idx - 1)) continue; // the start's or the end's own line goes with it
    else joined.push(segs[i]?.st?.ctrl ? { ctrl: segs[i].st!.ctrl } : { line: segs[i]?.line });
  }
  const N = P.length, t = (i: number) => (i >= N - 1 ? life : Math.round(((life * i) / Math.max(1, N - 1)) * 1e4) / 1e4);
  const ease = m.keys.x?.[0]?.ease ?? "linear";
  const keyed = N === 1 ? P : P.slice(0, N - 1);
  m.keys.x = keyed.map((q, i) => ({ t: N === 1 ? 0 : t(i), v: q[0], ease }));
  m.keys.y = keyed.map((q, i) => ({ t: N === 1 ? 0 : t(i), v: q[1], ease }));
  m.base.x = P[0][0]; m.base.y = P[0][1];
  if (m.numKeys?.turn?.length) m.numKeys!.turn = turns.flatMap((v, i) => (v == null ? [] : [{ t: N === 1 ? 0 : t(i), v, ease: "linear" as const }]));
  const strokes: Stroke[] = [];
  for (let i = 0; i < N - 1; i++) {
    const a = t(i), b = t(i + 1), open = i === N - 2 ? { open: true } : {}, j = joined[i];
    if (j?.ctrl) strokes.push({ a, b, pts: segPts(P[i], P[i + 1], j.ctrl), ctrl: j.ctrl, ...open });
    else if (j?.line && j.line.length > 1) strokes.push({ a, b, pts: j.line, ...open });
    else strokes.push({ a, b, pts: segPts(P[i], P[i + 1], [[0, 0], [0, 0]]), ctrl: [[0, 0], [0, 0]], ...open });
  }
  m.strokes = strokes;
}

/**
 * Add a node on line number i, at the spot on it nearest to `at`. The line keeps its exact shape: a pen curve
 * is cut in two curves there, a drawn line is cut at that point. Returns the new node's number.
 */
export function penSplitLine(m: Item, i: number, at: Pt): number {
  const nodes = motionNodes(m), blocks = motionBlocks(m);
  const segs = blocks.slice(0, Math.max(0, nodes.length - 1)).map(([a, b]) => ({ st: strokeFor(m, a, b), line: blockLine(m, a, b) }));
  const seg = segs[i];
  if (!seg) return -1;
  const A = nodes[i].p, B = nodes[i + 1].p;
  let S: Pt, left: { ctrl?: [Pt, Pt]; line?: Pt[] }, right: { ctrl?: [Pt, Pt]; line?: Pt[] };
  const lerp = (p: Pt, q: Pt, u: number): Pt => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  if (seg.st?.ctrl || !seg.line) {
    // a pen curve (or a plain straight piece): cut it at the nearest point (de Casteljau keeps the shape)
    const c = seg.st?.ctrl ?? [[0, 0], [0, 0]] as [Pt, Pt];
    const P1: Pt = [A[0] + c[0][0], A[1] + c[0][1]], P2: Pt = [B[0] + c[1][0], B[1] + c[1][1]];
    const samples = segPts(A, B, c, 200);
    let best = 1, bd = Infinity;
    samples.forEach((q, j) => { const d = Math.hypot(q[0] - at[0], q[1] - at[1]); if (d < bd && j > 0 && j < samples.length - 1) { bd = d; best = j; } });
    const u = best / 200;
    const Q1 = lerp(A, P1, u), Q2 = lerp(P1, P2, u), Q3 = lerp(P2, B, u), R1 = lerp(Q1, Q2, u), R2 = lerp(Q2, Q3, u);
    S = lerp(R1, R2, u);
    left = { ctrl: [[Q1[0] - A[0], Q1[1] - A[1]], [R1[0] - S[0], R1[1] - S[1]]] };
    right = { ctrl: [[R2[0] - S[0], R2[1] - S[1]], [Q3[0] - B[0], Q3[1] - B[1]]] };
  } else {
    const line = seg.line;
    let best = 1, bd = Infinity;
    line.forEach((q, j) => { const d = Math.hypot(q[0] - at[0], q[1] - at[1]); if (d < bd && j > 0 && j < line.length - 1) { bd = d; best = j; } });
    S = line[best];
    left = { line: line.slice(0, best + 1) }; right = { line: line.slice(best) };
  }
  const life = m.end - m.start;
  const turns = nodes.map((n) => m.numKeys?.turn?.find((k) => Math.abs(k.t - n.t) < 1e-3)?.v);
  turns.splice(i + 1, 0, undefined);
  const P = [...nodes.map((n) => n.p)]; P.splice(i + 1, 0, S);
  const specs: ({ ctrl?: [Pt, Pt]; line?: Pt[] | null } | undefined)[] = segs.map((g) => (g.st?.ctrl ? { ctrl: g.st.ctrl } : { line: g.line }));
  specs.splice(i, 1, left, right);
  const N = P.length, t = (j: number) => (j >= N - 1 ? life : Math.round(((life * j) / (N - 1)) * 1e4) / 1e4);
  const ease = m.keys.x?.[0]?.ease ?? "linear";
  m.keys.x = P.slice(0, N - 1).map((q, j) => ({ t: t(j), v: Math.round(q[0] * 10) / 10, ease }));
  m.keys.y = P.slice(0, N - 1).map((q, j) => ({ t: t(j), v: Math.round(q[1] * 10) / 10, ease }));
  if (m.numKeys?.turn?.length) m.numKeys!.turn = turns.flatMap((v, j) => (v == null ? [] : [{ t: t(j), v, ease: "linear" as const }]));
  const strokes: Stroke[] = [];
  for (let j = 0; j < N - 1; j++) {
    const a = t(j), b = t(j + 1), open = j === N - 2 ? { open: true } : {}, sp = specs[j];
    if (sp?.ctrl) strokes.push({ a, b, pts: segPts(P[j], P[j + 1], sp.ctrl), ctrl: sp.ctrl, ...open });
    else if (sp?.line && sp.line.length > 1) strokes.push({ a, b, pts: sp.line, ...open });
    else strokes.push({ a, b, pts: segPts(P[j], P[j + 1], [[0, 0], [0, 0]]), ctrl: [[0, 0], [0, 0]], ...open });
  }
  m.strokes = strokes;
  return i + 1;
}

/** Move a whole path (every node, line and handle) by dx, dy. */
export function movePath(m: Item, dx: number, dy: number) {
  if (m.pivot) m.pivot = [m.pivot[0] + dx, m.pivot[1] + dy];
  for (const k of m.keys.x ?? []) k.v = Math.round((k.v + dx) * 10) / 10;
  for (const k of m.keys.y ?? []) k.v = Math.round((k.v + dy) * 10) / 10;
  m.base.x += dx; m.base.y += dy;
  for (const s of m.strokes ?? []) s.pts = s.pts.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10] as Pt);
}

/** Change a pen segment's handles (and re-sample its points). */
export function setSegHandles(m: Item, a: Seconds, b: Seconds, ctrl: [Pt, Pt]) {
  const st = strokeFor(m, a, b);
  if (!st) return;
  st.ctrl = ctrl;
  st.pts = segPts(nodePos(m, a), nodePos(m, b), ctrl);
}

/** A new motion clip: invisible, with one keyframe (its start node) at `at`; its end is wherever its line ends. */
export function newMotionItem(project: Project, id: string, trackId: string, start: Seconds, end: Seconds, at?: Pt): Item {
  const [cx, cy] = at ?? [project.width / 2, project.height / 2];
  void end;
  return {
    id, name: "Motion", kind: "motion", trackId, start, end, w: 0, h: 0, fill: "transparent", tint: "--orange",
    base: { x: cx, y: cy, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 },
    keys: { x: [{ t: 0, v: cx, ease: "linear" }], y: [{ t: 0, v: cy, ease: "linear" }] }, pathV2: true,
  };
}
