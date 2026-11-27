import { useEffect, useState } from "react";
import type { Asset, Item, Project } from "@moshion/engine";
import { mediaTime, placeItem, uid, volumeAt } from "@moshion/engine";
import { useStore } from "./store";
import { readImage } from "./persist";
import { writeMedia } from "./disk";

/* ---------------- big media (video, audio) lives in IndexedDB; images stay inline ---------------- */
const DB = "moshion-media", STORE = "blobs";
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function putBlob(id: string, b: Blob) {
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(b, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function getBlob(id: string): Promise<Blob | null> {
  const d = await db();
  return new Promise((res) => { const r = d.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => res((r.result as Blob) ?? null); r.onerror = () => res(null); });
}

const urls = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();
function load(id: string): Promise<string | null> {
  if (urls.has(id)) return Promise.resolve(urls.get(id)!);
  if (!loading.has(id)) loading.set(id, getBlob(id).then((b) => { if (!b) return null; const u = URL.createObjectURL(b); urls.set(id, u); return u; }).catch(() => null));
  return loading.get(id)!;
}

/** Playable URL for a video/audio asset (loads it from local storage the first time). */
export function useMediaURL(id: string | undefined): string | undefined {
  const [u, setU] = useState(() => (id ? urls.get(id) : undefined));
  useEffect(() => {
    if (!id) return;
    if (urls.has(id)) { setU(urls.get(id)); return; }
    let live = true;
    load(id).then((x) => { if (live && x) setU(x); });
    return () => { live = false; };
  }, [id]);
  return u;
}

function meta(url: string, kind: "video" | "audio"): Promise<{ dur: number; w?: number; h?: number }> {
  return new Promise((res) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () => res({ dur: isFinite(el.duration) ? el.duration : 5, w: (el as HTMLVideoElement).videoWidth, h: (el as HTMLVideoElement).videoHeight });
    el.onerror = () => res({ dur: 5 });
    el.src = url;
  });
}
function imgSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.width, h: i.height }); i.onerror = () => res({ w: 800, h: 800 }); i.src = url; });
}

/** Add files to the project's media. Returns the new assets. */
export async function importFiles(files: File[]): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const f of files) {
    const id = uid("asset");
    if (f.type.startsWith("image/")) {
      const url = await readImage(f);
      const { w, h } = await imgSize(url);
      out.push({ id, name: f.name, kind: "image", url, w, h });
    } else if (f.type.startsWith("video/") || f.type.startsWith("audio/")) {
      const kind = f.type.startsWith("video/") ? "video" : "audio";
      await putBlob(id, f);
      writeMedia(id, f).catch(() => {}); // also keep a copy next to the project files
      const u = URL.createObjectURL(f); urls.set(id, u);
      const m = await meta(u, kind);
      out.push({ id, name: f.name, kind, dur: m.dur, w: m.w, h: m.h });
    }
  }
  if (out.length) useStore.getState().edit((p) => { (p.assets ??= []).push(...out); });
  const skipped = files.length - out.length;
  useStore.getState().toast(out.length ? `${out.length} added to Media${skipped ? ` · ${skipped} not supported` : ""}` : "Only images, videos and audio can be imported");
  return out;
}

export function pickMedia(): Promise<File[]> {
  return new Promise((res) => {
    const inp = document.createElement("input");
    // Android's picker only uses the first type in a list (images only): there it lists every file; others are skipped on import
    inp.type = "file"; inp.multiple = true; inp.accept = /Android/i.test(navigator.userAgent) ? "*/*" : "image/*,video/*,audio/*";
    inp.onchange = () => res([...(inp.files ?? [])]);
    inp.click();
  });
}

/** Put an asset in the scene at time `at` (and, for pictures, at canvas point `pos`). */
export function placeAsset(a: Asset, at?: number, pos?: { x: number; y: number }) {
  const { project, t, edit, select, toast } = useStore.getState();
  const id = uid("item");
  const auto = project.autoLength !== false;
  const start = Math.max(0, auto ? (project.items.length ? Math.min(at ?? t, project.duration) : 0) : Math.min(at ?? t, project.duration - 0.1));
  const len = a.kind === "image" ? 3 : Math.max(0.1, a.dur ?? 5);
  const end = auto ? start + len : Math.min(project.duration, start + len);
  const audio = a.kind === "audio";
  edit((p: Project) => {
    const kind = audio ? "audio" : "video";
    const { trackId, lane } = placeItem(p, kind, start, end, useStore.getState().project.items.find((q) => q.id === useStore.getState().selected)?.trackId, () => uid(audio ? "A" : "V"));
    const s = a.w && a.h ? Math.min(p.width / a.w, p.height / a.h, a.kind === "image" ? 800 / Math.max(a.w, a.h) : Infinity) : 1;
    const it: Item = {
      id, name: a.name.replace(/\.[^.]+$/, ""), kind: audio ? "audio" : a.kind === "video" ? "video" : "image", trackId, lane, start, end,
      w: Math.round((a.w ?? 400) * s), h: Math.round((a.h ?? 300) * s),
      fill: a.kind === "image" ? `url("${a.url}")` : "#000", tint: audio ? "--green" : "--teal", radius: 0, keys: {},
      base: { x: pos?.x ?? p.width / 2, y: pos?.y ?? p.height / 2, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 },
      src: a.kind === "image" ? undefined : a.id,
    };
    p.items.push(it);
  });
  if (!audio) select(id);
  toast(`${a.name} added`);
}

/**
 * Keep a <video>/<audio> element in step with the playhead. `exact`: the video engine draws the paused frame
 * (and plays it backwards), so while paused the element only catches up once the playhead rests, ready to play.
 */
export function useMediaSync(ref: React.RefObject<HTMLMediaElement | null>, item: Item, url: string | undefined, exact = false) {
  const t = useStore((s) => s.t);
  const playing = useStore((s) => s.playing);
  const muted = useStore((s) => { const tr = s.project.tracks.find((x) => x.id === item.trackId); return !!tr?.muted; });
  const vol = useStore((s) => volumeAt(s.project, item, s.t));
  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return;
    const local = mediaTime(item, t - item.start, el.duration || undefined);
    const inside = t >= item.start && t < item.end;
    el.muted = muted;
    el.volume = Math.min(1, vol);
    el.playbackRate = Math.min(16, Math.max(0.0625, item.speed ?? 1));
    // backwards can't play natively: it's stepped frame by frame
    if (playing && inside && !item.reverse) {
      if (el.paused) el.play().catch(() => {});
      if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - local) <= 0.02) return;
      if (!exact) { el.currentTime = local; return; }
      const id = setTimeout(() => { el.currentTime = local; }, 250); // not while scrubbing: the engine shows those frames
      return () => clearTimeout(id);
    }
  }, [t, playing, muted, vol, url, item.start, item.end, item.mediaOffset, item.speed, item.reverse, exact]);
}

/** The stored file for a video/audio asset (for export). */
export function mediaBlob(id: string): Promise<Blob | null> { return getBlob(id).catch(() => null); }

/** Put a file back into local media storage (when a project is loaded from disk). */
export function putMediaBlob(id: string, b: Blob) { return putBlob(id, b); }
