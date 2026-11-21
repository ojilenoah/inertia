/*
 * Item effects: shiny edges, glass, glitch, colour split, neon… Each one is a few SVG filter
 * steps. The editor applies them to the item with CSS `filter: url(#…)`, the export with
 * `ctx.filter = url(#…)`, so both draw them the same way. Effects stack in list order.
 * Sizes are in item pixels; `scale` converts them for the canvas being drawn.
 */
import type { FxOpt } from "./types";

export type ItemFxKind =
  | "shine" | "glass" | "glitch" | "rgbsplit" | "neon" | "outline" | "wobble" | "noise"
  | "posterize" | "duotone" | "emboss" | "pixelate" | "hueshift" | "flicker" | "longshadow" | "innerglow" | "chroma" | "lumakey";

export interface ItemFx { id: string; kind: ItemFxKind; amount: number; opts?: Record<string, number | string>; off?: boolean; /** amount keyframes (item-local times) */ keys?: { t: number; v: number }[] }

/** An effect's amount at item-local time (blends between its keyframes). */
export function fxAmountAt(f: ItemFx, local: number): number {
  const ks = f.keys;
  if (!ks?.length) return f.amount;
  if (local <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (local >= last.t) return last.v;
  let i = 0;
  while (i < ks.length - 2 && local >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1], p = (local - a.t) / (b.t - a.t || 1e-9), e = p * p * (3 - 2 * p);
  return a.v + (b.v - a.v) * e;
}
/** The effect list with each amount worked out for this moment. */
export function resolveFx(fx: ItemFx[] | undefined, local: number): ItemFx[] | undefined {
  return fx?.map((f) => (f.keys?.length ? { ...f, amount: fxAmountAt(f, local) } : f));
}

export const ITEM_FX: { kind: ItemFxKind; label: string; hint: string; opts: FxOpt[] }[] = [
  { kind: "shine", label: "Shiny edges", hint: "Glossy light along the edges", opts: [
    { key: "size", label: "Bevel", min: 1, max: 40, step: 1, def: 8, unit: "px" },
    { key: "angle", label: "Light angle", min: 0, max: 360, step: 1, def: 225, unit: "°" },
    { key: "spin", label: "Light moves", min: 0, max: 360, step: 5, def: 0, unit: "°/s" },
    { key: "gloss", label: "Gloss", min: 1, max: 60, step: 1, def: 18 },
    { key: "color", label: "Light colour", def: "#ffffff", color: true },
  ] },
  { kind: "glass", label: "Glass", hint: "See-through, frosted, with bright edges", opts: [
    { key: "clear", label: "See-through", min: 0, max: 0.95, step: 0.01, def: 0.6 },
    { key: "frost", label: "Frost", min: 0, max: 40, step: 1, def: 12, unit: "px" },
    { key: "edge", label: "Edge light", min: 0, max: 30, step: 1, def: 10, unit: "px" },
  ] },
  { kind: "glitch", label: "Glitch", hint: "Slices jump and colours split", opts: [
    { key: "speed", label: "Speed", min: 1, max: 30, step: 1, def: 12, unit: "/s" },
    { key: "shift", label: "Slice shift", min: 0, max: 120, step: 1, def: 40, unit: "px" },
    { key: "split", label: "Colour split", min: 0, max: 40, step: 1, def: 8, unit: "px" },
    { key: "bands", label: "Slices", min: 0.005, max: 0.2, step: 0.005, def: 0.04 },
  ] },
  { kind: "rgbsplit", label: "Colour split", hint: "Red and blue drift apart", opts: [
    { key: "offset", label: "Distance", min: 0, max: 60, step: 1, def: 10, unit: "px" },
    { key: "angle", label: "Direction", min: 0, max: 360, step: 1, def: 0, unit: "°" },
  ] },
  { kind: "neon", label: "Neon", hint: "Glowing coloured outline", opts: [
    { key: "color", label: "Colour", def: "#3affd9", color: true },
    { key: "width", label: "Line", min: 1, max: 30, step: 1, def: 4, unit: "px" },
    { key: "glow", label: "Glow", min: 0, max: 60, step: 1, def: 18, unit: "px" },
  ] },
  { kind: "outline", label: "Outline", hint: "A solid line around the shape", opts: [
    { key: "color", label: "Colour", def: "#111111", color: true },
    { key: "width", label: "Width", min: 1, max: 40, step: 1, def: 6, unit: "px" },
  ] },
  { kind: "innerglow", label: "Inner glow", hint: "Soft light inside the edges", opts: [
    { key: "color", label: "Colour", def: "#ffffff", color: true },
    { key: "size", label: "Size", min: 1, max: 60, step: 1, def: 16, unit: "px" },
  ] },
  { kind: "longshadow", label: "Long shadow", hint: "A hard flat shadow trailing off", opts: [
    { key: "color", label: "Colour", def: "#000000", color: true },
    { key: "length", label: "Length", min: 4, max: 200, step: 2, def: 60, unit: "px" },
    { key: "angle", label: "Direction", min: 0, max: 360, step: 1, def: 45, unit: "°" },
  ] },
  { kind: "wobble", label: "Wobble", hint: "Hand-drawn boil / wavy edges", opts: [
    { key: "size", label: "Wobble", min: 1, max: 60, step: 1, def: 10, unit: "px" },
    { key: "detail", label: "Detail", min: 0.002, max: 0.1, step: 0.002, def: 0.02 },
    { key: "speed", label: "Speed", min: 0, max: 24, step: 1, def: 8, unit: "/s" },
  ] },
  { kind: "noise", label: "Grain", hint: "Film grain on the item", opts: [
    { key: "size", label: "Grain size", min: 0.3, max: 6, step: 0.1, def: 1.2 },
    { key: "speed", label: "Flicker", min: 0, max: 24, step: 1, def: 12, unit: "/s" },
  ] },
  { kind: "pixelate", label: "Pixelate", hint: "Big blocky pixels", opts: [
    { key: "size", label: "Pixel size", min: 2, max: 80, step: 1, def: 12, unit: "px" },
  ] },
  { kind: "posterize", label: "Posterize", hint: "Fewer, flatter colours", opts: [
    { key: "levels", label: "Levels", min: 2, max: 10, step: 1, def: 4 },
  ] },
  { kind: "duotone", label: "Duotone", hint: "Two-colour print look", opts: [
    { key: "dark", label: "Shadows", def: "#1b1b3a", color: true },
    { key: "light", label: "Highlights", def: "#ff7a59", color: true },
  ] },
  { kind: "emboss", label: "Emboss", hint: "Stamped relief", opts: [] },
  { kind: "hueshift", label: "Hologram", hint: "Colours cycle like foil", opts: [
    { key: "speed", label: "Speed", min: 0, max: 720, step: 10, def: 180, unit: "°/s" },
  ] },
  { kind: "flicker", label: "Flicker", hint: "Random dimming like a bad bulb", opts: [
    { key: "speed", label: "Speed", min: 1, max: 30, step: 1, def: 14, unit: "/s" },
  ] },
  { kind: "chroma", label: "Green screen", hint: "Removes a green (or blue) background from a video or photo", opts: [
    { key: "color", label: "Screen colour", def: "#00c040", color: true },
    { key: "strength", label: "Strength", min: 1, max: 20, step: 0.5, def: 8 },
    { key: "edge", label: "Keep edges", min: -1, max: 1, step: 0.05, def: 0.2 },
  ] },
  { kind: "lumakey", label: "Plain background", hint: "Removes a plain white (or black) background", opts: [
    { key: "dark", label: "Background is dark", min: 0, max: 1, step: 1, def: 0 },
    { key: "strength", label: "Strength", min: 1, max: 30, step: 0.5, def: 10 },
    { key: "edge", label: "Keep edges", min: -1, max: 1, step: 0.05, def: 0.1 },
  ] },
];

export function itemFxOpt<T extends number | string>(f: ItemFx, key: string): T {
  const v = f.opts?.[key];
  if (v != null) return v as T;
  return (ITEM_FX.find((x) => x.kind === f.kind)?.opts.find((o) => o.key === key)?.def ?? 0) as T;
}

const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const n = (v: number) => Math.round(v * 1000) / 1000;
const rgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
};

/** Blend `fx` over `src` by amount a (a = 1: only the effect). */
const mix = (fx: string, src: string, a: number, out: string) =>
  `<feComposite in="${fx}" in2="${src}" operator="arithmetic" k1="0" k2="${n(a)}" k3="${n(1 - a)}" k4="0" result="${out}"/>`;

/** SVG filter steps for one effect: reads `src`, writes `out`. */
function steps(f: ItemFx, src: string, out: string, t: number, s: number, i: number): string {
  const A = Math.max(0, Math.min(1, f.amount)), o = <T extends number | string>(k: string) => itemFxOpt<T>(f, k), p = `e${i}_`;
  switch (f.kind) {
    case "shine": {
      const az = (o<number>("angle") + t * o<number>("spin")) % 360;
      return `<feGaussianBlur in="SourceAlpha" stdDeviation="${n(o<number>("size") * s)}" result="${p}b"/>`
        + `<feSpecularLighting in="${p}b" surfaceScale="${n(4 + 6 * A)}" specularConstant="${n(0.5 + 1.4 * A)}" specularExponent="${o<number>("gloss")}" lighting-color="${o<string>("color")}" result="${p}s"><feDistantLight azimuth="${n(az)}" elevation="40"/></feSpecularLighting>`
        + `<feComposite in="${p}s" in2="SourceAlpha" operator="in" result="${p}si"/>`
        + `<feComposite in="${src}" in2="${p}si" operator="arithmetic" k1="0" k2="1" k3="${n(A)}" k4="0" result="${out}"/>`;
    }
    case "glass": {
      const clear = o<number>("clear") * A, frost = o<number>("frost");
      return `<feTurbulence type="fractalNoise" baseFrequency="${n(0.03 / s)}" numOctaves="2" seed="7" result="${p}n"/>`
        + `<feDisplacementMap in="${src}" in2="${p}n" scale="${n(frost * s * A)}" xChannelSelector="R" yChannelSelector="G" result="${p}d"/>`
        + `<feComponentTransfer in="${p}d" result="${p}t"><feFuncA type="linear" slope="${n(1 - clear)}"/></feComponentTransfer>`
        + `<feGaussianBlur in="SourceAlpha" stdDeviation="${n(Math.max(0.5, o<number>("edge")) * s)}" result="${p}b"/>`
        + `<feSpecularLighting in="${p}b" surfaceScale="6" specularConstant="${n(1.2 * A)}" specularExponent="22" lighting-color="#ffffff" result="${p}s"><feDistantLight azimuth="235" elevation="35"/></feSpecularLighting>`
        + `<feComposite in="${p}s" in2="SourceAlpha" operator="in" result="${p}si"/>`
        + `<feComposite in="${p}t" in2="${p}si" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${out}"/>`;
    }
    case "glitch": {
      const fr = Math.floor(t * o<number>("speed")), on = rnd(fr + i * 31) < 0.35 + 0.5 * A;
      const shift = (on ? o<number>("shift") : o<number>("shift") * 0.08) * A * s, split = (on ? o<number>("split") : o<number>("split") * 0.3) * A * s;
      return `<feTurbulence type="turbulence" baseFrequency="0 ${n(o<number>("bands") / s)}" numOctaves="1" seed="${fr % 997}" result="${p}n"/>`
        + `<feDisplacementMap in="${src}" in2="${p}n" scale="${n(shift)}" xChannelSelector="R" yChannelSelector="A" result="${p}g"/>`
        + `<feColorMatrix in="${p}g" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${p}r"/>`
        + `<feOffset in="${p}r" dx="${n(split)}" dy="0" result="${p}ro"/>`
        + `<feColorMatrix in="${p}g" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" result="${p}c"/>`
        + `<feOffset in="${p}c" dx="${n(-split)}" dy="0" result="${p}co"/>`
        + `<feBlend in="${p}ro" in2="${p}co" mode="screen" result="${out}"/>`;
    }
    case "rgbsplit": {
      const d = o<number>("offset") * A * s, a = (o<number>("angle") * Math.PI) / 180, dx = Math.cos(a) * d, dy = Math.sin(a) * d;
      return `<feColorMatrix in="${src}" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${p}r"/>`
        + `<feOffset in="${p}r" dx="${n(dx)}" dy="${n(dy)}" result="${p}ro"/>`
        + `<feColorMatrix in="${src}" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" result="${p}c"/>`
        + `<feOffset in="${p}c" dx="${n(-dx)}" dy="${n(-dy)}" result="${p}co"/>`
        + `<feBlend in="${p}ro" in2="${p}co" mode="screen" result="${out}"/>`;
    }
    case "neon": {
      const [r, g, b] = rgb(o<string>("color"));
      return `<feMorphology in="SourceAlpha" operator="dilate" radius="${n(o<number>("width") * s)}" result="${p}d"/>`
        + `<feComposite in="${p}d" in2="SourceAlpha" operator="out" result="${p}ring"/>`
        + `<feColorMatrix in="${p}ring" type="matrix" values="0 0 0 0 ${n(r)} 0 0 0 0 ${n(g)} 0 0 0 0 ${n(b)} 0 0 0 1 0" result="${p}c"/>`
        + `<feGaussianBlur in="${p}c" stdDeviation="${n(o<number>("glow") * s * A)}" result="${p}gl"/>`
        + `<feMerge result="${out}"><feMergeNode in="${p}gl"/><feMergeNode in="${p}gl"/><feMergeNode in="${src}"/><feMergeNode in="${p}c"/></feMerge>`;
    }
    case "outline": {
      const [r, g, b] = rgb(o<string>("color"));
      return `<feMorphology in="SourceAlpha" operator="dilate" radius="${n(o<number>("width") * s * Math.max(0.05, A))}" result="${p}d"/>`
        + `<feColorMatrix in="${p}d" type="matrix" values="0 0 0 0 ${n(r)} 0 0 0 0 ${n(g)} 0 0 0 0 ${n(b)} 0 0 0 1 0" result="${p}c"/>`
        + `<feMerge result="${out}"><feMergeNode in="${p}c"/><feMergeNode in="${src}"/></feMerge>`;
    }
    case "innerglow": {
      const [r, g, b] = rgb(o<string>("color"));
      return `<feGaussianBlur in="SourceAlpha" stdDeviation="${n(o<number>("size") * s)}" result="${p}b"/>`
        + `<feComposite in="SourceAlpha" in2="${p}b" operator="out" result="${p}e"/>`
        + `<feColorMatrix in="${p}e" type="matrix" values="0 0 0 0 ${n(r)} 0 0 0 0 ${n(g)} 0 0 0 0 ${n(b)} 0 0 0 ${n(A)} 0" result="${p}c"/>`
        + `<feMerge result="${out}"><feMergeNode in="${src}"/><feMergeNode in="${p}c"/></feMerge>`;
    }
    case "longshadow": {
      const [r, g, b] = rgb(o<string>("color")), L = o<number>("length") * s * Math.max(0.05, A), a = (o<number>("angle") * Math.PI) / 180;
      const stepsN = 12, parts: string[] = [];
      for (let k = 1; k <= stepsN; k++) parts.push(`<feOffset in="SourceAlpha" dx="${n(Math.cos(a) * L * (k / stepsN))}" dy="${n(Math.sin(a) * L * (k / stepsN))}" result="${p}o${k}"/>`);
      return parts.join("")
        + `<feMerge result="${p}m">${Array.from({ length: stepsN }, (_, k) => `<feMergeNode in="${p}o${k + 1}"/>`).join("")}</feMerge>`
        + `<feMorphology in="${p}m" operator="dilate" radius="${n(L / stepsN / 2 + 0.5)}" result="${p}md"/>`
        + `<feColorMatrix in="${p}md" type="matrix" values="0 0 0 0 ${n(r)} 0 0 0 0 ${n(g)} 0 0 0 0 ${n(b)} 0 0 0 0.6 0" result="${p}c"/>`
        + `<feMerge result="${out}"><feMergeNode in="${p}c"/><feMergeNode in="${src}"/></feMerge>`;
    }
    case "wobble": {
      const sp = o<number>("speed"), seed = sp > 0 ? Math.floor(t * sp) % 997 : 3;
      return `<feTurbulence type="fractalNoise" baseFrequency="${n(o<number>("detail") / s)}" numOctaves="2" seed="${seed}" result="${p}n"/>`
        + `<feDisplacementMap in="${src}" in2="${p}n" scale="${n(o<number>("size") * s * A * 2)}" xChannelSelector="R" yChannelSelector="G" result="${out}"/>`;
    }
    case "noise": {
      const sp = o<number>("speed"), seed = sp > 0 ? Math.floor(t * sp) % 997 : 5;
      return `<feTurbulence type="fractalNoise" baseFrequency="${n(0.8 / (o<number>("size") * s))}" numOctaves="1" seed="${seed}" result="${p}n"/>`
        + `<feColorMatrix in="${p}n" type="saturate" values="0" result="${p}g"/>`
        + `<feComposite in="${p}g" in2="SourceAlpha" operator="in" result="${p}gi"/>`
        + `<feBlend in="${src}" in2="${p}gi" mode="overlay" result="${p}bl"/>`
        + `<feComposite in="${p}bl" in2="SourceAlpha" operator="in" result="${p}bi"/>`
        + mix(`${p}bi`, src, A, out);
    }
    case "pixelate": {
      const z = Math.max(1, o<number>("size") * s * Math.max(0.05, A));
      return `<feFlood x="${n(z / 2)}" y="${n(z / 2)}" width="1" height="1" result="${p}f"/>`
        + `<feComposite width="${n(z)}" height="${n(z)}" in="${p}f" result="${p}c"/>`
        + `<feTile in="${p}c" result="${p}t"/>`
        + `<feComposite in="${src}" in2="${p}t" operator="in" result="${p}p"/>`
        + `<feMorphology in="${p}p" operator="dilate" radius="${n(z / 2)}" result="${out}"/>`;
    }
    case "posterize": {
      const lv = Math.max(2, Math.round(o<number>("levels"))), tv = Array.from({ length: lv }, (_, k) => n(k / (lv - 1))).join(" ");
      return `<feComponentTransfer in="${src}" result="${p}p"><feFuncR type="discrete" tableValues="${tv}"/><feFuncG type="discrete" tableValues="${tv}"/><feFuncB type="discrete" tableValues="${tv}"/></feComponentTransfer>` + mix(`${p}p`, src, A, out);
    }
    case "duotone": {
      const [r1, g1, b1] = rgb(o<string>("dark")), [r2, g2, b2] = rgb(o<string>("light"));
      return `<feColorMatrix in="${src}" type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 1 0" result="${p}g"/>`
        + `<feComponentTransfer in="${p}g" result="${p}d"><feFuncR type="table" tableValues="${n(r1)} ${n(r2)}"/><feFuncG type="table" tableValues="${n(g1)} ${n(g2)}"/><feFuncB type="table" tableValues="${n(b1)} ${n(b2)}"/></feComponentTransfer>`
        + mix(`${p}d`, src, A, out);
    }
    case "emboss":
      return `<feConvolveMatrix in="${src}" order="3" kernelMatrix="-2 -1 0 -1 1 1 0 1 2" preserveAlpha="true" result="${p}e"/>` + mix(`${p}e`, src, A, out);
    case "hueshift":
      return `<feColorMatrix in="${src}" type="hueRotate" values="${n((t * o<number>("speed")) % 360)}" result="${p}h"/>` + mix(`${p}h`, src, A, out);
    case "chroma": {
      // alpha drops where the screen colour's main channel stands out from the other two
      const [r, g, b] = rgb(o<string>("color")), main = g >= r && g >= b ? 1 : b >= r ? 2 : 0, k = o<number>("strength");
      const row = [0, 0, 0].map((_, c) => (c === main ? -k : k / 2));
      return `<feColorMatrix in="${src}" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${row.map(n).join(" ")} 1 ${n(o<number>("edge"))}" result="${p}k"/>`
        + `<feComposite in="${p}k" in2="${src}" operator="in" result="${p}m"/>` + mix(`${p}m`, src, A, out);
    }
    case "lumakey": {
      // alpha follows brightness: a light background goes see-through (or a dark one)
      const k = o<number>("strength"), dark = o<number>("dark") > 0.5, c = n((dark ? 1 : -1) * k / 3);
      return `<feColorMatrix in="${src}" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${c} ${c} ${c} 0 ${n((dark ? 0 : k) + o<number>("edge"))}" result="${p}k"/>`
        + `<feComposite in="${p}k" in2="${src}" operator="in" result="${p}m"/>` + mix(`${p}m`, src, A, out);
    }
    case "flicker": {
      const fr = Math.floor(t * o<number>("speed")), dim = rnd(fr * 3 + i) < 0.35 * A ? 0.25 + 0.5 * rnd(fr) : 1;
      return `<feComponentTransfer in="${src}" result="${out}"><feFuncA type="linear" slope="${n(dim)}"/></feComponentTransfer>`;
    }
  }
}

/** The whole <filter> element for an item's effects (or null when it has none). */
export function itemFxFilter(id: string, fx: ItemFx[] | undefined, t: number, scale = 1): string | null {
  const list = (fx ?? []).filter((f) => !f.off && f.amount > 0);
  if (!list.length) return null;
  let src = "SourceGraphic", body = "";
  list.forEach((f, i) => { const out = `r${i}`; body += steps(f, src, out, t, scale, i); src = out; });
  return `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">${body}</filter>`;
}
