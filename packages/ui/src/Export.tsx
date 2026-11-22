import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { anim } from "./anim";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { Project } from "@moshion/engine";
import { useStore } from "./store";
import { mixAudio, prepare, renderFrame } from "./render";
import { GifWriter } from "./gif";

type Phase = { k: "setup" } | { k: "run"; frame: number; total: number; step: string } | { k: "done"; url: string; name: string; size: number; secs: number; audio: boolean } | { k: "error"; msg: string };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Render the project frame by frame and encode an H.264 MP4 (with AAC audio when the browser can encode it). */
/** Output shape: the project's own, or another aspect (fitted with bars, or filled and cropped). */
export interface Shape { aspect: "own" | "9:16" | "1:1" | "16:9" | "4:5"; fit: "fit" | "fill" }
function outSize(project: Project, scale: number, sh: Shape): [number, number] {
  if (sh.aspect === "own") return [even(project.width * scale), even(project.height * scale)];
  const [a, b] = sh.aspect.split(":").map(Number), long = Math.max(project.width, project.height) * scale;
  return a >= b ? [even(long), even((long * b) / a)] : [even((long * a) / b), even(long)];
}
/** Draws frames at the output size and shape (reframing with bars or cropping when the shape differs). */
async function makeFramer(project: Project, W: number, H: number, sh: Shape, transparent = false) {
  if (sh.aspect === "own") {
    const rs = await prepare(project, W, H); rs.transparent = transparent;
    return (out: HTMLCanvasElement, t: number) => renderFrame(out, project, t, rs);
  }
  const k = sh.fit === "fit" ? Math.min(W / project.width, H / project.height) : Math.max(W / project.width, H / project.height);
  const iw = even(project.width * k), ih = even(project.height * k);
  const rs = await prepare(project, iw, ih); rs.transparent = transparent;
  const tmp = document.createElement("canvas"); tmp.width = iw; tmp.height = ih;
  return async (out: HTMLCanvasElement, t: number) => {
    await renderFrame(tmp, project, t, rs);
    const g = out.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    if (!transparent) { g.fillStyle = /^#/.test(project.background) ? project.background : "#000"; g.fillRect(0, 0, W, H); }
    g.drawImage(tmp, (W - iw) / 2, (H - ih) / 2);
  };
}

async function exportMP4(project: Project, scale: number, onProgress: (f: number, n: number, step: string) => void, cancelled: () => boolean, range: [number, number] = [0, project.duration], sh: Shape = { aspect: "own", fit: "fit" }, quality = 1) {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser can't encode video. Use Chrome or Edge, or the desktop app.");
  const [W, H] = outSize(project, scale, sh), fps = project.fps;
  const [ra, rb] = range;
  const total = Math.max(1, Math.round((rb - ra) * fps));
  const bitrate = Math.round(Math.min(60e6, Math.max(2e6, W * H * fps * 0.12 * quality)));
  let codec = "";
  for (const c of ["avc1.640033", "avc1.640028", "avc1.4d0028", "avc1.42003e"]) {
    const ok = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: fps }).catch(() => null);
    if (ok?.supported) { codec = c; break; }
  }
  if (!codec) throw new Error(`This browser can't encode ${W}×${H} H.264. Try the half size.`);

  onProgress(0, total, "Mixing audio");
  const audio = await mixAudio(project).catch(() => null);
  let audioOk = false;
  if (audio && typeof AudioEncoder !== "undefined") {
    const s = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: audio.sampleRate, numberOfChannels: 2, bitrate: 192000 }).catch(() => null);
    audioOk = !!s?.supported;
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: "in-memory",
    video: { codec: "avc", width: W, height: H, frameRate: fps },
    ...(audioOk ? { audio: { codec: "aac" as const, numberOfChannels: 2, sampleRate: audio!.sampleRate } } : {}),
  });
  let failure: Error | null = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e as Error; } });
  venc.configure({ codec, width: W, height: H, bitrate, framerate: fps, latencyMode: "quality" });

  onProgress(0, total, "Loading media");
  const frame = await makeFramer(project, W, H, sh);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  for (let i = 0; i < total; i++) {
    if (cancelled()) { venc.close(); throw new Error("cancelled"); }
    if (failure) throw failure;
    await frame(canvas, ra + i / fps);
    const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 3 === 0) { onProgress(i, total, "Rendering"); await new Promise((r) => setTimeout(r, 0)); }
  }
  onProgress(total, total, "Finishing");
  await venc.flush();
  venc.close();

  if (audioOk && audio) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e as Error; } });
    aenc.configure({ codec: "mp4a.40.2", sampleRate: audio.sampleRate, numberOfChannels: 2, bitrate: 192000 });
    const a0 = Math.floor(ra * audio.sampleRate), a1 = Math.min(audio.length, Math.ceil(rb * audio.sampleRate));
    const L = audio.getChannelData(0).subarray(a0, a1), R = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).subarray(a0, a1);
    const N = 1024;
    for (let s = 0; s < L.length; s += N) {
      const n = Math.min(N, L.length - s), buf = new Float32Array(n * 2);
      buf.set(L.subarray(s, s + n), 0); buf.set(R.subarray(s, s + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((s * 1e6) / audio.sampleRate), data: buf });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
  }
  if (failure) throw failure;
  muxer.finalize();
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), audio: audioOk };
}

/** Animated GIF (up to 25 fps), same frames as the video. */
async function exportGIF(project: Project, scale: number, range: [number, number], onProgress: (f: number, n: number, step: string) => void, cancelled: () => boolean, sh: Shape = { aspect: "own", fit: "fit" }) {
  const [W, H] = outSize(project, scale, sh), fps = Math.min(project.fps, 25);
  const [ra, rb] = range, total = Math.max(1, Math.round((rb - ra) * fps));
  onProgress(0, total, "Loading media");
  const frame = await makeFramer(project, W, H, sh);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const gif = new GifWriter(W, H);
  for (let i = 0; i < total; i++) {
    if (cancelled()) throw new Error("cancelled");
    await frame(canvas, ra + i / fps);
    gif.add(g.getImageData(0, 0, W, H).data, 100 / fps);
    if (i % 2 === 0) { onProgress(i, total, "Rendering GIF"); await new Promise((r) => setTimeout(r, 0)); }
  }
  return gif.finish();
}

/** Every frame as a PNG with a see-through background, in one .zip (for putting over other video). */
async function exportPNGs(project: Project, scale: number, range: [number, number], onProgress: (f: number, n: number, step: string) => void, cancelled: () => boolean, sh: Shape) {
  const [W, H] = outSize(project, scale, sh), fps = project.fps;
  const [ra, rb] = range, total = Math.max(1, Math.round((rb - ra) * fps));
  onProgress(0, total, "Loading media");
  const frame = await makeFramer(project, W, H, sh, true);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const zip = new ZipWriter();
  for (let i = 0; i < total; i++) {
    if (cancelled()) throw new Error("cancelled");
    await frame(canvas, ra + i / fps);
    const b = await new Promise<Blob>((res) => canvas.toBlob((x) => res(x!), "image/png"));
    zip.add(`frame_${String(i).padStart(5, "0")}.png`, new Uint8Array(await b.arrayBuffer()));
    if (i % 2 === 0) { onProgress(i, total, "Rendering frames"); await new Promise((r) => setTimeout(r, 0)); }
  }
  return zip.finish();
}

/** A minimal .zip writer (files stored as they are, which suits PNGs). */
class ZipWriter {
  private parts: Uint8Array[] = []; private dir: Uint8Array[] = []; private off = 0;
  private static table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  private crc(d: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = ZipWriter.table[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  add(name: string, data: Uint8Array) {
    const nm = new TextEncoder().encode(name), crc = this.crc(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, this.off, true);
    this.parts.push(new Uint8Array(h.buffer), nm, data);
    this.dir.push(new Uint8Array(c.buffer), nm);
    this.off += 30 + nm.length + data.length;
  }
  finish(): Blob {
    const size = this.dir.reduce((a, b) => a + b.length, 0), n = this.dir.length / 2;
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, n, true); e.setUint16(10, n, true); e.setUint32(12, size, true); e.setUint32(16, this.off, true);
    return new Blob([...this.parts, ...this.dir, new Uint8Array(e.buffer)] as BlobPart[], { type: "application/zip" });
  }
}

/** The frame under the playhead as a PNG picture. */
async function exportPNG(project: Project, scale: number, t: number) {
  const W = Math.round(project.width * scale), H = Math.round(project.height * scale);
  const rs = await prepare(project, W, H);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  await renderFrame(c, project, t, rs);
  return new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
}

export function ExportDialog() {
  const open = useStore((s) => s.ui.exporting);
  const project = useStore((s) => s.project);
  const { setUI } = useStore.getState();
  const [scale, setScale] = useState(1);
  const [format, setFormat] = useState<"mp4" | "gif" | "zip">("mp4");
  const [shape, setShape] = useState<Shape>({ aspect: "own", fit: "fit" });
  const [quality, setQuality] = useState(1);
  const [copied, setCopied] = useState(false);
  const chapters = (useStore.getState().project.markers ?? []).filter((m) => m.chapter).sort((a, b) => a.t - b.t);
  const loop = useStore((s) => s.ui.loop);
  const [rangeKind, setRangeKind] = useState<"all" | "loop" | "custom">("all");
  const [custom, setCustom] = useState<[number, number]>([0, 0]);
  const [phase, setPhase] = useState<Phase>({ k: "setup" });
  const cancel = useRef(false);
  const t0 = useRef(0);
  useEffect(() => { if (open) { setPhase({ k: "setup" }); cancel.current = false; } }, [open]);
  if (!open) return null;

  const base = project.name.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim() || "inertia";
  const name = `${base}${format === "zip" ? " frames" : ""}.${format}`;
  const range: [number, number] = rangeKind === "loop" && loop ? [loop.a, Math.min(loop.b, project.duration)]
    : rangeKind === "custom" ? [Math.max(0, Math.min(custom[0], project.duration)), Math.max(0, Math.min(custom[1] || project.duration, project.duration))] : [0, project.duration];
  const close = () => { if (phase.k === "run") return; if (phase.k === "done") URL.revokeObjectURL(phase.url); setUI({ exporting: false }); };
  const start = async () => {
    cancel.current = false; t0.current = performance.now();
    useStore.setState({ playing: false });
    setPhase({ k: "run", frame: 0, total: 1, step: "Starting" });
    try {
      const prog = (frame: number, total: number, step: string) => setPhase({ k: "run", frame, total, step });
      const { blob, audio } = format === "gif"
        ? { blob: await exportGIF(project, scale, range, prog, () => cancel.current, shape), audio: false }
        : format === "zip" ? { blob: await exportPNGs(project, scale, range, prog, () => cancel.current, shape), audio: false }
        : await exportMP4(project, scale, prog, () => cancel.current, range, shape, quality);
      const url = URL.createObjectURL(blob);
      setPhase({ k: "done", url, name, size: blob.size, secs: (performance.now() - t0.current) / 1000, audio });
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    } catch (e) {
      const msg = (e as Error).message;
      setPhase(msg === "cancelled" ? { k: "setup" } : { k: "error", msg });
    }
  };
  const [W, H] = outSize(project, scale, shape);
  const frames = Math.round((range[1] - range[0]) * (format === "gif" ? Math.min(project.fps, 25) : project.fps));
  const savePNG = async () => {
    const b = await exportPNG(project, scale, useStore.getState().t);
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${base} ${useStore.getState().t.toFixed(2)}s.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <motion.div {...anim.fade} className="xback" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <motion.div {...anim.sheet} className="xbox">
        <div className="xhead"><b>Export</b><span className="sp" />{phase.k !== "run" && <button className="xclose" onClick={close} aria-label="Close">×</button>}</div>
        {phase.k === "setup" || phase.k === "error" ? (
          <>
            <div className="xrow"><span>Format</span>
              <span className="gseg2">{([["mp4", "MP4 video"], ["gif", "GIF"], ["zip", "See-through PNGs"]] as const).map(([v, l]) => <button key={v} className={format === v ? "on" : ""} onClick={() => setFormat(v)}>{l}</button>)}</span>
            </div>
            {format === "zip" && <div className="xrow"><span /><span className="hint" style={{ margin: 0 }}>Every frame as a PNG with no background, in a .zip, to lay over other video.</span></div>}
            <div className="xrow"><span>Shape</span>
              <span className="gseg2">{([["own", "As made"], ["9:16", "9:16"], ["1:1", "1:1"], ["4:5", "4:5"], ["16:9", "16:9"]] as const).map(([v, l]) => <button key={v} className={shape.aspect === v ? "on" : ""} onClick={() => setShape({ ...shape, aspect: v })}>{l}</button>)}</span>
            </div>
            {shape.aspect !== "own" && <div className="xrow"><span>Reframe</span>
              <span className="gseg2"><button className={shape.fit === "fit" ? "on" : ""} onClick={() => setShape({ ...shape, fit: "fit" })}>Fit (bars)</button><button className={shape.fit === "fill" ? "on" : ""} onClick={() => setShape({ ...shape, fit: "fill" })}>Fill (crop)</button></span>
            </div>}
            {format === "mp4" && <div className="xrow"><span>Quality</span>
              <span className="gseg2">{([[0.5, "Smaller file"], [1, "Standard"], [2, "Best"]] as const).map(([v, l]) => <button key={v} className={quality === v ? "on" : ""} onClick={() => setQuality(v)}>{l}</button>)}</span>
            </div>}
            <div className="xrow"><span>Part</span>
              <span className="gseg2">
                <button className={rangeKind === "all" ? "on" : ""} onClick={() => setRangeKind("all")}>Whole video</button>
                {loop && <button className={rangeKind === "loop" ? "on" : ""} onClick={() => setRangeKind("loop")}>Loop region</button>}
                <button className={rangeKind === "custom" ? "on" : ""} onClick={() => { setRangeKind("custom"); if (!custom[1]) setCustom([0, project.duration]); }}>From – to</button>
              </span>
            </div>
            {rangeKind === "custom" && (
              <div className="xrow"><span>Seconds</span>
                <span className="hsize">
                  <input type="number" step={0.1} min={0} value={custom[0]} onChange={(e) => setCustom([+e.target.value, custom[1]])} /> to
                  <input type="number" step={0.1} min={0} value={custom[1]} onChange={(e) => setCustom([custom[0], +e.target.value])} />
                </span>
              </div>
            )}
            <div className="xrow"><span>Size</span>
              <span className="gseg2">{[[1, "Full"], [0.5, "Half"]].map(([v, l]) => <button key={v} className={scale === v ? "on" : ""} onClick={() => setScale(v as number)}>{l}</button>)}</span>
            </div>
            <div className="xrow"><span>Output</span><b className="mono">{W}×{H} · {format === "gif" ? Math.min(project.fps, 25) : project.fps} fps · {(range[1] - range[0]).toFixed(1)}s · {frames} frames</b></div>
            {phase.k === "error" && <div className="xerr">{phase.msg}</div>}
            <button className="hcreate xgo" onClick={start}>Export {format === "gif" ? "GIF" : format === "zip" ? "frames" : "video"}</button>
            <button className="hlink" style={{ alignSelf: "center" }} onClick={savePNG}>Save the frame at the playhead as a picture (PNG)</button>
            {chapters.length > 0 && <button className="hlink" style={{ alignSelf: "center" }} onClick={() => {
              const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
              const lines = [...(chapters[0].t > 0.5 ? ["0:00 Start"] : []), ...chapters.map((c) => `${fmt(c.t)} ${c.label}`)];
              navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
            }}>{copied ? "Chapters copied ✓" : `Copy ${chapters.length} chapter${chapters.length === 1 ? "" : "s"} (for YouTube descriptions)`}</button>}
          </>
        ) : phase.k === "run" ? (
          <>
            <div className="xbar"><i style={{ width: `${(phase.frame / phase.total) * 100}%` }} /></div>
            <div className="xrow"><span>{phase.step}</span><b className="mono">{phase.frame} / {phase.total}</b></div>
            <button className="hlink xcancel" onClick={() => { cancel.current = true; }}>Cancel</button>
          </>
        ) : (
          <>
            <div className="xdone">Saved <b>{phase.name}</b></div>
            <div className="xrow"><span>{(phase.size / 1e6).toFixed(1)} MB · took {phase.secs.toFixed(1)}s</span><span>{phase.audio ? "with sound" : "no sound"}</span></div>
            {phase.name.endsWith(".zip") ? <p className="hint">Unzip it and use the frames as an image sequence in any editor.</p> : phase.name.endsWith(".gif") ? <img className="xprev" src={phase.url} alt="" style={{ objectFit: "contain" }} /> : <video className="xprev" src={phase.url} controls />}
            <a className="hcreate xgo" href={phase.url} download={phase.name}>Download again</a>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
