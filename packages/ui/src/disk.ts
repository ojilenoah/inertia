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
  /** the desktop app, first start: the person picks where projects go (until then they're kept in the app only) */
  | { kind: "choose" }
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

/* ---------------- desktop / mobile app ----------------
 * Desktop: a folder the person chose (asked once, on first start; Documents/Inertia Projects is offered first),
 * stored as a full path. Phones (Android): Documents/Inertia Projects inside what the app may use, else its data folder.
 */
let base: BaseDirectory = BaseDirectory.Document;
const APPDIR = "Inertia Projects";
/** The old name's folder: offered for bringing projects in on first start. */
const OLD_APPDIR = "Moshion Projects";
const FOLDER_KEY = "inertia.folder";
/** Desktop app: the chosen folder (full path); "" while using a base folder (phones). */
let root = "";
const isMobileApp = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
export const isDesktopApp = () => isApp() && !isMobileApp();
/** A path inside the projects folder, and the options to reach it. */
const at = (rel = "") => (root ? (rel ? `${root}/${rel}` : root) : rel ? `${APPDIR}/${rel}` : APPDIR);
const opt = () => (root ? undefined : { baseDir: base });
async function useFolder(path: string) {
  await mkdir(`${path}/media`, { recursive: true });
  root = path;
  setState({ kind: "app", where: path });
}
async function appInit() {
  if (isDesktopApp()) {
    let saved: string | null = null;
    try { saved = localStorage.getItem(FOLDER_KEY); } catch { /* storage unavailable */ }
    if (!saved) { setState({ kind: "choose" }); return; }
    try { await useFolder(saved); } catch { setState({ kind: "choose" }); } // gone or not allowed any more: ask again
    return;
  }
  try { await mkdir(`${APPDIR}/media`, { baseDir: base, recursive: true }); setState({ kind: "app", where: "Documents/Inertia Projects" }); }
  catch {
    base = BaseDirectory.AppData;
    await mkdir(`${APPDIR}/media`, { baseDir: base, recursive: true });
    setState({ kind: "app", where: "the app's own storage" });
  }
}
/** Desktop app: Documents/Inertia Projects (the suggested place). */
export async function defaultAppFolder() {
  const { documentDir, join } = await import("@tauri-apps/api/path");
  return join(await documentDir(), APPDIR);
}
/** Desktop app: let the person pick a folder (null if they cancel). */
export async function pickAppFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { documentDir } = await import("@tauri-apps/api/path");
  // recursive: the folder's contents (and media/) become reachable too
  const p = await open({ directory: true, multiple: false, recursive: true, title: "Where should Inertia save your projects?", defaultPath: await documentDir() });
  return typeof p === "string" ? p : null;
}
/** Desktop app: save projects in this folder from now on. */
export async function setAppFolder(path: string) {
  await useFolder(path);
  try { localStorage.setItem(FOLDER_KEY, path); } catch { /* storage unavailable */ }
  return state;
}
/** Projects in the old "Moshion Projects" folder (Documents), to bring in on first start. */
export async function oldFolderProjects(): Promise<{ project: Project; updated: number }[]> {
  if (!isApp()) return [];
  const out: { project: Project; updated: number }[] = [];
  try {
    for (const e of await readDir(OLD_APPDIR, { baseDir: BaseDirectory.Document })) {
      if (!e.isFile || !e.name.endsWith(".moshion")) continue;
      try {
        const d = JSON.parse(await readTextFile(`${OLD_APPDIR}/${e.name}`, { baseDir: BaseDirectory.Document }));
        const project: Project = d.project ?? d;
        if (!d.deleted && project?.items && project?.tracks && project.id) out.push({ project, updated: +d.updated || Date.parse(d.savedAt) || Date.now() });
      } catch { /* not a project */ }
    }
  } catch { /* no old folder */ }
  return out;
}
/** A media file kept in the old folder (copied along when projects are brought in). */
export async function readOldMedia(id: string): Promise<Uint8Array | null> {
  try { return await readFile(`${OLD_APPDIR}/media/${id}`, { baseDir: BaseDirectory.Document }); } catch { return null; }
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
  if (state.kind === "app") await writeTextFile(at(fileOf(p.id)), text, opt());
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
  if (state.kind === "app") { await writeTextFile(at(fileOf(id)), text, opt()); return; }
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
    for (const e of await readDir(at(), opt())) if (e.isFile && e.name.endsWith(".moshion")) parse(await readTextFile(at(e.name), opt()));
  } else {
    for await (const h of dir!.values()) if (h.kind === "file" && h.name.endsWith(".moshion")) parse(await (await (h as FileSystemFileHandle).getFile()).text());
  }
  return out;
}
export async function writeMedia(id: string, blob: Blob) {
  if (!diskReady()) return;
  if (state.kind === "server") { await fetch(`/__moshion/media/${encodeURIComponent(id)}`, { method: "PUT", body: blob }); return; }
  if (state.kind === "app") {
    const path = at(`media/${id}`);
    if (!(await exists(path, opt()))) await writeFile(path, new Uint8Array(await blob.arrayBuffer()), opt());
  } else {
    const m = await sub("media");
    try { await m.getFileHandle(id); } catch { await writeTo(m, id, blob); }
  }
}
export async function readMedia(id: string, type = ""): Promise<Blob | null> {
  if (!diskReady()) return null;
  try {
    if (state.kind === "server") { const r = await fetch(`/__moshion/media/${encodeURIComponent(id)}`, { cache: "no-store" }); return r.ok ? new Blob([await r.arrayBuffer()], { type }) : null; }
    if (state.kind === "app") return new Blob([await readFile(at(`media/${id}`), opt())], { type });
    const m = await sub("media");
    return await (await m.getFileHandle(id)).getFile();
  } catch { return null; }
}
