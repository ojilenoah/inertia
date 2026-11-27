export type Seconds = number;

/** Animatable properties of every visual item. */
export type Prop = "x" | "y" | "z" | "rx" | "ry" | "rz" | "scale" | "opacity";
export const PROPS: Prop[] = ["x", "y", "z", "rx", "ry", "rz", "scale", "opacity"];

export const PROP_LABEL: Record<Prop, string> = {
  x: "Position X", y: "Position Y", z: "Position Z",
  rx: "Rotation X", ry: "Rotation Y", rz: "Rotation Z",
  scale: "Scale", opacity: "Opacity",
};

/** cubic-bezier(x1, y1, x2, y2) */
export type Bezier = [number, number, number, number];
export type EaseName = "linear" | "ease" | "easeIn" | "easeOut" | "smooth" | "expo" | "back" | "hold" | "wiggle";
export type Ease = EaseName | Bezier;

/** `ease` shapes the segment that LEAVES this key. */
export interface Keyframe {
  t: Seconds;
  v: number;
  ease: Ease;
}

export type Keys = Partial<Record<Prop, Keyframe[]>>;

export type ItemKind = "rect" | "ellipse" | "star" | "text" | "image" | "glass" | "audio" | "video" | "motion" | "shape" | "line" | "camera" | "chart" | "particles";
/** Something imported into the project's Media: pictures inline, video/audio by id (stored locally). */
/** Every CSS blend mode, grouped the way design apps show them. */
export const BLEND_GROUPS: [string, [BlendMode, string][]][] = [
  ["", [["normal", "Normal"]]],
  ["Darken", [["darken", "Darken"], ["multiply", "Multiply"], ["color-burn", "Color burn"]]],
  ["Lighten", [["lighten", "Lighten"], ["screen", "Screen"], ["color-dodge", "Color dodge"], ["plus-lighter", "Add"]]],
  ["Contrast", [["overlay", "Overlay"], ["soft-light", "Soft light"], ["hard-light", "Hard light"]]],
  ["Invert", [["difference", "Difference"], ["exclusion", "Exclusion"]]],
  ["Colour", [["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"], ["luminosity", "Luminosity"]]],
];
export type BlendMode =
  | "normal" | "darken" | "multiply" | "color-burn" | "lighten" | "screen" | "color-dodge" | "plus-lighter"
  | "overlay" | "soft-light" | "hard-light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";
export interface Asset { id: string; name: string; kind: "image" | "video" | "audio"; url?: string; w?: number; h?: number; dur?: number }

/**
 * Motion tracking on a video clip: one point, or four corners (top-left, top-right, bottom-right, bottom-left), found
 * frame by frame. Kept in the file's own terms, so trimming, splitting, speed and resizing the clip never break it:
 * `t` is seconds into the file, positions are fractions of the frame (0..1, left/top = 0).
 */
export interface Tracker {
  id: string;
  name: string;
  n: 1 | 4;
  pts: { t: Seconds; p: [number, number][] }[];
}

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  trackId: string;
  start: Seconds;
  end: Seconds;
  /** Size in project pixels. Position (base.x/base.y) is the item's centre. */
  w: number;
  h: number;
  /** CSS background: a colour, gradient, or `url(...)` once an image is placed in the shape. */
  fill: string;
  radius?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  /** Timeline clip colour. */
  tint: string;
  base: Record<Prop, number>;
  /** Text: letters / words / lines animate one by one. */
  textAnim?: import("./textanim").TextAnim;
  /** Video/audio: the Media asset it plays. */
  src?: string;
  /** Video/audio: seconds into the file where this item starts (changes when trimmed or split). */
  mediaOffset?: number;
  /** Video: points followed through the clip (motion tracking). See Tracker. */
  trackers?: Tracker[];
  /** Item keys: `t` is relative to the item's start, so moving the item moves its animation. */
  keys: Keys;
  fontWeight?: number;
  /** Letter spacing in em. */
  letterSpacing?: number;
  fontFamily?: string;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  textCase?: "none" | "uppercase" | "lowercase" | "capitalize";
  /** Box behind the text (CSS colour, or undefined for none). */
  textBg?: string;
  /** Padding inside the text background box, px. */
  textPad?: number;
  /** Outline around the letters (text) or the shape (other items). */
  stroke?: { width: number; color: string };
  /** Text: wrap inside a fixed width (`w`) instead of growing to fit one line per line. */
  wrap?: boolean;
  wordSpacing?: number;
  /** Text: gradient fill instead of a solid colour. */
  textGradient?: { from: string; to: string; angle: number };
  /** Text filled with a picture or a video (shown through the letters). */
  textFill?: { kind: "image" | "video"; url?: string; src?: string; zoom?: number };
  /** Stacking on top of the track order: higher is further in front. It can change at keyframes (it holds until the next one). */
  layer?: number;
  layerKeys?: { t: Seconds; v: number }[];
  /** Sound & video clips: playback speed (1 = normal), played backwards, loudness (1 = as recorded; keyframable), fades, and dipping under other sounds. */
  speed?: number;
  reverse?: boolean;
  volume?: number;
  fadeIn?: Seconds;
  fadeOut?: Seconds;
  duck?: boolean;
  /** Motion blur (0 = off, 1 = strong): fast movement leaves a soft trail. */
  motionBlur?: number;
  /** A gradient fill (kept so it can be edited; the fill itself is the CSS gradient). */
  fillGrad?: { type: "linear" | "radial"; angle: number; stops: string[] };
  /** Text tricks: count a number up, unscramble the letters, or a blinking typing cursor. */
  /** Follows another item: moves, turns and grows with it (measured from where both were when linked). */
  /** auto: made by a mask ("Takes this along") — goes away with the mask. */
  parentLink?: { id: string; x0: number; y0: number; rz0: number; s0: number; auto?: boolean };
  /** A chart drawn from numbers. */
  chart?: import("./extraitems").ChartSpec;
  /** A particle effect (confetti, sparks, snow, dust). */
  particles?: import("./extraitems").ParticleSpec;
  /** A property driven by another: `prop` changes by (source's change since its start) × amount. */
  links?: { prop: Prop; src: string; srcProp: Prop; amount: number }[];
  textFx?: { kind: "count" | "scramble" | "cursor"; from?: number; to?: number; decimals?: number; prefix?: string; suffix?: string; dur?: Seconds };
  /** Text: drop shadow behind the letters. */
  textShadow?: { x: number; y: number; blur: number; color: string };
  /** Opacity of the text background box, 0..1. */
  bgOpacity?: number;
  /** Image placed inside a shape: offset in % of the shape, and zoom (1 = as fitted). */
  imgX?: number;
  imgY?: number;
  imgZoom?: number;
  /** How an image sits inside its frame. */
  fit?: "cover" | "contain";
  /** CSS mix-blend-mode. */
  blend?: BlendMode;
  /** Per-item look effects. */
  look?: Look;
  /** Which lane of its track the item sits in (0 = top). */
  lane?: number;
  /** Only show this item inside another item's shape (or outside it, inverted). */
  /** Clip to another item's shape. `inside`: placed inside it (the container stays visible); otherwise the mask item is hidden. */
  mask?: { by: string; invert?: boolean; inside?: boolean;
    /** true: moving the mask on the canvas leaves this item where it is (by default it moves along with its mask). */
    free?: boolean;
    /** What clips: its shape (default), or one of its edges — this item is hidden only past that edge (it goes "into" the other item there) — or two opposite edges. */
    edge?: "shape" | "top" | "bottom" | "left" | "right" | "width" | "height" | "above" | "below";
    /** A hollow mask shape cuts with its rim (the hole doesn't count) unless this is set: then the whole shape. */
    whole?: boolean;
    /** A hollow mask shape: use its inner edge (the hole) — an edge cut follows the hole's side, a shape cut is the hole. */
    inner?: boolean;
    /** Edge cuts: hidden only while it's in the far half of the shape, then it comes out the other side. */
    through?: boolean };
  /** Draw extra copies, each one offset, turned, scaled, faded and delayed a bit more. */
  repeat?: { count: number; dx: number; dy: number; rotate: number; scale: number; fade: number; delay: number };
  /** Hollow: how thick the rim is (px) when the middle is cut out — the hole is the same shape, rounding and all. 0 = solid. */
  hollow?: number;
  /** Locked: can't be picked or moved on the canvas (unlock from the timeline, the menu or Ctrl+Shift+L). */
  locked?: boolean;
  /** Text: run along this line, motion path or shape's outline. */
  onPath?: string;
  /**
   * How text sits on its path. side: letters on top of the line, centred on it, or hanging under it
   * (outside / on / inside a shape). flip: run the other way. stand: letters stand up off a 3D-tilted shape
   * instead of lying flat in it. far: letters on the far side. (Where along it, and the gap: keyframed numbers.)
   */
  pathText?: { side?: "top" | "middle" | "under"; flip?: boolean; stand?: boolean; far?: "show" | "fade" | "hide"; edge?: "outer" | "inner" };
  /** On a path: how far it's turned round the edge (degrees: 0 lies in the surface, 90 stands up off it). Keyframed in numKeys. */
  pathTilt?: number;
  /** A path made with this version: its rx/ry/rz/scale are the path's own turn, tilt and size (node turns live in numKeys.turn). */
  pathV2?: boolean;
  /** A path's turning point (set once it's turned, tilted or sized, so editing its nodes doesn't shift it). */
  pivot?: [number, number];
  /** Extra settings for the look sliders: glow colour and strength, shadow colour / offset / softness, 3D depth colour and direction. */
  lookOpts?: { glowColor?: string; glowPower?: number; shadowColor?: string; shadowOpacity?: number; shadowX?: number; shadowY?: number; shadowSoft?: number; depthColor?: string; depthAngle?: number };
  /** Keep width and height in proportion when resizing. */
  lockRatio?: boolean;
  /** Keyframes for number settings (font size, letter spacing, corners, offset along a line). */
  numKeys?: Partial<Record<import("./morph").NumKey, Keyframe[]>>;
  /** Keyframes for colours (text colour, fill, border). */
  colorKeys?: Partial<Record<import("./morph").ColorKey, { t: Seconds; v: string }[]>>;
  /** Text: letters with their own colour (start..end, end exclusive), which can change at keyframes too. */
  textRanges?: { id: string; start: number; end: number; color: string; keys?: { t: Seconds; v: string }[] }[];
  /** Item effects (shiny edges, glass, glitch…), applied in order. */
  fx?: import("./itemfx").ItemFx[];
  /** kind "shape": which shape and its settings. */
  shape?: import("./shapes").ShapeSpec;
  /** Shape keyframes: the shape changes between them (morphing). */
  shapeKeys?: { t: Seconds; spec: import("./shapes").ShapeSpec }[];
  /** kind "line": the drawn line and its style. */
  line?: import("./shapes").LineSpec;
  /** Motion clip: a drawn line for each keyframe block (local times a → b). */
  strokes?: import("./motion").Stroke[];
  /** Follow a motion clip's path. */
  follow?: import("./motion").Follow;
  /** Keyframes for the look (blur, glow, shadow, depth); `look` is the value with no keyframes. */
  lookKeys?: Partial<Record<keyof Look, Keyframe[]>>;
  /** Text keyframes: the wording changes between them (letters fade out / in). */
  textKeys?: { t: Seconds; text: string }[];
  /** How the text changes from one text keyframe to the next (default: smooth). */
  textMorph?: import("./morph").TextMorphKind;
  /** Corner pin: each corner's offset (px, in the item's own frame) — the item warps in perspective to fit. Keyframed in numKeys. */
  /** Corner pin on a shape: "shape" reshapes its outline (and border) to the corners instead of a perspective warp. */
  pinMode?: "persp" | "shape";
  pin0x?: number; pin0y?: number; pin1x?: number; pin1y?: number; pin2x?: number; pin2y?: number; pin3x?: number; pin3y?: number;
  /** Glass/effect shapes. */
  effect?: { kind: "liquid-glass" | "frost"; magnify: number; blur: number };
  /** Preset animations layered on top of keyframes: entering, leaving, and for the whole life of the item. */
  anim?: ItemAnim;
}

export type InOutKind = "fade" | "slideUp" | "slideDown" | "slideLeft" | "slideRight" | "scale" | "pop" | "blur" | "rotate" | "flip" | "zoom" | "typewriter";
export type LoopKind = "float" | "pulse" | "spin" | "sway" | "wiggle" | "breathe" | "drift" | "kenburns";
/**
 * An In or Out. `at`: for In, seconds after the item starts before it begins; for Out, seconds
 * before the item ends that it finishes. With `unit` (text only) it moves letter by letter /
 * word by word / line by line and `kind` is a text animation.
 */
export interface AnimStep {
  kind: InOutKind | import("./textanim").TextAnimKind;
  dur: number;
  at?: number;
  unit?: import("./textanim").TextUnit;
  stagger?: number;
}
export interface ItemAnim {
  in?: AnimStep;
  out?: AnimStep;
  /** Runs for the item's whole lifetime. speed = cycles per second, amount 0..2. With `unit`, a text loop. */
  loop?: { kind: LoopKind | import("./textanim").TextLoopKind; speed: number; amount: number; unit?: import("./textanim").TextUnit };
}
export const IN_OUT_LABEL: Record<InOutKind, string> = {
  fade: "Fade", slideUp: "Slide up", slideDown: "Slide down", slideLeft: "Slide left", slideRight: "Slide right",
  scale: "Scale", pop: "Pop", blur: "Blur", rotate: "Rotate", flip: "Flip 3D", zoom: "Zoom", typewriter: "Typewriter",
};
export const LOOP_LABEL: Record<LoopKind, string> = {
  float: "Float", pulse: "Pulse", spin: "Spin", sway: "Sway", wiggle: "Wiggle", breathe: "Breathe", drift: "Drift", kenburns: "Ken Burns",
};

export interface Look {
  /** 3D extrusion depth in px (stacked layers behind the item). */
  extrude: number;
  shadow: number;
  blur: number;
  glow: number;
  /** Lines: how much of the line is drawn (0..1), for drawing it on over time. */
  draw: number;
  /** Lines: where the drawn part starts (0..1), so a dash can travel along the line. */
  drawStart: number;
}
export const NO_LOOK: Look = { extrude: 0, shadow: 0, blur: 0, glow: 0, draw: 1, drawStart: 0 };

/**
 * video: a normal track, carries any visual item.
 * group: wraps normal tracks; its own keys move everything inside it.
 * audio: sound only.
 * (The canvas track is not in this list: every project has exactly one, always
 *  drawn as the last row, under the audio tracks. It carries the scene effects.)
 */
export type TrackKind = "video" | "audio" | "group";

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  /** Set on tracks nested inside a group track. */
  parent?: string;
  open?: boolean;
  /**
   * Group keys (absolute time). Offsets applied on top of every child item:
   * x/y/z/rotations add, scale/opacity multiply.
   */
  keys?: Keys;
  /** Lanes inside the track (stacked rows), each can be hidden or locked. */
  lanes?: { hidden?: boolean; locked?: boolean }[];
  /** Group: a mask for all of its items together (same settings as an item's mask). */
  mask?: Item["mask"];
  /** Group: offsets that apply all the time (used until the group gets keyframes). */
  base?: Partial<Record<Prop, number>>;
  muted?: boolean;
  locked?: boolean;
  /** A group can have a parent too (its mask, when the mask takes it along): the whole group moves, turns and grows with it. */
  parentLink?: Item["parentLink"];
}

export interface Transition {
  id: string;
  trackId: string;
  t: Seconds;
  d: Seconds;
  kind: "morph";
}

export type SceneEffectKind = "grain" | "vhs" | "vignette" | "lensBlur" | "camcorder" | "glitch" | "film" | "chroma";
export const SCENE_EFFECTS: Record<SceneEffectKind, string> = {
  grain: "Film grain", vhs: "VHS scanlines", vignette: "Vignette", lensBlur: "Lens blur",
  camcorder: "Camcorder", glitch: "Glitch", film: "Old film", chroma: "RGB split",
};

export type BgKind = "solid" | "linear" | "radial" | "conic" | "mesh" | "aurora" | "video";
/** A background clip on the canvas track. Cut it to change the background over time. */
export interface Background {
  id: string;
  name: string;
  start: Seconds;
  end: Seconds;
  kind: BgKind;
  colors: string[];
  /** Degrees, for linear/conic. */
  angle: number;
  /** Movement speed; 0 = still. */
  speed: number;
  /** A video background: the media file, its length, and whether it loops (default) or holds its last frame. */
  src?: string;
  mediaDur?: Seconds;
  once?: boolean;
  /** Where this canvas sits on the board (top-left, video pixels). */
  board?: { x: number; y: number };
  /** Its look at the canvas keyframes (absolute times): colours, angle and movement change between them. */
  keys?: { t: Seconds; colors: string[]; angle: number; speed: number }[];
  /** The transition into this canvas from the one before. */
  trans?: import("./board").CanvasTrans;
}

/** An effect clip on the canvas track: applies to the whole frame between start and end. */
export interface SceneEffect {
  id: string;
  kind: SceneEffectKind;
  start: Seconds;
  end: Seconds;
  amount: number; // 0..1
  /** Amount keyframes (absolute times), set on the canvas's keyframes. */
  keys?: { t: Seconds; v: number }[];
  /** Per-look settings (see FX_OPTS); missing ones use their defaults. Sizes are in video pixels. */
  opts?: Record<string, number | string>;
}

export interface FxOpt { key: string; label: string; min?: number; max?: number; step?: number; def: number | string; unit?: string; color?: boolean }
/** The settings each screen look offers. */
export const FX_OPTS: Partial<Record<SceneEffectKind, FxOpt[]>> = {
  grain: [
    { key: "size", label: "Grain size", min: 0.3, max: 4, step: 0.05, def: 1, unit: "×" },
    { key: "speed", label: "Flicker", min: 0, max: 24, step: 1, def: 24, unit: "/s" },
  ],
  vhs: [
    { key: "spacing", label: "Line spacing", min: 4, max: 160, step: 1, def: 20, unit: "px" },
    { key: "thickness", label: "Line thickness", min: 1, max: 80, step: 1, def: 7, unit: "px" },
    { key: "angle", label: "Direction", min: -90, max: 90, step: 1, def: 0, unit: "°" },
    { key: "darkness", label: "Strength", min: 0.02, max: 0.9, step: 0.01, def: 0.09 },
    { key: "scroll", label: "Scroll", min: -300, max: 300, step: 5, def: 0, unit: "px/s" },
    { key: "color", label: "Colour", def: "#000000", color: true },
  ],
  vignette: [
    { key: "size", label: "Clear centre", min: 5, max: 95, step: 1, def: 55, unit: "%" },
    { key: "darkness", label: "Darkness", min: 0.05, max: 1, step: 0.01, def: 0.3 },
    { key: "color", label: "Colour", def: "#000000", color: true },
  ],
  lensBlur: [
    { key: "blur", label: "Blur", min: 2, max: 150, step: 1, def: 34, unit: "px" },
    { key: "clear", label: "Sharp centre", min: 5, max: 95, step: 1, def: 55, unit: "%" },
  ],
};
/** A look's setting, or its default. */
export function fxOpt<T extends number | string>(f: { kind: SceneEffectKind; opts?: Record<string, number | string> }, key: string): T {
  const v = f.opts?.[key];
  if (v != null) return v as T;
  return (FX_OPTS[f.kind]?.find((o) => o.key === key)?.def ?? 0) as T;
}
/** "#rrggbb" + alpha → rgba(). */
export function hexA(hex: string, a: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(0,0,0,${a})`;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: Seconds;
  /** The video ends where the last item ends (default). false = a length you set yourself. */
  autoLength?: boolean;
  background: string;
  tracks: Track[];
  items: Item[];
  transitions: Transition[];
  effects: SceneEffect[];
  /** Background clips on the canvas track; `background` shows where none is active. */
  backgrounds?: Background[];
  /** Effects on the whole frame (same list as item effects). */
  canvasFx?: import("./itemfx").ItemFx[];
  /** The canvas item's keyframes (absolute times): look and effect amounts change between them. */
  canvasKeys?: Seconds[];
  /** The base colour at the canvas keyframes. */
  bgColorKeys?: { t: Seconds; v: string }[];
  /** Named points on the ruler. */
  /** Markers on the timeline: a name, an optional note, and chapters (listed for YouTube etc. when exporting). */
  markers?: { id: string; t: Seconds; label: string; note?: string; chapter?: boolean }[];
  /** Imported pictures, videos and audio. */
  assets?: Asset[];
}

export type ItemState = Record<Prop, number> & {
  visible: boolean;
  /** Extra blur in px from an animation preset. */
  blur?: number;
  /** Share of text characters shown (typewriter), 0..1. */
  reveal?: number;
};
