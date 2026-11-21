import type { Bezier, Ease, EaseName } from "./types";

export const EASE_PRESETS: Record<Exclude<EaseName, "hold">, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.42, 0, 0.58, 1],
  expo: [0.85, 0, 0.15, 1],
  back: [0.34, 1.56, 0.64, 1],
  wiggle: [0, 0, 1, 1],
  /** Starts slowly, arrives at full speed. */
  easeIn: [0.42, 0, 1, 1],
  /** Leaves at full speed and slows down into the next keyframe. */
  easeOut: [0, 0, 0.58, 1],
  /** Glides through keyframes without stopping (worked out from the neighbouring keyframes; see smoothValue). */
  smooth: [0.33, 0.33, 0.67, 0.67],
};

/**
 * "Smooth": the value flows through each keyframe at a steady speed instead of stopping there,
 * like a curve drawn through all the keyframes (its slope at each keyframe comes from its neighbours).
 */
export function smoothValue(keys: { t: number; v: number }[], i: number, t: number): number {
  const a = keys[i], b = keys[i + 1], prev = keys[i - 1], next = keys[i + 2];
  const dt = b.t - a.t || 1e-9, u = Math.min(Math.max((t - a.t) / dt, 0), 1);
  const m0 = prev ? ((b.v - prev.v) / (b.t - prev.t || 1e-9)) * dt : b.v - a.v;
  const m1 = next ? ((next.v - a.v) / (next.t - a.t || 1e-9)) * dt : b.v - a.v;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * m1;
}
/** "Wiggle": travels from one keyframe to the next while shaking (strongest in the middle). */
const wiggleFn = (p: number) => {
  if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;
  const n = Math.sin(p * 41.3) * 0.5 + Math.sin(p * 97.1 + 1.3) * 0.3 + Math.sin(p * 23.7 + 2.1) * 0.2;
  return p + Math.sin(Math.PI * p) * 0.35 * n;
};

export function toBezier(e: Ease): Bezier | null {
  if (Array.isArray(e)) return e;
  if (e === "hold") return null;
  return EASE_PRESETS[e];
}

/** Classic cubic-bezier timing function: solve x(s)=p for s, return y(s). */
export function cubicBezier([x1, y1, x2, y2]: Bezier): (p: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let s = p;
    for (let i = 0; i < 8; i++) {
      const err = sx(s) - p;
      if (Math.abs(err) < 1e-6) return sy(s);
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0, hi = 1;
    s = p;
    for (let i = 0; i < 30; i++) {
      const x = sx(s);
      if (Math.abs(x - p) < 1e-6) break;
      if (x < p) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return sy(s);
  };
}

const cache = new Map<string, (p: number) => number>();
export function easeFn(e: Ease): (p: number) => number {
  if (e === "wiggle") return wiggleFn;
  const b = toBezier(e);
  if (!b) return () => 0; // hold
  const k = b.join(",");
  let f = cache.get(k);
  if (!f) { f = cubicBezier(b); cache.set(k, f); }
  return f;
}
