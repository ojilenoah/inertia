import type { Item, ItemState, Project, ShapeSpec } from "@moshion/engine";
import { lineShape, pinAt, pinQuad } from "@moshion/engine";
import { followOffset, groupChain, itemState, itemsInGroup, motionAt, numAt, pathPivot, pathTransform, pathTransformZ, sampleKeys, pieceFx, resolveItem, shapeAt, splitPieces, textAnimOf, textUnit } from "@moshion/engine";
import { outlinePoints } from "./shapeMorph";

type Pt = [number, number];
const rad = Math.PI / 180;

/* ---------------- masks ---------------- */
/** Items that are used to mask something: they're hidden themselves (a group used as a mask hides all its items). */
export function maskItems(project: Project): Set<string> {
  // a mask shape is hidden, unless things were placed inside it (then it's a visible container)
  const out = new Set<string>();
  const masks = [...project.items.map((i) => i.mask), ...project.tracks.map((t) => t.mask)];
  for (const m of masks) {
    if (!m || m.inside) continue;
    const g = project.tracks.find((t) => t.id === m.by && t.kind === "group");
    if (g) itemsInGroup(project, g.id).forEach((x) => out.add(x.id)); else out.add(m.by);
  }
  return out;
}
/**
 * What moves along when these items are moved: the items they mask (and items in groups they mask), at any depth,
 * except items set to stay put ("Leaves this put").
 */
export function maskFollowers(project: Project, ids: string[]): string[] {
  const all = [...ids];
  for (let grew = true, n = 0; grew && n < 10; n++) {
    grew = false;
    for (const o of project.items) {
      if (all.includes(o.id) || o.kind === "audio") continue;
      // (only items the mask doesn't already carry as their parent)
      const own = o.mask && !o.mask.free && all.includes(o.mask.by) && o.parentLink?.id !== o.mask.by;
      const g = o.mask ? undefined : groupChain(project, o).find((x) => x.mask);
      const viaGroup = !!g?.mask && !g.mask.free && all.includes(g.mask.by) && g.parentLink?.id !== g.mask.by;
      if (own || viaGroup) { all.push(o.id); grew = true; }
    }
  }
  return all.slice(ids.length);
}
/** The mask an item uses: its own, or else the nearest group around it that has one (groups inside groups too). */
export function maskOf(project: Project, item: Item): Item["mask"] {
  if (item.mask) return item.mask;
  return groupChain(project, item).find((g) => g.mask)?.mask;
}
function specOf(it: Item): ShapeSpec | null {
  if (it.kind === "shape" && it.shape) return it.shape;
  if (it.kind === "ellipse" || it.kind === "glass") return { type: "ellipse" };
  if (it.kind === "star") return { type: "star", count: 5, inner: 0.38 };
  if (["rect", "image", "video", "text", "chart", "particles"].includes(it.kind)) return { type: "rect", round: Math.min(1, (it.radius ?? 0) / (Math.min(it.w, it.h) / 2 || 1)) };
  return null;
}
const flat3 = (s: ItemState) => Math.abs(s.rx % 360) < 0.01 && Math.abs(s.ry % 360) < 0.01 && Math.abs(s.z) < 0.01;
/**
 * A point of an item (in its own box) where it lands on the canvas: position, size, turn, and its 3D tilt
 * with the same perspective the editor and export use, so masks follow what you actually see.
 */
function toWorld(s: ItemState, it: Item, [px, py]: Pt, pz = 0): Pt {
  let x = (px - it.w / 2) * s.scale, y = (py - it.h / 2) * s.scale, z = pz * s.scale;
  let c = Math.cos(s.rz * rad), n = Math.sin(s.rz * rad);
  [x, y] = [x * c - y * n, x * n + y * c];
  if (flat3(s) && !pz) return [s.x + x, s.y + y];
  c = Math.cos(s.ry * rad); n = Math.sin(s.ry * rad);
  [x, z] = [x * c + z * n, -x * n + z * c];
  c = Math.cos(s.rx * rad); n = Math.sin(s.rx * rad);
  [y, z] = [y * c - z * n, y * n + z * c];
  z += s.z;
  const f = 1400 / Math.max(1, 1400 - z);
  return [s.x + x * f, s.y + y * f];
}
/** The 3×3 projective map taking the four corners src → dst (used to undo a 3D tilt). */
function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination
  for (let i = 0; i < 8; i++) {
    let p = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-12;
    for (let r = 0; r < 8; r++) { if (r === i) continue; const f = A[r][i] / d; for (let k = i; k < 8; k++) A[r][k] -= f * A[i][k]; b[r] -= f * b[i]; }
  }
  return [...b.map((v, i) => v / (A[i][i] || 1e-12)), 1];
}
function toLocal(s: ItemState, it: Item, [wx, wy]: Pt): Pt {
  if (flat3(s)) {
    const dx = wx - s.x, dy = wy - s.y, c = Math.cos(-s.rz * rad), n = Math.sin(-s.rz * rad);
    return [(dx * c - dy * n) / (s.scale || 1) + it.w / 2, (dx * n + dy * c) / (s.scale || 1) + it.h / 2];
  }
  // a tilted item: map the canvas point back onto its own (tilted) surface
  const box: Pt[] = [[0, 0], [it.w, 0], [it.w, it.h], [0, it.h]];
  const h = homography(box.map((p) => toWorld(s, it, p)), box);
  const W = h[6] * wx + h[7] * wy + 1;
  return [(h[0] * wx + h[1] * wy + h[2]) / W, (h[3] * wx + h[4] * wy + h[5]) / W];
}
/** An item's outline on the canvas at time t (keyframed shapes use the shape they have right now). */
function outlineOf(project: Project, m: Item, t: number): Pt[] | null {
  const loc = localOutline(m, t);
  if (!loc) return null;
  const ms = itemState(project, m, t);
  return loc.map((p) => toWorld(ms, m, p));
}
/** An item's outline on the canvas (for the onion skin's mask outlines). */
export function itemOutline(project: Project, m: Item, t: number): Pt[] | null { return outlineOf(project, m, t); }
/** An item's outline in its own box (keyframed shapes use the shape they have right now). */
function localOutline(m: Item, t: number, w = m.w, h = m.h): Pt[] | null {
  const spec = specOf(m);
  if (!spec) return null;
  let pts = outlinePoints(spec, w, h);
  if (m.kind === "shape") {
    const sa = shapeAt(m, t - m.start);
    pts = outlinePoints(sa.spec, w, h);
    if (sa.to && sa.p != null) { const B = outlinePoints(sa.to, w, h), q = sa.p; pts = pts.map(([x, y], i) => [x + (B[i][0] - x) * q, y + (B[i][1] - y) * q] as Pt); }
  }
  return pts;
}
/** Keep the part of a polygon on one side of a line through the item's middle (Sutherland–Hodgman). */
function clipHalf(poly: Pt[], inside: (p: Pt) => boolean, cross: (a: Pt, b: Pt) => Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) out.push(cross(a, b));
  }
  return out;
}
/**
 * Clipping by one edge of an item's outline as you see it (a circle turned into an ellipse in 3D cuts along the
 * ellipse): the masked item stays visible on the near side of the outline's middle line and inside the far half
 * of the shape, and is hidden past that far edge. Worked out on screen, in the item's own (turned) direction.
 */
function edgeRegion(world: Pt[], cx0: number, cy0: number, rz: number, edge: string): Pt[][] {
  const c = Math.cos(-rz * rad), n = Math.sin(-rz * rad), cb = Math.cos(rz * rad), nb = Math.sin(rz * rad);
  const into = ([x, y]: Pt): Pt => { const dx = x - cx0, dy = y - cy0; return [dx * c - dy * n, dx * n + dy * c]; };
  const back = ([x, y]: Pt): Pt => [cx0 + x * cb - y * nb, cy0 + x * nb + y * cb];
  const q = world.map(into), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, B = 1e5;
  const across = edge === "left" || edge === "right", mid = across ? mx : my;
  const free: Record<string, Pt[]> = {
    right: [[-B, -B], [mx, -B], [mx, B], [-B, B]],
    left: [[mx, -B], [B, -B], [B, B], [mx, B]],
    bottom: [[-B, -B], [B, -B], [B, my], [-B, my]],
    top: [[-B, my], [B, my], [B, B], [-B, B]],
  };
  const far = (p: Pt) => (edge === "right" ? p[0] >= mx : edge === "left" ? p[0] <= mx : edge === "bottom" ? p[1] >= my : p[1] <= my);
  const cross = (a: Pt, b: Pt): Pt => {
    const k = across ? (mid - a[0]) / (b[0] - a[0] || 1e-9) : (mid - a[1]) / (b[1] - a[1] || 1e-9);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const half = clipHalf(q, far, cross);
  return (half.length > 2 ? [free[edge], half] : [free[edge]]).map((r) => r.map(back));
}
/** For an edge cut: the open half on the near side of the outline's middle line, and the half past it (on the canvas). */
function edgeHalves(world: Pt[], cx0: number, cy0: number, rz: number, edge: string): { near: Pt[]; far: Pt[] } {
  const c = Math.cos(-rz * rad), n = Math.sin(-rz * rad), cb = Math.cos(rz * rad), nb = Math.sin(rz * rad);
  const into = ([x, y]: Pt): Pt => { const dx = x - cx0, dy = y - cy0; return [dx * c - dy * n, dx * n + dy * c]; };
  const back = ([x, y]: Pt): Pt => [cx0 + x * cb - y * nb, cy0 + x * nb + y * cb];
  const q = world.map(into), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2, B = 1e5;
  const halves: Record<string, Pt[]> = {
    right: [[-B, -B], [mx, -B], [mx, B], [-B, B]], left: [[mx, -B], [B, -B], [B, B], [mx, B]],
    bottom: [[-B, -B], [B, -B], [B, my], [-B, my]], top: [[-B, my], [B, my], [B, B], [-B, B]],
  };
  const opposite: Record<string, string> = { right: "left", left: "right", top: "bottom", bottom: "top" };
  return { near: halves[edge].map(back), far: halves[opposite[edge]].map(back) };
}
/** All outlines drawn the same way round, so overlapping ones join up instead of cutting holes. */
const clockwise = (r: Pt[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return a >= 0 ? r : [...r].reverse(); };
function edgeBox(edge: string, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const B = 1e5;
  // the area that stays visible: everything on this side of the chosen edge, unlimited every other way
  const boxes: Record<string, [number, number, number, number]> = {
    right: [x0 - B, y0 - B, x1, y1 + B],   // hidden past the right edge
    left: [x0, y0 - B, x1 + B, y1 + B],    // hidden past the left edge
    top: [x0 - B, y0, x1 + B, y1 + B],     // hidden past the top edge
    bottom: [x0 - B, y0 - B, x1 + B, y1],  // hidden past the bottom edge
    width: [x0, y0 - B, x1, y1 + B], height: [x0 - B, y0, x1 + B, y1],
    above: [x0 - B, y0 - B, x1 + B, y0], below: [x0 - B, y1, x1 + B, y1 + B], // (older projects)
  };
  return boxes[edge];
}
/** The mask outline(s) on the canvas at time t (or null). A group masks with all of its items together. */
export function maskOutline(project: Project, item: Item, t: number): { pts: Pt[]; rings: Pt[][]; invert: boolean } | null {
  const mk = maskOf(project, item);
  const by = mk?.by;
  if (!by || by === item.id) return null;
  const invert = !!mk!.invert, edge = mk!.edge;
  const group = project.tracks.find((tr) => tr.id === by && tr.kind === "group");
  if (group) {
    const rings = itemsInGroup(project, group.id).filter((m) => m.id !== item.id && t >= m.start && t < m.end)
      .map((m) => outlineOf(project, m, t)).filter((r): r is Pt[] => !!r && r.length > 2).map(clockwise);
    if (!rings.length) return null;
    if (edge && edge !== "shape") {
      // past one edge of the whole group (its overall box)
      const all = rings.flat(), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
      const [a, b, c, d] = edgeBox(edge, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      const r: Pt[] = [[a, b], [c, b], [c, d], [a, d]];
      return { pts: r, rings: [r], invert };
    }
    return { pts: rings[0], rings, invert };
  }
  const m = project.items.find((i) => i.id === by);
  if (!m || !specOf(m)) return null;
  // clipping along one edge of its real outline (in the item's own turned / tilted frame)
  if (edge && ["left", "right", "top", "bottom"].includes(edge)) {
    const ms = itemState(project, m, t), world = outlineOf(project, m, t);
    if (!world) return null;
    const rings = edgeRegion(world, ms.x, ms.y, ms.rz, edge).map(clockwise);
    return { pts: rings[0], rings, invert };
  }
  if (edge && edge !== "shape") {
    const ms = itemState(project, m, t);
    const [x0, y0, x1, y1] = edgeBox(edge, 0, 0, m.w, m.h);
    const r = ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[]).map((p) => toWorld(ms, m, p));
    return { pts: r, rings: [r], invert };
  }
  const r = outlineOf(project, m, t);
  return r ? { pts: r, rings: [r], invert } : null;
}
/** CSS clip-path for the masked item (its own box coordinates). */
/* ---------------- text masks: the letters themselves ---------------- */
export type M6 = [number, number, number, number, number, number];
const I6: M6 = [1, 0, 0, 1, 0, 0];
/** a · b (apply b first) */
export const mul6 = (a: M6, b: M6): M6 => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
/** The 2D matrix that follows a mapping closely around a point (exact for flat items; close for 3D tilts). */
function affineNear(f: (p: Pt) => Pt, [ox, oy]: Pt, e = 100): M6 {
  const O = f([ox, oy]), A = f([ox + e, oy]), B = f([ox, oy + e]);
  const a = (A[0] - O[0]) / e, b = (A[1] - O[1]) / e, c = (B[0] - O[0]) / e, d = (B[1] - O[1]) / e;
  return [a, b, c, d, O[0] - a * ox - c * oy, O[1] - b * ox - d * oy];
}
/** From the canvas to an item's own box (for drawing things in it). */
export const worldToItem = (s: ItemState, it: Item): M6 => affineNear((p) => toLocal(s, it, p), [s.x, s.y]);
export const toItemBox = (s: ItemState, it: Item, p: Pt): Pt => toLocal(s, it, p);
/** A point of an item (in its own box) where it lands on the canvas. */
export const itemToWorld = (s: ItemState, it: Item, p: Pt): Pt => toWorld(s, it, p);

/** Letters on the canvas: each piece of text with the matrix that puts it there (letter animations, typewriter and curved text included). */
export type Letters = { font: string; size: number; spacing: number; wordSpacing: number; central: boolean; pieces: { text: string; m: M6; x: number; y: number; o: number }[] };

/** A text item's pieces as the export draws them, in the text's own middle-centred units. */
function textPieces(it: Item, sans: string, local: number, reveal: number | undefined) {
  const size = it.fontSize ?? 100, lh = size * (it.lineHeight ?? 0.9), pad = it.textBg ? it.textPad ?? 24 : 0;
  const font = `${it.italic ? "italic " : ""}${it.fontWeight ?? 800} ${size}px ${it.fontFamily ? `"${it.fontFamily}", ` : ""}${sans}`;
  const spacing = (it.letterSpacing ?? -0.04) * size, wordSpacing = (it.wordSpacing ?? 0) * size;
  meas ??= document.createElement("canvas").getContext("2d");
  const c = meas! as CanvasRenderingContext2D & { letterSpacing: string; wordSpacing: string };
  c.font = font; c.letterSpacing = `${spacing}px`; c.wordSpacing = `${wordSpacing}px`;
  const full = textCase(it.text ?? "", it.textCase), inner = it.w - pad * 2, rows: string[] = [];
  for (const para of full.split("\n")) {
    if (!it.wrap) { rows.push(para); continue; }
    let line = "";
    for (const word of para.split(/(\s+)/)) { const test = line + word; if (line && c.measureText(test.trimEnd()).width > inner) { rows.push(line.trimEnd()); line = word.trimStart(); } else line = test; }
    rows.push(line);
  }
  // the typewriter shows only the first part (laid out as the whole text, so nothing reflows)
  let left = reveal == null || reveal >= 1 ? Infinity : Math.floor([...full].length * Math.max(0, reveal));
  const lines = rows.map((l) => { const n = [...l].length; const part = [...l].slice(0, Math.max(0, Math.min(n, left))).join(""); left -= n + 1; return part; });
  const widths = rows.map((l) => c.measureText(l).width);
  const boxW = it.wrap ? it.w : Math.max(...widths, 1) + pad * 2, boxH = rows.length * lh + pad * 2;
  const mm = c.measureText("Hg"), asc = mm.fontBoundingBoxAscent ?? size * 0.8, desc = mm.fontBoundingBoxDescent ?? size * 0.2;
  const x0 = -boxW / 2, y0 = -boxH / 2, cw = boxW - pad * 2;
  const unit = textAnimOf(it) ? textUnit(it) : null;
  const total = unit === "line" ? lines.length : unit ? splitPieces(full, unit).filter((p) => p.anim).length : 0;
  const pieces: Letters["pieces"] = [];
  let pi = -1;
  lines.forEach((ln, i) => {
    const ax = (it.align ?? "left") === "center" ? (cw - widths[i]) / 2 : it.align === "right" ? cw - widths[i] : 0;
    const bx = x0 + pad + ax, by = y0 + pad + i * lh + (lh - (asc + desc)) / 2 + asc;
    if (!unit) { if (ln) pieces.push({ text: ln, m: I6, x: bx, y: by, o: 1 }); return; }
    let off = 0;
    for (const p of unit === "line" ? [{ text: ln, anim: true }] : splitPieces(ln, unit)) {
      const pw = c.measureText(p.text).width;
      if (p.anim) {
        pi++;
        const f = pieceFx(it, local, pi, total, p.text);
        if (f.o > 0.001) {
          const r = (f.r * Math.PI) / 180, k = Math.tan(((f.sk ?? 0) * Math.PI) / 180);
          const sx = f.s * f.sx * Math.cos((f.ry * Math.PI) / 180), sy = f.s * f.sy * Math.cos((f.rx * Math.PI) / 180);
          const T: M6 = [1, 0, 0, 1, bx + off + pw / 2 + f.dx, by + f.dy], R: M6 = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], K: M6 = [1, 0, k, 1, 0, 0], S: M6 = [sx, 0, 0, sy, 0, 0];
          pieces.push({ text: f.text ?? p.text, m: mul6(mul6(mul6(T, R), K), S), x: -pw / 2, y: 0, o: Math.min(1, f.o) });
        }
      }
      off += pw;
    }
  });
  c.letterSpacing = "0px"; c.wordSpacing = "0px";
  return { font, size, spacing, wordSpacing, pieces };
}

/** A text item's letters on the canvas right now (for masks and for picking it by its letters). */
export function textLetters(project: Project, by: Item, t: number, sans: string): Letters | null {
  const local = t - by.start, r = resolveItem(by, local);
  if (r.onPath || r.follow) {
    const g = pathGlyphs(project, r, t, sans);
    return g ? { font: g.font, size: g.size, spacing: 0, wordSpacing: 0, central: true, pieces: g.glyphs.map((q) => ({ text: q.ch, m: q.m, x: -q.w / 2, y: 0, o: q.a })) } : null;
  }
  const ts = itemState(project, by, t);
  const toCanvas = affineNear((p) => toWorld(ts, by, [by.w / 2 + p[0], by.h / 2 + p[1]]), [0, 0]);
  const P = textPieces(r, sans, local, ts.reveal);
  return { ...P, central: false, pieces: P.pieces.map((pc) => ({ ...pc, m: mul6(toCanvas, pc.m) })) };
}

/**
 * A text item used as a mask cuts by its letters (not its box). Returns that text item, or null. With an edge
 * (cut along its right / left / top / bottom side), `edge` holds the two halves on the canvas: the masked item
 * shows everywhere on the near side, and only inside the letters on the far side.
 */
export function textMaskOf(project: Project, item: Item, t?: number): { by: Item; invert: boolean; edge?: { near: Pt[]; far: Pt[] } } | null {
  const m = maskOf(project, item);
  if (!m) return null;
  const by = project.items.find((i) => i.id === m.by && i.kind === "text");
  if (!by) return null;
  if (!m.edge || m.edge === "shape") return { by, invert: !!m.invert };
  if (!["left", "right", "top", "bottom"].includes(m.edge)) return null;
  if (t == null) return { by, invert: !!m.invert };
  const ms = itemState(project, by, t), world = outlineOf(project, by, t);
  if (!world) return null;
  return { by, invert: !!m.invert, edge: edgeHalves(world, ms.x, ms.y, ms.rz, m.edge) };
}

export function maskClipPath(project: Project, item: Item, s: ItemState, t: number): string | undefined {
  if (textMaskOf(project, item)) return undefined; // drawn as an SVG mask of its letters (see the editor)
  const mo = maskOutline(project, item, t);
  if (!mo) return undefined;
  const poly = mo.rings.map((ring) => ring.map((p) => toLocal(s, item, p)).map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") + "Z").join("");
  if (!mo.invert) return `path("${poly}")`;
  const big = 100000;
  return `path(evenodd, "M${-big} ${-big}H${big}V${big}H${-big}Z${poly}")`;
}

/* ---------------- repeater ---------------- */
export interface Repeat { count: number; dx: number; dy: number; rotate: number; scale: number; fade: number; delay: number }
export const REPEAT_DEFAULT: Repeat = { count: 4, dx: 60, dy: 0, rotate: 0, scale: 0, fade: 0.2, delay: 0 };
/** The copies a repeater draws (not including the item itself), back to front. */
export function repeatCopies(project: Project, item: Item, t: number): { s: ItemState; t: number; i: number }[] {
  const r = item.repeat;
  if (!r || r.count < 2) return [];
  const out: { s: ItemState; t: number; i: number }[] = [];
  for (let i = r.count - 1; i >= 1; i--) {
    const ti = t - i * r.delay;
    const s = { ...itemState(project, item, ti) };
    if (!s.visible && !(t >= item.start && t < item.end)) continue;
    s.visible = true;
    s.x += r.dx * i; s.y += r.dy * i; s.rz += r.rotate * i;
    s.scale *= Math.max(0, 1 + r.scale * i);
    s.opacity *= Math.max(0, 1 - r.fade * i);
    out.push({ s, t: ti, i });
  }
  return out;
}

/* ---------------- text along a line ---------------- */
export const pathOffset = (item: Item, local: number) => numAt(item, "pathOffset", local);

/* ---------------- look: shadow, glow, depth ---------------- */
const hexA = (c: string, a: number) => { const m = /^#([0-9a-f]{6})$/i.exec(c); return m ? `#${m[1]}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}` : c; };
/** The drop-shadows for an item's Shadow and Glow (same in the editor and the export). */
export function lookShadows(it: Item): string[] {
  const l = it.look, o = it.lookOpts ?? {}, f: string[] = [];
  if (l?.shadow) {
    const x = o.shadowX ?? 0, y = o.shadowY ?? l.shadow, soft = o.shadowSoft ?? 1.6;
    f.push(`drop-shadow(${x}px ${y}px ${Math.max(0, l.shadow * soft)}px ${hexA(o.shadowColor ?? "#000000", o.shadowOpacity ?? 0.35)})`);
  }
  if (l?.glow) {
    const c = o.glowColor ?? (it.kind === "text" ? it.color ?? "#ffffff" : "#ffffff"), n = Math.max(1, Math.min(4, Math.round(o.glowPower ?? 1)));
    for (let i = 0; i < n; i++) f.push(`drop-shadow(0 0 ${l.glow * (1 + i * 0.35)}px ${hexA(c, 0.9)})`);
  }
  return f;
}
/** One step of 3D depth: which way it goes (direction in degrees, 45 = down-right) and its colour. */
export function depthStep(it: Item, base: string): { dx: number; dy: number; color: string } {
  const o = it.lookOpts ?? {}, a = ((o.depthAngle ?? 45) * Math.PI) / 180;
  return { dx: Math.SQRT2 * Math.cos(a), dy: Math.SQRT2 * Math.sin(a), color: o.depthColor ?? `color-mix(in srgb, ${base} 55%, #7a7a7a)` };
}

/* ---------------- letters along a path ---------------- */
/** One letter placed on a path: its width, and the 2D matrix (a b c d e f) that puts it on the canvas. */
export type Glyph = { ch: string; w: number; m: [number, number, number, number, number, number]; a: number };
/** Items text can run along: lines, motion paths and anything with an outline (circle, square, star, shapes…). */
/** Items that can ride along something (everything that's drawn, except lines and paths themselves). */
export const canRide = (it: Item) => !["line", "motion", "audio", "camera"].includes(it.kind);
export const canCarryText = (it: Item) => it.kind === "line" || it.kind === "motion" || (it.kind !== "text" && !!specOf(it));
const textCase = (t: string, c?: string) => (c === "uppercase" ? t.toUpperCase() : c === "lowercase" ? t.toLowerCase() : c === "capitalize" ? t.replace(/\b\p{L}/gu, (m) => m.toUpperCase()) : t);
let meas: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();
function charW(font: string, ch: string): number {
  const key = font + "\u0000" + ch;
  let w = widthCache.get(key);
  if (w == null) {
    meas ??= document.createElement("canvas").getContext("2d");
    meas!.font = font; w = meas!.measureText(ch).width;
    if (widthCache.size > 4000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}
/** The font text on a path is drawn with (sans: the app's sans-serif stack). */
export const pathFont = (it: Item, size: number, sans: string) => `${it.italic ? "italic " : ""}${it.fontWeight ?? 800} ${size}px ${it.fontFamily ? `"${it.fontFamily}", ` : ""}${sans}`;

type PathSrc = {
  pts: Pt[]; closed: boolean;
  /** from the path's own units to the canvas (z: off the surface, towards you) */
  map: (p: Pt, z?: number) => Pt;
  /** how big the path's units are on the canvas (text keeps its own size) */
  unit: number;
  /** following a motion: where the middle of the text is along the path (distance), and letters past the ends carry on straight */
  anchor?: number; upright?: boolean;
  /** a 3D-tilted outline (standing letters make sense) */
  tilted?: boolean; center?: Pt;
};
function pathSource(project: Project, item: Item, t: number): PathSrc | null {
  // following a motion: the letters ride along the route it takes
  const f = item.follow;
  if (item.kind === "text" && f && f.letters !== false) {
    const m = project.items.find((i) => i.id === f.motionId && i.kind === "motion");
    if (!m) return null;
    const life = m.end - m.start, N = 200;
    const s = itemState(project, item, t), now = followOffset(project, item, t, 0, 0);
    if (!now || !(life > 0)) return null;
    const dx = s.x - now.x, dy = s.y - now.y; // own place (relative mode), groups, parents
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) { const p = followOffset(project, item, m.start + (i / N) * life, 0, 0)!; pts.push([p.x + dx, p.y + dy]); }
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const u = Math.min(Math.max((t - m.start) / life, 0), 1) * N, i0 = Math.min(Math.floor(u), N - 1);
    const anchor = lens[i0] + (lens[i0 + 1] - lens[i0]) * (u - i0);
    return { pts, closed: false, map: (p) => p, unit: 1, anchor, upright: !f.orient };
  }
  const p = item.onPath ? project.items.find((i) => i.id === item.onPath) : undefined;
  if (!p) return null;
  const tc = Math.min(Math.max(t, p.start), p.end - 1e-3);
  if (p.kind === "motion") {
    // a motion path: the text rides it with the motion's own timing — its middle is where the motion is now
    // (Along shifts it ahead or behind), and it carries on straight past the ends
    // the path's own points, put on the canvas through the path's turn / 3D tilt / size: letters tilt with it
    const life = p.end - p.start, N = 200, lt = Math.min(Math.max(t - p.start, 0), life);
    const pf = pathTransform(p, lt), sc = sampleKeys(p.keys.scale, lt, p.base.scale ?? 1) || 1;
    const tiltedPath = Math.abs(sampleKeys(p.keys.rx, lt, p.base.rx ?? 0)) > 0.01 || Math.abs(sampleKeys(p.keys.ry, lt, p.base.ry ?? 0)) > 0.01;
    const mapP = (q: Pt, z = 0): Pt => {
      if (!pf) return q;
      if (!z) return pf(q);
      // off the path's plane (standing letters): lift it along the plane's own up direction, worked out from the turn
      const a = pf(q), b = pathTransformZ(p, lt, q, z);
      return b ?? a;
    };
    const pts = Array.from({ length: N + 1 }, (_, i) => { const m = motionAt(p, (i / N) * life); return [m.x, m.y] as Pt; });
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const u = Math.min(Math.max((t - p.start) / (life || 1), 0), 1) * N, i0 = Math.min(Math.floor(u), N - 1);
    const anchor = lens[i0] + (lens[i0 + 1] - lens[i0]) * (u - i0);
    return { pts, closed: false, map: mapP, unit: pf ? sc : 1, anchor, tilted: tiltedPath, center: pathPivot(p) };
  }
  const ps = itemState(project, p, tc);
  const tilted = !flat3(ps);
  const map = (q: Pt, z = 0) => toWorld(ps, p, q, z);
  if (p.kind === "line" && p.line) {
    // the line as it's drawn: its curves and rounded corners, not just straight from point to point
    const L = p.line, px = (q: Pt): Pt => [(q[0] + 0.5) * p.w, (q[1] + 0.5) * p.h];
    const ctrl = L.ctrl?.map((c) => (c ? [px(c[0]), px(c[1])] as [Pt, Pt] : null));
    return { pts: lineShape(L.pts.map(px), ctrl, L.round ?? 0), closed: false, map, unit: ps.scale || 1, tilted, center: [p.w / 2, p.h / 2] };
  }
  let loc = localOutline(p, tc);
  // a hollow shape's inner edge: the hole's outline (the same shape, the rim's thickness in from every side)
  const th = item.pathText?.edge === "inner" ? Math.min(numAt(p, "hollow", tc - p.start), Math.min(p.w, p.h) / 2 - 1) : 0;
  if (th > 0.5) { const inner = localOutline(p, tc, p.w - 2 * th, p.h - 2 * th); if (inner) loc = inner.map(([u, v]) => [u + th, v + th] as Pt); }
  if (!loc) return null;
  return { pts: loc, closed: true, map, unit: ps.scale || 1, tilted, center: [p.w / 2, p.h / 2] };
}

/**
 * Text laid along a path, letter by letter. Works the same in the editor and the export:
 * each letter gets a matrix that puts it on the canvas, so letters on a 3D-tilted circle tilt with it
 * (or stand up off it), and text following a motion bends round the route instead of moving as a block.
 */
/** The path the text runs along, in the direction it runs, with distances along it. */
function runPath(src: PathSrc, o: NonNullable<Item["pathText"]>, standing = !!o.stand) {
  let pts = src.pts;
  // standing letters read from the front when they run the other way round
  const flip = standing && src.tilted && src.closed ? !o.flip : !!o.flip;
  if (flip) pts = src.closed ? [pts[0], ...pts.slice(1).reverse()] : [...pts].reverse();
  if (src.closed) pts = [...pts, pts[0]];
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1];
  const at = (d: number): Pt => {
    if (src.closed) d = ((d % total) + total) % total;
    else if (d <= 0 || d >= total) {
      // past an end: carry on straight
      const [a, b] = d <= 0 ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, e = d <= 0 ? d : d - total, base = d <= 0 ? a : b;
      return [base[0] + ((b[0] - a[0]) / L) * e, base[1] + ((b[1] - a[1]) / L) * e];
    }
    let lo = 0, hi = lens.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lens[mid] <= d) lo = mid; else hi = mid; }
    const u = (d - lens[lo]) / (lens[hi] - lens[lo] || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u];
  };
  return { pts, lens, total, at };
}

/**
 * Text laid along a path, letter by letter. Works the same in the editor and the export:
 * each letter gets a matrix that puts it on the canvas, so letters on a 3D-tilted circle tilt with it
 * (or stand up off it), and text following a motion bends round the route instead of moving as a block.
 * "Along" is where the middle of the text is; `center` is that point on the canvas (the text's box sits there).
 */
/** How far something on a path is turned round the edge (degrees; older "stand up" text counts as 90). */
export function pathTiltOf(item: Item, local: number): number {
  if (item.pathTilt == null && !item.numKeys?.pathTilt?.length && item.pathText?.stand) return 90;
  return numAt(item, "pathTilt", local);
}
/** Which way is "up" off a path's surface on screen (+1 / −1), so turned-up things lean towards you. */
function upOf(src: PathSrc): number {
  if (!src.center) return 1;
  const c0 = src.map(src.center), c1 = src.map(src.center, 10);
  return c1[1] - c0[1] > 0 ? -1 : 1;
}
/**
 * A spot on a path, hinged round the edge: where something's middle lands on the canvas (`off` from the line, in
 * the path's units) and its across / down directions there. `tilt` (radians) turns it round the edge: 0 lies in
 * the surface, 90° stands up off it, anything between leans, past 90° folds over to the other side.
 */
function hingeAt(src: PathSrc, at: (d: number) => Pt, d: number, off: number, tilt: number, h: number, e: number, upZ: number) {
  const P = at(d), A = at(d - h), B = at(d + h);
  let tx = B[0] - A[0], ty = B[1] - A[1];
  const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
  if (src.upright) { tx = 1; ty = 0; }
  const nx = -ty, ny = tx, ct = Math.cos(tilt), dz = -upZ * Math.sin(tilt); // "down": in the surface, turned out of it by tilt
  const C: Pt = [P[0] + nx * off * ct, P[1] + ny * off * ct], cz = dz * off;
  const O = src.map(C, cz), X = src.map([C[0] + tx * e, C[1] + ty * e], cz), Y = src.map([C[0] + nx * e * ct, C[1] + ny * e * ct], cz + dz * e);
  return { O, ax: [(X[0] - O[0]) / e, (X[1] - O[1]) / e] as Pt, by: [(Y[0] - O[0]) / e, (Y[1] - O[1]) / e] as Pt };
}

export function pathGlyphs(project: Project, item: Item, t: number, sans: string): { glyphs: Glyph[]; size: number; font: string; center: { x: number; y: number; angle: number } } | null {
  if (item.kind !== "text") return null;
  const src = pathSource(project, item, t);
  if (!src || src.pts.length < 2) return null;
  const local = t - item.start, s = itemState(project, item, t), o = item.pathText ?? {};
  const fs = numAt(item, "fontSize", local) || item.fontSize || 100;
  const size = (fs * (s.scale || 1)) / src.unit; // in the path's own units
  const font = pathFont(item, fs, sans), k = size / fs;
  const spacing = (numAt(item, "letterSpacing", local) ?? item.letterSpacing ?? -0.04) * size;
  const chars = [...textCase(item.text ?? "", item.textCase).replace(/\s*\n\s*/g, " ")];
  const widths = chars.map((ch) => charW(font, ch) * k + spacing);
  const textW = widths.reduce((a, b) => a + b, 0);
  const tilt = (pathTiltOf(item, local) * Math.PI) / 180;
  const { total, at } = runPath(src, o, Math.abs(Math.sin(tilt)) > 0.7);
  if (!(total > 0)) return null;
  // where the middle of the text is along the path, and how far off the line it sits (the gap, in canvas px)
  const middle = (src.anchor ?? 0) + (pathOffset(item, local) / 100) * total;
  const start = middle - textW / 2;
  const gap = numAt(item, "pathGap", local) / src.unit;
  const h = Math.max(1.5, size * 0.3), e = Math.max(1, size * 0.25);
  const shift = o.side === "under" ? 0.36 : o.side === "middle" ? 0 : -0.36; // letters' middle, off the line (× size, down is +)
  const off = shift * size + (o.side === "under" ? gap : -gap); // the gap pushes them further out (or further in)
  // turned up letters lean "up" out of the surface: whichever way looks up on screen
  const upZ = upOf(src);
  /** a letter's place at distance d along the path: where its middle lands, and its across / down directions on the canvas */
  const place = (d: number) => hingeAt(src, at, d, off, tilt, h, e, upZ);
  const out: Glyph[] = [];
  let d = start;
  chars.forEach((ch, i) => {
    const w = widths[i], mid = d + w / 2;
    d += w;
    if (ch === " ") return;
    if (src.closed && textW > total && mid - start > total) return; // longer than the way round: don't overlap
    const { O, ax, by } = place(mid);
    // the far side of a tilted shape shows letters from behind (mirrored)
    const back = ax[0] * by[1] - ax[1] * by[0] < 0;
    const a = back ? (o.far === "hide" ? 0 : o.far === "fade" ? 0.25 : 1) : 1;
    if (a > 0) out.push({ ch, w: w - spacing, m: [ax[0], ax[1], by[0], by[1], O[0], O[1]], a });
  });
  const c = place(middle);
  return { glyphs: out, size, font: pathFont(item, size, sans), center: { x: c.O[0], y: c.O[1], angle: (Math.atan2(c.ax[1], c.ax[0]) * 180) / Math.PI } };
}

/**
 * Dragging text along its path: the "Along" value (in %) that puts the text's middle nearest to a canvas point.
 * Round a shape it picks the turn closest to `near`, so the text doesn't jump a whole lap.
 */
export function pathOffsetAt(project: Project, item: Item, t: number, [wx, wy]: Pt, near: number): number | null {
  const src = pathSource(project, item, t);
  if (!src || src.pts.length < 2) return null;
  const { pts, lens, total } = runPath(src, item.pathText ?? {}, Math.abs(Math.sin((pathTiltOf(item, t - item.start) * Math.PI) / 180)) > 0.7);
  if (!(total > 0)) return null;
  const W = pts.map((p) => src.map(p));
  let best = Infinity, bestD = 0;
  for (let i = 1; i < W.length; i++) {
    const [ax, ay] = W[i - 1], [bx, by] = W[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / L2));
    const q = Math.hypot(ax + dx * u - wx, ay + dy * u - wy);
    if (q < best) { best = q; bestD = lens[i - 1] + (lens[i] - lens[i - 1]) * u; }
  }
  // riding a motion: Along is how far ahead of (or behind) where the motion is
  let v = ((bestD - (src.anchor ?? 0)) / total) * 100;
  if (src.closed) v += Math.round((near - v) / 100) * 100;
  return Math.round(v * 10) / 10;
}

/** Something (not text) placed along a line or outline: where its middle lands and how it's turned there. */
export interface ItemPlace { O: Pt; ax: Pt; by: Pt; f: number; rz: number; back: boolean; center: { x: number; y: number; angle: number } }
/**
 * Any item can ride a line, a shape's outline or a motion path, like text does: Along moves it along, Gap moves it
 * off the line, Sits puts it on top / centred / under, and Turn hinges it round the edge (lying in the surface,
 * standing up off it, or anywhere between). It follows the path's own 3D tilt.
 */
export function pathPlace(project: Project, item: Item, t: number): ItemPlace | null {
  if (item.kind === "text" || !item.onPath) return null;
  const src = pathSource(project, item, t);
  if (!src || src.pts.length < 2) return null;
  const local = t - item.start, s = itemState(project, item, t), o = item.pathText ?? {};
  const tilt = (pathTiltOf(item, local) * Math.PI) / 180;
  const { total, at } = runPath(src, o, Math.abs(Math.sin(tilt)) > 0.7);
  if (!(total > 0)) return null;
  const f = (Math.abs(s.scale) || 1) / src.unit; // its own px → the path's units
  const ih = item.h * f, gap = numAt(item, "pathGap", local) / src.unit;
  const off = o.side === "under" ? ih / 2 + gap : o.side === "middle" ? 0 : -ih / 2 - gap;
  const d = (src.anchor ?? 0) + (pathOffset(item, local) / 100) * total;
  const p = hingeAt(src, at, d, off, tilt, Math.max(1.5, item.w * f * 0.2), 1, upOf(src));
  const rz = sampleKeys(item.keys.rz, local, item.base.rz ?? 0);
  return { ...p, f, rz, back: p.ax[0] * p.by[1] - p.ax[1] * p.by[0] < 0, center: { x: p.O[0], y: p.O[1], angle: (Math.atan2(p.ax[1], p.ax[0]) * 180) / Math.PI } };
}
/** The CSS transform that puts an item at its place on a path (its own turn stays, within the surface). */
export function placeCss(p: ItemPlace): string {
  const f = p.f, n = (v: number) => +v.toFixed(6);
  return `matrix(${n(p.ax[0] * f)},${n(p.ax[1] * f)},${n(p.by[0] * f)},${n(p.by[1] * f)},0,0)${p.rz ? ` rotate(${p.rz}deg)` : ""}`;
}

/** Shapes that can be reshaped by their corners (their outline and border are redrawn, not warped). */
export const RESHAPABLE = (it: Item) => ["shape", "rect", "ellipse", "star"].includes(it.kind);
/**
 * Corner pin in Reshape mode: the shape's outline (from its box's top-left, in its own px) bent so its box's corners
 * land on the pinned corners — each point keeps its place between the sides. Null when not reshaped.
 */
export function reshapeOutline(m: Item, t: number): Pt[] | null {
  if (m.pinMode !== "shape" || !RESHAPABLE(m)) return null;
  const off = pinAt(m, t - m.start);
  if (!off) return null;
  const loc = localOutline(m, t);
  if (!loc) return null;
  const q = pinQuad(m.w, m.h, off).map(([x, y]) => [x + m.w / 2, y + m.h / 2] as Pt);
  return loc.map(([px, py]) => {
    const u = px / (m.w || 1), v = py / (m.h || 1);
    const tx = q[0][0] + (q[1][0] - q[0][0]) * u, ty = q[0][1] + (q[1][1] - q[0][1]) * u;
    const bx = q[3][0] + (q[2][0] - q[3][0]) * u, by = q[3][1] + (q[2][1] - q[3][1]) * u;
    return [tx + (bx - tx) * v, ty + (by - ty) * v] as Pt;
  });
}
