import type { Item, Seconds } from "./types";
import { numAt, setNum } from "./morph";

/*
 * Corner pin: each of an item's four corners can be dragged on its own and the item warps in perspective to
 * fit (like pinning a picture onto a wall at an angle). The corners are offsets from where they'd be (in the
 * item's own px, before its turn and scale), keyframed like any number setting.
 */

type P2 = [number, number];
/** The 8 numbers: corner 0 (top-left), 1 (top-right), 2 (bottom-right), 3 (bottom-left), x then y. */
export const PIN_KEYS = ["pin0x", "pin0y", "pin1x", "pin1y", "pin2x", "pin2y", "pin3x", "pin3y"] as const;
export type PinKey = (typeof PIN_KEYS)[number];

/** The corners' offsets at item-local time, or null when none is moved. */
export function pinAt(item: Item, local: Seconds): P2[] | null {
  const v = PIN_KEYS.map((k) => numAt(item, k, local));
  if (v.every((x) => Math.abs(x) < 1e-6)) return null;
  return [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]];
}
export function isPinned(item: Item): boolean {
  return PIN_KEYS.some((k) => Math.abs((item as unknown as Record<string, number | undefined>)[k] ?? 0) > 1e-6 || item.numKeys?.[k]?.some((q) => Math.abs(q.v) > 1e-6));
}

/** The four corners (from the item's centre) with the offsets added. */
export function pinQuad(w: number, h: number, off: P2[]): P2[] {
  const rest: P2[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return rest.map((p, i) => [p[0] + off[i][0], p[1] + off[i][1]]);
}

/**
 * The perspective map (3×3, row by row) that takes the item's rectangle (centred on 0, 0) onto `quad`.
 * Null when the quad is folded over itself (no such map).
 */
export function pinMatrix(w: number, h: number, quad: P2[]): number[] | null {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, hh: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; hh = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  // unit square → quad, after the rectangle → unit square (u = x / w + ½, v = y / h + ½)
  const S = [1 / w, 0, 0.5, 0, 1 / h, 0.5, 0, 0, 1];
  const Q = [a, b, c, d, e, f, g, hh, 1];
  const m = (r: number, col: number) => Q[r * 3] * S[col] + Q[r * 3 + 1] * S[3 + col] + Q[r * 3 + 2] * S[6 + col];
  const out = [m(0, 0), m(0, 1), m(0, 2), m(1, 0), m(1, 1), m(1, 2), m(2, 0), m(2, 1), m(2, 2)];
  return out.every(Number.isFinite) ? out : null;
}

/** Where a point (from the item's centre) lands under the pin; null past the horizon. */
export function pinMap(H: number[], x: number, y: number): P2 | null {
  const wq = H[6] * x + H[7] * y + H[8];
  if (wq < 0.02) return null;
  return [(H[0] * x + H[1] * y + H[2]) / wq, (H[3] * x + H[4] * y + H[5]) / wq];
}

/** The same map as a CSS transform (with the transform origin at the item's centre). */
export function pinCSS(H: number[]): string {
  const n = H.map((v) => +v.toFixed(8));
  return `matrix3d(${n[0]},${n[3]},0,${n[6]},${n[1]},${n[4]},0,${n[7]},0,0,1,0,${n[2]},${n[5]},0,${n[8]})`;
}

/** The item's pin map at item-local time, or null when it isn't pinned. */
export function pinHAt(item: Item, local: Seconds): number[] | null {
  const off = pinAt(item, local);
  return off ? pinMatrix(item.w, item.h, pinQuad(item.w, item.h, off)) : null;
}

/** Move one corner to a new offset (the keyframe rule: with keyframes, at the keyframe under the playhead). */
export function setPinCorner(item: Item, t: Seconds, corner: number, off: P2) {
  setNum(item, PIN_KEYS[corner * 2], t, off[0]);
  setNum(item, PIN_KEYS[corner * 2 + 1], t, off[1]);
}

/** Take the pin off completely (every corner back, its keyframes gone). */
export function clearPin(item: Item) {
  const rec = item as unknown as Record<string, number | undefined>;
  for (const k of PIN_KEYS) { delete rec[k]; if (item.numKeys) delete item.numKeys[k]; }
}
