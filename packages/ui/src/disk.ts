import { useEffect, useState } from "react";
import type { Project } from "@moshion/engine";
import { BaseDirectory, exists, mkdir, readDir, readFile, readTextFile, remove, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

/*
 * Projects as real files, so they survive the browser's storage being cleared.
 *  - Desktop/Android app: Documents/Moshion (or the app's data folder if Documents isn't available).
 *  - Browser: a folder you pick once (Chrome/Edge); the app remembers it and asks again after a restart.
 * Each project is <id>.moshion; imported video/audio go in media/<assetId>.
 */

export type DiskState =
  | { kind: "app"; where: string }
  | { kind: "server"; where: string }
  | { kind: "folder"; name: string }
  | { kind: "needs-permission"; name: string }
  | { kind: "unsupported" }
  | { kind: "none" };

let state: DiskState = { kind: "none" };
const listeners = new Set<(s: DiskState) => void>();
function setState(s: DiskState) { state = s; listeners.forEach((l) => l(s)); }
export function useDisk() {
  const [s, set] = useState(state);
  useEffect(() => { listeners.add(set); set(state); return () => { listeners.delete(set); }; }, []);
  return s;
}
export const diskReady = () => state.kind === "app" || state.kind === "server" || state.kind === "folder";

const isApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const fileOf = (id: string) => `${id}.moshion`;
const serialize = (p: Project, updated: number) => JSON.stringify({ moshion: 1, updated, savedAt: new Date(updated).toISOString(), project: p });

/* ---------------- desktop / mobile app ---------------- */
let base: BaseDirectory = BaseDirectory.Document;
const APPDIR = "Moshion Projects";
async function appInit() {
  try { await mkdir(`${APPDIR}/media`, { baseDir: base, recursive: true }); setState({ kind: "app", where: "Documents/Moshion Projects" }); }
  catch {
    base = BaseDirectory.AppData;
    await mkdir(`${APPDIR}/media`, { baseDir: base, recursive: true });
    setState({ kind: "app", where: "the app's data folder" });
  }
}

/* ---------------- browser folder (File System Access) ---------------- */
type Dir = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: string }): Promise<PermissionState>;
  requestPermission(o: { mode: string }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};
let dir: Dir | null = null;
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open("moshion-disk", 1); r.onupgradeneeded = () => r.result.createObjectStore("h"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function saveHandle(h: Dir | null) {
  const d = await idb();
  await new Promise<void>((res) => { const tx = d.transaction("h", "readwrite"); if (h) tx.objectStore("h").put(h, "root"); else tx.objectStore("h").delete("root"); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
async function loadHandle(): Promise<Dir | null> {
  const d = await idb();
  return new Promise((res) => { const r = d.transaction("h").objectStore("h").get("root"); r.onsuccess = () => res((r.result as Dir) ?? null); r.onerror = () => res(null); });
}
const canPick = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

/** Run once at startup. */
export async function diskInit(): Promise<DiskState> {
  try {
    if (isApp()) { await appInit(); return state; }
    // running from the dev server: it keeps projects on disk for every browser on this computer
    try {
      const r = await fetch("/__moshion/ping", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setState({ kind: "server", where: String(j.dir ?? "Documents/Moshion Projects") }); return state; }
    } catch { /* not the dev server */ }
    if (!canPick()) { setState({ kind: "unsupported" }); return state; }
    const h = await loadHandle().catch(() => null);
    if (!h) { setState({ kind: "none" }); return state; }
    dir = h;
    const p = await h.queryPermission({ mode: "readwrite" });
    setState(p === "granted" ? { kind: "folder", name: h.name } : { kind: "needs-permission", name: h.name });
  } catch { setState(isApp() ? { kind: "unsupported" } : { kind: "none" }); }
  return state;
}

/** Browser: pick the folder projects are saved in (must be called from a click). */
export async function chooseFolder(): Promise<DiskState> {
  const w = window as unknown as { showDirectoryPicker(o: object): Promise<Dir> };
  try {
    const h = await w.showDirectoryPicker({ id: "moshion-projects", mode: "readwrite", startIn: "documents" });
    dir = h; await saveHandle(h);
    setState({ kind: "folder", name: h.name });
  } catch { /* cancelled */ }
  return state;
}
/** Browser: allow the remembered folder again after a restart (must be called from a click). */
export async function reconnect(): Promise<DiskState> {
  if (!dir) return chooseFolder();
  const p = await dir.requestPermission({ mode: "readwrite" }).catch(() => "denied" as PermissionState);
  setState(p === "granted" ? { kind: "folder", name: dir.name } : { kind: "needs-permission", name: dir.name });
  return state;
}
export async function forgetFolder() { dir = null; await saveHandle(null); setState({ kind: "none" }); }

async function sub(name: string) { return dir!.getDirectoryHandle(name, { create: true }) as Promise<Dir>; }
async function writeTo(d: Dir, name: string, data: Blob | string) {
  const f = await d.getFileHandle(name, { create: true });
  const w = await (f as FileSystemFileHandle & { createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> }).createWritable();
  await w.write(data); await w.close();
}

/* ---------------- the operations the app uses ---------------- */
export async function writeProject(p: Project, updated = Date.now()) {
  if (!diskReady()) return;
  const text = serialize(p, updated);
  if (state.kind === "server") { await fetch(`/__moshion/project/${encodeURIComponent(p.id)}`, { method: "PUT", body: text }); return; }
  if (state.kind === "app") await writeTextFile(`${APPDIR}/${fileOf(p.id)}`, text, { baseDir: base });
  else await writeTo(dir!, fileOf(p.id), text);
}
/**
 * Deleting a project leaves a small "deleted" marker in its place (not nothing): every other browser and the app
 * see it and delete their own copy too, instead of writing their copy back as if it were new.
 */
export async function deleteProjectFile(id: string) {
  if (!diskReady()) return;
  const text = JSON.stringify({ moshion: 1, deleted: true, updated: Date.now(), project: { id } });
  if (state.kind === "server") { await fetch(`/__moshion/project/${encodeURIComponent(id)}`, { method: "PUT", body: text }); return; }
  if (state.kind === "app") { await writeTextFile(`${APPDIR}/${fileOf(id)}`, text, { baseDir: base }); return; }
  await writeTo(dir!, fileOf(id), text);
}
void remove; void exists;
/** Every project saved as a file, with when it was last saved. */
export async function readAllProjects(): Promise<{ project: Project; updated: number; deleted?: boolean }[]> {
  if (!diskReady()) return [];
  const out: { project: Project; updated: number; deleted?: boolean }[] = [];
  const parse = (text: string) => {
    try {
      const d = JSON.parse(text); const project: Project = d.project ?? d;
      if (d.deleted && project?.id) out.push({ project, updated: +d.updated || 0, deleted: true });
      else if (project?.items && project?.tracks && project.id) out.push({ project, updated: +d.updated || Date.parse(d.savedAt) || 0 });
    } catch { /* not a project */ }
  };
  if (state.kind === "server") {
    const list = (await (await fetch("/__moshion/projects", { cache: "no-store" })).json()) as unknown[];
    for (const d of list) parse(JSON.stringify(d));
  } else if (state.kind === "app") {
    for (const e of await readDir(APPDIR, { baseDir: base })) if (e.isFile && e.name.endsWith(".moshion")) parse(await readTextFile(`${APPDIR}/${e.name}`, { baseDir: base }));
  } else {
    for await (const h of dir!.values()) if (h.kind === "file" && h.name.endsWith(".moshion")) parse(await (await (h as FileSystemFileHandle).getFile()).text());
  }
  return out;
}
export async function writeMedia(id: string, blob: Blob) {
  if (!diskReady()) return;
  if (state.kind === "server") { await fetch(`/__moshion/media/${encodeURIComponent(id)}`, { method: "PUT", body: blob }); return; }
  if (state.kind === "app") {
    const path = `${APPDIR}/media/${id}`;
    if (!(await exists(path, { baseDir: base }))) await writeFile(path, new Uint8Array(await blob.arrayBuffer()), { baseDir: base });
  } else {
    const m = await sub("media");
    try { await m.getFileHandle(id); } catch { await writeTo(m, id, blob); }
  }
}
export async function readMedia(id: string, type = ""): Promise<Blob | null> {
  if (!diskReady()) return null;
  try {
    if (state.kind === "server") { const r = await fetch(`/__moshion/media/${encodeURIComponent(id)}`, { cache: "no-store" }); return r.ok ? new Blob([await r.arrayBuffer()], { type }) : null; }
    if (state.kind === "app") return new Blob([await readFile(`${APPDIR}/media/${id}`, { baseDir: base })], { type });
    const m = await sub("media");
    return await (await m.getFileHandle(id)).getFile();
  } catch { return null; }
}
