import type { Item } from "./types";
import { easeFn } from "./easing";

/*
 * Text animations that move each letter, word or line on its own (staggered),
 * on top of the item's keyframes and its whole-item In/Out presets.
 */

export type TextAnimKind = "fade" | "rise" | "drop" | "pop" | "blur" | "spin" | "slide" | "scramble" | "typewriter" | "tracking" | "flip" | "zoom"
  | "elastic" | "bouncein" | "swirl" | "stretch" | "squash" | "unfold" | "skew" | "rain" | "random" | "shuffle" | "neon" | "crash"
  | "spiral" | "slot" | "focus" | "glitch" | "grow" | "whip";
export type TextLoopKind = "wave" | "bounce" | "jitter" | "flicker" | "rainbow" | "swing"
  | "float" | "shake" | "breathe" | "spin" | "orbit" | "zigzag" | "rubber" | "glitch" | "pulse" | "drunk" | "typing" | "sparkle";
export type TextUnit = "letter" | "word" | "line";

export interface TextAnimStep { kind: TextAnimKind; dur: number; unit: TextUnit; stagger: number; at?: number }
export interface TextAnim {
  in?: TextAnimStep;
  out?: TextAnimStep;
  loop?: { kind: TextLoopKind; speed: number; amount: number; unit: TextUnit };
}

export const TEXT_ANIM_LABEL: Record<TextAnimKind, string> = {
  fade: "Fade", rise: "Rise", drop: "Drop", pop: "Pop", blur: "Blur", spin: "Spin", slide: "Slide",
  scramble: "Scramble", typewriter: "Type", tracking: "Spread", flip: "Flip", zoom: "Zoom",
  elastic: "Elastic", bouncein: "Bounce", swirl: "Swirl", stretch: "Stretch", squash: "Squash", unfold: "Unfold", skew: "Skew",
  rain: "Rain", random: "Random", shuffle: "Shuffle", neon: "Neon", crash: "Crash", spiral: "Spiral", slot: "Slot machine",
  focus: "Focus", glitch: "Glitch", grow: "Grow", whip: "Whip",
};
export const TEXT_LOOP_LABEL: Record<TextLoopKind, string> = {
  wave: "Wave", bounce: "Bounce", jitter: "Jitter", flicker: "Flicker", rainbow: "Rainbow", swing: "Swing",
  float: "Float", shake: "Shake", breathe: "Breathe", spin: "Spin", orbit: "Orbit", zigzag: "Zigzag", rubber: "Rubber",
  glitch: "Glitch", pulse: "Pulse", drunk: "Drunk", typing: "Typing", sparkle: "Sparkle",
};

/** One piece of text: a letter, word or line (whitespace pieces don't animate). */
export interface Piece { text: string; anim: boolean }

/** Split text into pieces. Newlines are kept as their own non-animated pieces. */
export function splitPieces(text: string, unit: TextUnit): Piece[] {
  const out: Piece[] = [];
  if (unit === "line") {
    text.split(/(\n)/).forEach((p) => p && out.push({ text: p, anim: p !== "\n" }));
  } else if (unit === "word") {
    text.split(/(\s+)/).forEach((p) => p && out.push({ text: p, anim: !/^\s+$/.test(p) }));
  } else {
    for (const ch of text) out.push({ text: ch, anim: !/\s/.test(ch) });
  }
  return out;
}

export interface PieceFx {
  o: number; dx: number; dy: number; s: number; r: number; ry: number; blur: number;
  /** tip forward (degrees), stretch across / up, slant (degrees) */
  rx: number; sx: number; sy: number; sk: number;
  /** Replacement text (scramble). */
  text?: string;
  color?: string;
}
const NONE: PieceFx = { o: 1, dx: 0, dy: 0, s: 1, r: 0, ry: 0, blur: 0, rx: 0, sx: 1, sy: 1, sk: 0 };

const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const back = easeFn("back");
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*@";

const bounceOut = (p: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
};
/** Animations where pieces go in a shuffled order rather than left to right. */
const SHUFFLED = new Set<TextAnimKind>(["rain", "random", "neon"]);
/** A fixed shuffled position for piece i among n. */
const rankOf = (i: number, n: number) => { const v = rnd(i * 13 + 5); let r = 0; for (let j = 0; j < n; j++) if (rnd(j * 13 + 5) < v) r++; return r; };

/** Progress 0..1 of piece i (of n) through a step that starts at `t0`. */
function progress(step: TextAnimStep, local: number, t0: number, i: number, n: number) {
  const st = Math.min(Math.max(step.stagger, 0), 0.95);
  const each = n > 1 ? (step.dur * st) / (n - 1) : 0;
  const pd = Math.max(0.04, step.dur - each * (n - 1));
  return Math.min(1, Math.max(0, (local - t0 - i * each) / pd));
}

function applyStep(fx: PieceFx, kind: TextAnimKind, p: number, i: number, n: number, size: number, piece: string, local: number) {
  const e = easeOut(p), off = 1 - e;
  switch (kind) {
    case "fade": fx.o *= e; break;
    case "rise": fx.dy += off * size * 0.6; fx.o *= e; break;
    case "drop": fx.dy -= off * size * 0.8; fx.o *= e; break;
    case "pop": fx.s *= Math.max(0, back(p)); fx.o *= Math.min(1, p * 3); break;
    case "blur": fx.blur += off * size * 0.18; fx.o *= e; break;
    case "spin": fx.r += off * -120; fx.dy += off * size * 0.3; fx.o *= e; break;
    case "slide": fx.dx += off * size * 1.2; fx.o *= e; break;
    case "flip": fx.ry += off * 90; fx.o *= Math.min(1, e * 1.4); break;
    case "zoom": fx.s *= 1 + off * 1.6; fx.blur += off * size * 0.08; fx.o *= e; break;
    case "typewriter": fx.o *= p > 0 ? 1 : 0; break;
    case "tracking": fx.dx += (i - (n - 1) / 2) * off * size * 0.5; fx.o *= e; break;
    case "elastic": { const el = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 4.5); fx.s *= Math.max(0, el); fx.o *= Math.min(1, p * 4); break; }
    case "bouncein": { const b = bounceOut(p); fx.dy -= (1 - b) * size * 1.4; fx.o *= Math.min(1, p * 5); break; }
    case "swirl": fx.r += off * -360; fx.s *= e; fx.o *= e; break;
    case "stretch": fx.sx *= 1 + off * 2.5; fx.sy *= 1 - off * 0.4; fx.o *= e; break;
    case "squash": fx.sy *= Math.max(0, back(p)); fx.sx *= 1 + off * 0.5; fx.o *= Math.min(1, p * 3); break;
    case "unfold": fx.rx += off * -90; fx.o *= Math.min(1, e * 1.4); break;
    case "skew": fx.sk += off * -35; fx.dx += off * size * 0.7; fx.o *= e; break;
    case "rain": fx.dy -= off * size * 3; fx.o *= e; break;
    case "random": fx.o *= e; fx.s *= 0.85 + 0.15 * e; break;
    case "shuffle": fx.dx += (rnd(i * 5 + 1) - 0.5) * size * 6 * off; fx.dy += (rnd(i * 5 + 2) - 0.5) * size * 4 * off; fx.r += (rnd(i * 5 + 3) - 0.5) * 220 * off; fx.o *= e; break;
    case "neon": if (p < 1) fx.o *= rnd(Math.floor(local * 30) + i * 7) < p * p ? 1 : 0.08; break;
    case "crash": {
      const fall = Math.min(1, p / 0.7), land = Math.max(0, (p - 0.7) / 0.3);
      fx.dy -= (1 - fall * fall) * size * 1.6; fx.r += (1 - fall) * (rnd(i * 9) - 0.5) * 120;
      if (land > 0 && land < 1) { const k = Math.sin(land * Math.PI); fx.sy *= 1 - 0.3 * k; fx.sx *= 1 + 0.25 * k; }
      fx.o *= Math.min(1, p * 5); break;
    }
    case "spiral": { const a = off * Math.PI * 3 + i, rad = off * size * 2.2; fx.dx += Math.cos(a) * rad; fx.dy += Math.sin(a) * rad; fx.r += off * 180; fx.o *= e; break; }
    case "slot":
      fx.dy += off * size * 0.9; fx.o *= Math.min(1, p * 3);
      if (p < 1) fx.text = [...piece].map((c, k) => (/\s/.test(c) ? c : GLYPHS[Math.floor(rnd(Math.floor(local * 30) + i * 11 + k) * GLYPHS.length)])).join("");
      break;
    case "focus": fx.blur += off * size * 0.3; fx.dx += (i - (n - 1) / 2) * off * size * 0.25; fx.o *= e; break;
    case "glitch":
      if (p < 1) { const f = Math.floor(local * 24); fx.dx += (rnd(f + i * 3) - 0.5) * size * 0.7 * off; fx.dy += (rnd(f * 5 + i) - 0.5) * size * 0.2 * off; fx.o *= rnd(f * 3 + i) < 0.25 + 0.75 * p ? 1 : 0; if (rnd(f * 7 + i) < 0.3 * off) fx.color = rnd(f + i) < 0.5 ? "#ff2e88" : "#2ef0ff"; }
      break;
    case "grow": fx.sy *= e; fx.dy += off * size * 0.35; fx.o *= Math.min(1, e * 2); break;
    case "whip": fx.dx += off * size * 3.2; fx.sk += off * -25; fx.blur += off * size * 0.06; fx.o *= e; break;
    case "scramble":
      if (p <= 0) fx.o = 0;
      else if (p < 1) fx.text = [...piece].map((c, k) => (/\s/.test(c) ? c : GLYPHS[Math.floor(rnd(Math.floor(local * 24) + i * 7 + k) * GLYPHS.length)])).join("");
      break;
  }
}

/** The item's letter/word/line animations: In/Out/Throughout entries that have a unit (plus older separate ones). */
export function textAnimOf(item: Item): TextAnim | null {
  if (item.kind !== "text") return null;
  const a = item.anim, old = item.textAnim;
  const step = (s: NonNullable<Item["anim"]>["in"]): TextAnimStep | undefined =>
    s?.unit ? { kind: s.kind as TextAnimKind, dur: s.dur, unit: s.unit, stagger: s.stagger ?? 0.6, at: s.at } : undefined;
  const out: TextAnim = {
    in: step(a?.in) ?? old?.in,
    out: step(a?.out) ?? old?.out,
    loop: a?.loop?.unit ? { kind: a.loop.kind as TextLoopKind, speed: a.loop.speed, amount: a.loop.amount, unit: a.loop.unit } : old?.loop,
  };
  return out.in || out.out || out.loop ? out : null;
}

/** Move older separate text animations into the item's In / Out / Throughout. */
export function migrateTextAnim(item: Item) {
  const ta = item.textAnim;
  if (!ta) return;
  const a = (item.anim ??= {});
  if (ta.in && !a.in) a.in = { kind: ta.in.kind, dur: ta.in.dur, unit: ta.in.unit, stagger: ta.in.stagger };
  if (ta.out && !a.out) a.out = { kind: ta.out.kind, dur: ta.out.dur, unit: ta.out.unit, stagger: ta.out.stagger };
  if (ta.loop && !a.loop) a.loop = { kind: ta.loop.kind, speed: ta.loop.speed, amount: ta.loop.amount, unit: ta.loop.unit };
  delete item.textAnim;
}

/** How piece `i` of `n` looks at item-local time `local`. */
export function pieceFx(item: Item, local: number, i: number, n: number, piece: string): PieceFx {
  const ta = textAnimOf(item);
  if (!ta) return NONE;
  const size = item.fontSize ?? 100, life = item.end - item.start;
  const fx: PieceFx = { ...NONE };
  if (ta.in) applyStep(fx, ta.in.kind, progress(ta.in, local, ta.in.at ?? 0, SHUFFLED.has(ta.in.kind) ? rankOf(i, n) : i, n), i, n, size, piece, local);
  if (ta.out) {
    // leaving: same order, finishing exactly at the item's end
    const q = progress(ta.out, local, life - (ta.out.at ?? 0) - ta.out.dur, SHUFFLED.has(ta.out.kind) ? rankOf(i, n) : i, n);
    applyStep(fx, ta.out.kind, 1 - q, i, n, size, piece, local);
  }
  if (ta.loop) {
    const { kind, speed: sp, amount: A } = ta.loop, ph = local * sp;
    switch (kind) {
      case "wave": fx.dy += Math.sin(ph * Math.PI * 2 - i * 0.55) * size * 0.12 * A; break;
      case "bounce": fx.dy -= Math.abs(Math.sin(ph * Math.PI - i * 0.35)) * size * 0.22 * A; break;
      case "swing": fx.r += Math.sin(ph * Math.PI * 2 - i * 0.5) * 12 * A; break;
      case "jitter": { const f = Math.floor(local * 12); fx.dx += (rnd(f + i * 3) - 0.5) * size * 0.08 * A; fx.dy += (rnd(f * 2 + i * 5) - 0.5) * size * 0.08 * A; break; }
      case "flicker": { const f = Math.floor(local * 14 * Math.max(0.2, sp)); if (rnd(f * 3 + i * 11) < 0.12 * A) fx.o *= 0.15; break; }
      case "rainbow": fx.color = `hsl(${Math.round((i * 28 + local * sp * 140) % 360)} 85% 58%)`; break;
      case "float": fx.dy += Math.sin(ph * Math.PI * 2 + i * 1.3) * size * 0.08 * A; fx.r += Math.sin(ph * Math.PI * 2 + i * 0.9) * 4 * A; break;
      case "shake": { const f = Math.floor(local * 24); fx.dx += (rnd(f + i * 3) - 0.5) * size * 0.18 * A; fx.dy += (rnd(f * 2 + i * 5) - 0.5) * size * 0.18 * A; fx.r += (rnd(f * 3 + i) - 0.5) * 14 * A; break; }
      case "breathe": fx.s *= 1 + Math.sin(ph * Math.PI * 2 - i * 0.4) * 0.12 * A; break;
      case "spin": fx.r += ((ph * 360 + i * 25) % 360) * Math.min(1, A); break;
      case "orbit": { const a = ph * Math.PI * 2 + i * 0.6; fx.dx += Math.cos(a) * size * 0.08 * A; fx.dy += Math.sin(a) * size * 0.08 * A; break; }
      case "zigzag": fx.dx += Math.sin(ph * Math.PI * 2 - i * 0.7) * size * 0.1 * A; fx.dy += Math.cos(ph * Math.PI * 4 - i * 0.7) * size * 0.05 * A; break;
      case "rubber": { const w = Math.sin(ph * Math.PI * 2 - i * 0.5); fx.sx *= 1 + w * 0.25 * A; fx.sy *= 1 - w * 0.2 * A; break; }
      case "glitch": { const f = Math.floor(local * 16); if (rnd(f * 7 + i) < 0.07 * A) { fx.dx += (rnd(f + i) - 0.5) * size * 0.5; fx.color = rnd(f * 3 + i) < 0.5 ? "#ff2e88" : "#2ef0ff"; fx.sk += (rnd(f + i * 2) - 0.5) * 30; } break; }
      case "pulse": fx.s *= 1 + Math.pow(Math.max(0, Math.sin(ph * Math.PI * 2 - i * 0.5)), 8) * 0.4 * A; break;
      case "drunk": fx.r += Math.sin(ph * 1.3 * Math.PI * 2 + i) * 9 * A; fx.dy += Math.sin(ph * 0.9 * Math.PI * 2 + i * 0.7) * size * 0.06 * A; fx.dx += Math.sin(ph * 0.7 * Math.PI * 2 + i * 1.1) * size * 0.04 * A; break;
      case "typing": { const cyc = 1 + n * 0.08, shown = Math.floor(((ph % cyc) / cyc) * (n + 3)); fx.o *= i < shown ? 1 : 0; break; }
      case "sparkle": { const f = Math.floor(local * 10 * Math.max(0.3, sp)); const tw = rnd(f * 5 + i * 3); fx.o *= 0.45 + 0.55 * tw; fx.s *= 1 + (tw > 0.9 ? 0.15 * A : 0); break; }
    }
  }
  return fx;
}

/** The unit pieces are split by: the in/out step's unit, else the loop's. */
export function textUnit(item: Item): TextUnit {
  const ta = textAnimOf(item);
  return ta?.in?.unit ?? ta?.out?.unit ?? ta?.loop?.unit ?? "letter";
}

/** Display name of an In/Out (whole-item or text) and of a Throughout. */
export function stepLabel(step: { kind: string; unit?: TextUnit }): string {
  const IN_OUT: Record<string, string> = {
    fade: "Fade", slideUp: "Slide up", slideDown: "Slide down", slideLeft: "Slide left", slideRight: "Slide right",
    scale: "Scale", pop: "Pop", blur: "Blur", rotate: "Rotate", flip: "Flip 3D", zoom: "Zoom", typewriter: "Typewriter",
  };
  if (step.unit) return `${TEXT_ANIM_LABEL[step.kind as TextAnimKind] ?? step.kind} · ${step.unit === "letter" ? "letters" : step.unit === "word" ? "words" : "lines"}`;
  return IN_OUT[step.kind] ?? step.kind;
}
export function loopLabel(loop: { kind: string; unit?: TextUnit }): string {
  const LOOP: Record<string, string> = { float: "Float", pulse: "Pulse", spin: "Spin", sway: "Sway", wiggle: "Wiggle", breathe: "Breathe", drift: "Drift", kenburns: "Ken Burns" };
  return loop.unit ? TEXT_LOOP_LABEL[loop.kind as TextLoopKind] ?? loop.kind : LOOP[loop.kind] ?? loop.kind;
}
