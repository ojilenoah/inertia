import { useEffect, useState } from "react";
import { mediaBlob } from "./media";

/*
 * Sound pictures for clips: the loudness of a media file over time (decoded once and kept),
 * and beat detection (sudden jumps in loudness) for snapping cuts and keyframes to the music.
 */
const peaks = new Map<string, { peaks: Float32Array; dur: number } | null>();
const waiting = new Map<string, Promise<{ peaks: Float32Array; dur: number } | null>>();
const buffers = new Map<string, AudioBuffer>();
const PER_SEC = 60;

async function decode(src: string): Promise<AudioBuffer | null> {
  if (buffers.has(src)) return buffers.get(src)!;
  const b = await mediaBlob(src);
  if (!b) return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await b.arrayBuffer());
    buffers.set(src, buf);
    return buf;
  } catch { return null; }
}

async function load(src: string) {
  const buf = await decode(src);
  if (!buf) { peaks.set(src, null); return null; }
  const n = Math.max(1, Math.ceil(buf.duration * PER_SEC)), out = new Float32Array(n), step = buf.sampleRate / PER_SEC;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * step), b = Math.min(buf.length, Math.floor((i + 1) * step));
    for (const d of chans) for (let j = a; j < b; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v; }
    out[i] = m;
  }
  const r = { peaks: out, dur: buf.duration };
  peaks.set(src, r);
  return r;
}

/** Loudness of a media file (PER_SEC values per second), or null while loading / if it has no sound. */
export function usePeaks(src: string | undefined) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!src || peaks.has(src)) return;
    let live = true;
    const p = waiting.get(src) ?? load(src);
    waiting.set(src, p);
    p.then(() => { if (live) bump((n) => n + 1); });
    return () => { live = false; };
  }, [src]);
  return src ? peaks.get(src) ?? null : null;
}
export const PEAKS_PER_SEC = PER_SEC;

/** Times (in the media file) where a beat lands: sudden rises in loudness, at least 0.25s apart. */
export async function findBeats(src: string): Promise<number[]> {
  const buf = await decode(src);
  if (!buf) return [];
  const d = buf.getChannelData(0), win = 1024, hop = 512, rate = buf.sampleRate;
  const energy: number[] = [];
  for (let i = 0; i + win < d.length; i += hop) { let e = 0; for (let j = i; j < i + win; j += 2) e += d[j] * d[j]; energy.push(e); }
  const avgN = Math.round((rate / hop) * 0.8), out: number[] = [];
  let last = -1;
  for (let i = 1; i < energy.length; i++) {
    const a = Math.max(0, i - avgN);
    let s = 0; for (let j = a; j < i; j++) s += energy[j];
    const avg = s / Math.max(1, i - a), t = (i * hop) / rate;
    if (energy[i] > avg * 1.6 && energy[i] > energy[i - 1] && energy[i] > 0.02 * win && t - last > 0.25) { out.push(t); last = t; }
  }
  return out;
}
