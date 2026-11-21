/*
 * Shapes made from settings (points, sides, rounding…) and lines you draw.
 * Every shape is an SVG path in its own box (0..w, 0..h): the editor clips with it and the
 * export fills it, so both always match.
 */

export type ShapeType =
  | "rect" | "ellipse" | "triangle" | "diamond" | "polygon" | "star" | "burst" | "heart"
  | "arrow" | "ring" | "cross" | "capsule" | "bubble" | "blob" | "chevron" | "drop" | "path";

export interface ShapeSpec {
  type: ShapeType;
  /** polygon sides / star points */
  count?: number;
  /** star & burst: inner size; ring: hole size; arrow: head length (0..1) */
  inner?: number;
  /** how rounded the corners are (0..1) */
  round?: number;
  /** cross, arrow, chevron: arm thickness (0..1) */
  thickness?: number;
  /** blob: a different random shape per number */
  seed?: number;
  /** path (imported SVG): outlines as points in a 0..1 box */
  rings?: [number, number][][];
}

export interface ShapeInfo { type: ShapeType; label: string; spec: ShapeSpec; params: ("count" | "inner" | "round" | "thickness" | "seed")[] }
export const SHAPES_LIST: ShapeInfo[] = [
  { type: "rect", label: "Rectangle", spec: { type: "rect", round: 0.12 }, params: ["round"] },
  { type: "ellipse", label: "Ellipse", spec: { type: "ellipse" }, params: [] },
  { type: "triangle", label: "Triangle", spec: { type: "triangle", round: 0.1 }, params: ["round"] },
  { type: "diamond", label: "Diamond", spec: { type: "diamond", round: 0.05 }, params: ["round"] },
  { type: "polygon", label: "Polygon", spec: { type: "polygon", count: 6, round: 0.1 }, params: ["count", "round"] },
  { type: "star", label: "Star", spec: { type: "star", count: 5, inner: 0.45, round: 0 }, params: ["count", "inner", "round"] },
  { type: "burst", label: "Burst", spec: { type: "burst", count: 14, inner: 0.78, round: 0.2 }, params: ["count", "inner", "round"] },
  { type: "heart", label: "Heart", spec: { type: "heart" }, params: [] },
  { type: "arrow", label: "Arrow", spec: { type: "arrow", thickness: 0.4, inner: 0.4, round: 0.1 }, params: ["thickness", "inner", "round"] },
  { type: "chevron", label: "Chevron", spec: { type: "chevron", thickness: 0.4, round: 0.1 }, params: ["thickness", "round"] },
  { type: "ring", label: "Ring", spec: { type: "ring", inner: 0.6 }, params: ["inner"] },
  { type: "cross", label: "Cross", spec: { type: "cross", thickness: 0.34, round: 0.15 }, params: ["thickness", "round"] },
  { type: "capsule", label: "Capsule", spec: { type: "capsule" }, params: [] },
  { type: "bubble", label: "Speech", spec: { type: "bubble", round: 0.35 }, params: ["round"] },
  { type: "drop", label: "Drop", spec: { type: "drop" }, params: [] },
  { type: "blob", label: "Blob", spec: { type: "blob", count: 7, round: 0.6, seed: 3 }, params: ["count", "round", "seed"] },
];
export const SHAPE_PARAM_LABEL = { count: "Points / sides", inner: "Inner size", round: "Roundness", thickness: "Thickness", seed: "Variation" } as const;

type P = [number, number];
const f = (n: number) => Math.round(n * 100) / 100;

/** A closed polygon with its corners rounded by `round` (0 = sharp, 1 = as round as the edges allow). */
function roundedPoly(pts: P[], round: number): string {
  const n = pts.length;
  if (!round) return pts.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join("") + "Z";
  const t = Math.min(0.5, Math.max(0, round) * 0.5);
  let d = "";
  for (let i = 0; i < n; i++) {
    const v = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const p1: P = [v[0] + (a[0] - v[0]) * t, v[1] + (a[1] - v[1]) * t], p2: P = [v[0] + (b[0] - v[0]) * t, v[1] + (b[1] - v[1]) * t];
    d += `${i ? "L" : "M"}${f(p1[0])} ${f(p1[1])}Q${f(v[0])} ${f(v[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "Z";
}
const ellipseD = (cx: number, cy: number, rx: number, ry: number) =>
  `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
function radial(w: number, h: number, n: number, r: (i: number) => number, start = -Math.PI / 2): P[] {
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i / n) * Math.PI * 2, k = r(i);
    return [w / 2 + Math.cos(a) * (w / 2) * k, h / 2 + Math.sin(a) * (h / 2) * k] as P;
  });
}
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** The outline of a shape in a w×h box. `evenodd` shapes have holes. */
export function shapeD(s: ShapeSpec, w: number, h: number): { d: string; evenodd?: boolean } {
  const round = s.round ?? 0;
  switch (s.type) {
    case "path": {
      const rings = s.rings ?? [];
      return { d: rings.map((r) => r.map(([x, y], i) => `${i ? "L" : "M"}${f(x * w)} ${f(y * h)}`).join("") + "Z").join(""), evenodd: rings.length > 1 };
    }
    case "rect": {
      const r = Math.min(w, h) / 2 * Math.min(1, round);
      return { d: `M${f(r)} 0H${f(w - r)}Q${f(w)} 0 ${f(w)} ${f(r)}V${f(h - r)}Q${f(w)} ${f(h)} ${f(w - r)} ${f(h)}H${f(r)}Q0 ${f(h)} 0 ${f(h - r)}V${f(r)}Q0 0 ${f(r)} 0Z` };
    }
    case "capsule": return shapeD({ type: "rect", round: 1 }, w, h);
    case "ellipse": return { d: ellipseD(w / 2, h / 2, w / 2, h / 2) };
    case "triangle": return { d: roundedPoly([[w / 2, 0], [w, h], [0, h]], round) };
    case "diamond": return { d: roundedPoly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], round) };
    case "polygon": return { d: roundedPoly(radial(w, h, Math.max(3, Math.round(s.count ?? 6)), () => 1), round) };
    case "star": case "burst": {
      const n = Math.max(3, Math.round(s.count ?? 5)), inner = Math.min(0.98, Math.max(0.05, s.inner ?? 0.45));
      return { d: roundedPoly(radial(w, h, n * 2, (i) => (i % 2 ? inner : 1)), round) };
    }
    case "heart": {
      const u = (x: number, y: number) => `${f(x * w)} ${f(y * h)}`;
      return { d: `M${u(0.5, 0.95)}C${u(0.2, 0.75)} ${u(0, 0.55)} ${u(0, 0.3)}C${u(0, 0.12)} ${u(0.15, 0)} ${u(0.3, 0)}C${u(0.4, 0)} ${u(0.47, 0.06)} ${u(0.5, 0.15)}C${u(0.53, 0.06)} ${u(0.6, 0)} ${u(0.7, 0)}C${u(0.85, 0)} ${u(1, 0.12)} ${u(1, 0.3)}C${u(1, 0.55)} ${u(0.8, 0.75)} ${u(0.5, 0.95)}Z` };
    }
    case "drop": {
      const u = (x: number, y: number) => `${f(x * w)} ${f(y * h)}`;
      return { d: `M${u(0.5, 0)}C${u(0.75, 0.3)} ${u(1, 0.5)} ${u(1, 0.68)}C${u(1, 0.88)} ${u(0.78, 1)} ${u(0.5, 1)}C${u(0.22, 1)} ${u(0, 0.88)} ${u(0, 0.68)}C${u(0, 0.5)} ${u(0.25, 0.3)} ${u(0.5, 0)}Z` };
    }
    case "arrow": {
      const th = Math.min(0.95, Math.max(0.05, s.thickness ?? 0.4)) * h, head = Math.min(0.9, Math.max(0.1, s.inner ?? 0.4)) * w;
      const y0 = (h - th) / 2, y1 = (h + th) / 2, x1 = w - head;
      return { d: roundedPoly([[0, y0], [x1, y0], [x1, 0], [w, h / 2], [x1, h], [x1, y1], [0, y1]], round * 0.6) };
    }
    case "chevron": {
      const th = Math.min(0.9, Math.max(0.05, s.thickness ?? 0.4)) * w;
      return { d: roundedPoly([[0, 0], [th, 0], [w, h / 2], [th, h], [0, h], [w - th, h / 2]], round * 0.6) };
    }
    case "cross": {
      const tx = Math.min(0.95, Math.max(0.05, s.thickness ?? 0.34)) * w, ty = Math.min(0.95, Math.max(0.05, s.thickness ?? 0.34)) * h;
      const a = (w - tx) / 2, b = (w + tx) / 2, c = (h - ty) / 2, e = (h + ty) / 2;
      return { d: roundedPoly([[a, 0], [b, 0], [b, c], [w, c], [w, e], [b, e], [b, h], [a, h], [a, e], [0, e], [0, c], [a, c]], round * 0.5) };
    }
    case "ring": {
      const k = Math.min(0.95, Math.max(0.05, s.inner ?? 0.6));
      return { d: ellipseD(w / 2, h / 2, w / 2, h / 2) + ellipseD(w / 2, h / 2, (w / 2) * k, (h / 2) * k), evenodd: true };
    }
    case "bubble": {
      const bh = h * 0.78, r = Math.min(w, bh) / 2 * Math.min(1, round);
      const body = `M${f(r)} 0H${f(w - r)}Q${f(w)} 0 ${f(w)} ${f(r)}V${f(bh - r)}Q${f(w)} ${f(bh)} ${f(w - r)} ${f(bh)}H${f(w * 0.42)}L${f(w * 0.2)} ${f(h)}L${f(w * 0.26)} ${f(bh)}H${f(r)}Q0 ${f(bh)} 0 ${f(bh - r)}V${f(r)}Q0 0 ${f(r)} 0Z`;
      return { d: body };
    }
    case "blob": {
      const n = Math.max(3, Math.round(s.count ?? 7)), seed = s.seed ?? 1;
      const pts = radial(w, h, n, (i) => 0.62 + 0.38 * rnd(seed * 31 + i * 7));
      // smooth closed curve through the points (Catmull-Rom → Bézier), tension from roundness
      const k = 0.08 + 0.2 * Math.min(1, Math.max(0, round));
      let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        d += `C${f(p1[0] + (p2[0] - p0[0]) * k)} ${f(p1[1] + (p2[1] - p0[1]) * k)} ${f(p2[0] - (p3[0] - p1[0]) * k)} ${f(p2[1] - (p3[1] - p1[1]) * k)} ${f(p2[0])} ${f(p2[1])}`;
      }
      return { d: d + "Z" };
    }
  }
}

/* ---------------- lines ---------------- */
export type LineDash = "solid" | "dash" | "dot" | "dashdot";
export type LineArrow = "none" | "end" | "start" | "both";
export interface LineSpec {
  /** points relative to the item's box: -0.5..0.5 of its width / height */
  pts: [number, number][];
  width: number;
  color: string;
  dash: LineDash;
  arrow: LineArrow;
  cap: "round" | "butt";
}
/** Dash pattern (in px) for a line style. */
export function dashArray(l: LineSpec): number[] {
  const w = Math.max(1, l.width);
  if (l.dash === "dash") return [w * 3, w * 2.2];
  if (l.dash === "dot") return [0.001, w * 2];
  if (l.dash === "dashdot") return [w * 3, w * 1.6, 0.001, w * 1.6];
  return [];
}
/** The first `frac` (0..1) of a polyline, by length — used to draw a line on over time. */
export function partialLine(pts: [number, number][], frac: number): [number, number][] {
  if (frac >= 1 || pts.length < 2) return pts;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const want = Math.max(0, frac) * lens[lens.length - 1];
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= want) { out.push(pts[i]); continue; }
    const u = (want - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]);
    break;
  }
  return out;
}
/** Arrowhead triangles at the ends of a (pixel-space) polyline. */
export function arrowHeads(pts: [number, number][], l: LineSpec): [number, number][][] {
  if (l.arrow === "none" || pts.length < 2) return [];
  const size = Math.max(6, l.width * 3.2);
  const head = (tip: [number, number], from: [number, number]) => {
    const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    return [tip, [tip[0] - Math.cos(a - 0.45) * size, tip[1] - Math.sin(a - 0.45) * size], [tip[0] - Math.cos(a + 0.45) * size, tip[1] - Math.sin(a + 0.45) * size]] as [number, number][];
  };
  const out: [number, number][][] = [];
  if (l.arrow === "end" || l.arrow === "both") out.push(head(pts[pts.length - 1], pts[pts.length - 2]));
  if (l.arrow === "start" || l.arrow === "both") out.push(head(pts[0], pts[1]));
  return out;
}

/** The part of a polyline between fractions a and b of its length. */
export function subLine(pts: [number, number][], a: number, b: number): [number, number][] {
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(1, Math.max(a, b));
  if (lo <= 0) return partialLine(pts, hi);
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1], from = lo * total, to = hi * total;
  const at = (d: number): [number, number] => {
    let i = 1; while (i < pts.length - 1 && lens[i] < d) i++;
    const u = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
  };
  const out: [number, number][] = [at(from)];
  for (let i = 1; i < pts.length - 1; i++) if (lens[i] > from && lens[i] < to) out.push(pts[i]);
  out.push(at(to));
  return out;
}
