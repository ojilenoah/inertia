/*
 * The video engine: frames decoded by the app itself (WebCodecs, with Mediabunny reading the file) instead of seeking
 * a <video> element. Every frame is the exact one for its time, the same in the editor, the export and the tracker.
 *  - frameAt: one frame (random access, cached) — the editor's paused picture and scrubbing
 *  - Reader: frames in order, decoding each only once — export and tracking
 *  - thumbs: small frames for the timeline's filmstrips
 * Where the browser can't decode a file (no WebCodecs, or a codec it doesn't have) everything returns null and the
 * callers keep using a <video> element.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack, type WrappedCanvas } from "mediabunny";
import { mediaBlob } from "./media";

export type FrameImage = HTMLCanvasElement | OffscreenCanvas;
export interface Frame { img: FrameImage; w: number; h: number; /** start time in the file (s) */ t: number; /** how long it shows (s) */ d: number }

const toFrame = (c: WrappedCanvas): Frame => ({ img: c.canvas, w: c.canvas.width, h: c.canvas.height, t: c.timestamp, d: Math.max(1e-3, c.duration || 1 / 30) });
const covers = (f: Frame, t: number) => t >= f.t - 1e-4 && t < f.t + f.d - 1e-4;

/** A small cache of decoded frames (most recently used last). */
class FrameCache {
  private list: Frame[] = [];
  constructor(private max: number) {}
  get(t: number): Frame | null {
    const i = this.list.findIndex((f) => covers(f, t));
    if (i < 0) return null;
    const f = this.list[i];
    this.list.splice(i, 1); this.list.push(f);
    return f;
  }
  put(f: Frame) {
    if (this.list.some((x) => Math.abs(x.t - f.t) < 1e-5)) return;
    this.list.push(f);
    if (this.list.length > this.max) this.list.shift();
  }
}

export class VideoSource {
  readonly w: number; readonly h: number; readonly dur: number;
  private sinks = new Map<string, CanvasSink>();
  private caches = new Map<string, FrameCache>();
  constructor(private input: Input, private track: InputVideoTrack, dur: number) {
    this.w = track.displayWidth; this.h = track.displayHeight; this.dur = dur;
  }
  /** Output size for frames no bigger than `maxSide` on their longer side (never bigger than the video). */
  size(maxSide: number): [number, number] {
    const k = Math.min(1, maxSide / Math.max(this.w, this.h));
    return [Math.max(2, Math.round((this.w * k) / 2) * 2), Math.max(2, Math.round((this.h * k) / 2) * 2)];
  }
  sink(maxSide: number): CanvasSink {
    const [w, h] = this.size(maxSide), key = `${w}x${h}`;
    let s = this.sinks.get(key);
    if (!s) { s = new CanvasSink(this.track, { width: w, height: h, fit: "fill" }); this.sinks.set(key, s); }
    return s;
  }
  cache(maxSide: number, max = 36): FrameCache {
    const [w, h] = this.size(maxSide), key = `${w}x${h}`;
    let c = this.caches.get(key);
    if (!c) { c = new FrameCache(max); this.caches.set(key, c); }
    return c;
  }
  /** The frame showing at time `t` (seconds into the file). */
  async frameAt(t: number, maxSide: number): Promise<Frame | null> {
    const tt = this.clamp(t), cache = this.cache(maxSide);
    const hit = cache.get(tt);
    if (hit) return hit;
    const c = await this.sink(maxSide).getCanvas(tt).catch(() => null);
    if (!c) return null;
    const f = toFrame(c);
    cache.put(f);
    return f;
  }
  clamp(t: number) { return Math.min(Math.max(0, t), Math.max(0, this.dur - 1e-3)); }
  close() { this.input.dispose(); }
}

const sources = new Map<string, Promise<VideoSource | null>>();
/** The engine's view of a video asset; null when this browser can't decode it (use a <video> element then). */
export function videoSource(id: string | undefined): Promise<VideoSource | null> {
  if (!id || typeof VideoDecoder === "undefined") return Promise.resolve(null);
  let p = sources.get(id);
  if (!p) {
    p = (async () => {
      const blob = await mediaBlob(id);
      if (!blob) return null;
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) { input.dispose(); return null; }
      const dur = await track.computeDuration().catch(() => 0);
      return new VideoSource(input, track, dur || (await input.computeDuration().catch(() => 0)));
    })().catch(() => null);
    sources.set(id, p);
    // a file that couldn't be read (not imported yet): try again next time
    p.then((s) => { if (!s) setTimeout(() => sources.delete(id), 3000); });
  }
  return p;
}

/**
 * Asks for frames as the playhead moves and hands back the newest one: while a frame is being decoded, only the
 * latest wanted time is kept, so scrubbing stays responsive however fast the playhead moves.
 */
export class FrameLane {
  private pending: number | null = null;
  private running = false;
  private dead = false;
  constructor(private src: VideoSource, private maxSide: number, private deliver: (f: Frame, wanted: number) => void) {}
  request(t: number) {
    if (this.dead) return;
    const hit = this.src.cache(this.maxSide).get(this.src.clamp(t));
    if (hit) { this.pending = null; this.deliver(hit, t); return; }
    this.pending = t;
    if (!this.running) void this.run();
  }
  private async run() {
    this.running = true;
    while (this.pending != null && !this.dead) {
      const t = this.pending; this.pending = null;
      const f = await this.src.frameAt(t, this.maxSide);
      if (f && !this.dead && (this.pending == null || covers(f, this.src.clamp(this.pending)))) this.deliver(f, t);
    }
    this.running = false;
  }
  stop() { this.dead = true; this.pending = null; }
}

/**
 * Frames in time order, each decoded once (export, tracking). Jumping back, or far ahead, starts again from the
 * nearest key frame.
 */
export class Reader {
  private it: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private cur: Frame | null = null;
  private next: Frame | null = null;
  private done = false;
  constructor(readonly src: VideoSource, private maxSide: number) {}
  async at(t: number): Promise<Frame | null> {
    const tt = this.src.clamp(t);
    if (this.cur && covers(this.cur, tt)) return this.cur;
    if (!this.it || !this.cur || tt < this.cur.t - 1e-4 || tt > this.cur.t + 2) await this.restart(tt);
    else if (!this.next && !this.done) await this.pull();
    // step forward until the frame showing at tt
    while (this.next && this.next.t <= tt + 1e-4) { this.cur = this.next; this.next = null; await this.pull(); }
    return this.cur;
  }
  private async restart(t: number) {
    await this.it?.return(undefined).catch(() => {});
    this.it = this.src.sink(this.maxSide).canvases(t);
    this.done = false; this.cur = null; this.next = null;
    await this.pull();
    this.cur = this.next; this.next = null;
    if (this.cur) await this.pull();
  }
  private async pull() {
    if (!this.it || this.done) return;
    const r = await this.it.next().catch(() => ({ done: true as const, value: undefined }));
    if (r.done || !r.value) { this.done = true; this.next = null; return; }
    this.next = toFrame(r.value); // a sink without a pool hands out a new canvas each time, so it can be kept
  }
  async close() { await this.it?.return(undefined).catch(() => {}); this.it = null; }
}

/* ---------------- filmstrip thumbnails ---------------- */
const thumbCache = new Map<string, Frame>();
const THUMB_STEP = 0.25; // thumbnails are kept for every quarter second of the file
/**
 * Small frames (height `h`) for each time in `times` (seconds into the file), decoded in one sorted pass.
 * Calls `got` as each arrives; times are rounded to a quarter second so neighbouring clips and zoom levels share them.
 */
export async function thumbs(id: string, times: number[], h: number, got: (t: number, f: Frame) => void, alive: () => boolean) {
  const src = await videoSource(id);
  if (!src || !alive()) return false;
  const maxSide = Math.round(h * Math.max(1, src.w / src.h));
  const key = (t: number) => `${id}|${maxSide}|${t}`;
  const want = [...new Set(times.map((t) => Math.round(src.clamp(t) / THUMB_STEP) * THUMB_STEP))].sort((a, b) => a - b);
  const todo: number[] = [];
  for (const t of want) { const f = thumbCache.get(key(t)); if (f) got(t, f); else todo.push(t); }
  if (!todo.length) return true;
  const sink = src.sink(maxSide);
  let i = 0;
  for await (const c of sink.canvasesAtTimestamps(todo)) {
    if (!alive()) break;
    const t = todo[i++];
    if (!c) continue;
    const f = toFrame(c);
    thumbCache.set(key(t), f);
    got(t, f);
  }
  if (thumbCache.size > 1500) { const ks = [...thumbCache.keys()].slice(0, 500); ks.forEach((k) => thumbCache.delete(k)); }
  return true;
}
export const thumbTime = (t: number) => Math.round(t / THUMB_STEP) * THUMB_STEP;
