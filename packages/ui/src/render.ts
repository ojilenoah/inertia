import type { Item, ItemState, Project } from "@moshion/engine";
import { arrowHeads, dashArray, fxOpt, hexA, shapeD } from "@moshion/engine";
import type { MorphChar } from "@moshion/engine";
import { pinHAt, pinMap, pinMatrix } from "@moshion/engine";
import { morphLayout } from "./textmorph";
import { reshapeOutline } from "./extras";
import { activeBackground, backgroundCSS, bgVideoTime, itemState, pieceFx, splitPieces, textAnimOf, textUnit } from "@moshion/engine";
import { activeLooks, looksTransform } from "./Looks";
import { mediaBlob } from "./media";
import { Reader, videoSource, type VideoSource } from "./videoengine";
import { drawParticles } from "./newitems";
import { itemFxFilter, itemHidden, letterColors, resolveFx, resolveItem, resolveScene } from "@moshion/engine";
import { itemShapeD } from "./shapeMorph";
import { hollowParts } from "./shapeMorph";
import { depthStep, lookShadows, maskItems, maskOutline, pathGlyphs, pathPlace, repeatCopies, textLetters, textMaskOf, type Glyph, type ItemPlace } from "./extras";
import { chartProgress, chartSVG, particlesAt, magicFrame, blurTrail, cameraAt, lookAt, textShown, mediaTime, volumeAt, stackAt, stackCompare, subLine, lineShape, transLayers, transitionAt } from "@moshion/engine";

/*
 * Draws one frame of a project onto a 2D canvas, the same way the editor shows it,
 * so export can encode it. Everything is a function of t (no playback state).
 */

type Ctx = CanvasRenderingContext2D;

/* ---------------- CSS gradients → canvas ---------------- */
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
let colorCtx: CanvasRenderingContext2D | null = null;
/** The same colour with alpha 0. */
function clear(c: string): string {
  colorCtx ??= document.createElement("canvas").getContext("2d");
  colorCtx!.fillStyle = "#000"; colorCtx!.fillStyle = c;
  const v = String(colorCtx!.fillStyle);
  const hex = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) return `rgba(${parseInt(hex[1], 16)},${parseInt(hex[2], 16)},${parseInt(hex[3], 16)},0)`;
  const rgb = v.match(/rgba?\(([^,]+),([^,]+),([^,)]+)/);
  return rgb ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},0)` : "rgba(0,0,0,0)";
}
/** "red 40%" → colour + optional position (0..1); px positions use `len`. */
function stops(parts: string[], len: number): [number, string][] {
  const raw = parts.map((p) => {
    const m = p.match(/^(.*?)(?:\s+(-?[\d.]+)(%|px))?$/)!;
    const pos = m[2] != null ? (m[3] === "%" ? +m[2] / 100 : +m[2] / len) : null;
    return { c: m[1].trim(), pos };
  });
  if (raw.length && raw[0].pos == null) raw[0].pos = 0;
  if (raw.length && raw[raw.length - 1].pos == null) raw[raw.length - 1].pos = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].pos != null) continue;
    let j = i; while (raw[j].pos == null) j++;
    const a = raw[i - 1].pos!, b = raw[j].pos!;
    for (let q = i; q < j; q++) raw[q].pos = a + ((b - a) * (q - i + 1)) / (j - i + 1);
  }
  let last = 0;
  const out = raw.map((r) => { last = Math.max(last, Math.min(1, Math.max(0, r.pos!))); return [last, r.c] as [number, string]; });
  // CSS fades through "transparent" from the colour next to it; a plain transparent black would leave dark fringes
  for (let i = 0; i < out.length; i++) if (out[i][1] === "transparent") {
    const nb = out[i - 1]?.[1] !== "transparent" ? out[i - 1]?.[1] : out[i + 1]?.[1];
    out[i][1] = nb && nb !== "transparent" ? clear(nb) : "rgba(0,0,0,0)";
  }
  return out;
}
function addStops(g: CanvasGradient, st: [number, string][]) { for (const [p, c] of st) { try { g.addColorStop(p, c); } catch { /* unsupported colour: skip */ } } }
const pct = (v: string, size: number) => (v.endsWith("%") ? (parseFloat(v) / 100) * size : v === "center" ? size / 2 : v === "left" || v === "top" ? 0 : v === "right" || v === "bottom" ? size : parseFloat(v));

/** Paint one CSS background layer (colour or gradient) over the box x,y,w,h. */
function paintLayer(ctx: Ctx, css: string, x: number, y: number, w: number, h: number) {
  const m = css.match(/^(linear|radial|conic)-gradient\((.*)\)$/s);
  if (!m) { ctx.fillStyle = css; ctx.fillRect(x, y, w, h); return; }
  const args = splitTop(m[2]);
  if (m[1] === "linear") {
    let ang = 180;
    if (/deg$/.test(args[0])) ang = parseFloat(args.shift()!);
    else if (/^to /.test(args[0])) { const d = args.shift()!; ang = d.includes("right") ? 90 : d.includes("left") ? 270 : d.includes("top") ? 0 : 180; }
    const a = (ang * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
    const L = Math.abs(w * dx) + Math.abs(h * dy), cx = x + w / 2, cy = y + h / 2;
    const g = ctx.createLinearGradient(cx - (dx * L) / 2, cy - (dy * L) / 2, cx + (dx * L) / 2, cy + (dy * L) / 2);
    addStops(g, stops(args, L));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h); return;
  }
  if (m[1] === "conic") {
    let from = 0, cx = x + w / 2, cy = y + h / 2;
    if (/^from|^at/.test(args[0])) {
      const d = args.shift()!;
      const f = d.match(/from\s+(-?[\d.]+)deg/); if (f) from = +f[1];
      const at = d.match(/at\s+(\S+)\s+(\S+)/); if (at) { cx = x + pct(at[1], w); cy = y + pct(at[2], h); }
    }
    const g = ctx.createConicGradient(((from - 90) * Math.PI) / 180, cx, cy);
    addStops(g, stops(args, 1));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h); return;
  }
  // radial
  let cx = x + w / 2, cy = y + h / 2, rx = 0, ry = 0, shape = "ellipse";
  if (/^(circle|ellipse|at |closest|farthest|-?[\d.]+(%|px))/.test(args[0]) && !/^#|^rgb|^hsl/.test(args[0])) {
    const d = args.shift()!;
    if (d.startsWith("circle")) shape = "circle";
    const at = d.match(/at\s+(\S+)(?:\s+(\S+))?/);
    if (at) { cx = x + pct(at[1], w); cy = y + pct(at[2] ?? at[1], h); }
    const size = d.replace(/at\s.*$/, "").match(/(-?[\d.]+%|-?[\d.]+px)\s*(-?[\d.]+%|-?[\d.]+px)?/);
    if (size) { rx = pct(size[1], w); ry = size[2] ? pct(size[2], h) : rx; }
  }
  const fx = Math.max(cx - x, x + w - cx), fy = Math.max(cy - y, y + h - cy);
  if (!rx) {
    if (shape === "circle") rx = ry = Math.hypot(fx, fy);
    else { rx = fx * Math.SQRT2; ry = fy * Math.SQRT2; }
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(cx, cy); ctx.scale(1, ry / rx || 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  addStops(g, stops(args, rx));
  ctx.fillStyle = g;
  const R = Math.max(w, h) * 4 + rx * 2; ctx.fillRect(-R, -R * (rx / (ry || 1)), R * 2, R * 2 * (rx / (ry || 1)));
  ctx.restore();
}
/** A whole CSS `background` value (layers are listed top first). */
export function paintCSS(ctx: Ctx, css: string, x: number, y: number, w: number, h: number) {
  const layers = splitTop(css).reverse();
  for (const l of layers) if (!l.startsWith("url(")) paintLayer(ctx, l, x, y, w, h);
}

/** The editor's film grain (same SVG noise). */
const GRAIN = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='1' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='1.6' intercept='-.3'/%3E%3CfeFuncG type='linear' slope='1.6' intercept='-.3'/%3E%3CfeFuncB type='linear' slope='1.6' intercept='-.3'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

/* ---------------- CSS drawn by the browser itself ---------------- */
/**
 * Render a CSS background (with its filter) to an image the size of the box, using the browser's
 * own CSS engine, so gradients and blurs match the editor exactly. Cached by its look.
 */
const cssCache = new Map<string, Promise<HTMLImageElement | null>>();
function cssImage(background: string, filter: string | undefined, w: number, h: number, scale: number): Promise<HTMLImageElement | null> {
  const key = `${background}|${filter}|${w}|${h}|${scale}`;
  const hit = cssCache.get(key);
  if (hit) return hit;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const pw = Math.ceil(w * scale), ph = Math.ceil(h * scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:0 0;background:${esc(background)};${filter ? `filter:${esc(filter)};` : ""}"></div></foreignObject></svg>`;
  const pr = new Promise<HTMLImageElement | null>((res) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  if (cssCache.size > 40) cssCache.clear();
  cssCache.set(key, pr);
  return pr;
}

/* ---------------- media ---------------- */
const images = new Map<string, HTMLImageElement>();
function urlOf(fill: string) { const m = fill.match(/^url\(["']?(.*?)["']?\)$/s); return m ? m[1] : null; }
function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (images.has(src)) return Promise.resolve(images.get(src)!);
  return new Promise((res) => { const i = new Image(); i.onload = () => { images.set(src, i); res(i); }; i.onerror = () => res(null); i.src = src; });
}

export interface RenderSession {
  /** Videos the engine can't decode here: <video> elements, seeked for each frame. */
  videos: Map<string, HTMLVideoElement>;
  /** Videos the engine decodes (exact frames, each decoded once). */
  engine: Map<string, VideoSource>;
  /** One reader per place a video is used (a clip, a background, a text fill), so each reads forwards on its own. */
  readers: Map<string, Reader>;
  noise: HTMLCanvasElement[];
  world: HTMLCanvasElement;
  scratch: HTMLCanvasElement;
  /** One item painted flat before it's placed (and warped for 3D). */
  flat: HTMLCanvasElement;
  crop: HTMLCanvasElement;
  fxTmp: HTMLCanvasElement;
  /** Leave the background see-through (PNG frames). */
  transparent?: boolean;
  /** The two sides of a canvas transition. */
  tA?: HTMLCanvasElement;
  tB?: HTMLCanvasElement;
  /** The editor's grain texture. */
  grain: HTMLImageElement | null;
  /** Size of one editor screen pixel in project pixels (grain, scanlines and lens blur are drawn in screen pixels there). */
  screenPx: number;
  sans: string;
}

/** Load every picture and video the project uses, and build the noise tiles. */
export async function prepare(project: Project, width: number, height: number): Promise<RenderSession> {
  await document.fonts?.ready;
  for (const it of project.items) { const u = urlOf(it.fill); if (u) await loadImage(u); if (it.textFill?.url) await loadImage(it.textFill.url); }
  const videos = new Map<string, HTMLVideoElement>();
  const engine = new Map<string, VideoSource>();
  const vsrcs = [...project.items.filter((it) => it.kind === "video").map((it) => it.src), ...project.items.map((it) => it.textFill?.kind === "video" ? it.textFill.src : undefined), ...(project.backgrounds ?? []).filter((b) => b.kind === "video").map((b) => b.src)];
  for (const src of vsrcs) {
    if (!src || videos.has(src) || engine.has(src)) continue;
    const es = await videoSource(src);
    if (es) { engine.set(src, es); continue; }
    const b = await mediaBlob(src);
    if (!b) continue;
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = URL.createObjectURL(b);
    await new Promise<void>((r) => { v.onloadeddata = () => r(); v.onerror = () => r(); });
    videos.set(src, v);
  }
  const noise = [0, 1, 2, 3].map((n) => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d")!, d = g.createImageData(256, 256);
    let s = 1234 + n * 977;
    for (let i = 0; i < d.data.length; i += 4) { s = (s * 16807) % 2147483647; const v = (s / 2147483647) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0); return c;
  });
  const mk = () => { const c = document.createElement("canvas"); c.width = width; c.height = height; return c; };
  const mo = document.querySelector(".mo");
  const sans = (mo ? getComputedStyle(mo).getPropertyValue("--sans") : "") || "Inter, system-ui, sans-serif";
  const grain = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = GRAIN; });
  const stage = document.querySelector(".stage");
  const kEditor = stage ? stage.getBoundingClientRect().width / project.width : 0.3;
  return { videos, engine, readers: new Map(), noise, world: mk(), scratch: mk(), flat: document.createElement("canvas"), crop: document.createElement("canvas"), fxTmp: document.createElement("canvas"), sans, grain, screenPx: 1 / Math.max(0.05, kEditor) };
}

/**
 * A video's frame at `mt` seconds into the file (or, with `wrap`, its time looped over the file's length), from the
 * engine (exact, decoded in order) or else by seeking a <video> element. `use` names where it's used.
 */
async function videoAt(rs: RenderSession, src: string, use: string, mt: (dur: number) => number): Promise<{ img: CanvasImageSource; w: number; h: number } | null> {
  const es = rs.engine.get(src);
  if (es) {
    const key = `${src}|${use}`;
    let r = rs.readers.get(key);
    if (!r) { r = new Reader(es, 1 << 14); rs.readers.set(key, r); }
    const f = await r.at(mt(es.dur));
    return f ? { img: f.img, w: f.w, h: f.h } : null;
  }
  const v = rs.videos.get(src);
  if (!v) return null;
  await seek(v, mt(v.duration || 0));
  return { img: v, w: v.videoWidth, h: v.videoHeight };
}
/** Let go of the decoders a render used. */
export async function closeSession(rs: RenderSession) {
  for (const r of rs.readers.values()) await r.close();
  rs.readers.clear();
}

async function seek(v: HTMLVideoElement, t: number) {
  const target = Math.min(Math.max(0, t), Math.max(0, (v.duration || 0) - 0.001));
  if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) return;
  await new Promise<void>((r) => { const done = () => { v.removeEventListener("seeked", done); r(); }; v.addEventListener("seeked", done); v.currentTime = target; setTimeout(done, 1500); });
}

/** An SVG string as an image (cached). */
const svgCache = new Map<string, Promise<HTMLImageElement | null>>();
function svgImage(svg: string): Promise<HTMLImageElement | null> {
  const hit = svgCache.get(svg); if (hit) return hit;
  const pr = new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  if (svgCache.size > 60) svgCache.clear();
  svgCache.set(svg, pr);
  return pr;
}

/* ---------------- items ---------------- */
/** The picture or video frame a text item is filled with, if any. */
async function textMedia(it: Item, local: number, rs: RenderSession): Promise<{ src: CanvasImageSource; w: number; h: number } | undefined> {
  const f = it.textFill;
  if (!f) return undefined;
  if (f.kind === "image" && f.url) { const u = urlOf(`url("${f.url}")`) ?? f.url; const img = images.get(u) ?? images.get(f.url); return img ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : undefined; }
  if (!f.src) return undefined;
  const fr = await videoAt(rs, f.src, `text:${it.id}`, (dur) => local % (dur || 1e9));
  return fr ? { src: fr.img, w: fr.w, h: fr.h } : undefined;
}
const STAR = [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]];
const BLEND: Record<string, GlobalCompositeOperation> = { normal: "source-over", "plus-lighter": "lighter" };

/** An item's outline, centred on the origin, and how to fill it (shapes with holes use evenodd). */
function outline(it: Item): { p: Path2D; rule: CanvasFillRule } {
  const w = it.w, h = it.h, p = new Path2D();
  // corner pin, Reshape mode: the outline bent to the corners
  const rsh = (it as Item & { __reshape?: [number, number][] | null }).__reshape;
  if (rsh) { rsh.forEach(([px, py], i) => (i ? p.lineTo(px - w / 2, py - h / 2) : p.moveTo(px - w / 2, py - h / 2))); p.closePath(); return { p, rule: "nonzero" }; }
  // hollow: the outline with the hole (the same shape, t in) cut out
  const hol = (it as Item & { __hollow?: ReturnType<typeof hollowParts> }).__hollow ?? null; // worked out at the frame's time (morphing shapes too)
  if (hol) {
    p.addPath(new Path2D(hol.outer.d), new DOMMatrix().translate(-w / 2, -h / 2));
    p.addPath(new Path2D(hol.inner.d), new DOMMatrix().translate(-w / 2 + hol.t, -h / 2 + hol.t));
    return { p, rule: "evenodd" };
  }
  if (it.kind === "shape") {
    const sd = (it as Item & { __shape?: { d: string; evenodd?: boolean } }).__shape ?? shapeD(it.shape ?? { type: "rect" }, w, h);
    p.addPath(new Path2D(sd.d), new DOMMatrix().translate(-w / 2, -h / 2));
    return { p, rule: sd.evenodd ? "evenodd" : "nonzero" };
  }
  if (it.kind === "ellipse") p.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (it.kind === "star") { STAR.forEach(([px, py], i) => (i ? p.lineTo : p.moveTo).call(p, -w / 2 + (px / 100) * w, -h / 2 + (py / 100) * h)); p.closePath(); }
  else p.roundRect(-w / 2, -h / 2, w, h, Math.min(it.radius ?? 0, w / 2, h / 2));
  return { p, rule: "nonzero" };
}
/** Length of an item's outline (for borders drawn on). */
function perimeter(it: Item): number {
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const w = it.w, h = it.h;
  let d: string;
  if (it.kind === "shape") d = shapeD(it.shape ?? { type: "rect" }, w, h).d;
  else if (it.kind === "ellipse") return Math.PI * (3 * (w + h) / 2 - Math.sqrt((3 * w / 2 + h / 2) * (w / 2 + 3 * h / 2)));
  else d = `M0 0H${w}V${h}H0Z`;
  probe.setAttribute("d", d);
  try { return probe.getTotalLength(); } catch { return 2 * (w + h); }
}
const fillShape = (ctx: Ctx, it: Item) => { const o = outline(it); ctx.fill(o.p, o.rule); };
const clipShape = (ctx: Ctx, it: Item) => { const o = outline(it); ctx.clip(o.p, o.rule); };
const strokeShape = (ctx: Ctx, it: Item) => ctx.stroke(outline(it).p);

/** Two spare sheets the size of the frame, for text masks. */
let sheets: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
function maskSheets(w: number, h: number): [HTMLCanvasElement, HTMLCanvasElement] {
  sheets ??= [document.createElement("canvas"), document.createElement("canvas")];
  for (const c of sheets) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return sheets;
}

/** Text running along a line, motion path or shape outline (same letters and places as the editor). */
function drawTextOnPath(ctx: Ctx, it: Item, s: ItemState, g: { glyphs: Glyph[]; font: string }) {
  ctx.save();
  ctx.font = g.font; ctx.fillStyle = it.color ?? "#111"; ctx.textBaseline = "middle";
  for (const q of g.glyphs) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity * q.a));
    ctx.transform(...q.m);
    ctx.fillText(q.ch, -q.w / 2, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** A drawn line: dashed/dotted, arrowheads, and only the first `draw` share when it's being drawn on. */
function drawLine(ctx: Ctx, it: Item) {
  const l = it.line!;
  const toPx = ([u, v]: [number, number]) => [u * it.w, v * it.h] as [number, number];
  const px = lineShape(l.pts.map(toPx), l.ctrl?.map((c) => (c ? [toPx(c[0]), toPx(c[1])] : null)), l.round ?? 0);
  const pts = subLine(px, it.look?.drawStart ?? 0, Math.max(0, Math.min(1, it.look?.draw ?? 1)));
  if (pts.length < 2) return;
  ctx.lineWidth = l.width; ctx.strokeStyle = l.color; ctx.fillStyle = l.color;
  ctx.lineCap = l.dash === "dot" ? "round" : l.cap; ctx.lineJoin = "round";
  ctx.setLineDash(dashArray(l));
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.setLineDash([]);
  for (const tri of arrowHeads(pts, l)) { ctx.beginPath(); tri.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); }
}

function drawImageFit(ctx: Ctx, img: CanvasImageSource, iw: number, ih: number, it: Item) {
  const fit = it.fit ?? "cover";
  const s = fit === "contain" ? Math.min(it.w / iw, it.h / ih) : Math.max(it.w / iw, it.h / ih);
  const dw = iw * s, dh = ih * s;
  ctx.save();
  ctx.translate(((it.imgX ?? 0) / 100) * it.w, ((it.imgY ?? 0) / 100) * it.h);
  ctx.scale(it.imgZoom ?? 1, it.imgZoom ?? 1);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function shade(color: string) { return /^#|^rgb|^hsl/.test(color) ? color : "#555"; }

/** Canvas filters and shadows are in output pixels; CSS ones are in the item's own pixels. Scale px values by `k`. */
const scalePx = (f: string, k: number) => f.replace(/(-?[\d.]+)px/g, (_, n) => `${+n * k}px`);
const devScale = (ctx: Ctx) => { const m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1; };
function textShadowOn(ctx: Ctx, sh: { x: number; y: number; blur: number; color: string }) {
  const k = devScale(ctx); ctx.shadowColor = sh.color; ctx.shadowBlur = sh.blur * k; ctx.shadowOffsetX = sh.x * k; ctx.shadowOffsetY = sh.y * k;
}
function filterOf(it: Item, s: ItemState) {
  const l = it.look, f: string[] = [];
  if (l?.blur) f.push(`blur(${l.blur}px)`);
  f.push(...lookShadows(it));
  if (s.blur) f.push(`blur(${s.blur}px)`);
  return f.length ? f.join(" ") : "none";
}

function revealed(text: string, r: number | undefined) {
  if (r == null || r >= 1) return text;
  return [...text].slice(0, Math.floor([...text].length * Math.max(0, r))).join("");
}
function caseOf(t: string, c?: string) {
  if (c === "uppercase") return t.toUpperCase();
  if (c === "lowercase") return t.toLowerCase();
  if (c === "capitalize") return t.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
  return t;
}

/** Text between two text keyframes: each changing letter drawn as the chosen kind of change has it (see morphChars). */
function drawMorph(ctx: Ctx, it: Item, chars: (MorphChar & { color?: string })[], size: number, lh: number, pad: number) {
  const lines: MorphChar[][] = [[]];
  for (const c of chars) { if (c.ch === "\n") { if (c.kind === "keep" || c.f > 0.5) lines.push([]); } else lines[lines.length - 1].push({ ...c, ch: caseOf(c.ch, it.textCase) }); }
  const wOf = (c: MorphChar) => ctx.measureText(c.ch).width * (c.kind === "keep" ? 1 : c.w ?? c.f);
  const widths = lines.map((l) => l.reduce((a, c) => a + wOf(c), 0));
  const boxW = it.wrap ? it.w : Math.max(...widths, 1) + pad * 2, boxH = lines.length * lh + pad * 2;
  const x0 = -boxW / 2, y0 = -boxH / 2;
  if (it.textBg) {
    ctx.save(); ctx.globalAlpha *= it.bgOpacity ?? 1; ctx.fillStyle = it.textBg;
    ctx.beginPath(); ctx.roundRect(x0, y0, boxW, boxH, Math.min(it.radius ?? 0, boxW / 2, boxH / 2)); ctx.fill(); ctx.restore();
  }
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? size * 0.8, desc = m.fontBoundingBoxDescent ?? size * 0.2;
  ctx.textBaseline = "alphabetic";
  const ds = devScale(ctx);
  lines.forEach((ln, i) => {
    const cw = boxW - pad * 2, lw = widths[i];
    let x = x0 + pad + ((it.align ?? "left") === "center" ? (cw - lw) / 2 : it.align === "right" ? cw - lw : 0);
    const by = y0 + pad + i * lh + (lh - (asc + desc)) / 2 + asc;
    const mid = (asc - desc) / 2; // letters scale and flip around the middle of the line
    for (const c of ln) {
      const full = ctx.measureText(c.ch).width, w = wOf(c), keep = c.kind === "keep";
      const op = keep ? 1 : c.op ?? c.f, sc = keep ? 1 : c.sc ?? 1, sy = keep ? 1 : c.sy ?? 1;
      if (op > 0.001 && sc * sy > 0.001) {
        ctx.save();
        ctx.globalAlpha *= op;
        if (!keep && c.blur) { const fl = ctx.filter; ctx.filter = `${fl && fl !== "none" ? fl + " " : ""}blur(${(c.blur * size * ds).toFixed(2)}px)`; }
        ctx.translate(x + w / 2, by - mid + (keep ? 0 : (c.dy ?? 0) * size));
        ctx.scale(sc, sc * sy);
        if (it.textShadow) textShadowOn(ctx, it.textShadow);
        ctx.fillStyle = (c as MorphChar & { color?: string }).color ?? it.color ?? "#111";
        ctx.fillText(c.ch, -full / 2, mid);
        if (it.stroke?.width) { ctx.shadowColor = "transparent"; ctx.lineWidth = it.stroke.width; ctx.strokeStyle = it.stroke.color; ctx.strokeText(c.ch, -full / 2, mid); }
        ctx.restore();
      }
      x += w;
    }
  });
}

/** Text changing between two text keyframes, in place (the same layout as the editor, see morphLayout). */
function drawMorphInPlace(ctx: Ctx, it: Item, tx: { morph?: MorphChar[]; from?: string; to?: string; u?: number }, size: number, lh: number, pad: number) {
  const L = morphLayout(tx.morph ?? [], tx.from ?? "", tx.to ?? "", tx.u ?? 0, {
    measure: (q) => (q ? ctx.measureText(q).width : 0), align: it.align ?? "left", maxW: it.wrap ? Math.max(1, it.w - pad * 2) : null, caseOf: (q) => caseOf(q, it.textCase),
  });
  const boxW = it.wrap ? it.w : L.w + pad * 2, boxH = L.lines * lh + pad * 2;
  const x0 = -boxW / 2, y0 = -boxH / 2;
  if (it.textBg) {
    ctx.save(); ctx.globalAlpha *= it.bgOpacity ?? 1; ctx.fillStyle = it.textBg;
    ctx.beginPath(); ctx.roundRect(x0, y0, boxW, boxH, Math.min(it.radius ?? 0, boxW / 2, boxH / 2)); ctx.fill(); ctx.restore();
  }
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? size * 0.8, desc = m.fontBoundingBoxDescent ?? size * 0.2, mid = (asc - desc) / 2;
  const f = (it.align ?? "left") === "center" ? 0.5 : it.align === "right" ? 1 : 0;
  const left = x0 + pad + (boxW - pad * 2 - L.w) * f, ds = devScale(ctx);
  ctx.textBaseline = "alphabetic";
  for (const c of L.chars) {
    if (c.op <= 0.001 || c.sc * c.sy <= 0.001) continue;
    const full = ctx.measureText(c.ch).width, by = y0 + pad + c.line * lh + (lh - (asc + desc)) / 2 + asc;
    ctx.save();
    ctx.globalAlpha *= c.op;
    if (c.blur) { const fl = ctx.filter; ctx.filter = `${fl && fl !== "none" ? fl + " " : ""}blur(${(c.blur * size * ds).toFixed(2)}px)`; }
    ctx.translate(left + c.x + full / 2, by - mid + c.dy * size);
    ctx.scale(c.sc, c.sc * c.sy);
    if (it.textShadow) textShadowOn(ctx, it.textShadow);
    ctx.fillStyle = it.color ?? "#111";
    ctx.fillText(c.ch, -full / 2, mid);
    if (it.stroke?.width) { ctx.shadowColor = "transparent"; ctx.lineWidth = it.stroke.width; ctx.strokeStyle = it.stroke.color; ctx.strokeText(c.ch, -full / 2, mid); }
    ctx.restore();
  }
}

function drawText(ctx: Ctx, it: Item, s: ItemState, sans: string, local = 0, media?: { src: CanvasImageSource; w: number; h: number }) {
  const size = it.fontSize ?? 100, lh = size * (it.lineHeight ?? 0.9), pad = it.textBg ? it.textPad ?? 24 : 0;
  ctx.font = `${it.italic ? "italic " : ""}${it.fontWeight ?? 800} ${size}px ${it.fontFamily ? `"${it.fontFamily}", ` : ""}${sans}`;
  (ctx as Ctx & { letterSpacing: string; wordSpacing: string }).letterSpacing = `${(it.letterSpacing ?? -0.04) * size}px`;
  (ctx as Ctx & { wordSpacing: string }).wordSpacing = `${(it.wordSpacing ?? 0) * size}px`;
  const mt = (it as Item & { __mt?: { morph?: MorphChar[]; from?: string; to?: string; u?: number } }).__mt;
  if (mt?.morph) { drawMorphInPlace(ctx, it, mt, size, lh, pad); return; }
  // letters with their own colours: drawn one by one (same layout as a morph with nothing changing)
  const lettersC = (it as Item & { __letters?: Map<number, string> | null }).__letters;
  if (lettersC && !textAnimOf(it)) {
    const shown = revealed(caseOf(it.text ?? "", it.textCase), s.reveal);
    drawMorph(ctx, it, [...shown].map((ch, i) => ({ ch, f: 1, kind: "keep" as const, color: lettersC.get(i) })), size, lh, pad);
    return;
  }
  const full = caseOf(it.text ?? "", it.textCase);
  const text = revealed(full, s.reveal);
  // lines (wrapping inside the box width when "wrap" is on), laid out from the full text so reveal doesn't reflow
  const inner = it.w - pad * 2;
  const layout = (src: string) => {
    const out: string[] = [];
    for (const para of src.split("\n")) {
      if (!it.wrap) { out.push(para); continue; }
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        const test = line + word;
        if (line && ctx.measureText(test.trimEnd()).width > inner) { out.push(line.trimEnd()); line = word.trimStart(); } else line = test;
      }
      out.push(line);
    }
    return out;
  };
  const fullLines = layout(full);
  let left = [...text].length;
  const lines = fullLines.map((l) => { const n = [...l].length; const part = [...l].slice(0, Math.max(0, left)).join(""); left -= n + 1; return part; });
  const widths = fullLines.map((l) => ctx.measureText(l).width);
  const boxW = it.wrap ? it.w : Math.max(...widths, 1) + pad * 2;
  const boxH = fullLines.length * lh + pad * 2;
  const x0 = -boxW / 2, y0 = -boxH / 2;
  if (it.textBg) {
    ctx.save(); ctx.globalAlpha *= it.bgOpacity ?? 1; ctx.fillStyle = it.textBg;
    ctx.beginPath(); ctx.roundRect(x0, y0, boxW, boxH, Math.min(it.radius ?? 0, boxW / 2, boxH / 2)); ctx.fill(); ctx.restore();
  }
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? size * 0.8, desc = m.fontBoundingBoxDescent ?? size * 0.2;
  const color = it.color ?? "#111";
  let fill: string | CanvasGradient | CanvasPattern = color;
  if (it.textGradient) {
    const g = it.textGradient, a = (g.angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
    const L = Math.abs(boxW * dx) + Math.abs(boxH * dy);
    const gr = ctx.createLinearGradient(-(dx * L) / 2, -(dy * L) / 2, (dx * L) / 2, (dy * L) / 2);
    gr.addColorStop(0, g.from); gr.addColorStop(1, g.to); fill = gr;
  }
  // a picture or video showing through the letters (covers the text box)
  if (media && media.w && boxW > 0 && boxH > 0) {
    const pc = document.createElement("canvas"); pc.width = Math.ceil(boxW); pc.height = Math.ceil(boxH);
    const sc = Math.max(boxW / media.w, boxH / media.h) * (it.textFill?.zoom ?? 1);
    pc.getContext("2d")!.drawImage(media.src, (boxW - media.w * sc) / 2, (boxH - media.h * sc) / 2, media.w * sc, media.h * sc);
    const pat = ctx.createPattern(pc, "no-repeat");
    if (pat) { pat.setTransform(new DOMMatrix().translate(x0, y0)); fill = pat; }
  }
  ctx.textBaseline = "alphabetic";
  const depth = Math.min(Math.round(it.look?.extrude ?? 0), 60);
  // per-piece animation: count pieces over the whole text so the stagger matches the editor
  const unit = textAnimOf(it) ? textUnit(it) : null;
  const total = unit === "line" ? lines.length : unit ? splitPieces(full, unit).filter((p) => p.anim).length : 0;
  let pi = -1;
  lines.forEach((ln, i) => {
    const lw = widths[i], cw = boxW - pad * 2;
    const ax = (it.align ?? "left") === "center" ? (cw - lw) / 2 : it.align === "right" ? cw - lw : 0;
    const bx = x0 + pad + ax, by = y0 + pad + i * lh + (lh - (asc + desc)) / 2 + asc;
    if (unit) {
      const pieces = unit === "line" ? [{ text: ln, anim: true }] : splitPieces(ln, unit);
      let off = 0;
      for (const p of pieces) {
        const pw = ctx.measureText(p.text).width;
        if (p.anim) {
          pi++;
          const f = pieceFx(it, local, pi, total, p.text);
          if (f.o > 0.001) {
            ctx.save();
            ctx.globalAlpha *= Math.min(1, f.o);
            if (f.blur) ctx.filter = `blur(${f.blur}px)`;
            ctx.translate(bx + off + pw / 2 + f.dx, by + f.dy);
            ctx.rotate((f.r * Math.PI) / 180);
            if (f.sk) ctx.transform(1, 0, Math.tan((f.sk * Math.PI) / 180), 1, 0, 0);
            ctx.scale(f.s * f.sx * Math.cos((f.ry * Math.PI) / 180), f.s * f.sy * Math.cos((f.rx * Math.PI) / 180));
            if (it.textShadow) textShadowOn(ctx, it.textShadow);
            ctx.fillStyle = f.color ?? fill;
            ctx.fillText(f.text ?? p.text, -pw / 2, 0);
            if (it.stroke?.width) { ctx.shadowColor = "transparent"; ctx.lineWidth = it.stroke.width; ctx.strokeStyle = it.stroke.color; ctx.lineJoin = "round"; ctx.strokeText(f.text ?? p.text, -pw / 2, 0); }
            ctx.restore();
          }
        }
        off += pw;
      }
      return;
    }
    if (!ln) return;
    if (depth && !it.textGradient) { const st = depthStep(it, shade(color)); ctx.fillStyle = st.color; for (let d = depth; d >= 1; d--) ctx.fillText(ln, bx + d * st.dx, by + d * st.dy); }
    ctx.save();
    if (it.textShadow) textShadowOn(ctx, it.textShadow);
    ctx.fillStyle = fill; ctx.fillText(ln, bx, by);
    ctx.restore();
    if (it.stroke?.width) { ctx.lineWidth = it.stroke.width; ctx.strokeStyle = it.stroke.color; ctx.lineJoin = "round"; ctx.strokeText(ln, bx, by); }
    if (it.underline) { ctx.fillStyle = fill; ctx.fillRect(bx, by + size * 0.1, ctx.measureText(ln).width, Math.max(1, size * 0.06)); }
  });
}

/** The landscape drawn inside picture placeholders (and with a sun inside circles), as in the editor. */
function drawMountains(ctx: Ctx, w: number, h: number, sun: boolean) {
  const x0 = -w / 2, y0 = -h / 2;
  if (sun) {
    const r = (w * 0.22) / 2, cx = x0 + w * 0.56 + r, cy = y0 + h * 0.26 + r;
    ctx.save(); ctx.shadowColor = "rgba(255,220,150,.6)"; ctx.shadowBlur = 80 * devScale(ctx); ctx.fillStyle = "#FFF1C9";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const pts = [[0, 74], [18, 56], [30, 68], [48, 44], [64, 64], [78, 52], [100, 70], [100, 100], [0, 100]];
  ctx.fillStyle = sun ? "#2A2347" : "#0F1736";
  ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x0 + (px / 100) * w, y0 + (py / 100) * h)); ctx.closePath(); ctx.fill();
}

/** Paint an item flat (no position/rotation/scale), centred on the origin. */
async function paintFlat(ctx: Ctx, it: Item, s: ItemState, t: number, rs: RenderSession, back: boolean) {
  { const fl = filterOf(it, s); ctx.filter = fl === "none" ? fl : scalePx(fl, devScale(ctx)); }
  if (it.kind === "text") { drawText(ctx, it, s, rs.sans, t - it.start, await textMedia(it, t - it.start, rs)); return; }
  if (it.kind === "line" && it.line) { drawLine(ctx, it); return; }
  if (it.kind === "chart" && it.chart) {
    const img = await svgImage(chartSVG(it.chart, it.w, it.h, chartProgress(it, t - it.start), rs.sans));
    if (img) ctx.drawImage(img, -it.w / 2, -it.h / 2, it.w, it.h);
    return;
  }
  if (it.kind === "particles" && it.particles) {
    ctx.save(); ctx.translate(-it.w / 2, -it.h / 2);
    drawParticles(ctx as CanvasRenderingContext2D, particlesAt(it.particles, it.w, it.h, t - it.start, it.end - it.start));
    ctx.restore();
    return;
  }
  if (back) { ctx.fillStyle = "#fff"; fillShape(ctx, it); return; } // the white back of a card
  const depth = Math.min(Math.round(it.look?.extrude ?? 0), 60);
  if (depth) {
    const st = depthStep(it, /^#/.test(it.fill) ? it.fill : "#555");
    ctx.save(); ctx.fillStyle = st.color;
    for (let dd = depth; dd >= 1; dd--) { ctx.save(); ctx.translate(dd * st.dx, dd * st.dy); fillShape(ctx, it); ctx.restore(); }
    ctx.restore();
  }
  ctx.save();
  clipShape(ctx, it);
  const vf = it.kind === "video" && it.src ? await videoAt(rs, it.src, it.id, (dur) => mediaTime(it, t - it.start, dur || undefined)) : null;
  if (it.kind === "video" && vf) {
    ctx.fillStyle = "#000"; ctx.fillRect(-it.w / 2, -it.h / 2, it.w, it.h);
    drawImageFit(ctx, vf.img, vf.w || it.w, vf.h || it.h, it);
  } else {
    const u = urlOf(it.fill);
    if (u) {
      ctx.fillStyle = "#d9d7d2"; ctx.fillRect(-it.w / 2, -it.h / 2, it.w, it.h);
      const img = images.get(u);
      if (img) drawImageFit(ctx, img, img.naturalWidth, img.naturalHeight, it);
    } else if (it.fill !== "transparent") {
      // a reshaped outline can reach past the box: fill all of it
      const rsh = (it as Item & { __reshape?: [number, number][] | null }).__reshape;
      if (rsh) {
        const xs = rsh.map((q) => q[0] - it.w / 2), ys = rsh.map((q) => q[1] - it.h / 2), x0 = Math.min(...xs), y0 = Math.min(...ys);
        paintCSS(ctx, it.fill, x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0);
      } else paintCSS(ctx, it.fill, -it.w / 2, -it.h / 2, it.w, it.h);
    }
    if (it.fill.startsWith("linear") && (it.kind === "image" || it.kind === "ellipse")) drawMountains(ctx, it.w, it.h, it.kind === "ellipse");
    if (it.text) {
      ctx.fillStyle = it.color ?? "#111"; ctx.font = `${it.fontWeight ?? 600} ${it.fontSize ?? 40}px "Geist Mono", monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it.text, 0, 0);
    }
  }
  if (it.stroke?.width) {
    ctx.lineWidth = it.stroke.width * 2; ctx.strokeStyle = it.stroke.color;
    // a border that draws itself on
    const lk = lookAt(it, t - it.start), dr = lk.draw ?? 1, from = lk.drawStart ?? 0;
    if (dr < 0.999 || from > 0.001) {
      const L = perimeter(it);
      ctx.setLineDash([Math.max(0, dr - from) * L, L * 2]); ctx.lineDashOffset = -from * L;
    }
    strokeShape(ctx, it);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * Where a point of the item (u, v from its centre, in px) lands on the canvas: the same
 * transform the editor uses — perspective(1400px) translateZ rotateX rotateY rotateZ scale.
 */
function project3D(s: ItemState, u: number, v: number): [number, number, number] {
  const r = Math.PI / 180;
  let x = u * s.scale, y = v * s.scale, z = 0;
  let c = Math.cos(s.rz * r), n = Math.sin(s.rz * r);
  [x, y] = [x * c - y * n, x * n + y * c];
  c = Math.cos(s.ry * r); n = Math.sin(s.ry * r);
  [x, z] = [x * c + z * n, -x * n + z * c];
  c = Math.cos(s.rx * r); n = Math.sin(s.rx * r);
  [y, z] = [y * c - z * n, y * n + z * c];
  z += s.z;
  const f = 1400 / Math.max(1, 1400 - z);
  return [s.x + x * f, s.y + y * f, f];
}

/** Draw `img` with its corner grid mapped to `dst` (perspective by many small affine triangles). */
function drawWarped(ctx: Ctx, img: HTMLCanvasElement, sw: number, sh: number, N: number, dst: (i: number, j: number) => [number, number], pad: number) {
  const tri = (s0: number[], s1: number[], s2: number[], d0: number[], d1: number[], d2: number[]) => {
    if (![d0[0], d0[1], d1[0], d1[1], d2[0], d2[1]].every(Number.isFinite)) return; // past a corner pin's horizon
    const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
    if (Math.abs(den) < 1e-9) return;
    const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
    const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
    const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
    const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
    const e = d0[0] - a * s0[0] - c * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
    // grow the clip a hair so neighbouring triangles don't show seams
    const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
    const g = (q: number[]) => { const dx = q[0] - cx, dy = q[1] - cy, l = Math.hypot(dx, dy) || 1; return [q[0] + (dx / l) * pad, q[1] + (dy / l) * pad]; };
    const [p0, p1, p2] = [g(d0), g(d1), g(d2)];
    ctx.save();
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s00 = [(i / N) * sw, (j / N) * sh], s10 = [((i + 1) / N) * sw, (j / N) * sh], s01 = [(i / N) * sw, ((j + 1) / N) * sh], s11 = [((i + 1) / N) * sw, ((j + 1) / N) * sh];
    const d00 = dst(i, j), d10 = dst(i + 1, j), d01 = dst(i, j + 1), d11 = dst(i + 1, j + 1);
    tri(s00, s10, s11, d00, d10, d11);
    tri(s00, s11, s01, d00, d11, d01);
  }
}

/**
 * A corner-pinned item: the flat picture of it mapped pixel by pixel onto the canvas. The pin and the item's own
 * 3D turn are both perspective maps of a flat card, so together they're one exact map (no seams, no triangles):
 * worked out from where the item's four corners land, then each canvas pixel looks up where it comes from.
 */
function drawPinned(ctx: Ctx, f: CanvasRenderingContext2D, pw: number, ph: number, q: number, it: Item, s: ItemState, H: number[], rs: RenderSession) {
  const M = ctx.getTransform(), W = ctx.canvas.width, Hh = ctx.canvas.height;
  // flat-canvas pixel (from its centre) → canvas pixel
  const toOut = (u: number, v: number): [number, number] | null => {
    const p = pinMap(H, u, v); if (!p) return null;
    const [x, y] = project3D(s, p[0], p[1]);
    return [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f];
  };
  const hw = it.w / 2, hh = it.h / 2;
  const corners = [toOut(-hw, -hh), toOut(hw, -hh), toOut(hw, hh), toOut(-hw, hh)];
  if (corners.some((c) => !c)) return;
  // the same map in flat-canvas pixels (centred), then turned round: canvas pixel → flat pixel
  const G = pinMatrix(it.w * q, it.h * q, corners as [number, number][]);
  if (!G) return;
  const [a, b, c, d, e, g2, g, h, i] = G;
  const A = e * i - g2 * h, B = c * h - b * i, C = b * g2 - c * e, D = g2 * g - d * i, E = a * i - c * g, F = c * d - a * g2, Gi = d * h - e * g, Hi = b * g - a * h, I = a * e - b * d;
  // which canvas pixels it can reach: the margin's corners, or the whole canvas when they pass the horizon
  const fw2 = pw / q / 2, fh2 = ph / q / 2;
  const ext = [toOut(-fw2, -fh2), toOut(fw2, -fh2), toOut(fw2, fh2), toOut(-fw2, fh2)];
  let x0 = 0, y0 = 0, x1 = W, y1 = Hh;
  if (ext.every(Boolean)) {
    x0 = Math.max(0, Math.floor(Math.min(...ext.map((p) => p![0])))); x1 = Math.min(W, Math.ceil(Math.max(...ext.map((p) => p![0]))));
    y0 = Math.max(0, Math.floor(Math.min(...ext.map((p) => p![1])))); y1 = Math.min(Hh, Math.ceil(Math.max(...ext.map((p) => p![1]))));
  }
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  const src = f.getImageData(0, 0, pw, ph).data;
  const tmp = rs.fxTmp, tg = tmp.getContext("2d")!;
  if (tmp.width < bw || tmp.height < bh) { tmp.width = Math.max(tmp.width, bw); tmp.height = Math.max(tmp.height, bh); }
  const out = tg.createImageData(bw, bh), o = out.data;
  const cx = pw / 2, cy = ph / 2;
  for (let yy = 0; yy < bh; yy++) {
    const Y = y0 + yy + 0.5;
    for (let xx = 0; xx < bw; xx++) {
      const X = x0 + xx + 0.5;
      const wq = Gi * X + Hi * Y + I;
      if (wq === 0) continue;
      const u = (A * X + B * Y + C) / wq + cx - 0.5, v = (D * X + E * Y + F) / wq + cy - 0.5;
      if (u < -1 || v < -1 || u > pw || v > ph) continue;
      // bilinear: the four flat pixels around (u, v)
      const ux = Math.floor(u), vy = Math.floor(v), fx = u - ux, fy = v - vy;
      let r = 0, gg = 0, bb = 0, al = 0;
      for (let k2 = 0; k2 < 4; k2++) {
        const sx = ux + (k2 & 1), sy = vy + (k2 >> 1);
        if (sx < 0 || sy < 0 || sx >= pw || sy >= ph) continue;
        const wgt = ((k2 & 1) ? fx : 1 - fx) * ((k2 >> 1) ? fy : 1 - fy), j = (sy * pw + sx) * 4, sa = src[j + 3] * wgt;
        r += src[j] * sa; gg += src[j + 1] * sa; bb += src[j + 2] * sa; al += sa;
      }
      if (al <= 0) continue;
      const n = (yy * bw + xx) * 4;
      o[n] = r / al; o[n + 1] = gg / al; o[n + 2] = bb / al; o[n + 3] = al;
    }
  }
  tg.clearRect(0, 0, bw, bh);
  tg.putImageData(out, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(tmp, 0, 0, bw, bh, x0, y0, bw, bh);
  ctx.restore();
}

async function drawItem(ctx: Ctx, raw: Item, s: ItemState, t: number, rs: RenderSession, placed?: ItemPlace | null) {
  // look and text as they are at this moment (they can have keyframes)
  const tx = textShown(raw, t - raw.start);
  const lc = letterColors(raw, t - raw.start);
  const it: Item & { __reshape?: [number, number][] | null; __mt?: typeof tx; __morph?: MorphChar[]; __shape?: { d: string; evenodd?: boolean }; __letters?: Map<number, string> | null; __hollow?: ReturnType<typeof hollowParts> } =
    { ...resolveItem(raw, t - raw.start), __morph: tx.morph, __mt: tx, __shape: raw.kind === "shape" ? itemShapeD(raw, t - raw.start, raw.w, raw.h) ?? undefined : undefined, __letters: lc, __hollow: reshapeOutline(raw, t) ? null : hollowParts(raw, t - raw.start), __reshape: reshapeOutline(raw, t) };
  const k = ctx.getTransform().a; // world px → output px
  // corner pin: warped in perspective onto its four corners (in its own frame, before it turns)
  const pinH = it.kind === "line" || it.kind === "motion" || it.__reshape ? null : pinHAt(raw, t - raw.start);
  const tilted = !!pinH || Math.abs(s.rx % 360) > 0.05 || Math.abs(s.ry % 360) > 0.05 || Math.abs(s.z) > 0.05;
  // which side faces us: the corners' winding flips when the back is showing
  const [ax, ay] = project3D(s, -1, -1), [bx, by] = project3D(s, 1, -1), [cx2, cy2] = project3D(s, 1, 1);
  const back = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax) < 0 && it.kind !== "text";
  // 1) paint it flat, with room around it for shadows, glow and overhanging text
  const pinReach = it.__reshape ? Math.max(0, ...it.__reshape.flatMap(([px, py]) => [-px, -py, px - it.w, py - it.h])) : 0; // a reshaped outline past its box
  const margin = Math.ceil(Math.max(it.w, it.h) * 0.35 + 80 + pinReach + (it.look?.extrude ?? 0) + (it.look?.glow ?? 0) * 2 + (it.look?.shadow ?? 0) * 3);
  const fw = it.w + margin * 2, fh = it.h + margin * 2;
  const q = Math.min(2 * k, Math.max(0.05, k * Math.max(0.25, s.scale) * (tilted ? 1.25 : 1)), 4096 / Math.max(fw, fh)); // flat canvas px per item px
  const flat = rs.flat, f = flat.getContext("2d")!;
  const pw = Math.ceil(fw * q), ph = Math.ceil(fh * q);
  if (flat.width < pw || flat.height < ph) { flat.width = Math.max(flat.width, pw); flat.height = Math.max(flat.height, ph); }
  f.setTransform(1, 0, 0, 1, 0, 0); f.clearRect(0, 0, flat.width, flat.height); f.globalAlpha = 1; f.globalCompositeOperation = "source-over"; f.filter = "none";
  f.setTransform(q, 0, 0, q, (fw / 2) * q, (fh / 2) * q);
  if (back) f.scale(-1, 1); // the back is seen mirrored, so un-mirror its contents
  await paintFlat(f, it, s, t, rs, back);
  f.setTransform(1, 0, 0, 1, 0, 0); f.filter = "none";
  // item effects (shiny edges, glass, glitch…): the editor's SVG filter, applied to the flat item
  const fxId = `fxe-${++fxCounter}`;
  const fxMarkup = itemFxFilter(fxId, resolveFx(raw.fx, t - raw.start), t - raw.start, q);
  if (fxMarkup) {
    const defs = fxDefs();
    defs.innerHTML = `<defs>${fxMarkup}</defs>`;
    const tmp = rs.fxTmp, tg = tmp.getContext("2d")!;
    if (tmp.width < pw || tmp.height < ph) { tmp.width = Math.max(tmp.width, pw); tmp.height = Math.max(tmp.height, ph); }
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, tmp.width, tmp.height);
    tg.filter = `url(#${fxId})`;
    tg.drawImage(flat, 0, 0, pw, ph, 0, 0, pw, ph);
    tg.filter = "none";
    f.clearRect(0, 0, flat.width, flat.height);
    f.drawImage(tmp, 0, 0, pw, ph, 0, 0, pw, ph);
    defs.innerHTML = "";
  }
  // 2) place it: plain 2D when it isn't tilted, otherwise a perspective warp
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
  ctx.globalCompositeOperation = BLEND[it.blend ?? "normal"] ?? (it.blend as GlobalCompositeOperation);
  if (placed) {
    // riding a line or outline: at its place there, hinged round the edge (its own turn within the surface)
    const f = placed.f;
    ctx.translate(placed.O[0], placed.O[1]);
    ctx.transform(placed.ax[0] * f, placed.ax[1] * f, placed.by[0] * f, placed.by[1] * f, 0, 0);
    ctx.rotate((placed.rz * Math.PI) / 180); ctx.scale(1 / q, 1 / q);
    ctx.drawImage(flat, 0, 0, pw, ph, -pw / 2, -ph / 2, pw, ph);
  } else if (!tilted) {
    ctx.translate(s.x, s.y); ctx.rotate((s.rz * Math.PI) / 180); ctx.scale(s.scale / q, s.scale / q);
    ctx.drawImage(flat, 0, 0, pw, ph, -pw / 2, -ph / 2, pw, ph);
  } else if (pinH) {
    drawPinned(ctx, f, pw, ph, q, it, s, pinH, rs);
  } else {
    const N = 14;
    const dst = (i: number, j: number) => {
      let u = -fw / 2 + (i / N) * fw, v = -fh / 2 + (j / N) * fh;
      if (pinH) { const q = pinMap(pinH, u, v); if (!q) return [NaN, NaN] as [number, number]; [u, v] = q; }
      const [x, y] = project3D(s, u, v); return [x, y] as [number, number];
    };
    // draw only the used part of the flat canvas
    const crop = rs.crop, cc = crop.getContext("2d")!;
    if (crop.width !== pw || crop.height !== ph) { crop.width = pw; crop.height = ph; } else cc.clearRect(0, 0, pw, ph);
    cc.drawImage(flat, 0, 0, pw, ph, 0, 0, pw, ph);
    drawWarped(ctx, crop, pw, ph, N, dst, 1.4 / k);
  }
  ctx.restore();
}

/** A hidden <svg> holding the filter of the item being exported. */
let fxCounter = 0;
function fxDefs(): SVGSVGElement {
  let el = document.getElementById("moshion-fx-export") as SVGSVGElement | null;
  if (!el) {
    el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.id = "moshion-fx-export";
    el.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    document.body.appendChild(el);
  }
  return el;
}

/* ---------------- looks & effects ---------------- */
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function overlays(ctx: Ctx, project: Project, t: number, rs: RenderSession) {
  const W = project.width, H = project.height, u = Math.min(W, H) / 1080;
  const L = activeLooks(project, t);
  if (L.camcorder) {
    const a = Math.min(1, L.camcorder.amount * 1.4), pad = 70 * u, fs = 44 * u, c = 90 * u, b = 5 * u;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 6 * devScale(ctx);
    const corner = (x: number, y: number, sx: number, sy: number) => { ctx.fillRect(x, y, c * sx, b * sy); ctx.fillRect(x, y, b * sx, c * sy); };
    corner(pad, pad, 1, 1); corner(W - pad, pad, -1, 1); corner(pad, H - pad, 1, -1); corner(W - pad, H - pad, -1, -1);
    ctx.font = `600 ${fs}px "Geist Mono", monospace`; ctx.textBaseline = "top";
    ctx.fillText("REC", pad + 40 * u + 40 * u, pad + 30 * u);
    ctx.fillStyle = Math.floor(t * 2) % 2 ? "rgba(255,45,45,.25)" : "#ff2d2d";
    ctx.beginPath(); ctx.arc(pad + 40 * u + 13 * u, pad + 30 * u + fs / 2, 13 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `600 ${fs * 0.8}px "Geist Mono", monospace`;
    ctx.textAlign = "right"; ctx.fillText("▮▮▮▯", W - pad - 40 * u, pad + 30 * u);
    ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText("SP ▶", pad + 40 * u, H - pad - 30 * u);
    const f = Math.floor(t * 30) % 30, s = Math.floor(t) % 60, m = Math.floor(t / 60);
    ctx.textAlign = "right"; ctx.font = `600 ${fs}px "Geist Mono", monospace`;
    ctx.fillText(`00:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`, W - pad - 40 * u, H - pad - 30 * u);
    ctx.restore();
  }
  if (L.glitch) {
    const fr = Math.floor(t * 15), a = L.glitch.amount;
    if (rnd(fr + 5) < 0.3 + 0.5 * a) {
      ctx.save(); ctx.globalCompositeOperation = "difference";
      const n = 2 + Math.floor(rnd(fr + 9) * 4 * a);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = ["rgba(255,0,80,.55)", "rgba(0,220,255,.55)", "rgba(255,255,255,.5)"][i % 3];
        ctx.fillRect(((rnd(fr + i * 13) - 0.5) * 0.3) * W, rnd(fr * 3 + i) * H, W, ((1 + rnd(fr * 5 + i) * 6 * a) / 100) * H);
      }
      ctx.restore();
    }
  }
  if (L.film) {
    const fr = Math.floor(t * 24), a = L.film.amount;
    ctx.save();
    paintLayer(ctx, `radial-gradient(ellipse at center, transparent 55%, rgba(40,25,10,${0.45 * a}) 100%)`, 0, 0, W, H);
    ctx.fillStyle = "rgba(20,15,10,.6)";
    for (let i = 0; i < Math.round(6 * a) + 2; i++) { ctx.beginPath(); ctx.ellipse(rnd(fr * 7 + i) * W, rnd(fr * 11 + i) * H, (1 + rnd(fr + i) * 3) * u, (1 + rnd(fr * 2 + i) * 3) * u, 0, 0, Math.PI * 2); ctx.fill(); }
    if (rnd(fr + 1) < 0.4 * a) { ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(rnd(fr + 4) * W, 0, 2 * u, H); }
    ctx.restore();
  }
  for (const f of project.effects) {
    if (t < f.start || t >= f.end) continue;
    const op = f.kind === "grain" ? f.amount : Math.min(1, f.amount * 1.5);
    ctx.save(); ctx.globalAlpha = op;
    if (f.kind === "grain") {
      ctx.globalCompositeOperation = "overlay";
      const size = fxOpt<number>(f, "size"), speed = fxOpt<number>(f, "speed");
      if (rs.grain) {
        const pat = ctx.createPattern(rs.grain, "repeat")!;
        // same tile size and jumps as the editor's grain
        const u = (870 * size) / 256;
        const jumps = [[0, 0], [-70, 40], [38, -88], [-22, -46], [82, 26], [-52, 76]], [jx, jy] = jumps[speed > 0 ? Math.floor(t * speed) % 6 : 0];
        pat.setTransform(new DOMMatrix().translate(jx * u, jy * u).scale(u, u));
        ctx.fillStyle = pat;
      } else ctx.fillStyle = ctx.createPattern(rs.noise[Math.floor(t * 4) % 4], "repeat")!;
      ctx.fillRect(0, 0, W, H);
    } else if (f.kind === "vhs") {
      const sp = fxOpt<number>(f, "spacing"), th = Math.min(fxOpt<number>(f, "thickness"), sp), ang = fxOpt<number>(f, "angle");
      ctx.fillStyle = hexA(fxOpt<string>(f, "color"), fxOpt<number>(f, "darkness"));
      // lines across the frame at the chosen direction, drifting with "scroll"
      const R = Math.hypot(W, H);
      ctx.translate(W / 2, H / 2); ctx.rotate((ang * Math.PI) / 180);
      const off = (((t * fxOpt<number>(f, "scroll")) % sp) + sp) % sp;
      for (let y = -R / 2 - sp + off; y < R / 2 + sp; y += sp) ctx.fillRect(-R / 2, y, R, th);
    } else if (f.kind === "vignette") {
      paintLayer(ctx, `radial-gradient(ellipse at center, transparent ${fxOpt<number>(f, "size")}%, ${hexA(fxOpt<string>(f, "color"), fxOpt<number>(f, "darkness"))} 100%)`, 0, 0, W, H);
    } else if (f.kind === "lensBlur") {
      const sc = rs.scratch, g = sc.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, sc.width, sc.height);
      g.filter = `blur(${fxOpt<number>(f, "blur") * (sc.width / W)}px)`; g.drawImage(ctx.canvas, 0, 0, sc.width, sc.height); g.filter = "none";
      g.globalCompositeOperation = "destination-in";
      g.save(); g.scale(sc.width / W, sc.height / H);
      paintLayer(g, `radial-gradient(ellipse 55% 50% at 50% 50%, transparent ${fxOpt<number>(f, "clear")}%, #000 100%)`, 0, 0, W, H);
      g.restore(); g.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1; ctx.drawImage(sc, 0, 0, W, H);
    }
    ctx.restore();
  }
}

/** Render the frame at time t into `out` (scaled to its size). */
/** One frame of the video. Between canvases with a transition, both sides are drawn and blended. */
export async function renderFrame(out: HTMLCanvasElement, project: Project, t: number, rs: RenderSession, trans = true) {
  const s = trans ? transitionAt(project, t) : null;
  if (!s) return renderPlain(out, project, t, rs);
  if (s.kind === "magic") return renderPlain(out, magicFrame(project, s, t, itemState), t, rs);
  const mk = (c?: HTMLCanvasElement) => { if (!c || c.width !== out.width || c.height !== out.height) { c = document.createElement("canvas"); c.width = out.width; c.height = out.height; } return c; };
  const A = (rs.tA = mk(rs.tA)), B = (rs.tB = mk(rs.tB));
  await renderPlain(A, project, s.tA, rs);
  await renderPlain(B, project, s.tB, rs);
  const g = out.getContext("2d")!, k = out.width / project.width, w = out.width, h = out.height;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  const { a, b } = transLayers(project, s);
  for (const [img, L] of [[A, a], [B, b]] as const) {
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, L.opacity));
    if (L.blur > 0.1) g.filter = `blur(${(L.blur * k).toFixed(2)}px)`;
    if (L.clip) { g.beginPath(); g.rect(L.clip[0] * w, L.clip[1] * h, (L.clip[2] - L.clip[0]) * w, (L.clip[3] - L.clip[1]) * h); g.clip(); }
    g.translate(w / 2 + L.x * k, h / 2 + L.y * k); g.scale(L.scale, L.scale);
    g.drawImage(img, -w / 2, -h / 2);
    g.restore();
  }
}

async function renderPlain(out: HTMLCanvasElement, projectIn: Project, t: number, rs: RenderSession) {
  const project = resolveScene(projectIn, t);
  const W = project.width, H = project.height, k = out.width / W;
  const world = rs.world, w = world.getContext("2d")!;
  w.setTransform(1, 0, 0, 1, 0, 0); w.clearRect(0, 0, world.width, world.height);
  w.setTransform(k, 0, 0, k, 0, 0);
  // background
  const bg = activeBackground(project, t);
  // the background is drawn by the browser's CSS engine, like in the editor (fallback: our own gradients)
  const css = rs.transparent ? { background: "transparent", filter: undefined as string | undefined } : bg ? backgroundCSS(bg, t) : { background: project.background, filter: undefined as string | undefined };
  const m0 = css.filter ? 80 : 0;
  const bgImg = await cssImage(css.background, css.filter, W + m0 * 2, H + m0 * 2, k);
  if (bgImg) { w.save(); w.setTransform(1, 0, 0, 1, 0, 0); w.drawImage(bgImg, -m0 * k, -m0 * k); w.restore(); }
  else {
    w.save(); if (css.filter) w.filter = scalePx(css.filter, k);
    paintCSS(w, css.background, -m0, -m0, W + m0 * 2, H + m0 * 2);
    w.restore();
  }
  const bf = bg?.kind === "video" && bg.src ? await videoAt(rs, bg.src, `bg:${bg.id}`, (dur) => bgVideoTime(bg, t, dur || bg.mediaDur)) : null;
  if (bf) {
    const vw = bf.w || W, vh = bf.h || H, s = Math.max(W / vw, H / vh); // cover the canvas
    w.drawImage(bf.img, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
  }
  // items, lower tracks first
  const items = project.items.filter((i) => i.kind !== "audio" && i.kind !== "motion" && i.kind !== "camera" && !itemHidden(project, i)).sort(stackCompare(project, t));
  const masks = maskItems(project);
  // the camera moves the view of everything above the background
  const cam = cameraAt(project, t);
  w.save();
  if (cam) { w.translate(W / 2, H / 2); w.rotate((-cam.rz * Math.PI) / 180); w.scale(1 / cam.scale, 1 / cam.scale); w.translate(-cam.x, -cam.y); }
  for (const { it, alpha } of stackAt(project, t, items)) {
    if (masks.has(it.id)) continue; // mask shapes only cut other items
    const s0 = itemState(project, it, t);
    if (!s0.visible) continue;
    // an item changing layer is drawn at both places for a moment, crossfading
    const s = alpha < 1 ? { ...s0, opacity: s0.opacity * alpha } : s0;
    // mask: clip to (or around) another item's shape, on the canvas
    const tmk = textMaskOf(project, it, t);
    const mo = tmk ? null : maskOutline(project, it, t);
    w.save();
    if (mo) {
      const p = new Path2D();
      if (mo.invert) p.rect(-1e5, -1e5, 2e5, 2e5);
      for (const ring of mo.rings) { ring.forEach(([px, py], i) => (i ? p.lineTo(px, py) : p.moveTo(px, py))); p.closePath(); }
      w.clip(p, mo.invert ? "evenodd" : "nonzero");
    }
    const drawAll = async (g: Ctx) => {
      for (const c of repeatCopies(project, it, t)) await drawItem(g, it, c.s, c.t, rs);
      for (const b of blurTrail(project, it, t)) await drawItem(g, it, { ...b.s, opacity: b.s.opacity * alpha * b.a }, b.t, rs);
      const path = it.kind === "text" && (it.onPath || it.follow) ? pathGlyphs(project, resolveItem(it, t - it.start), t, rs.sans) : null;
      if (path) drawTextOnPath(g, resolveItem(it, t - it.start), s, path);
      else await drawItem(g, it, s, t, rs, it.onPath ? pathPlace(project, it, t) : null);
    };
    if (tmk) {
      // a text mask: draw the item on its own sheet, then keep it only inside (or outside) the letters
      const [ia, ib] = maskSheets(world.width, world.height), A = ia.getContext("2d")!, B = ib.getContext("2d")!;
      for (const g of [A, B]) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, world.width, world.height); g.setTransform(w.getTransform()); }
      await drawAll(A);
      // the letters (as they are right now: letter animations, typewriter, curved text), plus the open half for an edge cut
      const L = textLetters(project, tmk.by, t, rs.sans);
      B.fillStyle = "#000";
      const fillPoly = (pts: [number, number][]) => { B.beginPath(); pts.forEach(([px, py], n) => (n ? B.lineTo(px, py) : B.moveTo(px, py))); B.closePath(); };
      if (tmk.edge) { fillPoly(tmk.edge.near); B.fill(); B.save(); fillPoly(tmk.edge.far); B.clip(); }
      // the text's own mask (it can be masked too): only the letters it lets show do the masking
      const own = maskOutline(project, tmk.by, t);
      if (own) {
        const op = new Path2D();
        if (own.invert) op.rect(-1e5, -1e5, 2e5, 2e5);
        for (const r of own.rings) { r.forEach(([px, py], n) => (n ? op.lineTo(px, py) : op.moveTo(px, py))); op.closePath(); }
        B.save(); B.clip(op, own.invert ? "evenodd" : "nonzero");
      }
      if (L) {
        const c = B as Ctx & { letterSpacing: string; wordSpacing: string };
        c.font = L.font; c.letterSpacing = `${L.spacing}px`; c.wordSpacing = `${L.wordSpacing}px`; c.textBaseline = L.central ? "middle" : "alphabetic";
        for (const pc of L.pieces) { B.save(); B.globalAlpha = pc.o; B.transform(...pc.m); B.fillText(pc.text, pc.x, pc.y); B.restore(); }
      }
      if (own) B.restore();
      if (tmk.edge) B.restore();
      A.setTransform(1, 0, 0, 1, 0, 0); A.globalCompositeOperation = tmk.invert ? "destination-out" : "destination-in"; A.drawImage(ib, 0, 0); A.globalCompositeOperation = "source-over";
      w.save(); w.setTransform(1, 0, 0, 1, 0, 0); w.drawImage(ia, 0, 0); w.restore();
    } else await drawAll(w);
    w.restore();
  }
  w.restore();
  // effects on the whole frame (the canvas item's effects)
  const cvFx = itemFxFilter(`fxe-cv-${++fxCounter}`, resolveFx(project.canvasFx, t), t, k);
  if (cvFx) {
    const defs = fxDefs(); defs.innerHTML = `<defs>${cvFx}</defs>`;
    const sc = rs.scratch, g = sc.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, sc.width, sc.height);
    g.filter = `url(#${cvFx.match(/id="([^"]+)"/)![1]})`; g.drawImage(world, 0, 0); g.filter = "none";
    w.setTransform(1, 0, 0, 1, 0, 0); w.clearRect(0, 0, world.width, world.height); w.drawImage(sc, 0, 0);
    defs.innerHTML = "";
  }
  // screen looks: filter + jitter over the whole picture, then overlays
  const lt = looksTransform(project, t);
  const o = out.getContext("2d")!;
  o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, out.width, out.height);
  if (!rs.transparent) { o.fillStyle = "#000"; o.fillRect(0, 0, out.width, out.height); }
  o.save();
  if (lt.filter) o.filter = scalePx(lt.filter, k);
  const tr = lt.transform?.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
  o.drawImage(world, tr ? +tr[1] * k : 0, tr ? +tr[2] * k : 0);
  o.restore();
  o.setTransform(k, 0, 0, k, 0, 0);
  overlays(o, project, t, rs);
  o.setTransform(1, 0, 0, 1, 0, 0);
}

/* ---------------- audio: mix every sound in the project ---------------- */
function reversed(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) { const a = buf.getChannelData(c), b = out.getChannelData(c); for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i]; }
  return out;
}
export async function mixAudio(project: Project, rate = 48000): Promise<AudioBuffer | null> {
  const sources = project.items.filter((i) => (i.kind === "audio" || i.kind === "video") && i.src && !project.tracks.find((t) => t.id === i.trackId)?.muted);
  if (!sources.length) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(project.duration * rate), rate);
  let any = false;
  const decoded = new Map<string, AudioBuffer | null>();
  for (const it of sources) {
    if (!decoded.has(it.src!)) {
      const b = await mediaBlob(it.src!);
      let buf: AudioBuffer | null = null;
      if (b) try { buf = await ctx.decodeAudioData(await b.arrayBuffer()); } catch { buf = null; }
      decoded.set(it.src!, buf);
    }
    const buf = decoded.get(it.src!);
    if (!buf) continue;
    // speed, backwards, and loudness over time (volume keys, fades, ducking)
    const sp = it.speed ?? 1, src = it.reverse ? reversed(ctx, buf) : buf;
    const n = ctx.createBufferSource(); n.buffer = src; n.playbackRate.value = sp;
    const g = ctx.createGain(); n.connect(g); g.connect(ctx.destination);
    const off = it.mediaOffset ?? 0, len = Math.min(it.end - it.start, (buf.duration - off) / sp);
    if (len <= 0) continue;
    const steps = Math.max(2, Math.ceil(len * 50)), curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = volumeAt(project, it, it.start + (len * i) / (steps - 1));
    g.gain.setValueCurveAtTime(curve, Math.max(0, it.start), len);
    n.start(Math.max(0, it.start), off, len * sp); any = true;
  }
  return any ? ctx.startRendering() : null;
}
