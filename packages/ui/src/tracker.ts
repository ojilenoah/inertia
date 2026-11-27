/*
 * Motion tracking: follow a point (or four corners) through a video clip, frame by frame, then use the result —
 * as keyframes you can fix — to make other things follow it, pin a picture onto it, steady the video, or keep it
 * centred when a wide video is shown in a tall frame.
 *
 * Frames come from the video engine at a small analysis size. Each point is found again in the next frame by
 * matching the patch around it (normalised cross-correlation): first roughly on a half-size frame over a wide area,
 * then precisely at full analysis size, with a sub-pixel finish. The patch slowly takes on the new look of the point
 * (light, turning) and the search starts where the point was heading, so fast or changing things are kept.
 */
import type { Item, Keyframe, Project, Tracker } from "@moshion/engine";
import { itemState, sampleKeys, uid } from "@moshion/engine";
import { useStore } from "./store";
import { videoSource, type VideoSource } from "./videoengine";

type P2 = [number, number];
/** The size frames are analysed at (longer side). */
const ANALYSE = 640;
/** Patch radius (analysis px) at full and half size, and how far the rough search looks (half-size px). */
const R0 = 10, R1 = 5, SEARCH = 22;
/** Below this match score the point is taken as lost and tracking stops there. */
const LOST = 0.5;

/* ---------------- times: the file vs the timeline ---------------- */
/** Seconds into the file → time on the timeline, for a clip (speed, trims and backwards included). */
export function projectTimeOf(it: Item, tm: number, dur: number): number {
  const sp = it.speed ?? 1, off = it.mediaOffset ?? 0;
  const local = it.reverse ? (dur - tm - off) / sp : (tm - off) / sp;
  return it.start + local;
}
/** The file's time range the clip shows. */
export function mediaRange(it: Item, dur: number): [number, number] {
  const sp = it.speed ?? 1, off = it.mediaOffset ?? 0, len = it.end - it.start;
  const a = off, b = Math.min(dur, off + len * sp);
  return it.reverse ? [Math.max(0, dur - b), dur - a] : [a, b];
}

/** A tracker's points at `tm` (seconds into the file): between two found frames it's in between; null where not tracked. */
export function trackerAt(tr: Tracker, tm: number): P2[] | null {
  const q = tr.pts;
  if (!q.length) return null;
  let lo = 0, hi = q.length - 1;
  if (tm < q[0].t - 0.02 || tm > q[hi].t + 0.02) return null;
  if (tm <= q[0].t) return q[0].p;
  if (tm >= q[hi].t) return q[hi].p;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (q[m].t <= tm) lo = m; else hi = m; }
  const a = q[lo], b = q[hi];
  if (b.t - a.t > 0.25) return tm - a.t < b.t - tm ? a.p : b.p; // a gap (separate runs): no guessing across it
  const f = (tm - a.t) / Math.max(1e-6, b.t - a.t);
  return a.p.map((pa, i) => [pa[0] + (b.p[i][0] - pa[0]) * f, pa[1] + (b.p[i][1] - pa[1]) * f] as P2);
}

/* ---------------- the video frame on the canvas ---------------- */
/** Where a point of the video frame (fractions u, v) sits in the clip's own box (px from its centre, before it's moved, turned or scaled). */
export function videoToLocal(it: Item, vw: number, vh: number, u: number, v: number): P2 {
  const k = (it.fit === "contain" ? Math.min(it.w / vw, it.h / vh) : Math.max(it.w / vw, it.h / vh)) * (it.imgZoom ?? 1);
  return [(u - 0.5) * vw * k + ((it.imgX ?? 0) / 100) * it.w, (v - 0.5) * vh * k + ((it.imgY ?? 0) / 100) * it.h];
}
function localToVideo(it: Item, vw: number, vh: number, x: number, y: number): P2 {
  const k = (it.fit === "contain" ? Math.min(it.w / vw, it.h / vh) : Math.max(it.w / vw, it.h / vh)) * (it.imgZoom ?? 1);
  return [(x - ((it.imgX ?? 0) / 100) * it.w) / (vw * k) + 0.5, (y - ((it.imgY ?? 0) / 100) * it.h) / (vh * k) + 0.5];
}
type Place = { x: number; y: number; rz: number; scale: number };
const toCanvas = (s: Place, [lx, ly]: P2): P2 => {
  const a = (s.rz * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  return [s.x + (lx * c - ly * si) * s.scale, s.y + (lx * si + ly * c) * s.scale];
};
const fromCanvas = (s: Place, [x, y]: P2): P2 => {
  const a = (-s.rz * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a), dx = (x - s.x) / s.scale, dy = (y - s.y) / s.scale;
  return [dx * c - dy * si, dx * si + dy * c];
};
/** A video point (fractions) → canvas px at timeline time T. */
export function videoToCanvas(project: Project, it: Item, T: number, vw: number, vh: number, p: P2): P2 {
  return toCanvas(itemState(project, it, T), videoToLocal(it, vw, vh, p[0], p[1]));
}
/** Canvas px → video point (fractions), at timeline time T. */
export function canvasToVideo(project: Project, it: Item, T: number, vw: number, vh: number, p: P2): P2 {
  const l = fromCanvas(itemState(project, it, T), p);
  return localToVideo(it, vw, vh, l[0], l[1]);
}

/* ---------------- grey frames and patch matching ---------------- */
type Gray = { w: number; h: number; d: Float32Array };
function grayOf(img: HTMLCanvasElement | OffscreenCanvas): Gray {
  const w = img.width, h = img.height;
  const g = (img as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const px = g.getImageData(0, 0, w, h).data, d = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114;
  return { w, h, d };
}
function halve(g: Gray): Gray {
  const w = g.w >> 1, h = g.h >> 1, d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * g.w + 2 * x;
    d[y * w + x] = (g.d[i] + g.d[i + 1] + g.d[i + g.w] + g.d[i + g.w + 1]) / 4;
  }
  return { w, h, d };
}
const at = (g: Gray, x: number, y: number) => {
  const xi = Math.max(0, Math.min(g.w - 2, Math.floor(x))), yi = Math.max(0, Math.min(g.h - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - xi)), fy = Math.max(0, Math.min(1, y - yi)), i = yi * g.w + xi;
  return (g.d[i] * (1 - fx) + g.d[i + 1] * fx) * (1 - fy) + (g.d[i + g.w] * (1 - fx) + g.d[i + g.w + 1] * fx) * fy;
};
/** The patch around (cx, cy), zero-mean and unit length (so a dot product is the correlation). */
function patch(g: Gray, cx: number, cy: number, r: number): Float32Array {
  const n = 2 * r + 1, out = new Float32Array(n * n);
  let m = 0;
  for (let j = -r, k = 0; j <= r; j++) for (let i = -r; i <= r; i++, k++) { out[k] = at(g, cx + i, cy + j); m += out[k]; }
  m /= out.length;
  let s = 0;
  for (let k = 0; k < out.length; k++) { out[k] -= m; s += out[k] * out[k]; }
  s = Math.sqrt(s) || 1;
  for (let k = 0; k < out.length; k++) out[k] /= s;
  return out;
}
/** Correlation of the template with the frame's patch at integer position (x, y). */
function score(g: Gray, tpl: Float32Array, r: number, x: number, y: number): number {
  if (x - r < 0 || y - r < 0 || x + r >= g.w || y + r >= g.h) return -1;
  let m = 0, s = 0, dot = 0;
  const n = 2 * r + 1;
  for (let j = 0; j < n; j++) { const row = (y - r + j) * g.w + x - r; for (let i = 0; i < n; i++) m += g.d[row + i]; }
  m /= n * n;
  for (let j = 0, k = 0; j < n; j++) {
    const row = (y - r + j) * g.w + x - r;
    for (let i = 0; i < n; i++, k++) { const v = g.d[row + i] - m; s += v * v; dot += v * tpl[k]; }
  }
  return s > 1e-3 ? dot / Math.sqrt(s) : -1;
}
/** Best match within ±R of (cx, cy), with a sub-pixel finish (a parabola through the neighbours). */
function search(g: Gray, tpl: Float32Array, r: number, cx: number, cy: number, R: number): { x: number; y: number; s: number } {
  const x0 = Math.round(cx), y0 = Math.round(cy);
  let bx = x0, by = y0, bs = -2;
  for (let y = y0 - R; y <= y0 + R; y++) for (let x = x0 - R; x <= x0 + R; x++) {
    const s = score(g, tpl, r, x, y);
    if (s > bs) { bs = s; bx = x; by = y; }
  }
  const sub = (a: number, b: number, c: number) => { const den = a - 2 * b + c; return Math.abs(den) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0; };
  const dx = sub(score(g, tpl, r, bx - 1, by), bs, score(g, tpl, r, bx + 1, by));
  const dy = sub(score(g, tpl, r, bx, by - 1), bs, score(g, tpl, r, bx, by + 1));
  return { x: bx + dx, y: by + dy, s: bs };
}
const blend = (a: Float32Array, b: Float32Array, k: number) => {
  let s = 0;
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) { o[i] = a[i] * (1 - k) + b[i] * k; s += o[i] * o[i]; }
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < o.length; i++) o[i] /= s;
  return o;
};

/**
 * One point being followed: its patches (full and half size), where it is, and where it was heading. The patches
 * slowly take on the point's new look but always keep some of how it looked when tracking started, so small
 * mistakes can't add up into drifting off.
 */
class Follower {
  tpl0: Float32Array; tpl1: Float32Array; org0: Float32Array; org1: Float32Array; x: number; y: number; vx = 0; vy = 0;
  /** This frame's candidate (before the group check) */
  cx = 0; cy = 0; cs = 0;
  constructor(g: Gray, g1: Gray, x: number, y: number) {
    this.x = x; this.y = y;
    this.tpl0 = this.org0 = patch(g, x, y, R0); this.tpl1 = this.org1 = patch(g1, x / 2, y / 2, R1);
  }
  /** Look for the point in the next frame (sets the candidate). */
  look(g: Gray, g1: Gray) {
    const px = this.x + this.vx, py = this.y + this.vy; // where it was heading
    const rough = search(g1, this.tpl1, R1, px / 2, py / 2, SEARCH);
    const fine = search(g, this.tpl0, R0, rough.x * 2, rough.y * 2, 3);
    this.cx = fine.x; this.cy = fine.y; this.cs = fine.s;
  }
  /** Look again only close to where it should be (a corner that strayed from the others). */
  lookNear(g: Gray, x: number, y: number) {
    const f = search(g, this.tpl0, R0, x, y, 4);
    this.cx = f.x; this.cy = f.y; this.cs = f.s;
  }
  /** Take the candidate; false when it's lost. */
  accept(g: Gray, g1: Gray): boolean {
    if (this.cs < LOST) return false;
    this.vx = (this.cx - this.x) * 0.8; this.vy = (this.cy - this.y) * 0.8;
    this.x = this.cx; this.y = this.cy;
    this.tpl0 = blend(blend(this.tpl0, patch(g, this.x, this.y, R0), 0.2), this.org0, 0.1);
    this.tpl1 = blend(blend(this.tpl1, patch(g1, this.x / 2, this.y / 2, R1), 0.2), this.org1, 0.1);
    return true;
  }
}

/**
 * Several points on one surface (four corners) move together: a point whose step disagrees with the others'
 * typical step is looked for again close to where the group says it should be.
 */
function stepAll(fol: Follower[], g: Gray, g1: Gray): boolean {
  for (const f of fol) f.look(g, g1);
  if (fol.length > 2) {
    const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
    const mx = med(fol.map((f) => f.cx - f.x)), my = med(fol.map((f) => f.cy - f.y));
    const lim = Math.max(2.5, 0.35 * Math.hypot(mx, my));
    for (const f of fol) if (Math.hypot(f.cx - f.x - mx, f.cy - f.y - my) > lim) f.lookNear(g, f.x + mx, f.y + my);
  }
  return fol.every((f) => f.accept(g, g1));
}

/* ---------------- running a track ---------------- */
let cancelRun = false;
export function stopTracking() { cancelRun = true; }

/** Frame-exact file time for timeline time T (the frame showing then). */
async function frameTime(src: VideoSource, it: Item, T: number): Promise<number> {
  const tm = src.clamp(mediaTimeOf(it, T, src.dur));
  const f = await src.frameAt(tm, ANALYSE);
  return f ? f.t : tm;
}
export function mediaTimeOf(it: Item, T: number, dur: number): number {
  const m = (it.mediaOffset ?? 0) + Math.max(0, T - it.start) * (it.speed ?? 1);
  return it.reverse ? Math.max(0, dur - m) : m;
}

/** Put a tracker's points at the frame showing at timeline time T (dragging a point; starting a track). */
export async function setTrackerPoints(itemId: string, trackerId: string, T: number, p: P2[], checkpoint = true) {
  const st = useStore.getState(), it = st.project.items.find((q) => q.id === itemId);
  const src = await videoSource(it?.src);
  if (!it || !src) return;
  const tm = await frameTime(src, it, T);
  st.edit((d) => {
    const tr = d.items.find((q) => q.id === itemId)?.trackers?.find((q) => q.id === trackerId);
    if (!tr) return;
    const i = tr.pts.findIndex((q) => Math.abs(q.t - tm) < 1e-4);
    if (i >= 0) tr.pts[i] = { t: tm, p }; else { tr.pts.push({ t: tm, p }); tr.pts.sort((a, b) => a.t - b.t); }
  }, checkpoint);
}

/** A new tracker on a video clip: one point in the middle, or four corners around the middle. */
export async function addTracker(itemId: string, n: 1 | 4) {
  const st = useStore.getState(), it = st.project.items.find((q) => q.id === itemId);
  const src = await videoSource(it?.src);
  if (!it) return;
  if (!src) { st.toast("This video can't be decoded here, so it can't be tracked (try Chrome or Edge, or the app)"); return; }
  const T = Math.min(Math.max(st.t, it.start), it.end - 1e-3);
  const tm = await frameTime(src, it, T);
  // in the part of the frame that's on the canvas: around the clip's centre
  const c = localToVideo(it, src.w, src.h, 0, 0), d = 0.12;
  const pts: P2[] = n === 1 ? [c] : [[c[0] - d, c[1] - d], [c[0] + d, c[1] - d], [c[0] + d, c[1] + d], [c[0] - d, c[1] + d]];
  const id = uid("trk"), count = (it.trackers?.length ?? 0) + 1;
  st.edit((p) => {
    const q = p.items.find((x) => x.id === itemId);
    if (q) (q.trackers ??= []).push({ id, name: n === 1 ? `Point ${count}` : `Corners ${count}`, n, pts: [{ t: tm, p: pts }] });
  });
  st.setUI({ tracking: { itemId, trackerId: id }, pinning: null });
}

/**
 * Follow the tracker's points from the playhead's frame, forwards or backwards on the timeline, to the clip's end
 * (or until a point is lost). Points found before in that direction are replaced.
 */
export async function runTracking(itemId: string, trackerId: string, dir: 1 | -1) {
  const st = useStore.getState(), it = st.project.items.find((q) => q.id === itemId);
  const tr = it?.trackers?.find((q) => q.id === trackerId);
  const src = await videoSource(it?.src);
  if (!it || !tr || !src) return;
  const T = Math.min(Math.max(st.t, it.start), it.end - 1e-3);
  const tm0 = await frameTime(src, it, T);
  const start = trackerAt(tr, tm0);
  if (!start) { st.toast("Put the point on the video at the playhead first (drag it there)"); return; }
  const [lo, hi] = mediaRange(it, src.dur);
  // forwards on the timeline is backwards in the file when the clip plays backwards
  const mdir = it.reverse ? -dir : dir;
  const [aw, ah] = src.size(ANALYSE);
  const total = Math.max(1, Math.round((mdir > 0 ? hi - tm0 : tm0 - lo) * 30));
  cancelRun = false;
  const found: { t: number; p: P2[] }[] = [];
  let lost = false, done = 0;
  const report = () => useStore.getState().setUI({ tracking: { itemId, trackerId, run: { dir, done, total } } });
  report();
  let fol: Follower[] | null = null;
  const take = (img: HTMLCanvasElement | OffscreenCanvas, t: number) => {
    const g = grayOf(img), g1 = halve(g);
    if (!fol) { fol = start.map(([u, v]) => new Follower(g, g1, u * aw, v * ah)); return true; }
    if (!stepAll(fol, g, g1)) { lost = true; return false; }
    found.push({ t, p: fol.map((f) => [f.x / aw, f.y / ah] as P2) });
    return true;
  };
  const sink = src.sink(ANALYSE);
  try {
    if (mdir > 0) {
      let last = performance.now();
      for await (const c of sink.canvases(tm0, hi + 1e-3)) {
        if (cancelRun || !take(c.canvas, c.timestamp)) break;
        done++;
        if (performance.now() - last > 400) { report(); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
      }
    } else {
      // backwards: decode a stretch forwards, then go through it in reverse
      const CH = 1.5;
      let b = tm0 + 1e-3;
      outer: while (b > lo + 1e-3 && !cancelRun) {
        const a = Math.max(lo, b - CH), chunk: { t: number; g: HTMLCanvasElement | OffscreenCanvas }[] = [];
        for await (const c of sink.canvases(a, b)) chunk.push({ t: c.timestamp, g: c.canvas });
        if (!chunk.length) break;
        for (let i = chunk.length - 1; i >= 0; i--) {
          if (cancelRun || !take(chunk[i].g, chunk[i].t)) break outer;
          done++;
        }
        report(); await new Promise((r) => setTimeout(r, 0));
        b = chunk[0].t - 1e-4;
      }
    }
  } finally {
    // keep what was found: replace the old points past the start, in the direction tracked
    const keep = (t: number) => (mdir > 0 ? t <= tm0 + 1e-4 : t >= tm0 - 1e-4);
    useStore.getState().edit((d) => {
      const q = d.items.find((x) => x.id === itemId)?.trackers?.find((x) => x.id === trackerId);
      if (!q) return;
      q.pts = [...q.pts.filter((x) => keep(x.t)), ...found].sort((x, y) => x.t - y.t);
    });
    useStore.getState().setUI({ tracking: { itemId, trackerId } });
    const secs = found.length ? Math.abs(found[found.length - 1].t - tm0) : 0;
    useStore.getState().toast(cancelRun ? `Stopped · ${found.length} frames tracked` : lost ? `Lost the point after ${secs.toFixed(1)}s — drag it back onto the spot and track again from there` : `Tracked ${found.length} frames`);
  }
}

/* ---------------- using a track ---------------- */
/** Keyframes from samples, keeping only as many as it takes to stay within `tol` px of the tracked path. */
function simplify(T: number[], vals: number[][], tol = 0.4): number[] {
  const keep = new Set<number>([0, T.length - 1]);
  const rec = (a: number, b: number) => {
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const f = (T[i] - T[a]) / Math.max(1e-9, T[b] - T[a]);
      for (const v of vals) { const e = Math.abs(v[a] + (v[b] - v[a]) * f - v[i]); if (e > worst) { worst = e; wi = i; } }
    }
    if (worst > tol && wi > 0) { keep.add(wi); rec(a, wi); rec(wi, b); }
  };
  if (T.length > 2) rec(0, T.length - 1);
  return [...keep].sort((a, b) => a - b);
}
/** Replace an item's keys for `prop`-like lists over [t0, t1] (local times) with these. */
function putKeys(list: Keyframe[] | undefined, t0: number, t1: number, add: Keyframe[]): Keyframe[] {
  return [...(list ?? []).filter((k) => k.t < t0 - 1e-4 || k.t > t1 + 1e-4), ...add].sort((a, b) => a.t - b.t);
}

async function ready(itemId: string, trackerId: string) {
  const st = useStore.getState(), project = st.project, it = project.items.find((q) => q.id === itemId);
  const tr = it?.trackers?.find((q) => q.id === trackerId);
  const src = await videoSource(it?.src);
  if (!it || !tr || !src) return null;
  // video points → canvas, with this video's own size
  const S = tr.pts
    .map((q) => ({ T: projectTimeOf(it, q.t, src.dur), p: q.p }))
    .filter((q) => q.T >= it.start - 1e-4 && q.T <= it.end + 1e-4)
    .sort((a, b) => a.T - b.T)
    .map((q) => ({ ...q, c: q.p.map((pp) => videoToCanvas(project, it, q.T, src.w, src.h, pp)) }));
  if (S.length < 2) { st.toast("Track it first: put the point on something and press Track"); return null; }
  return { st, project, it, tr, src, S };
}

/** The tracked point at timeline time T (canvas px), in between samples. */
function pointAt(S: { T: number; c: P2[] }[], T: number, i = 0): P2 {
  if (T <= S[0].T) return S[0].c[i];
  if (T >= S[S.length - 1].T) return S[S.length - 1].c[i];
  let k = 1; while (S[k].T < T) k++;
  const a = S[k - 1], b = S[k], f = (T - a.T) / Math.max(1e-9, b.T - a.T);
  return [a.c[i][0] + (b.c[i][0] - a.c[i][0]) * f, a.c[i][1] + (b.c[i][1] - a.c[i][1]) * f];
}

/** Make another item follow the tracked point (its position, keyed; it keeps its distance from the point at the playhead). */
export async function followTrack(itemId: string, trackerId: string, targetId: string) {
  const r = await ready(itemId, trackerId);
  if (!r) return;
  const { st, project, S } = r, tg = project.items.find((q) => q.id === targetId);
  if (!tg) return;
  // the average of the tracker's points (four corners: their middle)
  const mid = S.map((q) => ({ T: q.T, c: [[q.c.reduce((a, c) => a + c[0], 0) / q.c.length, q.c.reduce((a, c) => a + c[1], 0) / q.c.length] as P2] }));
  const S2 = mid.filter((q) => q.T >= tg.start - 1e-4 && q.T <= tg.end + 1e-4);
  if (S2.length < 2) { st.toast(`${tg.name} isn't on the timeline while the point is tracked`); return; }
  const T0 = Math.min(Math.max(st.t, S2[0].T), S2[S2.length - 1].T), p0 = pointAt(S2, T0);
  const dx = sampleKeys(tg.keys.x, T0 - tg.start, tg.base.x) - p0[0], dy = sampleKeys(tg.keys.y, T0 - tg.start, tg.base.y) - p0[1];
  const T = S2.map((q) => q.T - tg.start), X = S2.map((q) => q.c[0][0] + dx), Y = S2.map((q) => q.c[0][1] + dy);
  const idx = simplify(T, [X, Y]);
  st.edit((d) => {
    const q = d.items.find((x) => x.id === targetId);
    if (!q) return;
    q.keys.x = putKeys(q.keys.x, T[0], T[T.length - 1], idx.map((i) => ({ t: T[i], v: X[i], ease: "linear" as const })));
    q.keys.y = putKeys(q.keys.y, T[0], T[T.length - 1], idx.map((i) => ({ t: T[i], v: Y[i], ease: "linear" as const })));
  });
  st.toast(`${tg.name} follows ${r.tr.name} · ${idx.length} keyframes`);
}

const PIN = ["pin0x", "pin0y", "pin1x", "pin1y", "pin2x", "pin2y", "pin3x", "pin3y"] as const;
/** Four tracked corners → another item's corner pin, keyed: the item is warped onto the tracked corners in every frame. */
export async function pinToTrack(itemId: string, trackerId: string, targetId: string) {
  const r = await ready(itemId, trackerId);
  if (!r) return;
  const { st, project, S, tr } = r, tg = project.items.find((q) => q.id === targetId);
  if (!tg || tr.n !== 4) return;
  const S2 = S.filter((q) => q.T >= tg.start - 1e-4 && q.T <= tg.end + 1e-4);
  if (S2.length < 2) { st.toast(`${tg.name} isn't on the timeline while the corners are tracked`); return; }
  const rest: P2[] = [[-tg.w / 2, -tg.h / 2], [tg.w / 2, -tg.h / 2], [tg.w / 2, tg.h / 2], [-tg.w / 2, tg.h / 2]];
  const T = S2.map((q) => q.T - tg.start);
  const V: number[][] = PIN.map(() => []);
  for (const q of S2) {
    const s = itemState(project, tg, q.T);
    q.c.forEach((c, i) => { const l = fromCanvas(s, c); V[i * 2].push(l[0] - rest[i][0]); V[i * 2 + 1].push(l[1] - rest[i][1]); });
  }
  const idx = simplify(T, V, 0.5);
  st.edit((d) => {
    const q = d.items.find((x) => x.id === targetId);
    if (!q) return;
    const nk = (q.numKeys ??= {}) as Record<string, Keyframe[] | undefined>;
    PIN.forEach((k, j) => { nk[k] = putKeys(nk[k], T[0], T[T.length - 1], idx.map((i) => ({ t: T[i], v: V[j][i], ease: "linear" as const }))); });
    q.pinMode ??= "persp";
  });
  st.toast(`${tg.name} is pinned to ${tr.name} · ${idx.length} keyframes`);
}

/**
 * Steady the video: it moves against the tracked point so the point stays still on the canvas, and grows just
 * enough that its edges never come into view.
 */
export async function stabilise(itemId: string, trackerId: string) {
  const r = await ready(itemId, trackerId);
  if (!r) return;
  const { st, it, src, tr } = r;
  const S = tr.pts.map((q) => ({ T: projectTimeOf(it, q.t, src.dur), l: videoToLocal(it, src.w, src.h, q.p[0][0], q.p[0][1]) }))
    .filter((q) => q.T >= it.start - 1e-4 && q.T <= it.end + 1e-4).sort((a, b) => a.T - b.T);
  const T0 = Math.min(Math.max(st.t, S[0].T), S[S.length - 1].T);
  const k0 = S.reduce((b, q, i) => (Math.abs(q.T - T0) < Math.abs(S[b].T - T0) ? i : b), 0), l0 = S[k0].l;
  const d = S.map((q) => [q.l[0] - l0[0], q.l[1] - l0[1]] as P2);
  const mx = Math.max(...d.map((v) => Math.abs(v[0]))), my = Math.max(...d.map((v) => Math.abs(v[1])));
  const grow = Math.max(1 + (2 * mx) / it.w, 1 + (2 * my) / it.h);
  const loc = (T: number) => T - it.start;
  const x0 = sampleKeys(it.keys.x, loc(T0), it.base.x), y0 = sampleKeys(it.keys.y, loc(T0), it.base.y);
  const rz = sampleKeys(it.keys.rz, loc(T0), it.base.rz), sc = sampleKeys(it.keys.scale, loc(T0), it.base.scale) * grow;
  const a = (rz * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  const T = S.map((q) => loc(q.T));
  const X = d.map(([dx, dy]) => x0 - (dx * c - dy * si) * sc), Y = d.map(([dx, dy]) => y0 - (dx * si + dy * c) * sc);
  const idx = simplify(T, [X, Y]);
  st.edit((p) => {
    const q = p.items.find((x) => x.id === itemId);
    if (!q) return;
    q.keys.x = putKeys(q.keys.x, T[0], T[T.length - 1], idx.map((i) => ({ t: T[i], v: X[i], ease: "linear" as const })));
    q.keys.y = putKeys(q.keys.y, T[0], T[T.length - 1], idx.map((i) => ({ t: T[i], v: Y[i], ease: "linear" as const })));
    q.base.scale *= grow;
    q.keys.scale?.forEach((kf) => { kf.v *= grow; });
  });
  st.toast(`Steadied on ${tr.name} · zoomed in ${Math.round((grow - 1) * 100)}% so the edges stay hidden`);
}

/**
 * Keep the tracked point in the middle of the frame (a wide video in a tall canvas: the view pans with the
 * subject), smoothed so it moves like a camera operator would, and never far enough to show the video's edges.
 */
export async function keepCentred(itemId: string, trackerId: string) {
  const r = await ready(itemId, trackerId);
  if (!r) return;
  const { st, project, it, S, tr } = r;
  const W = project.width, H = project.height;
  const s0 = itemState(project, it, S[0].T);
  const hw = (it.w * Math.abs(s0.scale)) / 2, hh = (it.h * Math.abs(s0.scale)) / 2;
  // where the point would be with the clip where it is now, and how far the clip has to move to centre it
  const own = (T: number) => [sampleKeys(it.keys.x, T - it.start, it.base.x), sampleKeys(it.keys.y, T - it.start, it.base.y)];
  const raw = S.map((q) => { const o = own(q.T); return [o[0] + W / 2 - q.c[0][0], o[1] + H / 2 - q.c[0][1]]; });
  // smooth over about half a second each way
  const half = 0.4;
  const sm = raw.map((_, i) => {
    let sx = 0, sy = 0, n = 0;
    for (let j = i; j >= 0 && S[i].T - S[j].T <= half; j--) { sx += raw[j][0]; sy += raw[j][1]; n++; }
    for (let j = i + 1; j < S.length && S[j].T - S[i].T <= half; j++) { sx += raw[j][0]; sy += raw[j][1]; n++; }
    return [sx / n, sy / n];
  });
  const clampTo = (v: number, half2: number, size: number) => (half2 * 2 >= size ? Math.min(half2, Math.max(size - half2, v)) : size / 2);
  const T = S.map((q) => q.T - it.start);
  const X = sm.map((v) => clampTo(v[0], hw, W)), Y = sm.map((v) => clampTo(v[1], hh, H));
  const idx = simplify(T, [X, Y], 2); // smoothed already: a looser fit, far fewer keyframes
  st.edit((p) => {
    const q = p.items.find((x) => x.id === itemId);
    if (!q) return;
    q.keys.x = putKeys(q.keys.x, T[0], T[T.length - 1], idx.map((i) => ({ t: T[i], v: X[i], ease: "linear" as const })));
    if (hh * 2 > H + 1) q.keys.y = putKeys(q.keys.y, T[0], T[T.length - 1], idx.map((i) => ({ t: T[i], v: Y[i], ease: "linear" as const })));
  });
  st.toast(`The view follows ${tr.name} · ${idx.length} keyframes`);
}
