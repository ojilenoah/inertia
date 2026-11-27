import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { anim } from "./anim";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { Project } from "@moshion/engine";
import { useStore } from "./store";
import { closeSession, mixAudio, prepare, renderFrame, type RenderSession } from "./render";
import { GifWriter } from "./gif";
import { PlayIcon } from "./Icon";
import { exportFolder, hasExportFolder, openSaved, pickExportFolder, saveToExportFolder, shareSaved } from "./exportfolder";

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
/** The last export's render (its video decoders are let go when the next export starts). */
let lastSession: RenderSession | null = null;
async function makeFramer(project: Project, W: number, H: number, sh: Shape, transparent = false) {
  if (lastSession) { await closeSession(lastSession); lastSession = null; }
  if (sh.aspect === "own") {
    const rs = await prepare(project, W, H); rs.transparent = transparent; lastSession = rs;
    return (out: HTMLCanvasElement, t: number) => renderFrame(out, project, t, rs);
  }
  const k = sh.fit === "fit" ? Math.min(W / project.width, H / project.height) : Math.max(W / project.width, H / project.height);
  const iw = even(project.width * k), ih = even(project.height * k);
  const rs = await prepare(project, iw, ih); rs.transparent = transparent; lastSession = rs;
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
  // the Android app: the folder exports go into (chosen on the first start, or right here)
  const [folder, setFolder] = useState(() => exportFolder());
  const [saved, setSaved] = useState<{ uri: string; mime: string } | null>(null);
  const cancel = useRef(false);
  const t0 = useRef(0);
  useEffect(() => { if (open) { setPhase({ k: "setup" }); setSaved(null); setFolder(exportFolder()); cancel.current = false; } }, [open]);
  if (!open) return null;

  const base = project.name.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim() || "inertia";
  const name = `${base}${format === "zip" ? " frames" : ""}.${format}`;
  const range: [number, number] = rangeKind === "loop" && loop ? [loop.a, Math.min(loop.b, project.duration)]
    : rangeKind === "custom" ? [Math.max(0, Math.min(custom[0], project.duration)), Math.max(0, Math.min(custom[1] || project.duration, project.duration))] : [0, project.duration];
  const close = () => { if (phase.k === "run") return; if (phase.k === "done") URL.revokeObjectURL(phase.url); setUI({ exporting: false }); };
  const changeFolder = async () => { const f = await pickExportFolder(); if (f) setFolder(f); return f; };
  const start = async () => {
    // Android: exports go into a folder of the person's choosing: ask for it first if there isn't one yet
    let where = folder;
    if (hasExportFolder() && !where) {
      where = await changeFolder();
      if (!where) { setPhase({ k: "error", msg: "Pick a folder for your exports first, then export." }); return; }
    }
    cancel.current = false; t0.current = performance.now();
    useStore.setState({ playing: false });
    setPhase({ k: "run", frame: 0, total: 1, step: "Starting" });
    try {
      const prog = (frame: number, total: number, step: string) => setPhase({ k: "run", frame, total, step });
      const { blob, audio } = format === "gif"
        ? { blob: await exportGIF(project, scale, range, prog, () => cancel.current, shape), audio: false }
        : format === "zip" ? { blob: await exportPNGs(project, scale, range, prog, () => cancel.current, shape), audio: false }
        : await exportMP4(project, scale, prog, () => cancel.current, range, shape, quality);
      const fileName = hasExportFolder() ? `${base} ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}${format === "zip" ? " frames" : ""}.${format}` : name;
      if (hasExportFolder()) {
        setPhase({ k: "run", frame: 0, total: 100, step: `Saving to ${where}` });
        setSaved(await saveToExportFolder(blob, fileName, (f) => setPhase({ k: "run", frame: Math.round(f * 100), total: 100, step: `Saving to ${where}` })));
      }
      const url = URL.createObjectURL(blob);
      setPhase({ k: "done", url, name: fileName, size: blob.size, secs: (performance.now() - t0.current) / 1000, audio });
      if (!hasExportFolder()) { const a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); }
    } catch (e) {
      const msg = (e as Error).message;
      setPhase(msg === "cancelled" ? { k: "setup" } : { k: "error", msg });
    }
  };
  const [W, H] = outSize(project, scale, shape);
  const fps = format === "gif" ? Math.min(project.fps, 25) : project.fps;
  const savePNG = async () => {
    const b = await exportPNG(project, scale, useStore.getState().t);
    const nm = `${base} ${useStore.getState().t.toFixed(2)}s.png`;
    if (hasExportFolder()) {
      if (!folder && !(await changeFolder())) return;
      await saveToExportFolder(b, nm).then(() => useStore.getState().toast(`Picture saved to ${exportFolder()}`)).catch((e) => useStore.getState().toast((e as Error).message));
      return;
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = nm; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const seg = <T extends string | number>(value: T, opts: readonly (readonly [T, string])[], set: (v: T) => void) => (
    <span className="exseg">{opts.map(([v, l]) => <button key={String(v)} className={value === v ? "on" : ""} onClick={() => set(v)}>{l}</button>)}</span>
  );
  const pct = phase.k === "run" ? Math.round((phase.frame / Math.max(1, phase.total)) * 100) : 0;

  return (
    <motion.div {...anim.fade} className="xback" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <motion.div {...anim.sheet} className="xbox exbox">
        <div className="xhead"><b>{phase.k === "done" ? "Exported" : "Export"}</b><span className="sp" />{phase.k !== "run" && <button className="xclose" onClick={close} aria-label="Close">×</button>}</div>
        {phase.k === "setup" || phase.k === "error" ? (
          <>
            <Poster project={project} W={W} H={H} label={`${W}×${H} · ${fps} fps · ${(range[1] - range[0]).toFixed(1)}s`} />
            <div className="exopts">
              <div className="exrow"><span>Format</span>{seg(format, [["mp4", "Video"], ["gif", "GIF"], ["zip", "PNG frames"]] as const, setFormat)}</div>
              <div className="exrow"><span>Size</span>{seg(scale, [[1, "Full"], [0.5, "Half"]] as const, setScale)}</div>
              {format === "mp4" && <div className="exrow"><span>Quality</span>{seg(quality, [[0.5, "Smaller"], [1, "Standard"], [2, "Best"]] as const, setQuality)}</div>}
              <div className="exrow"><span>Shape</span>{seg(shape.aspect, [["own", "As made"], ["9:16", "9:16"], ["1:1", "1:1"], ["4:5", "4:5"], ["16:9", "16:9"]] as const, (v) => setShape({ ...shape, aspect: v }))}</div>
              {shape.aspect !== "own" && <div className="exrow"><span>Reframe</span>{seg(shape.fit, [["fit", "Fit"], ["fill", "Fill"]] as const, (v) => setShape({ ...shape, fit: v }))}</div>}
              <div className="exrow"><span>Part</span>{seg(rangeKind, [["all", "Whole"], ...(loop ? [["loop", "Loop"] as const] : []), ["custom", "From – to"]] as const, (v) => { setRangeKind(v); if (v === "custom" && !custom[1]) setCustom([0, project.duration]); })}</div>
              {rangeKind === "custom" && (
                <div className="exrow"><span>Seconds</span>
                  <span className="exrange">
                    <input type="number" step={0.1} min={0} value={custom[0]} onChange={(e) => setCustom([+e.target.value, custom[1]])} /><i>to</i>
                    <input type="number" step={0.1} min={0} value={custom[1]} onChange={(e) => setCustom([custom[0], +e.target.value])} />
                  </span>
                </div>
              )}
              {hasExportFolder() && <div className="exrow"><span>Saves to</span><button className="exfolder" onClick={changeFolder}><b>{folder || "Choose a folder"}</b><i>{folder ? "Change" : ""}</i></button></div>}
            </div>
            {phase.k === "error" && <div className="xerr">{phase.msg}</div>}
            <button className="hcreate xgo" onClick={start}>Export {format === "gif" ? "GIF" : format === "zip" ? "frames" : "video"}</button>
            <div className="exlinks">
              <button className="hlink" onClick={savePNG}>Save this frame as a picture</button>
              {chapters.length > 0 && <button className="hlink" onClick={() => {
                const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
                const lines = [...(chapters[0].t > 0.5 ? ["0:00 Start"] : []), ...chapters.map((c) => `${fmt(c.t)} ${c.label}`)];
                navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
              }}>{copied ? "Chapters copied ✓" : `Copy ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`}</button>}
            </div>
          </>
        ) : phase.k === "run" ? (
          <div className="exrun">
            <svg className="exring" viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" className="bg" />
              <circle cx="60" cy="60" r="52" className="fg" style={{ strokeDasharray: 2 * Math.PI * 52, strokeDashoffset: 2 * Math.PI * 52 * (1 - pct / 100) }} />
            </svg>
            <b className="expct">{pct}%</b>
            <span className="exstep">{phase.step}{phase.total > 1 && !phase.step.startsWith("Saving") ? ` · ${phase.frame} / ${phase.total}` : ""}</span>
            <button className="hlink" onClick={() => { cancel.current = true; }}>Cancel</button>
          </div>
        ) : (
          <>
            {phase.name.endsWith(".zip") ? <div className="exzip">{phase.name}</div>
              : phase.name.endsWith(".gif") ? <img className="explayer" src={phase.url} alt="" />
              : <ClipPlayer src={phase.url} />}
            <div className="exmeta">
              <span>{(phase.size / 1e6).toFixed(1)} MB</span><span>{phase.audio ? "With sound" : "No sound"}</span><span>{phase.secs.toFixed(1)}s</span>
            </div>
            {saved ? (
              <>
                <div className="exsaved">Saved to <b>{exportFolder() || folder}</b></div>
                <div className="exacts">
                  <button className="hcreate" onClick={() => openSaved(saved.uri, saved.mime)}>Open</button>
                  <button className="hghost" onClick={() => shareSaved(saved.uri, saved.mime)}>Share</button>
                </div>
              </>
            ) : (
              <div className="exacts">
                <a className="hcreate" href={phase.url} download={phase.name}>Download again</a>
                <button className="hghost" onClick={close}>Done</button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/** The frame at the playhead, small, at the export's shape. */
function Poster({ project, W, H, label }: { project: Project; W: number; H: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const t = useStore((s) => s.t);
  useEffect(() => {
    let live = true;
    (async () => {
      const k = Math.min(1, 480 / Math.max(project.width, project.height));
      const w = Math.max(2, Math.round(project.width * k)), h = Math.max(2, Math.round(project.height * k));
      const rs = await prepare(project, w, h);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      await renderFrame(c, project, t, rs);
      await closeSession(rs);
      const out = ref.current;
      if (!live || !out) return;
      out.width = w; out.height = h; out.getContext("2d")!.drawImage(c, 0, 0);
    })().catch(() => {});
    return () => { live = false; };
  }, [project, t]);
  return (
    <div className="exposter">
      <div className="exframe" style={{ aspectRatio: `${W} / ${H}` }}><canvas ref={ref} /></div>
      <span className="exlabel">{label}</span>
    </div>
  );
}

/** The exported video: tap to play or pause, a bar to scrub, and the time; no browser controls. */
function ClipPlayer({ src }: { src: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const toggle = () => { const el = v.current; if (!el) return; if (el.paused) el.play().catch(() => {}); else el.pause(); };
  return (
    <div className="explayer">
      <video ref={v} src={src} playsInline loop onClick={toggle}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
      {!playing && <button className="exbig" onClick={toggle} aria-label="Play"><PlayIcon playing={false} /></button>}
      <div className="exctl">
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"}><PlayIcon playing={playing} /></button>
        <input type="range" min={0} max={dur || 1} step={0.01} value={t} style={{ ["--p" as string]: `${dur ? (t / dur) * 100 : 0}%` }}
          onChange={(e) => { const el = v.current; if (el) { el.currentTime = +e.target.value; setT(+e.target.value); } }} />
        <span>{fmt(t)} / {fmt(dur)}</span>
      </div>
    </div>
  );
}
