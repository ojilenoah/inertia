import type { MorphChar } from "@moshion/engine";

/*
 * Text changing between two text keyframes, in place: every letter sits where it belongs in the old wording or the
 * new one. Letters the two share slide from their old spot to their new one, the old ones leave from where they
 * were and the new ones arrive where they'll be. The text box only ever spans between the old and new widths, so
 * nothing spreads sideways while it changes.
 */

type Measure = (s: string) => number;

/** One letter to draw: where (x from the box's left, line number, both possibly between lines) and how. */
export interface Placed { ch: string; x: number; line: number; op: number; dy: number; sc: number; sy: number; blur: number; keep: boolean }

/** Where each letter of a text goes: x within its line, which line, and each line's width (lines break at \n and, with `maxW`, wrap at spaces). */
function layout(chs: string[], measure: Measure, maxW: number | null): { x: number[]; line: number[]; widths: number[] } {
  const x = new Array<number>(chs.length).fill(0), line = new Array<number>(chs.length).fill(0);
  const lines: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < chs.length; i++) {
    if (chs[i] === "\n") { line[i] = lines.length; lines.push(cur); cur = []; continue; }
    cur.push(i);
    if (maxW != null && chs[i] !== " " && cur.length > 1 && measure(cur.map((j) => chs[j]).join("")) > maxW) {
      // too wide: the word moves down to a new line (from just after the last space)
      let k = cur.length - 1;
      while (k > 0 && chs[cur[k]] !== " ") k--;
      if (k > 0) { lines.push(cur.slice(0, k + 1)); cur = cur.slice(k + 1); }
    }
  }
  lines.push(cur);
  const widths = lines.map((ids, li) => {
    let acc = "";
    for (const j of ids) { x[j] = measure(acc); line[j] = li; acc += chs[j]; }
    return measure(acc.replace(/\s+$/, ""));
  });
  return { x, line, widths };
}

const easeIO = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/**
 * The letters of a text change at progress `u` (0..1), laid out in place. `align` lines them up inside the box;
 * the box's width and height go smoothly from the old text's to the new one's.
 */
export function morphLayout(chars: MorphChar[], from: string, to: string, u: number, o: { measure: Measure; align: "left" | "center" | "right"; maxW: number | null; caseOf?: (s: string) => string }) {
  const cs = o.caseOf ?? ((s: string) => s);
  const A = [...cs(from)], B = [...cs(to)];
  const la = layout(A, o.measure, o.maxW), lb = layout(B, o.measure, o.maxW);
  const wA = Math.max(0, ...la.widths), wB = Math.max(0, ...lb.widths);
  const e = easeIO(Math.min(1, Math.max(0, u)));
  const W = wA + (wB - wA) * e, lines = la.widths.length + (lb.widths.length - la.widths.length) * e;
  const f = o.align === "center" ? 0.5 : o.align === "right" ? 1 : 0;
  // a letter's spot measured from the box's anchor (its left, middle or right), so both layouts line up with the box
  const relA = (i: number) => la.x[i] + (wA - la.widths[la.line[i]]) * f - wA * f;
  const relB = (i: number) => lb.x[i] + (wB - lb.widths[lb.line[i]]) * f - wB * f;
  const out: Placed[] = [];
  let ia = 0, ib = 0;
  for (const c of chars) {
    const keep = c.kind === "keep";
    const a = c.kind !== "add" ? ia++ : -1, b = c.kind !== "del" ? ib++ : -1;
    if ((a >= 0 ? A[a] : B[b]) === "\n") continue;
    const rx = keep ? relA(a) + (relB(b) - relA(a)) * e : a >= 0 ? relA(a) : relB(b);
    const ln = keep ? la.line[a] + (lb.line[b] - la.line[a]) * e : a >= 0 ? la.line[a] : lb.line[b];
    out.push({ ch: keep ? (a >= 0 ? A[a] : c.ch) : cs(c.ch), x: W * f + rx, line: ln, keep, op: keep ? 1 : c.op ?? c.f, dy: keep ? 0 : c.dy ?? 0, sc: keep ? 1 : c.sc ?? 1, sy: keep ? 1 : c.sy ?? 1, blur: keep ? 0 : c.blur ?? 0 });
  }
  return { chars: out, w: W, lines: Math.max(1, lines) };
}

/** A text measurer for a font (cached: the same strings get measured every frame). */
const ctxs = new Map<string, { ctx: CanvasRenderingContext2D; cache: Map<string, number> }>();
export function measurer(font: string, letterSpacingPx: number, wordSpacingPx: number): Measure {
  const key = `${font}|${letterSpacingPx}|${wordSpacingPx}`;
  let m = ctxs.get(key);
  if (!m) {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = font;
    (ctx as CanvasRenderingContext2D & { letterSpacing: string; wordSpacing: string }).letterSpacing = `${letterSpacingPx}px`;
    (ctx as CanvasRenderingContext2D & { wordSpacing: string }).wordSpacing = `${wordSpacingPx}px`;
    m = { ctx, cache: new Map() };
    if (ctxs.size > 40) ctxs.clear();
    ctxs.set(key, m);
  }
  const { ctx, cache } = m;
  return (s: string) => {
    let v = cache.get(s);
    if (v == null) { v = s ? ctx.measureText(s).width : 0; if (cache.size > 4000) cache.clear(); cache.set(s, v); }
    return v;
  };
}
