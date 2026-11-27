import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStacked } from "./layout";
import type { PinchDetail } from "./touch";
import type { Item, ItemState, Project, Prop } from "@moshion/engine";
import { mediaTime, groupPivot, sampleKeys, addKey, composeRotation, groupChain, magicFrame, blurTrail, cameraAt, lookAt, textShown, stackAt as stackAtTime, stackCompare, boardPos, canvases, itemHidden, itemLocked, resolveFx, resolveScene, transLayers, transitionAt } from "@moshion/engine";
import type { Layer } from "@moshion/engine";
import { ChartView, ParticlesView } from "./newitems";
import { BoardPlane, fitCam, useStills, type Cam } from "./Board";
import { itemFxFilter, keyTimes, letterColors, numAt, pathPivot, pathTransform, resolveItem, setNum } from "@moshion/engine";
import { subLine } from "@moshion/engine";
import { arrowHeads, dashArray, fxOpt, hexA, lineShape, setText } from "@moshion/engine";
import type { SceneEffect } from "@moshion/engine";
import type { MorphChar } from "@moshion/engine";
import { isPinned, pinCSS, pinHAt } from "@moshion/engine";
import { PinEditor } from "./PinEdit";
import { measurer, morphLayout } from "./textmorph";
import { groupOf, groupValues, itemState, itemsInGroup, ownValue, pieceFx, setValue, splitPieces, textAnimOf, textUnit } from "@moshion/engine";
import { prop } from "./EditTools";
import { useStore } from "./store";
import { Icon } from "./Icon";
import { RotationGimbal } from "./Gizmo";
import { Fader } from "./Fader";
import { BackgroundLayer, LookOverlays, looksTransform } from "./Looks";
import { placeAsset, useMediaSync, useMediaURL } from "./media";
import { ExactFrame, useVideoSource } from "./videoview";
import { videoSource } from "./videoengine";
import { GridButton, GridOverlay } from "./Grid";
import { MotionOverlay, PathDrawLayer, shownMotion } from "./MotionPath";
import { LineDrawLayer } from "./Shapes";
import { LineEditor } from "./LineEdit";
import { hollowParts, itemShapeD } from "./shapeMorph";
import { pathPlace, placeCss, reshapeOutline, RESHAPABLE, maskOutline } from "./extras";
import { depthStep, itemOutline, lookShadows, maskClipPath, maskFollowers, maskItems, maskOf, mul6, pathGlyphs, pathOffsetAt, repeatCopies, textLetters, textMaskOf, toItemBox, worldToItem, type Glyph } from "./extras";

/**
 * A video clip. Playing forwards, the <video> element plays it (with its sound); paused, scrubbing or playing
 * backwards, the video engine draws the exact frame for the playhead over it (the same frame the export uses).
 */
function VideoFace({ item }: { item: Item }) {
  const url = useMediaURL(item.src);
  const ref = useRef<HTMLVideoElement>(null);
  const src = useVideoSource(item.src);
  const playing = useStore((s) => s.playing);
  const t = useStore((s) => s.t);
  const exact = !!src && (!playing || !!item.reverse);
  useMediaSync(ref, item, url, !!src);
  const look: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: item.fit === "contain" ? "contain" : "cover", transform: `translate(${item.imgX ?? 0}%, ${item.imgY ?? 0}%) scale(${item.imgZoom ?? 1})` };
  if (!url) return <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#888", font: "500 28px var(--mono)" }}>Loading video…</div>;
  return <>
    <video ref={ref} src={url} playsInline preload="auto" style={look} />
    {src && <ExactFrame src={src} time={mediaTime(item, t - item.start, src.dur)} active={exact} style={look} />}
  </>;
}
function AudioPlayer({ item }: { item: Item }) {
  const url = useMediaURL(item.src);
  const ref = useRef<HTMLAudioElement>(null);
  useMediaSync(ref, item, url);
  return url ? <audio ref={ref} src={url} preload="auto" /> : null;
}

const STAR = "polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)";

/** Items back-to-front: lower tracks first, so upper tracks draw on top. */
function drawOrder(p: Project, t: number, selected: string | null): Item[] {
  // a camera is only drawn (as its frame) while it's selected
  return [...p.items].filter((i) => i.kind !== "audio" && i.kind !== "motion" && (i.kind !== "camera" || i.id === selected) && !itemHidden(p, i)).sort(stackCompare(p, t));
}

/**
 * Each item gets its own perspective and the canvas stays flat, so items never slice
 * through each other in 3D: stacking follows layer order only, like a compositor.
 */
const xf = (s: ItemState) =>
  `perspective(1400px) translateZ(${s.z}px) rotateX(${s.rx}deg) rotateY(${s.ry}deg) rotateZ(${s.rz}deg) scale(${s.scale})`;
/**
 * A shape's outline as a soft-edged mask (an SVG picture of the outline) instead of a hard clip:
 * the browser smooths a mask's edges properly, also when the shape is tilted in 3D or scaled up,
 * where a clip-path edge comes out jagged.
 */
const maskCache = new Map<string, string>();
function shapeMaskCss(d: string, w: number, h: number, evenodd?: boolean): React.CSSProperties {
  const key = `${w}|${h}|${evenodd ? 1 : 0}|${d}`;
  let url = maskCache.get(key);
  if (!url) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><path d="${d}" fill="#000"${evenodd ? ' fill-rule="evenodd"' : ""} shape-rendering="geometricPrecision"/></svg>`;
    url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    if (maskCache.size > 300) maskCache.clear();
    maskCache.set(key, url);
  }
  return { maskImage: url, WebkitMaskImage: url, maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" } as React.CSSProperties;
}
/** A hollow item's mask: its outline with the hole (the same shape, `t` in) cut out. */
function hollowMaskCss(outer: { d: string; evenodd?: boolean }, inner: { d: string; evenodd?: boolean }, t: number, w: number, h: number): React.CSSProperties {
  const key = `h|${w}|${h}|${t}|${outer.d}|${inner.d}`;
  let url = maskCache.get(key);
  if (!url) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><path d="${outer.d}" fill="#fff"${outer.evenodd ? ' fill-rule="evenodd"' : ""}/><path d="${inner.d}" transform="translate(${t} ${t})" fill="#000"${inner.evenodd ? ' fill-rule="evenodd"' : ""}/></mask></defs><rect width="${w}" height="${h}" fill="#000" mask="url(#m)"/></svg>`;
    url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    if (maskCache.size > 300) maskCache.clear();
    maskCache.set(key, url);
  }
  return { maskImage: url, WebkitMaskImage: url, maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" } as React.CSSProperties;
}
const STAR_PTS = [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]];
const starD = (w: number, h: number) => STAR_PTS.map(([x, y], i) => `${i ? "L" : "M"}${(x * w) / 100} ${(y * h) / 100}`).join("") + "Z";

/** Where a point of an item (u, v from its centre, in its own px) shows on the canvas: its turn, 3D tilt and scale. */
function screenPoint(s: ItemState, u: number, v: number): [number, number] {
  const r = Math.PI / 180;
  let x = u * s.scale, y = v * s.scale, z = 0;
  let c = Math.cos(s.rz * r), n = Math.sin(s.rz * r);
  [x, y] = [x * c - y * n, x * n + y * c];
  c = Math.cos(s.ry * r); n = Math.sin(s.ry * r);
  [x, z] = [x * c + z * n, -x * n + z * c];
  c = Math.cos(s.rx * r); n = Math.sin(s.rx * r);
  [y, z] = [y * c - z * n, y * n + z * c];
  const f = 1400 / Math.max(1, 1400 - (z + s.z));
  return [s.x + x * f, s.y + y * f];
}

/** Items that can be corner-pinned (lines and paths have their own points; sound and the camera aren't drawn). */
export const PINNABLE = (it: Item) => !["line", "motion", "audio", "camera", "glass"].includes(it.kind);

/** Not turned in 3D: drawn as a plain 2D layer, which the browser redraws sharp at any size. */
const isFlat = (s: ItemState) => Math.abs(s.rx % 360) < 0.01 && Math.abs(s.ry % 360) < 0.01 && Math.abs(s.z) < 0.01;

/** Stacked layers that give text or a shape real depth. */
function extrusion(item: Item, depth: number, color: string) {
  const n = Math.min(Math.round(depth), 60);
  if (!n) return undefined;
  const d = depthStep(item, color); // which way, and its colour (visible on dark and light colours)
  return Array.from({ length: n }, (_, i) => `${((i + 1) * d.dx).toFixed(2)}px ${((i + 1) * d.dy).toFixed(2)}px 0 ${d.color}`).join(",");
}

function lookFilter(item: Item) {
  const l = item.look;
  if (!l) return undefined;
  const f: string[] = [];
  if (l.blur) f.push(`blur(${l.blur}px)`);
  f.push(...lookShadows(item));
  return f.length ? f.join(" ") : undefined;
}

/** A mask on text running along a path: its outline on the canvas, as a clip for the letters (they're drawn on the canvas, not in the text's box). */
function pathTextClip(project: Project, it: Item, t: number): string | undefined {
  const mo = maskOutline(project, it, t);
  if (!mo || !mo.rings.length) return undefined;
  const d = mo.rings.map((r) => r.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z").join("");
  return mo.invert ? `path(evenodd, "M-99999 -99999H99999V99999H-99999Z${d}")` : `path(nonzero, "${d}")`;
}

/** Text running along a line, motion path or shape outline: each letter placed by its own matrix. */
function TextOnPath({ item, s, g, clip }: { item: Item; s: ItemState; g: { glyphs: Glyph[]; size: number }; clip?: string }) {
  return (
    <svg className="tpath" width="100%" height="100%" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", opacity: s.opacity, filter: lookFilter(item), clipPath: clip }}>
      <g fontSize={g.size} fontWeight={item.fontWeight ?? 800} fontStyle={item.italic ? "italic" : undefined} fill={item.color ?? "#111"}
        fontFamily={item.fontFamily ? `"${item.fontFamily}", var(--sans)` : "var(--sans)"} dominantBaseline="central" textRendering="geometricPrecision">
        {/* every letter can be picked (and dragged along) as the text itself, wherever it sits along the path */}
        {g.glyphs.map((q, i) => <text key={i} data-pathtext={item.id} style={{ pointerEvents: "auto", cursor: "grab" }} x={-q.w / 2} y={0} opacity={q.a < 1 ? q.a : undefined} transform={`matrix(${q.m.map((v) => +v.toFixed(4)).join(" ")})`}>{q.ch}</text>)}
      </g>
    </svg>
  );
}
let sansStack = "";
/**
 * A text mask: the letters (in the masked item's own box) drawn white in an SVG mask — black ones cut out of a
 * white sheet to keep what's outside them. Letter animations, the typewriter and curved text are followed.
 * With an edge cut, the near half stays open and only the letters show past the edge.
 */
function TextMaskDefs({ project, item, s, t }: { project: Project; item: Item; s: ItemState; t: number }) {
  const tm = textMaskOf(project, item, t);
  if (!tm) return null;
  const L = textLetters(project, tm.by, t, appSans());
  const W = worldToItem(s, item), id = `tmask-${item.id}`;
  const poly = (pts: [number, number][]) => pts.map((p, n) => { const q = toItemBox(s, item, p); return `${n ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }).join("") + "Z";
  const by = tm.by;
  const letters = L ? L.pieces.map((pc, n) => (
    <text key={n} x={pc.x} y={pc.y} transform={`matrix(${mul6(W, pc.m).map((v) => +v.toFixed(5)).join(" ")})`} fillOpacity={pc.o < 1 ? pc.o : undefined}
      fontFamily={by.fontFamily ? `"${by.fontFamily}", ${appSans()}` : appSans()} fontSize={L.size} fontWeight={by.fontWeight ?? 800} fontStyle={by.italic ? "italic" : undefined}
      dominantBaseline={L.central ? "central" : undefined} style={{ letterSpacing: `${L.spacing}px`, wordSpacing: `${L.wordSpacing}px`, whiteSpace: "pre" }}>{pc.text}</text>
  )) : null;
  // the text's own mask (it can be masked too): only the letters it lets show do the masking
  const own = maskOutline(project, by, t);
  const ownD = own ? (own.invert ? `M${-1e5} ${-1e5}H${1e5}V${1e5}H${-1e5}Z` : "") + own.rings.map((r) => poly(r)).join("") : null;
  const lettersOwn = ownD ? <g clipPath={`url(#${id}-own)`}>{letters}</g> : letters;
  const content = (fill: string) => (
    <g fill={fill}>
      {tm.edge && <path d={poly(tm.edge.near)} />}
      {tm.edge ? <g clipPath={`url(#${id}-far)`}>{lettersOwn}</g> : lettersOwn}
    </g>
  );
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {tm.edge && <clipPath id={`${id}-far`} clipPathUnits="userSpaceOnUse"><path d={poly(tm.edge.far)} /></clipPath>}
        {ownD && <clipPath id={`${id}-own`} clipPathUnits="userSpaceOnUse"><path d={ownD} clipRule={own!.invert ? "evenodd" : "nonzero"} /></clipPath>}
        <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
          {tm.invert ? <><rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="#fff" />{content("#000")}</> : content("#fff")}
        </mask>
      </defs>
    </svg>
  );
}

/** A scratch canvas for picking text by its letters. */
let hitCtx: CanvasRenderingContext2D | null = null;
/** Text on a path: its box sits at the middle of the curved text, turned along the path there. */
function onPathBox(_p: Project, it: Item, s: ItemState, g: { center: { x: number; y: number; angle: number } } | null): ItemState {
  return g && it.onPath ? { ...s, x: g.center.x, y: g.center.y, rz: g.center.angle, rx: 0, ry: 0, z: 0 } : s;
}
/** The app's text font stack (it's set on the app's root element, the same one the canvas text uses). */
const appSans = () => {
  if (sansStack) return sansStack;
  const mo = document.querySelector(".mo");
  const v = (mo ? getComputedStyle(mo).getPropertyValue("--sans") : "").trim();
  if (v) sansStack = v; // only remembered once found
  return v || "sans-serif";
};

/** Text where some letters have their own colour. */
function ColoredText({ text, colors }: { text: string; colors: Map<number, string> }) {
  const runs: { s: string; c?: string }[] = [];
  [...text].forEach((ch, i) => { const c = colors.get(i); const last = runs[runs.length - 1]; if (last && last.c === c) last.s += ch; else runs.push({ s: ch, c }); });
  return <>{runs.map((r, i) => (r.c ? <span key={i} style={{ color: r.c, WebkitTextFillColor: r.c }}>{r.s}</span> : r.s))}</>;
}

/** Text whose letters / words / lines animate one by one. Letters of a word stay together when wrapping. */
type LetterFill = { image: string; nat?: { w: number; h: number }; zoom: number };
/** Each moving letter carries its own slice of the picture / gradient, lined up as if it covered the whole text. */
function fillLetter(el: HTMLElement | null, fill: LetterFill | undefined) {
  if (!el || !fill) return;
  const box = el.offsetParent as HTMLElement | null;
  if (!box) return;
  const W = box.clientWidth, H = box.clientHeight;
  let bw = W, bh = H;
  if (fill.nat?.w) { const k = Math.max(W / fill.nat.w, H / fill.nat.h) * fill.zoom; bw = fill.nat.w * k; bh = fill.nat.h * k; }
  el.style.backgroundSize = `${bw}px ${bh}px`;
  el.style.backgroundPosition = `${(W - bw) / 2 - el.offsetLeft}px ${(H - bh) / 2 - el.offsetTop}px`;
}
const sizes = new Map<string, { w: number; h: number }>();
function useImageSize(url: string | undefined) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url || sizes.has(url)) return;
    const im = new Image(); im.onload = () => { sizes.set(url, { w: im.naturalWidth, h: im.naturalHeight }); bump((n) => n + 1); }; im.src = url;
  }, [url]);
  return url ? sizes.get(url) : undefined;
}

function AnimatedText({ item, text, local, colors, fill }: { item: Item; text: string; local: number; colors?: Map<number, string> | null; fill?: LetterFill }) {
  const unit = textUnit(item);
  const pieces = splitPieces(text, unit);
  const n = pieces.filter((p) => p.anim).length;
  let i = -1, pos = 0;
  const one = (p: { text: string; anim: boolean }, key: number) => {
    const at = pos; pos += [...p.text].length;
    if (!p.anim) return p.text;
    i++;
    const f = pieceFx(item, local, i, n, p.text);
    const own = colors?.get(at);
    return (
      <span key={key} ref={(el) => fillLetter(el, fill)} style={{
        display: "inline-block", whiteSpace: "pre", opacity: f.o, color: fill ? "transparent" : f.color ?? own,
        ...(fill ? { backgroundImage: fill.image, backgroundRepeat: "no-repeat", WebkitBackgroundClip: "text", backgroundClip: "text" } : {}),
        transform: `translate(${f.dx}px, ${f.dy}px) rotate(${f.r}deg) rotateY(${f.ry}deg) rotateX(${f.rx}deg) skewX(${f.sk}deg) scale(${f.s * f.sx}, ${f.s * f.sy})`,
        filter: f.blur ? `blur(${f.blur}px)` : undefined,
      }}>{f.text ?? p.text}</span>
    );
  };
  if (unit !== "letter") return <>{pieces.map(one)}</>;
  // group letters into words so a wrapped line never splits a word
  const words = text.split(/(\s+)/).filter(Boolean);
  let k = 0;
  return <>{words.map((w, wi) => /^\s+$/.test(w)
    ? ((pos += [...w].length), w)
    : <span key={"w" + wi} style={{ display: "inline-block", whiteSpace: "nowrap" }}>{[...w].map((ch) => one({ text: ch, anim: true }, k++))}</span>)}</>;
}

/**
 * Text changing between two text keyframes, in place: shared letters slide from their old spot to their new one, the
 * others leave or arrive where they stand (in the chosen kind of change), and the text never spreads sideways.
 */
function MorphText({ item, tx }: { item: Item; tx: { morph?: MorphChar[]; from?: string; to?: string; u?: number } }) {
  const size = item.fontSize ?? 100, lh = size * (item.lineHeight ?? 0.9), pad = item.textBg ? item.textPad ?? 24 : 0;
  const font = `${item.italic ? "italic " : ""}${item.fontWeight ?? 800} ${size}px ${item.fontFamily ? `"${item.fontFamily}", ${appSans()}` : appSans()}`;
  const L = morphLayout(tx.morph ?? [], tx.from ?? "", tx.to ?? "", tx.u ?? 0, {
    measure: measurer(font, (item.letterSpacing ?? -0.04) * size, (item.wordSpacing ?? 0) * size),
    align: item.align ?? "left", maxW: item.wrap ? Math.max(1, item.w - pad * 2) : null, caseOf: (s) => caseOfText(s, item.textCase),
  });
  return (
    <span style={{ position: "relative", display: "inline-block", width: L.w, height: L.lines * lh, verticalAlign: "top" }}>
      {L.chars.map((c, i) => c.op <= 0.001 || c.sc * c.sy <= 0.001 ? null : (
        <span key={i} style={{ position: "absolute", left: c.x, top: c.line * lh, height: lh, lineHeight: `${lh}px`, whiteSpace: "pre", opacity: c.op < 1 ? c.op : undefined,
          transform: c.dy || c.sc !== 1 || c.sy !== 1 ? `translateY(${c.dy}em) scale(${c.sc}, ${c.sc * c.sy})` : undefined, filter: c.blur ? `blur(${c.blur.toFixed(3)}em)` : undefined }}>{c.ch}</span>
      ))}
    </span>
  );
}
function caseOfText(t: string, c?: string) {
  if (c === "uppercase") return t.toUpperCase();
  if (c === "lowercase") return t.toLowerCase();
  if (c === "capitalize") return t.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
  return t;
}

/** The current frame of a video, as an image (for video showing through text). */
function useVideoFrame(src: string | undefined, item: Item): { url: string; w: number; h: number } | undefined {
  const url = useMediaURL(src);
  const t = useStore((x) => x.t);
  const [frame, setFrame] = useState<{ url: string; w: number; h: number }>();
  const v = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!url) return;
    const el = document.createElement("video"); el.muted = true; el.playsInline = true; el.preload = "auto"; el.src = url; v.current = el;
    return () => { el.removeAttribute("src"); el.load(); v.current = null; };
  }, [url]);
  useEffect(() => {
    // the video engine: the exact frame, no seeking
    let live = true;
    const want0 = Math.max(0, t - item.start);
    const viaEngine = videoSource(src).then(async (s) => {
      if (!s) return false;
      const f = await s.frameAt(want0 % (s.dur || 1e9), 640);
      if (!f || !live) return true;
      const c = document.createElement("canvas"); c.width = f.w; c.height = f.h;
      c.getContext("2d")!.drawImage(f.img, 0, 0);
      try { setFrame({ url: c.toDataURL("image/jpeg", 0.8), w: f.w, h: f.h }); } catch { /* not ready */ }
      return true;
    });
    const el = v.current;
    if (!el || !url) return () => { live = false; };
    const want = Math.max(0, t - item.start) % (el.duration || 1e9);
    const grab = () => {
      const w = Math.min(640, el.videoWidth || 640), h = Math.round((w * (el.videoHeight || 360)) / (el.videoWidth || 640));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(el, 0, 0, w, h);
      try { setFrame({ url: c.toDataURL("image/jpeg", 0.8), w, h }); } catch { /* not ready */ }
    };
    const viaElement = () => {
      if (!live) return;
      if (Math.abs(el.currentTime - want) < 0.03 && el.readyState >= 2) { grab(); return; }
      el.addEventListener("seeked", grab, { once: true });
      if (el.readyState >= 1) el.currentTime = want; else el.addEventListener("loadedmetadata", () => { el.currentTime = want; }, { once: true });
    };
    viaEngine.then((ok) => { if (!ok) viaElement(); });
    return () => { live = false; el.removeEventListener("seeked", grab); };
  }, [t, url, item.start]);
  return frame;
}

/** The outline of a plain rectangle, circle or star, as a path (for borders that draw on). */
function borderD(it: Item): string {
  const w = it.w, h = it.h;
  if (it.kind === "ellipse" || it.kind === "glass") return `M${w / 2} 0A${w / 2} ${h / 2} 0 1 1 ${w / 2 - 0.01} 0Z`;
  if (it.kind === "star") return STAR.replace(/^polygon\(|\)$/g, "").split(",").map((pp, i) => { const [x, y] = pp.trim().split(" ").map(parseFloat); return `${i ? "L" : "M"}${(x / 100) * w} ${(y / 100) * h}`; }).join("") + "Z";
  const r = Math.min(it.radius ?? 0, w / 2, h / 2);
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

function ItemView({ item: raw, s, editing, cropping, local = 0, extra }: { item: Item; s: ItemState; editing: boolean; cropping: boolean; local?: number; extra?: React.CSSProperties }) {
  const videoFrame = useVideoFrame(raw.kind === "text" && raw.textFill?.kind === "video" ? raw.textFill.src : undefined, raw);
  const imgSize = useImageSize(raw.kind === "text" && raw.textFill?.kind === "image" ? raw.textFill.url : undefined);
  // look and text as they are at this moment (they can have keyframes)
  const tx = textShown(raw, local);
  const item: Item = resolveItem(raw, local);
  const letters = letterColors(raw, local);
  const { edit, setUI } = useStore.getState();
  // corner pin: the item warps in perspective onto its four corners (applied in its own frame, before it turns)
  const pinH = raw.kind === "line" || raw.kind === "motion" || (raw.pinMode === "shape" && RESHAPABLE(raw)) ? null : pinHAt(raw, local);
  const style: React.CSSProperties = {
    left: s.x - item.w / 2, top: s.y - item.h / 2, width: item.w, height: item.h,
    // flat items get a 2D transform (and no 3D layer), so their edges stay crisp however big they get
    transform: (isFlat(s) ? `rotate(${s.rz}deg) scale(${s.scale})` : xf(s)) + (pinH ? ` ${pinCSS(pinH)}` : ""), opacity: s.opacity, borderRadius: item.kind === "ellipse" || item.kind === "glass" ? "50%" : item.radius ?? 0,
    ...(isFlat(s) ? { transformStyle: "flat", ["--bf" as string]: "visible", ["--backd" as string]: "none" } : {}),
    filter: [item.fx?.some((f) => !f.off && (f.amount > 0 || f.keys?.some((k) => k.v > 0))) ? `url(#fxi-${item.id})` : "", lookFilter(item), s.blur ? `blur(${s.blur}px)` : ""].filter(Boolean).join(" ") || undefined, mixBlendMode: item.blend && item.blend !== "normal" ? item.blend : undefined,
    ...extra,
  };
  if (item.kind === "glass") {
    return <div className="obj glass" data-id={item.id} style={{ ...style, ["--gb" as string]: `${item.effect?.blur ?? 1.5}px` }} />;
  }
  if (item.kind === "text") {
    const align = item.align ?? "left";
    const grad = item.textGradient;
    const mediaBg = item.textFill?.kind === "image" && item.textFill.url ? `url("${item.textFill.url}")` : item.textFill?.kind === "video" && videoFrame ? `url(${videoFrame.url})` : undefined;
    // the picture's own size (to fit it like "cover" when each letter carries its own slice)
    const mediaNat = item.textFill?.kind === "video" ? (videoFrame ? { w: videoFrame.w, h: videoFrame.h } : undefined) : imgSize;
    const letterFill = textAnimOf(item) && (mediaBg || grad) ? { image: mediaBg ?? `linear-gradient(${grad!.angle}deg, ${grad!.from}, ${grad!.to})`, nat: mediaBg ? mediaNat : undefined, zoom: item.textFill?.zoom ?? 1 } : undefined;
    const shadows = [
      grad || item.textFill ? undefined : extrusion(item, item.look?.extrude ?? 0, item.color ?? "#111"),
      !grad && !item.textFill && item.textShadow ? `${item.textShadow.x}px ${item.textShadow.y}px ${item.textShadow.blur}px ${item.textShadow.color}` : undefined,
    ].filter(Boolean).join(",");
    const box: React.CSSProperties = {
      width: item.wrap ? item.w : "max-content",
      padding: item.textBg ? item.textPad ?? 24 : 0, borderRadius: item.radius ?? 0,
      background: item.textBg ? `color-mix(in srgb, ${item.textBg} ${Math.round((item.bgOpacity ?? 1) * 100)}%, transparent)` : undefined,
      textAlign: align,
      filter: grad && item.textShadow ? `drop-shadow(${item.textShadow.x}px ${item.textShadow.y}px ${item.textShadow.blur / 2}px ${item.textShadow.color})` : undefined,
    };
    const span: React.CSSProperties = {
      fontSize: item.fontSize, fontWeight: item.fontWeight ?? 800,
      fontFamily: item.fontFamily ? `"${item.fontFamily}", var(--sans)` : "var(--sans)",
      fontStyle: item.italic ? "italic" : undefined, textDecoration: item.underline ? "underline" : undefined,
      letterSpacing: `${item.letterSpacing ?? -0.04}em`, wordSpacing: item.wordSpacing ? `${item.wordSpacing}em` : undefined,
      lineHeight: item.lineHeight ?? 0.9,
      textTransform: item.textCase && item.textCase !== "none" ? item.textCase : undefined,
      whiteSpace: item.wrap ? "pre-wrap" : "pre", overflowWrap: item.wrap ? "break-word" : undefined,
      color: grad || mediaBg ? "transparent" : item.color,
      // separate background settings (a "background" shorthand would reset the clip to the whole box whenever it changes, e.g. every video frame)
      backgroundImage: letterFill ? undefined : mediaBg ?? (grad ? `linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to})` : undefined),
      backgroundSize: mediaBg ? ((item.textFill?.zoom ?? 1) > 1.001 ? `${Math.round((item.textFill?.zoom ?? 1) * 100)}% auto` : "cover") : undefined,
      backgroundPosition: mediaBg ? "center" : undefined, backgroundRepeat: mediaBg ? "no-repeat" : undefined,
      WebkitBackgroundClip: grad || mediaBg ? "text" : undefined, backgroundClip: grad || mediaBg ? "text" : undefined,
      textShadow: shadows || undefined,
      WebkitTextStroke: item.stroke?.width ? `${item.stroke.width}px ${item.stroke.color}` : undefined,
      display: "block",
    };
    return (
      <div className="obj" data-id={item.id} style={style} onDoubleClick={() => setUI({ editingText: item.id })}>
        <div className="tbox" style={box}>
          {editing ? (
            <span
              className="tspan editing" contentEditable suppressContentEditableWarning style={span}
              ref={(el) => { if (el && document.activeElement !== el) { el.focus(); document.getSelection()?.selectAllChildren(el); } }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) (e.target as HTMLElement).blur(); }}
              onBlur={(e) => {
                const text = e.currentTarget.innerText.replace(/\n$/, "");
                if (text !== item.text) edit((dd) => { setText(dd.items.find((x) => x.id === item.id)!, useStore.getState().t, text); });
                setUI({ editingText: null });
              }}
            >{item.text}</span>
          ) : <span className="tspan" style={span}>{tx.morph ? <MorphText item={item} tx={tx} /> : textAnimOf(item) ? <AnimatedText item={item} text={revealed(item.text ?? "", s.reveal)} local={local} colors={letters} fill={letterFill} /> : letters ? <ColoredText text={revealed(item.text ?? "", s.reveal)} colors={letters} /> : revealed(item.text ?? "", s.reveal) || " "}</span>}
        </div>
      </div>
    );
  }
  if (item.kind === "video") {
    return (
      <div className="obj" data-id={item.id} style={style}>
        <div className="face" style={{ background: "#000", overflow: "hidden" }}><VideoFace item={item} /></div>
        <div className="face back" />
      </div>
    );
  }
  if (item.kind === "chart") return <div className="obj" data-id={item.id} style={{ ...style, borderRadius: 0 }}><ChartView item={item} local={local} /></div>;
  if (item.kind === "particles") return <div className="obj" data-id={item.id} style={{ ...style, borderRadius: 0 }}><ParticlesView item={item} local={local} /></div>;
  if (item.kind === "camera") return <div className="obj camframe" data-id={item.id} style={{ ...style, borderRadius: 0 }}><span>Camera</span></div>;
  if (item.kind === "line" && item.line) {
    return <div className="obj" data-id={item.id} style={{ ...style, borderRadius: 0 }}><LineSvg item={item} /></div>;
  }
  // corner pin, Reshape mode: the outline and its border redrawn to the corners (the face covers the new outline's box)
  const rsh = reshapeOutline(raw, raw.start + local);
  if (rsh) {
    const xs = rsh.map((q) => q[0]), ys = rsh.map((q) => q[1]);
    const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(1, Math.max(...xs) - bx), bh = Math.max(1, Math.max(...ys) - by);
    const dl = rsh.map(([px, py], i) => `${i ? "L" : "M"}${(px - bx).toFixed(2)} ${(py - by).toFixed(2)}`).join("") + "Z";
    const img = item.fill.startsWith("url(");
    return (
      <div className="obj" data-id={item.id} style={{ ...style, borderRadius: 0 }}>
        <div className="face" style={{ left: bx, top: by, width: bw, height: bh, right: "auto", bottom: "auto", borderRadius: 0, background: item.fill, backgroundSize: img ? item.fit ?? "cover" : undefined, backgroundRepeat: "no-repeat", backgroundPosition: "center", ...shapeMaskCss(dl, bw, bh) }}>
          {item.stroke?.width ? (
            <svg className="sstroke" viewBox={`0 0 ${bw} ${bh}`} preserveAspectRatio="none"><path d={dl} fill="none" stroke={item.stroke.color} strokeWidth={item.stroke.width * 2} strokeLinejoin="round" /></svg>
          ) : null}
        </div>
      </div>
    );
  }
  const sd = item.kind === "shape" ? itemShapeD(raw, local, item.w, item.h) : null;
  // a border can draw itself on (Fill › Border › Draw)
  const lk = lookAt(raw, local), borderDraw = lk.draw ?? 1, borderFrom = lk.drawStart ?? 0;
  const hol = hollowParts(raw, local);
  const cut = hol ? hollowMaskCss(hol.outer, hol.inner, hol.t, item.w, item.h) : sd ? shapeMaskCss(sd.d, item.w, item.h, sd.evenodd) : item.kind === "star" ? shapeMaskCss(starD(item.w, item.h), item.w, item.h) : undefined;
  if (sd || hol) style.borderRadius = 0;
  const isImg = item.fill.startsWith("url(");
  const imgLayer: React.CSSProperties = {
    position: "absolute", inset: 0, background: item.fill, backgroundSize: item.fit ?? "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center",
    transform: `translate(${item.imgX ?? 0}%, ${item.imgY ?? 0}%) scale(${item.imgZoom ?? 1})`,
  };
  return (
    <div className="obj" data-id={item.id} style={style}>
      {cropping && isImg && <div className="imgghost" style={imgLayer} />}
      <div className="face" style={{ background: isImg ? "#d9d7d2" : item.fill, backgroundSize: item.fit ?? "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center", ...cut, outline: item.stroke?.width && !sd && !hol && borderDraw >= 0.999 && borderFrom <= 0.001 ? `${item.stroke.width}px solid ${item.stroke.color}` : undefined, outlineOffset: item.stroke?.width && !sd && !hol ? -item.stroke.width : undefined, boxShadow: extrusion(item, item.look?.extrude ?? 0, /^#/.test(item.fill) ? item.fill : "#555"), overflow: item.look?.extrude ? "visible" : undefined }}>
        {isImg && <div style={imgLayer} />}
        {item.stroke?.width && (sd || hol || borderDraw < 0.999 || borderFrom > 0.001) ? (
          <svg className="sstroke" viewBox={`0 0 ${item.w} ${item.h}`} preserveAspectRatio="none">
            <path d={hol ? hol.outer.d : sd ? sd.d : borderD(item)} fill="none" stroke={item.stroke.color} strokeWidth={item.stroke.width * 2} pathLength={1}
              strokeDasharray={borderDraw < 0.999 || borderFrom > 0.001 ? `${Math.max(0, borderDraw - borderFrom)} 2` : undefined} strokeDashoffset={borderFrom ? -borderFrom : undefined} />
            {/* a hollow item's border also runs round the hole */}
            {hol && <path d={hol.inner.d} transform={`translate(${hol.t} ${hol.t})`} fill="none" stroke={item.stroke.color} strokeWidth={item.stroke.width * 2} pathLength={1}
              strokeDasharray={borderDraw < 0.999 || borderFrom > 0.001 ? `${Math.max(0, borderDraw - borderFrom)} 2` : undefined} strokeDashoffset={borderFrom ? -borderFrom : undefined} />}
          </svg>
        ) : null}
        {item.kind === "image" && item.fill.startsWith("linear") && <Mountains />}
        {item.kind === "ellipse" && item.fill.startsWith("linear") && <Mountains sun />}
        {item.text && (
          <div className="txt" style={{ justifyContent: "center", fontSize: item.fontSize, color: item.color, fontFamily: "var(--mono)", fontWeight: item.fontWeight ?? 600, letterSpacing: 0 }}>{item.text}</div>
        )}
      </div>
      <div className="face back" style={cut} />
    </div>
  );
}

/**
 * While picking an In / Out / Throughout preset, that item plays it on a loop on the canvas
 * (the playhead doesn't move). Returns the time to draw the item at, or null.
 */
function useAnimPreview(project: Project): { itemId: string; t: number; label: string } | null {
  const pv = useStore((s) => s.ui.animPreview);
  const playing = useStore((s) => s.playing);
  const realT = useStore((s) => s.t);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!pv || playing) return;
    let raf = 0; const t0 = performance.now();
    const tick = (n: number) => { setNow((n - t0) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pv?.itemId, pv?.slot, playing]);
  if (!pv || playing) return null;
  const it = project.items.find((i) => i.id === pv.itemId);
  const a = it?.anim;
  if (!it || (!a && !it.textAnim)) return null;
  const life = it.end - it.start;
  const slot = pv.slot === "tin" ? "in" : pv.slot === "tout" ? "out" : pv.slot === "tloop" ? "loop" : pv.slot;
  if (slot === "in" && a?.in) {
    const at = Math.min(a.in.at ?? 0, Math.max(0, life - a.in.dur)), lead = Math.min(at, 0.3);
    const cyc = lead + a.in.dur + 0.9, ph = now % cyc;
    return { itemId: it.id, t: it.start + Math.min(at - lead + ph, life - 0.001), label: `In · ${a.in.dur.toFixed(2)}s` };
  }
  if (slot === "out" && a?.out) {
    const lead = 0.5, end = it.end - (a.out.at ?? 0), cyc = lead + a.out.dur + 0.6, ph = now % cyc;
    return { itemId: it.id, t: Math.min(end - a.out.dur - lead + ph, it.end - 0.001), label: `Out · ${a.out.dur.toFixed(2)}s` };
  }
  if (slot === "loop" && a?.loop) {
    const base = Math.min(Math.max(realT, it.start + (a.in ? (a.in.at ?? 0) + a.in.dur : 0)), it.end - (a.out ? (a.out.at ?? 0) + a.out.dur : 0) - 0.01);
    return { itemId: it.id, t: base + (now % 4), label: "Throughout" };
  }
  return null;
}

/** A screen look drawn over the canvas, with its settings (sizes are in video px; k = video px → screen px). */
function fxStyle(f: SceneEffect, k: number, t: number): React.CSSProperties {
  const op = f.kind === "grain" ? f.amount : Math.min(1, f.amount * 1.5);
  if (f.kind === "grain") {
    const size = fxOpt<number>(f, "size"), speed = fxOpt<number>(f, "speed");
    return { opacity: op, backgroundSize: `${870 * size * k}px`, animation: speed > 0 ? `mo-grain ${6 / speed}s steps(1) infinite` : "none" };
  }
  if (f.kind === "vhs") {
    const sp = fxOpt<number>(f, "spacing") * k, th = Math.min(fxOpt<number>(f, "thickness"), fxOpt<number>(f, "spacing")) * k;
    const c = hexA(fxOpt<string>(f, "color"), fxOpt<number>(f, "darkness"));
    return { opacity: op, background: `repeating-linear-gradient(${fxOpt<number>(f, "angle")}deg, ${c} 0 ${th}px, transparent ${th}px ${sp}px)`, backgroundPosition: `0 ${(t * fxOpt<number>(f, "scroll") * k) % sp}px` };
  }
  if (f.kind === "vignette") {
    return { opacity: op, background: `radial-gradient(ellipse at center, transparent ${fxOpt<number>(f, "size")}%, ${hexA(fxOpt<string>(f, "color"), fxOpt<number>(f, "darkness"))} 100%)` };
  }
  if (f.kind === "lensBlur") {
    const m = `radial-gradient(ellipse 55% 50% at 50% 50%, transparent ${fxOpt<number>(f, "clear")}%, #000 100%)`;
    return { opacity: op, backdropFilter: `blur(${fxOpt<number>(f, "blur") * k}px)`, WebkitMaskImage: m, maskImage: m };
  }
  return { opacity: op };
}

/** Board view: a locked item drawn clipped to its canvas card. */
function BoardClip({ children }: { children?: React.ReactNode }) {
  return <div className="bclip">{children}</div>;
}

/** A drawn line: dashed or dotted, with arrowheads, drawn on as "draw" goes from 0 to 1. */
function LineSvg({ item }: { item: Item }) {
  const l = item.line!;
  const toPx = ([u, v]: [number, number]) => [(u + 0.5) * item.w, (v + 0.5) * item.h] as [number, number];
  const px = lineShape(l.pts.map(toPx), l.ctrl?.map((c) => (c ? [toPx(c[0]), toPx(c[1])] : null)), l.round ?? 0);
  const pts = subLine(px, item.look?.drawStart ?? 0, Math.max(0, Math.min(1, item.look?.draw ?? 1)));
  const dash = dashArray(l);
  return (
    <svg className="lsvg" width={item.w} height={item.h} style={{ overflow: "visible" }}>
      {pts.length > 1 && <path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("")} fill="none" stroke={l.color} strokeWidth={l.width}
        strokeLinecap={l.dash === "dot" ? "round" : l.cap} strokeLinejoin="round" strokeDasharray={dash.length ? dash.join(" ") : undefined} />}
      {arrowHeads(pts, l).map((tri, i) => <polygon key={i} points={tri.map((p) => p.join(",")).join(" ")} fill={l.color} />)}
    </svg>
  );
}

/** Typewriter: show only the first share of the characters. */
function revealed(text: string, r: number | undefined) {
  if (r == null || r >= 1) return text;
  return text.slice(0, Math.floor([...text].length * Math.max(0, r)));
}

/** Placeholder art for the demo's built-in images, until real images are placed. */
function Mountains({ sun }: { sun?: boolean }) {
  return (
    <>
      {sun && <div style={{ position: "absolute", width: "22%", aspectRatio: "1", borderRadius: "50%", background: "#FFF1C9", left: "56%", top: "26%", boxShadow: "0 0 80px 20px rgba(255,220,150,.6)" }} />}
      <div style={{ position: "absolute", inset: 0, background: sun ? "#2A2347" : "#0F1736", clipPath: "polygon(0 74%,18% 56%,30% 68%,48% 44%,64% 64%,78% 52%,100% 70%,100% 100%,0 100%)" }} />
    </>
  );
}

export function Viewer() {
  const rawProject = useStore((s) => s.project);
  const tNow = useStore((s) => s.t);
  const viewNow = useStore((s) => s.ui.view);
  const magic = viewNow !== "board" ? transitionAt(rawProject, tNow) : null;
  const project = magic?.kind === "magic" ? magicFrame(resolveScene(rawProject, tNow), magic, tNow, itemState) : resolveScene(rawProject, tNow);
  const t = useStore((s) => s.t);
  const selected = useStore((s) => s.selected);
  const ui = useStore((s) => s.ui);
  const { select, edit, checkpoint, setUI, toast } = useStore.getState();
  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [kFit, setK] = useState(0.3);
  // board mode: the preview is an endless plane with every canvas on it
  const board = ui.view === "board";
  const stacked = useStacked();
  const [cam, setCam] = useState<Cam | null>(null);
  const [wsize, setWsize] = useState({ w: 0, h: 0 });
  // edit view: zoomed in on the canvas with two fingers (1 = fit); x / y move it from the middle (screen px)
  const [vz, setVz] = useState({ z: 1, x: 0, y: 0 });
  const zoomed = !board && (vz.z !== 1 || vz.x !== 0 || vz.y !== 0);
  const k = board && cam ? cam.z : kFit * (board ? 1 : vz.z);
  useEffect(() => setVz({ z: 1, x: 0, y: 0 }), [rawProject.id, board]);
  const pinchRef = useRef<(d: PinchDetail) => void>(() => {});
  pinchRef.current = (d) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const mx = d.cx - r.left - r.width / 2, my = d.cy - r.top - r.height / 2;
    if (board && cam) {
      // the board: the point under the fingers stays under them while they move and spread
      const wx = cam.x + (mx - d.dx) / cam.z, wy = cam.y + (my - d.dy) / cam.z;
      const nz = Math.min(4, Math.max(0.02, cam.z * d.scale));
      setCam({ x: wx - mx / nz, y: wy - my / nz, z: nz });
      return;
    }
    const handOn = !!useStore.getState().ui.hand;
    setVz((v) => {
      const nz = Math.min(8, Math.max(handOn ? 0.2 : 1, v.z * d.scale));
      if (!handOn && nz <= 1.02) return { z: 1, x: 0, y: 0 }; // back to fit
      const ox = mx - d.dx, oy = my - d.dy; // where the fingers were
      return { z: nz, x: mx - ((ox - v.x) * nz) / v.z, y: my - ((oy - v.y) * nz) / v.z };
    });
  };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const on = (ev: Event) => pinchRef.current((ev as CustomEvent<PinchDetail>).detail);
    el.addEventListener("mo-pinch", on);
    // the mouse wheel zooms with the hand on (and with Ctrl, or a trackpad pinch, any time) around the pointer
    const wheel = (e: WheelEvent) => {
      if (useStore.getState().ui.view === "board") return;
      if (!useStore.getState().ui.hand && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      pinchRef.current({ dx: 0, dy: 0, scale: Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), cx: e.clientX, cy: e.clientY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("mo-pinch", on); el.removeEventListener("wheel", wheel); };
  }, []);
  /** Zoom by a step around the middle of the view (the hand's + and −). */
  const zoomStep = (f: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) pinchRef.current({ dx: 0, dy: 0, scale: f, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  };
  /** The hand: dragging moves the view around (one finger or the mouse); two fingers still pinch. */
  const handDrag = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.classList.add("grabbing");
    let lx = e.clientX, ly = e.clientY;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - lx, dy = ev.clientY - ly; lx = ev.clientX; ly = ev.clientY;
      if (ui.view === "board") setCam((c) => (c ? { ...c, x: c.x - dx / c.z, y: c.y - dy / c.z } : c));
      else setVz((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    const up = () => { el.classList.remove("grabbing"); removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };
  const cvs = canvases(rawProject);
  const live = cvs.find((c) => t >= c.start && t < c.end) ?? cvs[cvs.length - 1];
  const lpos = boardPos(rawProject, live);
  useEffect(() => {
    if (!board) { if (cam) setCam(null); return; }
    if (!cam && wsize.w > 0) setCam(fitCam(rawProject, wsize.w, wsize.h));
  }, [board, wsize.w, wsize.h]);
  // transitions between canvases (not on the board): the other side is a still frame
  const ts0 = !board ? transitionAt(rawProject, t) : null;
  const ts = ts0?.kind === "magic" ? null : ts0;
  const joins = !board ? cvs.slice(1).filter((c) => (c.trans?.dur ?? 0) > 0).flatMap((c) => [c.start - 1e-3, c.start]) : [];
  const stills = useStills(rawProject, joins);
  const tl = ts ? transLayers(rawProject, ts) : null;
  const liveIsA = !!ts && t < ts.to.start;
  const layerCss = (L: Layer, base: number): React.CSSProperties => ({
    transform: `translate(${L.x * base + ((1 - L.scale) * rawProject.width * base) / 2}px, ${L.y * base + ((1 - L.scale) * rawProject.height * base) / 2}px) scale(${base * L.scale})`,
    opacity: L.opacity, filter: L.blur > 0.1 ? `blur(${(L.blur * base).toFixed(1)}px)` : undefined,
    clipPath: L.clip ? `inset(${L.clip[1] * 100}% ${(1 - L.clip[2]) * 100}% ${(1 - L.clip[3]) * 100}% ${L.clip[0] * 100}%)` : undefined,
  });
  const snapT = ts ? Math.round((liveIsA ? ts.tB : ts.tA) * 1000) / 1000 : 0;
  const snapUrl = ts ? stills.get(snapT) : undefined;
  const [guides, setGuides] = useState<{ v?: number; h?: number }>({});
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /** Items the box currently touches, outlined live while dragging. */
  const [mhits, setMhits] = useState<{ id: string; left: number; top: number; width: number; height: number }[]>([]);
  const orbit = ui.orbit, setOrbit = (on: boolean) => setUI({ orbit: on });

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setK(Math.min(r.width / project.width, r.height / project.height));
      setWsize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  const items = drawOrder(project, t, selected);
  // the camera: the view follows it (while you're adjusting the camera itself, you see its frame instead)
  const camNow = cameraAt(project, t);
  const vcam = camNow && camNow.id !== selected ? camNow : null;
  const camZoom = vcam ? 1 / vcam.scale : 1;
  const camCSS = vcam ? `rotate(${-vcam.rz}deg) scale(${camZoom}) translate(${project.width / 2 - vcam.x}px, ${project.height / 2 - vcam.y}px)` : "";
  // the canvas's own movement (camera, 3D view, looks like shake): items and their selection boxes both follow it
  const innerTransform = [camCSS, orbit ? "perspective(2400px) rotateY(-22deg) rotateX(10deg) scale(.82)" : "", looksTransform(project, t).transform ?? ""].join(" ").trim() || "none";
  const masks = maskItems(project);

  // text items size themselves to their content, so the selection box always fits the text
  useLayoutEffect(() => {
    const fixes: [string, number, number][] = [];
    for (const it of project.items) {
      if (it.kind !== "text") continue;
      const box = document.querySelector<HTMLElement>(`.obj[data-id="${it.id}"] .tbox`);
      if (!box) continue;
      const w = Math.round(box.offsetWidth), h = Math.round(box.offsetHeight);
      if ((!it.wrap && Math.abs(w - it.w) > 1) || Math.abs(h - it.h) > 1) fixes.push([it.id, it.wrap ? it.w : w, h]);
    }
    if (fixes.length) edit((p) => { for (const [id, w, h] of fixes) { const it = p.items.find((x) => x.id === id); if (it) { it.w = w; it.h = h; } } }, false);
  });
  const sel = project.items.find((i) => i.id === selected);
  const selState = sel ? (sel.onPath && sel.kind !== "text" ? onPathBox(project, sel, itemState(project, sel, t), pathPlace(project, sel, t))
    : sel.kind === "text" && sel.onPath ? onPathBox(project, sel, itemState(project, sel, t), pathGlyphs(project, resolveItem(sel, t - sel.start), t, appSans()))
    : sel.kind === "motion" ? (() => { const s0 = itemState(project, sel, t), lt = Math.min(Math.max(t - sel.start, 0), sel.end - sel.start), f = pathTransform(sel, lt), c = pathPivot(sel), q = f ? f(c) : c; return { ...s0, x: q[0], y: q[1] }; })()
    : itemState(project, sel, t)) : null;
  const preview = useAnimPreview(project);
  // the box around a selected group, measured from its items on screen
  const selGroupTrack = ui.selGroup ? project.tracks.find((x) => x.id === ui.selGroup && x.kind === "group") : undefined;
  const [gbox, setGbox] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const stage = wrap.current?.querySelector(".stage");
    let next: typeof gbox = null;
    if (selGroupTrack && stage) {
      const ids = new Set(itemsInGroup(project, selGroupTrack.id).map((i) => i.id));
      const sr = stage.getBoundingClientRect();
      let l = Infinity, tp = Infinity, r = -Infinity, b = -Infinity;
      stage.querySelectorAll<HTMLElement>(".world .obj[data-id]").forEach((o) => {
        if (!ids.has(o.dataset.id!)) return;
        const q = o.getBoundingClientRect();
        l = Math.min(l, q.left); tp = Math.min(tp, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      });
      if (r > l) next = { l: Math.round(l - sr.left), t: Math.round(tp - sr.top), w: Math.round(r - l), h: Math.round(b - tp) };
    }
    if (JSON.stringify(next) !== JSON.stringify(gbox)) setGbox(next);
  });

  /**
   * Turning snaps to 15° steps (15, 30, 45, 90…) when it comes within a few degrees of one; Shift locks to them,
   * Ctrl or Alt turns snapping off. A chip at the top of the canvas shows the angle while you turn.
   */
  const [rotChip, setRotChip] = useState<string | null>(null);
  const snapAngle = (v: number, ev: PointerEvent) => {
    if (ev.shiftKey) return Math.round(v / 15) * 15;
    if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ui.snap) { const n = Math.round(v / 15) * 15; if (Math.abs(v - n) < 3.5) return n; }
    return Math.round(v * 10) / 10;
  };
  const degTxt = (v: number) => `${Math.round(v * 10) / 10}°`;
  const endChip = () => setRotChip(null);

  // the box around several selected items (not a group): drag to move them, turn them with the knob
  const [mbox, setMbox] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const stage = wrap.current?.querySelector(".stage");
    let next: typeof mbox = null;
    if (ui.multi.length > 1 && stage) {
      const ids = new Set(ui.multi), sr = stage.getBoundingClientRect();
      let l = Infinity, tp = Infinity, r = -Infinity, b = -Infinity;
      stage.querySelectorAll<HTMLElement>(".world .obj[data-id]").forEach((o) => {
        if (!ids.has(o.dataset.id!)) return;
        const q = o.getBoundingClientRect();
        l = Math.min(l, q.left); tp = Math.min(tp, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      });
      if (r > l) next = { l: Math.round(l - sr.left), t: Math.round(tp - sr.top), w: Math.round(r - l), h: Math.round(b - tp) };
    }
    if (JSON.stringify(next) !== JSON.stringify(mbox)) setMbox(next);
  });
  /**
   * Turn several selected items together around their middle: each keeps its place relative to the others
   * (they swing round the middle) and turns by the same amount (3D-tilted ones turn as a whole).
   * Items inside a group move as their group: the keyframe goes on the group, not on its items.
   * It always keyframes: a keyframe at the playhead holds the new turn, and anything that had no keyframes
   * also gets one at its start holding where it was — so it turns over time instead of jumping.
   */
  function startMultiRotate(e: React.PointerEvent) {
    if (!mbox) return;
    e.stopPropagation(); e.preventDefault();
    const sr = wrap.current!.querySelector(".stage")!.getBoundingClientRect();
    const cx = sr.left + mbox.l + mbox.w / 2, cy = sr.top + mbox.t + mbox.h / 2;
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    // what turns: each selected item on its own, or the outermost group it sits in
    const sel = project.items.filter((i) => ui.multi.includes(i.id));
    // the middle, on the canvas (worked out exactly, not from the box's screen pixels)
    const bx = sel.map((it) => { const s = itemState(project, it, t), hw = (it.w * s.scale) / 2, hh = (it.h * s.scale) / 2; return [s.x - hw, s.y - hh, s.x + hw, s.y + hh]; });
    const px = sel.length ? (Math.min(...bx.map((q) => q[0])) + Math.max(...bx.map((q) => q[2]))) / 2 : (cx - sr.left) / k;
    const py = sel.length ? (Math.min(...bx.map((q) => q[1])) + Math.max(...bx.map((q) => q[3]))) / 2 : (cy - sr.top) / k;
    const groupIds = [...new Set(sel.map((it) => groupChain(project, it).at(-1)?.id).filter((x): x is string => !!x))];
    const loose = sel.filter((it) => !groupChain(project, it).length);
    type Start = { id: string; wx: number; wy: number; x0: number; y0: number; r: { rx: number; ry: number; rz: number } };
    const itemStart: Start[] = loose.map((it) => { const s = itemState(project, it, t); return { id: it.id, wx: s.x, wy: s.y, x0: ownValue(it, "x", t), y0: ownValue(it, "y", t), r: { rx: ownValue(it, "rx", t), ry: ownValue(it, "ry", t), rz: ownValue(it, "rz", t) } }; });
    const groupStart: (Start & { from: number })[] = groupIds.map((gid) => {
      const g = project.tracks.find((x) => x.id === gid)!, G = groupValues(g, t), pv = groupPivot(project, g, t);
      const from = Math.min(...itemsInGroup(project, gid).map((i) => i.start));
      return { id: gid, wx: pv.x + G.x, wy: pv.y + G.y, x0: G.x, y0: G.y, r: { rx: G.rx, ry: G.ry, rz: G.rz }, from };
    });
    const tilted = (r: { rx: number; ry: number }) => Math.abs(r.rx % 360) > 0.01 || Math.abs(r.ry % 360) > 0.01;
    checkpoint();
    const mv = (ev: PointerEvent) => {
      const d = snapAngle(((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI, ev);
      setRotChip(`Turned ${d > 0 ? "+" : ""}${degTxt(d)} · ${[...groupStart.map((q) => project.tracks.find((g) => g.id === q.id)?.name ?? "Group"), ...itemStart.map((q) => project.items.find((i) => i.id === q.id)?.name ?? "")].slice(0, 4).join(" · ")}${groupStart.length + itemStart.length > 4 ? " …" : ""}`);
      const c = Math.cos((d * Math.PI) / 180), n = Math.sin((d * Math.PI) / 180);
      const swing = (q: Start) => { const dx = q.wx - px, dy = q.wy - py; return [q.x0 + px + dx * c - dy * n - q.wx, q.y0 + py + dx * n + dy * c - q.wy]; };
      const turned = (r: Start["r"]) => (tilted(r) ? composeRotation({ rx: 0, ry: 0, rz: d }, r) : { rx: r.rx, ry: r.ry, rz: r.rz + d });
      edit((p) => {
        for (const q of itemStart) {
          const it = p.items.find((i) => i.id === q.id);
          if (!it) continue;
          const local = Math.min(Math.max(t - it.start, 0), it.end - it.start);
          const props: Prop[] = tilted(q.r) ? ["x", "y", "rx", "ry", "rz"] : ["x", "y", "rz"];
          // nothing animated yet: first a keyframe at its start holding where it was
          if (!keyTimes(it).length && local > 0.05) for (const pr of props) addKey(it, pr, 0);
          for (const pr of props) if (!it.keys[pr]?.some((k) => Math.abs(k.t - local) < 1e-3)) addKey(it, pr, local);
          const [nx, ny] = swing(q), R = turned(q.r);
          const set = (pr: Prop, v: number) => { const kk = it.keys[pr]?.find((k) => Math.abs(k.t - local) < 1e-3); if (kk) kk.v = Math.round(v * 100) / 100; };
          set("x", nx); set("y", ny); set("rz", R.rz); if (tilted(q.r)) { set("rx", R.rx); set("ry", R.ry); }
        }
        for (const q of groupStart) {
          const g = p.tracks.find((x) => x.id === q.id);
          if (!g) continue;
          const keys = (g.keys ??= {});
          const props: Prop[] = tilted(q.r) ? ["x", "y", "rx", "ry", "rz"] : ["x", "y", "rz"];
          const def = (pr: Prop) => g.base?.[pr] ?? (pr === "scale" || pr === "opacity" ? 1 : 0);
          const has = Object.values(keys).some((ks) => ks?.length);
          const addG = (pr: Prop, at: number) => {
            const ks = (keys[pr] ??= []);
            if (ks.some((kk) => Math.abs(kk.t - at) < 1e-3)) return;
            ks.push({ t: at, v: sampleKeys(ks, at, def(pr)), ease: "ease" }); ks.sort((a, b) => a.t - b.t);
          };
          if (!has && t - q.from > 0.05) for (const pr of props) addG(pr, q.from);
          for (const pr of props) addG(pr, t);
          const [nx, ny] = swing(q), R = turned(q.r);
          const set = (pr: Prop, v: number) => { const kk = keys[pr]?.find((x) => Math.abs(x.t - t) < 1e-3); if (kk) kk.v = Math.round(v * 100) / 100; };
          set("x", nx); set("y", ny); set("rz", R.rz); if (tilted(q.r)) { set("rx", R.rx); set("ry", R.ry); }
        }
      }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); endChip(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /** The items under a point on the canvas, front to back (locked ones left out). */
  function stackAt(x: number, y: number): string[] {
    const ids: string[] = [];
    // hidden masks are on the canvas but don't take clicks: let them be found for this one look
    const hid = [...masks].map((id) => document.querySelector<HTMLElement>(`.world .obj[data-id="${id}"]`)).filter((x): x is HTMLElement => !!x);
    hid.forEach((el) => { el.style.pointerEvents = "auto"; });
    const under = document.elementsFromPoint(x, y);
    hid.forEach((el) => { el.style.pointerEvents = "none"; });
    // a hidden text mask counts only on its letters (not the gaps between them)
    const onLetters = (it: Item) => {
      if (it.kind !== "text" || !masks.has(it.id) || vcam) return true;
      const wr = document.querySelector(".world")?.getBoundingClientRect();
      const L = wr && textLetters(project, it, t, appSans());
      if (!wr || !L) return true;
      const sc = wr.width / project.width, wx = (x - wr.left) / sc, wy = (y - wr.top) / sc;
      const c = (hitCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true }))! as CanvasRenderingContext2D & { letterSpacing: string; wordSpacing: string };
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 4, 4);
      c.font = L.font; c.letterSpacing = `${L.spacing}px`; c.wordSpacing = `${L.wordSpacing}px`; c.textBaseline = L.central ? "middle" : "alphabetic"; c.fillStyle = "#000";
      for (const pc of L.pieces) { c.setTransform(1, 0, 0, 1, 2 - wx, 2 - wy); c.transform(...pc.m); c.fillText(pc.text, pc.x, pc.y); }
      const d = c.getImageData(0, 0, 4, 4).data;
      for (let n = 3; n < d.length; n += 4) if (d[n] > 0) return true;
      return false;
    };
    for (const el of under) {
      const o = (el as HTMLElement).closest?.<HTMLElement>(".world .obj[data-id]");
      const id = (el as Element).closest?.("[data-pathtext]")?.getAttribute("data-pathtext")?.split("~")[0] ?? o?.dataset.id;
      if (!id || ids.includes(id)) continue;
      const it = project.items.find((i) => i.id === id);
      if (it && !itemLocked(project, it) && onLetters(it)) ids.push(id);
    }
    return ids;
  }

  /**
   * Picking the exact item under the pointer — even inside a group, and even through the box drawn around a
   * selected group or several items:
   * - Shift-click adds it to the selection (or takes it out).
   * - Ctrl-click selects it; Ctrl-click again in the same place selects the item behind it, and so on round
   *   the stack. Keep holding the button and drag to move the one you've picked.
   */
  function ctrlPick(e: React.PointerEvent): boolean {
    if (!(e.shiftKey || e.ctrlKey || e.metaKey) || e.button !== 0) return false;
    const stack = stackAt(e.clientX, e.clientY);
    e.stopPropagation(); e.preventDefault();
    if (!stack.length) return true;
    if (e.shiftKey) {
      // from a selected group, start a fresh selection with this item
      const id = stack[0];
      const cur = ui.selGroup ? [] : ui.multi.length ? ui.multi : selected ? [selected] : [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      if (next.length === 1) select(next[0]); else useStore.getState().selectMany(next);
      return true;
    }
    // Ctrl: step through what's stacked here, front to back
    const at = ui.selGroup || ui.multi.length > 1 ? -1 : stack.indexOf(selected ?? "");
    const next = stack[(at + 1) % stack.length];
    const it = project.items.find((i) => i.id === next)!;
    select(next);
    if (stack.length > 1) toast(`${it.name} · ${stack.indexOf(next) + 1} of ${stack.length}`);
    startMove(e, it);
    return true;
  }

  /** Text on a path: dragging it slides it along the path (its "Along" value, keyframed like any other). */
  function startSlide(e: React.PointerEvent, item: Item) {
    const sx = e.clientX, sy = e.clientY;
    const g = item.kind === "text" ? pathGlyphs(project, resolveItem(item, t - item.start), t, appSans()) : pathPlace(project, item, t);
    if (!g) return;
    const c0 = g.center, proj = project;
    let near = numAt(item, "pathOffset", t - item.start), moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / (k * camZoom), dy = (ev.clientY - sy) / (k * camZoom);
      if (!moved && Math.hypot(dx, dy) * k * camZoom < 3) return;
      if (!moved) { moved = true; checkpoint(); }
      const v = pathOffsetAt(proj, item, t, [c0.x + dx, c0.y + dy], near);
      if (v == null) return;
      near = v;
      edit((p) => { const it = p.items.find((i) => i.id === item.id); if (it) setNum(it, "pathOffset", t, v); }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  function startMove(e: React.PointerEvent, item: Item) {
    const multi = useStore.getState().ui.multi;
    if (item.onPath && item.kind !== "motion" && !(multi.length > 1 && multi.includes(item.id))) { startSlide(e, item); return; }
    const sx = e.clientX, sy = e.clientY;
    const x0 = ownValue(item, "x", t), y0 = ownValue(item, "y", t);
    const st = itemState(project, item, t);
    const gx = st.x - x0, gy = st.y - y0; // group offset at this moment
    // everything selected moves together — and whatever they mask comes along, keeping its place relative to
    // the mask (unless that item is set to move on its own), at any depth (a mask of a mask…)
    const sel0 = multi.length && multi.includes(item.id) ? multi : [item.id];
    const ids = [...sel0, ...maskFollowers(project, sel0).filter((id) => { const o = project.items.find((i) => i.id === id); return o && !itemLocked(project, o); })];
    // where every other visible item sits right now (its on-screen box, 3D offset and scale included)
    const others = project.items.filter((o) => !ids.includes(o.id) && o.kind !== "audio").flatMap((o) => {
      const os = itemState(project, o, t);
      if (!os.visible) return [];
      const hw = (o.w * os.scale) / 2, hh = (o.h * os.scale) / 2;
      return [{ xs: [os.x - hw, os.x, os.x + hw], ys: [os.y - hh, os.y, os.y + hh] }];
    });
    const movers = ids.map((id) => { const it = project.items.find((i) => i.id === id)!; return { id, x0: ownValue(it, "x", t), y0: ownValue(it, "y", t) }; });
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / (k * camZoom), dy = (ev.clientY - sy) / (k * camZoom);
      if (!moved && Math.hypot(dx, dy) * k * camZoom < 3) return;
      if (!moved) { moved = true; checkpoint(); }
      let x = x0 + dx, y = y0 + dy;
      const g: { v?: number; h?: number } = {};
      if (ui.snap && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        if (ui.grid && ui.gridOpts.snap) {
          const S = ui.gridOpts.size / 2, ox = project.width / 2, oy = project.height / 2;
          x = Math.round((x + gx - ox) / S) * S + ox - gx; y = Math.round((y + gy - oy) / S) * S + oy - gy;
        }
        // snap edges and centre to the canvas centre and to every other item on screen
        const tol = 10 / k, hw = (item.w * st.scale) / 2, hh = (item.h * st.scale) / 2;
        let bx = tol, by = tol;
        const tryX = (T: number) => { for (const o of [-hw, 0, hw]) { const dd = Math.abs(x + gx + o - T); if (dd < bx) { bx = dd; x = T - o - gx; g.v = T; } } };
        const tryY = (T: number) => { for (const o of [-hh, 0, hh]) { const dd = Math.abs(y + gy + o - T); if (dd < by) { by = dd; y = T - o - gy; g.h = T; } } };
        tryX(project.width / 2); tryY(project.height / 2);
        if (ui.gridOpts.thirds) { tryX(project.width / 3); tryX((project.width * 2) / 3); tryY(project.height / 3); tryY((project.height * 2) / 3); }
        for (const o of others) { for (const T of o.xs) tryX(T); for (const T of o.ys) tryY(T); }
      }
      setGuides(g);
      const ddx = x - x0, ddy = y - y0;
      edit((p) => {
        for (const m of movers) {
          const it = p.items.find((i) => i.id === m.id);
          if (!it) continue;
          setValue(it, "x", t, Math.round(m.x0 + ddx));
          setValue(it, "y", t, Math.round(m.y0 + ddy));
        }
      }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setGuides({}); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /** Adjusting an image: drag moves it inside the shape. */
  function startPan(e: React.PointerEvent, item: Item) {
    e.preventDefault();
    const st0 = itemState(project, item, t);
    const sx = e.clientX, sy = e.clientY, x0 = item.imgX ?? 0, y0 = item.imgY ?? 0;
    const pw = item.w * st0.scale * k / 100, ph = item.h * st0.scale * k / 100;
    checkpoint();
    const mv = (ev: PointerEvent) => edit((p) => {
      const it = p.items.find((i) => i.id === item.id)!;
      it.imgX = Math.round((x0 + (ev.clientX - sx) / pw) * 10) / 10;
      it.imgY = Math.round((y0 + (ev.clientY - sy) / ph) * 10) / 10;
    }, false);
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  const cropItem = project.items.find((i) => i.id === ui.cropping);
  const zoomImg = (z: number) => cropItem && edit((p) => { const it = p.items.find((i) => i.id === cropItem.id)!; it.imgZoom = Math.min(Math.max(z, 0.2), 6); }, false);

  // Enter / Escape finish adjusting an image
  useEffect(() => {
    if (!ui.cropping) return;
    const k2 = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") { e.stopPropagation(); setUI({ cropping: null }); } };
    addEventListener("keydown", k2, true);
    return () => removeEventListener("keydown", k2, true);
  }, [ui.cropping]);

  /** Drag on empty canvas to box-select items (Shift adds to the selection). */
  function startMarquee(e: React.PointerEvent) {
    const stageR = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, add = e.shiftKey;
    const base = add ? (ui.multi.length ? ui.multi : selected ? [selected] : []) : [];
    let box: { l: number; t: number; r: number; b: number } | null = null;
    const mv = (ev: PointerEvent) => {
      box = { l: Math.min(sx, ev.clientX), t: Math.min(sy, ev.clientY), r: Math.max(sx, ev.clientX), b: Math.max(sy, ev.clientY) };
      if (box.r - box.l < 3 && box.b - box.t < 3) return;
      setMarquee({ left: box.l - stageR.left, top: box.t - stageR.top, width: box.r - box.l, height: box.b - box.t });
      setMhits(hits().map((o) => { const r = o.getBoundingClientRect(); return { id: o.dataset.id!, left: r.left - stageR.left, top: r.top - stageR.top, width: r.width, height: r.height }; }));
    };
    const hits = () => [...document.querySelectorAll<HTMLElement>(".world .obj[data-id]")].filter((o) => { const it = project.items.find((i) => i.id === o.dataset.id); return !masks.has(o.dataset.id!) && (!it || !itemLocked(project, it)); }).filter((o) => {
      const r = o.getBoundingClientRect();
      return r.right > box!.l && r.left < box!.r && r.bottom > box!.t && r.top < box!.b;
    });
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      setMarquee(null); setMhits([]);
      if (!box || (box.r - box.l < 3 && box.b - box.t < 3)) { if (!add) select(null); return; }
      const hit = hits().map((o) => o.dataset.id!);
      useStore.getState().selectMany([...new Set([...base, ...hit])]);
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /* ---------------- a selected group: one box around all its items ---------------- */
  const P = (gid: string, p: "x" | "y" | "scale" | "rz") => prop(null, gid, p);
  function groupDrag(e: React.PointerEvent, onMove: (ev: PointerEvent, dx: number, dy: number) => void, onEnd?: () => void) {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const mv = (ev: PointerEvent) => {
      if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; started = true; checkpoint(); }
      onMove(ev, ev.clientX - sx, ev.clientY - sy);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); onEnd?.(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  function startGroupMove(e: React.PointerEvent, gid: string) {
    const x0 = P(gid, "x").get(), y0 = P(gid, "y").get();
    groupDrag(e, (ev, dx, dy) => {
      let nx = dx / k, ny = dy / k;
      if (ev.shiftKey) { if (Math.abs(nx) > Math.abs(ny)) ny = 0; else nx = 0; }
      P(gid, "x").set(Math.round(x0 + nx)); P(gid, "y").set(Math.round(y0 + ny));
    });
  }
  function startGroupScale(e: React.PointerEvent, gid: string, cx: number, cy: number) {
    const s0 = P(gid, "scale").get(), d0 = Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy));
    groupDrag(e, (ev) => { P(gid, "scale").set(Math.max(0.02, Math.round(((s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0) * 1000) / 1000)); });
  }
  function startGroupRotate(e: React.PointerEvent, gid: string, cx: number, cy: number) {
    const r0 = P(gid, "rz").get(), a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    groupDrag(e, (ev) => {
      const v = snapAngle(r0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI, ev);
      setRotChip(`${project.tracks.find((g) => g.id === gid)?.name ?? "Group"} ${degTxt(v)}`);
      P(gid, "rz").set(v);
    }, endChip);
  }

  function startRotate(e: React.PointerEvent) {
    if (!sel || !selState) return;
    e.stopPropagation(); e.preventDefault();
    const sr = (e.currentTarget as HTMLElement).closest(".stage")!.getBoundingClientRect();
    const ox = sr.left + selState.x * k, oy = sr.top + selState.y * k;
    const a0 = Math.atan2(e.clientY - oy, e.clientX - ox);
    const own0 = ownValue(sel, "rz", t);
    checkpoint();
    const mv = (ev: PointerEvent) => {
      const v = snapAngle(own0 + ((Math.atan2(ev.clientY - oy, ev.clientX - ox) - a0) * 180) / Math.PI, ev);
      setRotChip(`${sel.name} ${degTxt(v)}`);
      edit((p) => { setValue(p.items.find((i) => i.id === sel.id)!, "rz", t, v); }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); endChip(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /**
   * Corner handles scale the item and keep its shape (Shift: free).
   * Edge handles stretch one side only. The opposite side stays put (Alt: from the centre).
   */
  function startResize(e: React.PointerEvent, handle: string) {
    if (!sel || !selState) return;
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, w0 = sel.w, h0 = sel.h, sc = selState.scale || 1, fs0 = sel.fontSize ?? 100;
    const fx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
    const fy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
    const corner = fx !== 0 && fy !== 0;
    // an animated item is resized through its Scale, so the change belongs to this moment's keyframe only
    const animated = Object.values(sel.keys).some((ks) => ks && ks.length);
    const sc0 = ownValue(sel, "scale", t), x0 = ownValue(sel, "x", t), y0 = ownValue(sel, "y", t);
    const ang = (selState.rz * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    checkpoint();
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      // pointer movement along the item's own (rotated) sides
      const lx = (dx * ca + dy * sa) / sc, ly = (-dx * sa + dy * ca) / sc;
      const fromCenter = ev.altKey || animated || sel.kind === "text"; // text always grows from its middle
      const m = fromCenter ? 2 : 1;
      let w = fx ? Math.max(20, w0 + m * fx * lx) : w0;
      let h = fy ? Math.max(20, h0 + m * fy * ly) : h0;
      let r = 1;
      // locked proportions: side handles scale both ways too
      if (sel.lockRatio && !corner) { const r2 = fx ? w / w0 : h / h0; w = w0 * r2; h = h0 * r2; }
      if (corner && !ev.shiftKey) { r = Math.max(0.02, (fx * lx / w0 + fy * ly / h0) * (m / 2) + 1); w = Math.max(20, w0 * r); h = Math.max(20, h0 * r); r = w / w0; }
      else if (corner) r = Math.max(w / w0, h / h0);
      if (ui.grid && ui.gridOpts.snap && ui.snap && !ev.altKey && !ev.ctrlKey && !ev.metaKey) { const S = ui.gridOpts.size / 2; w = Math.round(w / S) * S || w; h = Math.round(h / S) * S || h; }
      edit((p) => {
        const it = p.items.find((i) => i.id === sel.id)!;
        if (animated && corner) { setValue(it, "scale", t, Math.max(0.02, Math.round(sc0 * r * 1000) / 1000)); return; }
        it.w = Math.round(w); it.h = Math.round(h);
        if (it.kind === "text") {
          if (corner && !it.wrap) it.fontSize = Math.max(6, Math.round(fs0 * r));
          else if (fx && !fy) it.wrap = true; // pulling a side of text sets its width, and the text wraps inside it
        } else if (it.text && corner) it.fontSize = Math.max(6, Math.round(fs0 * r));
        if (!fromCenter) {
          const dw = ((it.w - w0) * fx) / 2, dh = ((it.h - h0) * fy) / 2;
          it.base.x = Math.round(x0 + (dw * ca - dh * sa) * sc);
          it.base.y = Math.round(y0 + (dw * sa + dh * ca) * sc);
        }
      }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  const vertical = project.height > project.width;

  return (
    <section className="card viewer" aria-label="Canvas" style={{ position: "relative" }}>
      {/* item effects: one SVG filter per item, rebuilt for the current moment (they can animate) */}
      <svg className="fxdefs" width="0" height="0" aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<defs>${itemFxFilter("fxi-canvas", resolveFx(project.canvasFx, t), t) ?? ""}${items.filter((it) => it.fx?.length).map((it) => itemFxFilter(`fxi-${it.id}`, resolveFx(it.fx, (preview?.itemId === it.id ? preview.t : t) - it.start), (preview?.itemId === it.id ? preview.t : t) - it.start) ?? "").join("")}</defs>` }} />
      {project.items.filter((i) => i.kind === "audio" && i.src).map((i) => <AudioPlayer key={i.id} item={i} />)}
      <div className={"stagewrap" + (board ? " board" : "") + (ui.hand ? " hand" : "")} ref={wrap}
        onWheel={board && cam ? (e) => {
          const r = wrap.current!.getBoundingClientRect();
          const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
          const wx = cam.x + mx / cam.z, wy = cam.y + my / cam.z;
          const nz = Math.min(4, Math.max(0.02, cam.z * Math.exp(-e.deltaY * 0.0015)));
          setCam({ x: wx - mx / nz, y: wy - my / nz, z: nz });
        } : undefined}>
        {board && cam && <BoardPlane project={rawProject} cam={cam} setCam={setCam} size={wsize} live={live} />}
        {/* the hand: a layer over the whole view that only moves and zooms it (nothing under it gets picked) */}
        {ui.hand && <div className="handpad" onPointerDown={handDrag} onContextMenu={(e) => e.preventDefault()} onDoubleClick={() => (board ? setCam(fitCam(rawProject, wsize.w, wsize.h)) : setVz({ z: 1, x: 0, y: 0 }))} />}
        {ui.hand && (
          <div className="handctl" onPointerDown={(e) => e.stopPropagation()}>
            {!board && <CanvasPeek project={project} t={t} k={k} vz={vz} size={wsize} kFit={kFit} setVz={setVz} />}
            <div className="hzoom">
              <button title="Zoom out" aria-label="Zoom out" onClick={() => (board && cam ? setCam({ ...cam, z: Math.max(0.02, cam.z / 1.25) }) : zoomStep(1 / 1.25))}><svg viewBox="0 0 24 24" width={14} height={14}><path d="M5 12h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></svg></button>
              <button className="hpct" title="Back to fit" onClick={() => (board ? setCam(fitCam(rawProject, wsize.w, wsize.h)) : setVz({ z: 1, x: 0, y: 0 }))}>{Math.round(k * 100)}%</button>
              <button title="Zoom in" aria-label="Zoom in" onClick={() => (board && cam ? setCam({ ...cam, z: Math.min(4, cam.z * 1.25) }) : zoomStep(1.25))}><svg viewBox="0 0 24 24" width={14} height={14}><path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></svg></button>
            </div>
          </div>
        )}
        {board && cam && (() => {
          const l = (lpos.x - cam.x) * k + wsize.w / 2, tp = (lpos.y - cam.y) * k + wsize.h / 2, cw = project.width * k, ch = project.height * k;
          return <>
            <div className="bveil" style={{ clipPath: `path(evenodd, "M0 0H${wsize.w}V${wsize.h}H0Z M${l} ${tp}h${cw}v${ch}h${-cw}Z")` }} />
            <div className="blive" style={{ left: l, top: tp, width: cw, height: ch }} />
          </>;
        })()}
        <div
          className="stage" ref={stageRef}
          style={{
            width: project.width * k, height: project.height * k,
            ...(zoomed ? { translate: `${vz.x}px ${vz.y}px` } : {}),
            ...(board && cam ? { position: "absolute", left: (lpos.x - cam.x) * k + wsize.w / 2, top: (lpos.y - cam.y) * k + wsize.h / 2, overflow: "visible", zIndex: 1 } : {}),
          }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("moshion/asset")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("moshion/asset");
            const a = project.assets?.find((x) => x.id === id);
            if (!a) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            placeAsset(a, undefined, { x: Math.round((e.clientX - r.left) / k), y: Math.round((e.clientY - r.top) / k) });
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("[contenteditable]")) return;
            let el = (e.target as HTMLElement).closest<HTMLElement>(".obj");
            // a letter of text running along a path: that text (not the line or shape it sits on)
            let onPathId = (e.target as Element).closest?.("[data-pathtext]")?.getAttribute("data-pathtext")?.split("~")[0];
            // the line or shape it rides on is in front (a higher layer): the letters still win over it
            if (!onPathId && el) {
              const front = el.dataset.id;
              for (const u of document.elementsFromPoint(e.clientX, e.clientY)) {
                const pid = u.closest?.("[data-pathtext]")?.getAttribute("data-pathtext")?.split("~")[0];
                if (pid && project.items.find((i) => i.id === pid)?.onPath === front) { onPathId = pid; break; }
              }
            }
            if (onPathId) el = document.querySelector<HTMLElement>(`.world .obj[data-id="${CSS.escape(onPathId)}"]`) ?? el;
            { const hitItem = el && project.items.find((i) => i.id === el!.dataset.id); if (hitItem && itemLocked(project, hitItem)) el = null; }
            if (!el) { if (ui.cropping) setUI({ cropping: null }); if (ui.inGroup || ui.selGroup) setUI({ inGroup: null, selGroup: null }); startMarquee(e); return; }
            const item = project.items.find((i) => i.id === el.dataset.id)!;
            if (ui.cropping) {
              if (ui.cropping === item.id) { startPan(e, item); return; }
              setUI({ cropping: null });
            }
            // Ctrl- or Shift-click: add this exact item (never its group) to the selection, or take it out
            if (ctrlPick(e)) return;
            // Alt-click: step through the items stacked under the pointer, front to back
            if (e.altKey) {
              const stack = stackAt(e.clientX, e.clientY);
              if (stack.length) {
                const next = stack[(stack.indexOf(selected ?? "") + 1) % stack.length];
                const it = project.items.find((i) => i.id === next)!;
                const g = groupOf(project, it);
                setUI({ selGroup: null, inGroup: g ? g.id : null });
                select(next);
                if (stack.length > 1) toast(`${it.name} · ${stack.indexOf(next) + 1} of ${stack.length}`);
                startMove(e, it);
                return;
              }
            }
            // groups inside groups: a click picks the outermost group you're not already inside
            const chain = groupChain(project, item).reverse(); // outermost first
            const inside = ui.inGroup ? chain.findIndex((x) => x.id === ui.inGroup) : -1;
            const g = chain[inside + 1];
            if (g && !(ui.multi.length && ui.multi.includes(item.id))) {
              select(null); setUI({ selGroup: g.id, inGroup: inside >= 0 ? chain[inside].id : null, panel: null });
              startGroupMove(e, g.id);
              return;
            }
            if (!(ui.multi.length && ui.multi.includes(item.id))) select(item.id);
            startMove(e, item);
          }}
          onDoubleClick={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>(".obj");
            const it = el && project.items.find((i) => i.id === el.dataset.id);
            // double-click a grouped item: step inside the group and edit just that item
            // double-click: step one group deeper (and into the item itself at the innermost group)
            const chain = it ? groupChain(project, it).reverse() : [];
            if (it && chain.length && ui.selGroup) {
              const at = chain.findIndex((x) => x.id === ui.selGroup);
              const next = chain[at + 1];
              if (next) { select(null); setUI({ inGroup: chain[at].id, selGroup: next.id }); toast(`Inside ${chain[at].name}`); return; }
              select(it.id); toast(`Editing inside ${chain[chain.length - 1].name}`); return;
            }
            const g = it && groupOf(project, it);
            if (it && g && ui.inGroup !== g.id) { select(it.id); toast(`Editing inside ${g.name} · click outside to leave`); return; }
            if (it && it.kind !== "text" && it.fill.startsWith("url(")) { checkpoint(); select(it.id); setUI({ cropping: it.id, mode3d: false }); }
          }}
          onWheel={(e) => { if (cropItem) zoomImg((cropItem.imgZoom ?? 1) * Math.exp(-e.deltaY * 0.0015)); }}
          onContextMenu={(e) => {
            e.preventDefault(); // the gimbal opens from the timeline; the canvas gets the layer menu
            // the selected item wins when it's under the pointer (even with something on top of it)
            const stack = stackAt(e.clientX, e.clientY);
            if (!stack.length) { setUI({ ctx: null }); return; }
            const cur = ui.multi.length ? ui.multi : selected ? [selected] : [];
            const id = stack.find((x) => cur.includes(x)) ?? stack[0];
            if (!ui.multi.includes(id)) select(id);
            setUI({ wheel: null, ctx: { x: e.clientX, y: e.clientY, itemId: id } });
          }}
        >
          <div
            className="world"
            style={{
              width: project.width, height: project.height, background: project.background,
              transform: `scale(${k})`, ["--k" as string]: k,
              ...(tl ? { ...layerCss(liveIsA ? tl.a : tl.b, k), zIndex: 1 } : {}),
            }}
          >
           <BackgroundLayer project={project} t={t} />
           <div style={{ position: "absolute", inset: 0, transformStyle: "flat", transform: innerTransform, filter: [project.canvasFx?.some((f) => !f.off && f.amount > 0) ? "url(#fxi-canvas)" : "", looksTransform(project, t).filter ?? ""].join(" ").trim() || undefined, transition: orbit ? "transform .5s cubic-bezier(.2,.8,.2,1)" : undefined }}>
            {stackAtTime(project, t, items).map(({ it, alpha, ghost }) => {
              const tt = preview?.itemId === it.id ? preview.t : t;
              const s0 = itemState(project, it, tt);
              if (!s0.visible) return null;
              // a hidden mask: invisible, but there to be picked (Ctrl-click) — faint with onion skin on
              if (masks.has(it.id)) return ghost ? null : <ItemView key={it.id} item={it} s={s0} local={tt - it.start} editing={false} cropping={false} extra={{ opacity: ui.onion ? 0.22 : 0, pointerEvents: "none" }} />;
              const s = alpha < 1 ? { ...s0, opacity: s0.opacity * alpha } : s0;
              const path = it.kind === "text" && (it.onPath || it.follow) ? pathGlyphs(project, resolveItem(it, tt - it.start), tt, appSans()) : null;
              // anything else riding a line or outline: put where it sits on it, hinged round the edge
              const placed = it.kind !== "text" && it.onPath ? pathPlace(project, it, tt) : null;
              const clip = maskClipPath(project, it, s, tt);
              // the fading copy at the item's old place in the stack (while it changes layer)
              // (text on a path: the copy is its letters on the path, never the plain text at its own spot)
              if (ghost) return path
                ? <TextOnPath key={it.id + "~layer"} item={resolveItem(it, tt - it.start)} s={s} g={path} clip={pathTextClip(project, it, tt)} />
                : <ItemView key={it.id + "~layer"} item={{ ...it, id: `${it.id}~layer` }} s={s} local={tt - it.start} editing={false} cropping={false} extra={{ clipPath: clip, pointerEvents: "none" }} />;
              // on the board a locked item stays inside its canvas card (nothing of it spills over the edge)
              const Wrap = board && itemLocked(project, it) ? BoardClip : Fragment;
              return (
                <Wrap key={it.id}>
                  {/* repeater copies, behind the item */}
                  {!path && repeatCopies(project, it, tt).map((c) => <ItemView key={`${it.id}~r${c.i}`} item={{ ...it, id: `${it.id}~r${c.i}` }} s={c.s} local={c.t - it.start} editing={false} cropping={false} extra={{ pointerEvents: "none", clipPath: clip }} />)}
                  {!!it.motionBlur && !path && blurTrail(project, it, tt).map((b) => (
                    <ItemView key={`${it.id}~mb${b.i}`} item={{ ...it, id: `${it.id}~mb${b.i}` }} s={{ ...b.s, opacity: b.s.opacity * alpha * b.a }} local={b.t - it.start} editing={false} cropping={false} extra={{ clipPath: maskClipPath(project, it, b.s, b.t), pointerEvents: "none" }} />
                  ))}
                  {ui.onion && maskOf(project, it) && <ItemView key={`${it.id}~whole`} item={{ ...it, id: `${it.id}~whole` }} s={s} local={tt - it.start} editing={false} cropping={false} extra={{ opacity: 0.22, pointerEvents: "none" }} />}
                  <TextMaskDefs project={project} item={it} s={s} t={tt} />
                  <ItemView item={it} s={placed ? { ...s, x: placed.O[0], y: placed.O[1] } : onPathBox(project, it, s, path)} local={tt - it.start} editing={ui.editingText === it.id} cropping={ui.cropping === it.id} extra={{ clipPath: clip, ...(textMaskOf(project, it, tt) ? { maskImage: `url(#tmask-${it.id})`, WebkitMaskImage: `url(#tmask-${it.id})` } : {}), ...(path ? { opacity: 0 } : {}), ...(placed ? { transform: placeCss(placed) } : {}) }} />
                  {path && <TextOnPath item={resolveItem(it, tt - it.start)} s={s} g={path} clip={pathTextClip(project, it, tt)} />}
                </Wrap>
              );
            })}
            {/* onion skin: the selected item at its previous and next keyframes */}
            {ui.onion && sel && (() => {
              const ks = keyTimes(sel).map((k) => sel.start + k);
              const prev = [...ks].reverse().find((k) => k < t - 1e-3), next = ks.find((k) => k > t + 1e-3);
              return [prev, next].map((kt, i) => kt == null ? null : (
                <ItemView key={"onion" + i} item={{ ...sel, id: `${sel.id}~onion${i}` }} s={itemState(project, sel, kt)} local={kt - sel.start} editing={false} cropping={false}
                  extra={{ opacity: 0.22, pointerEvents: "none", outline: `2px dashed ${i ? "#2f6bff" : "#ff2e88"}`, outlineOffset: 4 }} />
              ));
            })()}
            {/* onion skin: where masked items really are (their whole outline) and the hidden masks cutting them */}
            {ui.onion && (() => {
              const lines: { id: string; d: string; kind: "masked" | "mask" }[] = [];
              const onNow = (it: Item) => t >= it.start && t < it.end && itemState(project, it, t).visible;
              const add = (it: Item, kind: "masked" | "mask") => {
                if (lines.some((l) => l.id === it.id) || !onNow(it)) return;
                const pts = itemOutline(project, it, t);
                if (pts?.length) lines.push({ id: it.id, kind, d: pts.map((p, n) => `${n ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") + "Z" });
              };
              for (const it of project.items) {
                const m = maskOf(project, it);
                if (!m) continue;
                add(it, "masked");
                const g = project.tracks.find((x) => x.id === m.by && x.kind === "group");
                for (const mi of g ? itemsInGroup(project, g.id) : project.items.filter((x) => x.id === m.by)) if (masks.has(mi.id)) add(mi, "mask");
              }
              if (!lines.length) return null;
              const sw = 1.5 / (k * camZoom);
              return (
                <svg className="maskghost" width="100%" height="100%" aria-hidden="true">
                  {/* marching ants: white under black dashes that crawl along the outline */}
                  {lines.map((l) => (
                    <g key={l.id}>
                      <path d={l.d} fill="none" stroke="#fff" strokeWidth={sw} />
                      <path d={l.d} fill="none" stroke="#000" strokeWidth={sw} strokeDasharray={`${4 * sw} ${4 * sw}`}>
                        <animate attributeName="stroke-dashoffset" from="0" to={String(-8 * sw)} dur="0.6s" repeatCount="indefinite" />
                      </path>
                    </g>
                  ))}
                </svg>
              );
            })()}
            <LookOverlays project={project} t={t} />
           </div>
          </div>
          {mbox && !selGroupTrack && (
            <div className="gbox multi" style={{ left: mbox.l, top: mbox.t, width: mbox.w, height: mbox.h }}
              onPointerDown={(e) => { if (e.button !== 0 || ctrlPick(e)) return; const first = project.items.find((i) => i.id === ui.multi[0]); if (first) { e.stopPropagation(); startMove(e, first); } }}
              title={`${ui.multi.length} items`}>
              <b>{ui.multi.length} selected</b>
              <span className="grot" title="Turn them (Shift: 15°)" onPointerDown={startMultiRotate} />
            </div>
          )}
          {selGroupTrack && gbox && (() => {
            const cx = () => { const sr = wrap.current!.querySelector(".stage")!.getBoundingClientRect(); return [sr.left + gbox.l + gbox.w / 2, sr.top + gbox.t + gbox.h / 2] as const; };
            return (
              <div className="gbox" style={{ left: gbox.l, top: gbox.t, width: gbox.w, height: gbox.h }}
                onPointerDown={(e) => { if (e.button === 0 && !ctrlPick(e)) startGroupMove(e, selGroupTrack.id); }}
                onDoubleClick={(e) => {
                  // step inside: pick the item under the pointer
                  const ids = new Set(itemsInGroup(project, selGroupTrack.id).map((i) => i.id));
                  const el = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest<HTMLElement>(".world .obj[data-id]")).find((x) => x && ids.has(x.dataset.id!)) ?? undefined;
                  if (!el) return;
                  // a group inside this one: step into that group first; otherwise pick the item
                  const it = project.items.find((i) => i.id === el.dataset.id)!;
                  const chain = groupChain(project, it).reverse(); // outermost first
                  const next = chain[chain.findIndex((x) => x.id === selGroupTrack.id) + 1];
                  if (next) { select(null); setUI({ inGroup: selGroupTrack.id, selGroup: next.id }); toast(`Inside ${selGroupTrack.name} `); return; }
                  select(it.id); toast(`Editing inside ${selGroupTrack.name}`);
                }}
                title={selGroupTrack.name}>
                <b>{selGroupTrack.name}</b>
                {["nw", "ne", "sw", "se"].map((c) => <i key={c} className={c} onPointerDown={(e) => { const [x, y] = cx(); startGroupScale(e, selGroupTrack.id, x, y); }} />)}
                <span className="grot" title="Rotate (Shift: 15°)" onPointerDown={(e) => { const [x, y] = cx(); startGroupRotate(e, selGroupTrack.id, x, y); }} />
                <button className={"gknob" + (ui.mode3d ? " on" : "")} title={ui.mode3d ? "Back to 2D" : "3D: tilt the whole group"} onPointerDown={(e) => { e.stopPropagation(); setUI({ mode3d: !ui.mode3d }); }}>
                  <Icon name={ui.mode3d ? "rect" : "cube"} size={14} />
                </button>
              </div>
            );
          })()}
          {tl && snapUrl && <img className="tsnap" src={snapUrl} alt="" draggable={false}
            style={{ width: project.width, height: project.height, zIndex: liveIsA ? 2 : 0, ...layerCss(liveIsA ? tl.b : tl.a, k) }} />}
          <PathDrawLayer k={k} stage={stageRef} />
          <LineDrawLayer k={k} stage={stageRef} />
          {mhits.map((h) => <div key={h.id} className="mhit" style={{ left: h.left, top: h.top, width: h.width, height: h.height }} />)}
          {marquee && <div className="marquee" style={marquee} />}
          {preview && <div className="multihint pvhint">▶ Previewing {preview.label} · on a loop</div>}
          {ui.multi.length > 1 && <div className="multihint">{ui.multi.length} selected · Ctrl+G to group</div>}
          {/* the grid and snap lines: editing aids, drawn above everything and untouched by the canvas's looks and effects (they never reach the video) */}
          {/* motion paths: above the looks (so nothing roughens their edges) and not cut off at the canvas edge,
              so a path can start off screen (text flying in from outside) */}
          {(() => {
            // every motion path on screen now (so its nodes can be picked like objects); the selected one in full
            const act = shownMotion(project, selected) ?? (ui.pathDraw ? project.items.find((i) => i.id === ui.pathDraw!.motionId) : undefined);
            const all = project.items.filter((i) => i.kind === "motion" && (i.id === act?.id || (t >= i.start && t <= i.end && !itemHidden(project, i))));
            return all.length ? <div className="pathlayer" style={{ width: project.width, height: project.height, transform: `scale(${k})` }}>{all.map((mm) => <MotionOverlay key={mm.id} m={mm} k={k} t={t} active={mm.id === act?.id} />)}</div> : null;
          })()}
          {/* selection boxes: above the canvas's looks and screen effects (blur, tint, grain, lens blur never touch them),
              moving with the canvas exactly like the items do */}
          <div className="selworld" style={{ width: project.width, height: project.height, transform: `scale(${k})`, ["--k" as string]: k }}>
           <div style={{ position: "absolute", inset: 0, transformStyle: "flat", transform: innerTransform }}>
            {ui.multi.filter((id) => id !== selected).map((id) => {
              const it = project.items.find((i) => i.id === id);
              const ms = it && itemState(project, it, t);
              if (!it || !ms?.visible) return null;
              return <div key={id} className="selbox multi" style={{ left: ms.x - it.w / 2, top: ms.y - it.h / 2, width: it.w, height: it.h, transform: xf(ms), borderRadius: it.kind === "ellipse" || it.kind === "glass" ? "50%" : it.radius ?? 0 }} />;
            })}
            {/* the edit-mode switch: one button, each click goes to the next way of editing the item (2D → 3D → corner pin → 2D);
                its icon shows where the next click goes. It sits by the item's top-right on screen, upright and always the same
                size, however the item is turned, tilted, scaled or pinned. */}
            {sel && sel.kind !== "motion" && sel.kind !== "line" && selState?.visible && ui.cropping !== sel.id && ui.multi.length < 2 && (() => {
              const cur = ui.pinning === sel.id ? "pin" : ui.mode3d ? "3d" : "2d";
              const next = cur === "2d" ? "3d" : cur === "3d" ? (PINNABLE(sel) ? "pin" : "2d") : "2d";
              const tip = { "2d": "Back to 2D", "3d": "Switch to 3D: rotate on every axis with the gimbal", pin: "Corner pin: drag each corner on its own" }[next];
              // the same spot as always, right beside the rotate stick (it follows the item there), but upright and one size
              const sk = k * Math.max(0.02, Math.abs(selState.scale));
              const [cx, cy] = screenPoint(selState, 23 / sk, -sel.h / 2 - 40 / sk);
              return (
                <button className={"modeknob" + (cur !== "2d" ? " on" : "")} title={tip} aria-label={tip}
                  style={{ left: cx - 11 / k, top: cy - 11 / k }}
                  onPointerDown={(e) => { e.stopPropagation(); setUI({ mode3d: next === "3d", pinning: next === "pin" ? sel.id : null }); }}>
                  <Icon name={next === "3d" ? "cube" : next === "pin" ? "pin" : "rect"} size={16} />
                </button>
              );
            })()}
            {/* corner pin: its corners while pinning; just the pinned outline otherwise */}
            {sel && PINNABLE(sel) && selState?.visible && ui.multi.length < 2 && (ui.pinning === sel.id || isPinned(sel)) && (
              <PinEditor item={sel} s={selState} k={k} edit={ui.pinning === sel.id} />
            )}
            {sel && sel.kind !== "motion" && !(sel.kind === "line" && (sel.line?.pts.length ?? 0) < 2) && selState?.visible && ui.cropping !== sel.id && (
              <div
                className={"selbox" + (ui.pinning === sel.id ? " pinning" : "")}
                style={{
                  left: selState.x - sel.w / 2, top: selState.y - sel.h / 2, width: sel.w, height: sel.h,
                  transform: xf(selState),
                  borderRadius: sel.kind === "ellipse" || sel.kind === "glass" ? "50%" : sel.kind === "text" ? (sel.textBg ? sel.radius ?? 0 : 0) : sel.radius ?? 0,
                  // the box is scaled with the item: undo that for its lines and handles
                  ["--k" as string]: k * Math.max(0.02, Math.abs(selState.scale)),
                }}
              >
                {ui.pinning !== sel.id && <>
                {["nw", "ne", "sw", "se"].map((c) => <i key={c} className={c} title="Drag to resize · keeps the shape (Shift: free)" onPointerDown={(e) => startResize(e, c)} />)}
                {(sel.kind === "text" ? ["e", "w"] : ["n", "s", "e", "w"]).map((c) => <i key={c} className={"edge " + c} title={sel.kind === "text" ? "Drag to set the text width" : "Drag to stretch this side (Alt: both sides)"} onPointerDown={(e) => startResize(e, c)} />)}
                <span className="rot" title="Rotate (Shift: 15°)" onPointerDown={startRotate} />
                </>}

              </div>
            )}
           </div>
          </div>
          {/* a selected line: its points, to drag, add and delete */}
          {sel?.kind === "line" && !ui.lineTool && ui.multi.length < 2 && (
            <div className="pathlayer linelayer" style={{ width: project.width, height: project.height, transform: `scale(${k})` }}>
              <LineEditor project={project} item={sel} t={t} k={k} />
            </div>
          )}
          <div className="aidlayer" style={{ width: project.width, height: project.height, transform: `scale(${k})`, ["--k" as string]: k }}>
            <GridOverlay project={project} k={k} />
            {guides.v != null && <div className="guide" style={{ left: guides.v, top: 0, bottom: 0, width: 2 }} />}
            {guides.h != null && <div className="guide" style={{ top: guides.h, left: 0, right: 0, height: 2 }} />}
          </div>
          {/* screen looks stay inside the canvas (on the board nothing else trims them) */}
          <div className="fxbox">
          {project.effects.filter((f) => t >= f.start && t < f.end && ["grain", "vhs", "vignette", "lensBlur"].includes(f.kind)).map((f) => (
            <div key={f.id} className={"fx " + ({ grain: "grain", vhs: "vhs", vignette: "vig", lensBlur: "blur" } as Record<string, string>)[f.kind]} style={fxStyle(f, k, t)} />
          ))}
          </div>
        </div>
      </div>
      {/* drag this edge to make the video area bigger or smaller */}
      {board && <div className={"vresize " + (ui.side === "right" ? "l" : "r")} title="Drag to resize the video area · double-click for the automatic size"
        onDoubleClick={() => setUI({ viewK: 1 })}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const sec = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
          const x0 = e.clientX, f0 = ui.viewK ?? 1, dir = ui.side === "right" ? -1 : 1;
          const mv = (ev: PointerEvent) => setUI({ viewK: Math.min(2.5, Math.max(0.35, f0 * (sec.width + (ev.clientX - x0) * dir) / sec.width)) });
          const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
          addEventListener("pointermove", mv); addEventListener("pointerup", up);
        }} />}
      {rotChip && <div className="rotchip" aria-live="polite">{rotChip}</div>}
      {cropItem && (
        <div className="cropbar" onPointerDown={(e) => e.stopPropagation()}>
          <span>Drag to move the image · scroll to zoom</span>
          <div className="cropzoom"><Fader value={cropItem.imgZoom ?? 1} min={0.2} max={6} onChange={zoomImg} def={1} label="Image zoom" title="Image zoom · double-click resets" /></div>
          <button className="chip" onClick={() => edit((p) => { const it = p.items.find((i) => i.id === cropItem.id)!; it.imgX = 0; it.imgY = 0; it.imgZoom = 1; })}>Reset</button>
          <button className="chip on" onClick={() => setUI({ cropping: null })}>Done</button>
        </div>
      )}
      {ui.mode3d && sel && selState?.visible && <RotationGimbal itemId={sel.id} s={selState} onExit={() => setUI({ mode3d: false })} />}
      {ui.mode3d && !sel && selGroupTrack && <RotationGimbal itemId={null} trackId={selGroupTrack.id} s={groupValues(selGroupTrack, t)} onExit={() => setUI({ mode3d: false })} />}
      {(() => {
        const bar = (
          <>
        <button
          className="chip"
          title="Switch between vertical and horizontal"
          onClick={() => {
            edit((p) => { const w = p.width; p.width = p.height; p.height = w; });
            toast(vertical ? "Horizontal 1920×1080" : "Vertical 1080×1920");
          }}
        >
          {project.width}×{project.height}
        </button>
        {board && cam
          ? <button className="chip" title="Show every canvas" onClick={() => setCam(fitCam(rawProject, wsize.w, wsize.h))}>Board · {Math.round(k * 100)}%</button>
          : zoomed ? <button className="chip on" title="Back to fit" onClick={() => setVz({ z: 1, x: 0, y: 0 })}>{Math.round(k * 100)}% · Fit</button>
          : <span className="chip">Fit · {Math.round(k * 100)}%</span>}
        <span className="sp" />
        <button className={"ib" + (ui.onion ? " on" : "")} title="Onion skin" onClick={() => setUI({ onion: !ui.onion })}><Icon name="frame" /></button>
        <GridButton />
        <button className={"ib" + (orbit ? " on" : "")} title="3D orbit view" onClick={() => setOrbit(!orbit)}><Icon name="cube" /></button>
          </>
        );
        // phones: these sit in the play bar under the tracks, so the video gets this row too
        if (!stacked) return <div className="vbar">{bar}</div>;
        // phones: onion skin, grid and 3D view are in the menu; only a way back to fit when zoomed in (or on the board)
        return board && cam ? <button className="chip vfit" onClick={() => setCam(fitCam(rawProject, wsize.w, wsize.h))}>Board · {Math.round(k * 100)}%</button>
          : zoomed ? <button className="chip on vfit" title="Back to fit" onClick={() => setVz({ z: 1, x: 0, y: 0 })}>{Math.round(k * 100)}% · Fit</button> : null;
      })()}
    </section>
  );
}

/**
 * The hand's mini map: the whole canvas small, its items as little blocks, and a frame showing the part of it in
 * view. Tap or drag on it to go there.
 */
function CanvasPeek({ project, t, k, vz, size, kFit, setVz }: { project: Project; t: number; k: number; vz: { z: number; x: number; y: number }; size: { w: number; h: number }; kFit: number; setVz: (v: { z: number; x: number; y: number }) => void }) {
  const M = 104, s = M / Math.max(project.width, project.height);
  const mw = project.width * s, mh = project.height * s;
  // where the canvas sits in the view (it's centred, then moved by vz), and so which part of it is in view
  const left = (size.w - project.width * k) / 2 + vz.x, top = (size.h - project.height * k) / 2 + vz.y;
  const vx0 = (0 - left) / k, vy0 = (0 - top) / k, vx1 = (size.w - left) / k, vy1 = (size.h - top) / k;
  const go = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => {
      const px = Math.min(Math.max((ev.clientX - r.left) / s, 0), project.width), py = Math.min(Math.max((ev.clientY - r.top) / s, 0), project.height);
      // put that point of the canvas in the middle of the view
      setVz({ z: vz.z, x: size.w / 2 - px * k - (size.w - project.width * k) / 2, y: size.h / 2 - py * k - (size.h - project.height * k) / 2 });
    };
    e.preventDefault(); e.stopPropagation(); at(e);
    const mv = (ev: PointerEvent) => at(ev);
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  void kFit;
  const items = project.items.filter((it) => it.kind !== "audio" && it.kind !== "camera" && t >= it.start && t < it.end);
  return (
    <div className="peek" style={{ width: mw, height: mh, background: project.background }} onPointerDown={go} title="Where you are on the canvas · tap or drag to go somewhere">
      {items.map((it) => {
        const st = itemState(project, it, t);
        if (!st.visible) return null;
        const w = Math.max(2, it.w * Math.abs(st.scale) * s), h = Math.max(2, it.h * Math.abs(st.scale) * s);
        const fill = /^#[0-9a-f]{3,8}$/i.test(it.fill) ? it.fill : it.kind === "text" ? it.color ?? "#888" : "#8a8a8a";
        return <i key={it.id} style={{ left: st.x * s - w / 2, top: st.y * s - h / 2, width: w, height: h, background: fill, opacity: 0.85 * st.opacity, transform: st.rz ? `rotate(${st.rz}deg)` : undefined }} />;
      })}
      <b style={{ left: vx0 * s, top: vy0 * s, width: (vx1 - vx0) * s, height: (vy1 - vy0) * s }} />
    </div>
  );
}
