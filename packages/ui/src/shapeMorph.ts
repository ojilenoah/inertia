import type { Item, ShapeSpec } from "@moshion/engine";
import { shapeAt, shapeD, numAt } from "@moshion/engine";

/*
 * Morphing one shape into another: both outlines are traced into the same number of points,
 * lined up (same direction, starting at the top), and blended.
 */
const N = 160;
const cache = new Map<string, [number, number][]>();
let probe: SVGPathElement | null = null;

export function outlinePoints(spec: ShapeSpec, w: number, h: number): [number, number][] {
  const key = `${JSON.stringify(spec)}|${Math.round(w)}|${Math.round(h)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!probe) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden");
    probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(probe); document.body.appendChild(svg);
  }
  // the outer outline only (a ring's hole fades in/out as part of the outline blend)
  const full = shapeD(spec, w, h).d, second = full.indexOf("M", 1);
  probe.setAttribute("d", second > 0 ? full.slice(0, second) : full);
  const len = probe.getTotalLength();
  let pts: [number, number][] = Array.from({ length: N }, (_, i) => { const p = probe!.getPointAtLength((i / N) * len); return [p.x, p.y]; });
  // same winding for every shape
  let area = 0;
  for (let i = 0; i < N; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % N]; area += x0 * y1 - x1 * y0; }
  if (area < 0) pts = pts.reverse();
  // start at the point straight above the centre
  const cx = w / 2, cy = h / 2;
  let best = 0, bd = Infinity;
  pts.forEach(([x, y], i) => { const a = Math.atan2(y - cy, x - cx), dd = Math.abs(a + Math.PI / 2); if (dd < bd) { bd = dd; best = i; } });
  pts = [...pts.slice(best), ...pts.slice(0, best)];
  if (cache.size > 200) cache.clear();
  cache.set(key, pts);
  return pts;
}

/** The outline of a shape item at item-local time (blended while it morphs between shape keyframes). */
const STAR_PTS = [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]];
/**
 * A hollow item: its outline, and the hole — the same shape `t` px in from every side (rounded corners keep the
 * same roundness). The hole's path is in its own box; it sits at (t, t). Null when the item isn't hollow.
 */
export function hollowParts(item: Item, local: number): { outer: { d: string; evenodd?: boolean }; inner: { d: string; evenodd?: boolean }; t: number } | null {
  const t = Math.min(numAt(item, "hollow", local), Math.min(item.w, item.h) / 2 - 1);
  if (!(t > 0.5)) return null;
  const w = item.w, h = item.h, w2 = w - 2 * t, h2 = h - 2 * t;
  const of = (W: number, H: number): { d: string; evenodd?: boolean } | null => {
    if (item.kind === "shape") return itemShapeD(item, local, W, H);
    if (item.kind === "ellipse" || item.kind === "glass") return shapeD({ type: "ellipse" }, W, H);
    if (item.kind === "star") return { d: STAR_PTS.map(([x, y], i) => `${i ? "L" : "M"}${(x * W) / 100} ${(y * H) / 100}`).join("") + "Z" };
    if (["rect", "image", "video"].includes(item.kind)) return shapeD({ type: "rect", round: Math.min(1, (item.radius ?? 0) / (Math.min(w, h) / 2 || 1)) }, W, H);
    return null;
  };
  const outer = of(w, h), inner = of(w2, h2);
  return outer && inner ? { outer, inner, t } : null;
}

export function itemShapeD(item: Item, local: number, w: number, h: number): { d: string; evenodd?: boolean } | null {
  if (item.kind !== "shape") return null;
  const sa = shapeAt(item, local);
  if (!sa.to || sa.p == null) return shapeD(sa.spec, w, h);
  const A = outlinePoints(sa.spec, w, h), B = outlinePoints(sa.to, w, h), p = sa.p;
  const d = A.map(([x, y], i) => `${i ? "L" : "M"}${(x + (B[i][0] - x) * p).toFixed(1)} ${(y + (B[i][1] - y) * p).toFixed(1)}`).join("") + "Z";
  return { d };
}
