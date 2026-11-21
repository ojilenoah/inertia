import type { Project } from "@moshion/engine";
import { normalizeProject, sampleProject } from "@moshion/engine";
import { useStore } from "./store";
import { deleteProjectFile, diskReady, readAllProjects, readMedia, writeMedia, writeProject } from "./disk";
import { hasPictureRefs, unpackPictures } from "./imagestore";
import { autosaveAtKey } from "./persist";
import { mediaBlob, putMediaBlob } from "./media";
import { maybeSaveVersion } from "./History";

/**
 * Every project lives in a local library (IndexedDB), so the start screen can list them
 * and you can continue any of them. Saving to a .moshion file is still there for sharing.
 */
export interface LibEntry { id: string; name: string; width: number; height: number; updated: number; project: Project; /** the file version this entry last matched */ synced?: number }

const DB = "moshion-library", STORE = "projects";
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => { const r = fn(d.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function listProjects(): Promise<LibEntry[]> {
  try {
    const all = await tx<LibEntry[]>("readonly", (s) => s.getAll() as IDBRequest<LibEntry[]>);
    return all.sort((a, b) => b.updated - a.updated);
  } catch { return []; }
}
/** Projects deleted this session: never write them back. */
const deleted = new Set<string>();

/** An untouched copy of the demo: never sent to the shared folder (every browser has its own). */
function isPristineDemo(p: Project) {
  const d = sampleProject(); normalizeProject(d);
  const key = (x: Project) => JSON.stringify([x.items, x.tracks, x.backgrounds ?? [], x.effects]);
  return p.name === d.name && key(p) === key(d);
}

/** Tell the header how saving the open project went (only the open project shows a warning). */
function report(p: Project, issue: string | null) {
  const s = useStore.getState();
  if (s.project?.id === p.id && s.saveIssue !== issue) useStore.setState({ saveIssue: issue });
}
const why = (e: unknown) => {
  const m = (e as Error)?.name === "QuotaExceededError" ? "the browser is out of storage space" : (e as Error)?.message || "unknown error";
  return m;
};

export async function putProject(p: Project, toDisk = true, updated = Date.now(), synced?: number) {
  if (deleted.has(p.id)) return;
  // never write picture references (from the quick-save copy) to the library or the files: put the pictures back
  if (hasPictureRefs(JSON.stringify(p))) {
    const { json, missing } = await unpackPictures(JSON.stringify(p));
    if (missing) { report(p, "Some pictures couldn't be found in this browser — not saved, so the saved copy keeps them"); return; }
    p = JSON.parse(json);
  }
  const prev = await tx<LibEntry | undefined>("readonly", (s) => s.get(p.id) as IDBRequest<LibEntry | undefined>).catch(() => undefined);
  const e: LibEntry = { id: p.id, name: p.name, width: p.width, height: p.height, updated, project: JSON.parse(JSON.stringify(p)), synced: synced ?? prev?.synced };
  if (toDisk && !isPristineDemo(p)) maybeSaveVersion(p);
  let fileIssue: string | null = null;
  if (toDisk && diskReady() && !isPristineDemo(p)) {
    try { await writeProject(p, updated); e.synced = updated; } catch (err) { fileIssue = `Saved here, but not to the projects folder (${why(err)}) — it will try again`; }
  }
  try { await tx("readwrite", (s) => s.put(e)); }
  catch (err) { report(p, `Couldn't save: ${why(err)}. Use Save (Ctrl+S) to keep a copy as a file.`); throw err; }
  if (toDisk) report(p, fileIssue);
}

/** The quick-save copy holds references to its pictures: put the pictures back in (before anything is saved). */
export async function restorePictures() {
  const s = useStore.getState(), text = JSON.stringify(s.project);
  if (!hasPictureRefs(text)) return;
  const { json } = await unpackPictures(text);
  if (useStore.getState().project !== s.project) return;
  const p = JSON.parse(json) as Project;
  useStore.setState({ project: p, savedProject: p });
}

/**
 * On start, the editor opens the quick-save copy kept in browser storage. If the library has a newer copy of
 * that project (the quick copy couldn't hold it — pictures make projects big), open the newer one instead.
 */
export async function openNewerCopy() {
  const s = useStore.getState(), id = s.project.id;
  let at = 0;
  try { at = Number(localStorage.getItem(autosaveAtKey(id)) ?? localStorage.getItem("moshion.autosave.at") ?? "0") || 0; } catch { /* storage unavailable */ }
  const e = await tx<LibEntry | undefined>("readonly", (st) => st.get(id) as IDBRequest<LibEntry | undefined>).catch(() => undefined);
  if (!e || (e.updated <= at + 500 && !hasPictureRefs(JSON.stringify(s.project))) || JSON.stringify(e.project) === JSON.stringify(s.project)) return;
  if (useStore.getState().project.id !== id || useStore.getState().past.length) return; // already working on something
  const p = e.project; p.effects ??= []; normalizeProject(p);
  useStore.setState({ project: p, savedProject: p, past: [], pastTimes: [], future: [] });
}

/**
 * Bring the library and the project files in step: files that are newer (or missing here) are
 * loaded, projects only kept here are written out, and imported media is copied both ways.
 * Returns how many projects came in from files.
 */
export async function syncWithDisk(): Promise<number> {
  if (!diskReady()) return 0;
  const files = await readAllProjects().catch(() => []);
  const lib = await listProjects();
  let added = 0;
  const same = (a: Project, b: Project) => JSON.stringify(a) === JSON.stringify(b);
  for (const f of files) {
    if (deleted.has(f.project.id)) continue;
    const e = lib.find((x) => x.id === f.project.id);
    // deleted somewhere else: delete it here too (unless it was changed here after that)
    if (f.deleted) {
      if (e && e.updated <= f.updated + 1000 && e.id !== useStore.getState().project.id) { deleted.add(e.id); await tx("readwrite", (st) => st.delete(e.id)).catch(() => {}); }
      continue;
    }
    if (!e) { await putProject(f.project, false, f.updated, f.updated); added++; continue; }
    const base = e.synced ?? 0;
    const fileChanged = f.updated > base + 1000, localChanged = e.updated > base + 1000;
    if (!fileChanged) continue;
    if (localChanged && !same(e.project, f.project) && !isPristineDemo(e.project)) {
      // changed in both places: never throw either away — keep this browser's version as a copy
      const copy: Project = { ...JSON.parse(JSON.stringify(e.project)), id: "proj_" + Math.random().toString(36).slice(2, 10), name: `${e.name} (copy from this browser)` };
      await putProject(copy, true, e.updated);
      useStore.getState().toast(`"${e.name}" was changed in two places — the saved file is open, and this browser's version is kept as "${copy.name}"`);
    }
    await putProject(f.project, false, f.updated, f.updated); added++;
  }
  for (const e of await listProjects()) {
    if (deleted.has(e.id) || isPristineDemo(e.project)) continue;
    const f = files.find((x) => x.project.id === e.id);
    // deleted elsewhere: only written back if it was changed here after that
    if (f?.deleted && e.updated <= f.updated + 1000) continue;
    const base = e.synced ?? 0;
    if (!f || (e.updated > base + 1000 && !(f.updated > base + 1000))) {
      try { await writeProject(e.project, e.updated); await tx("readwrite", (s) => s.put({ ...e, synced: e.updated })); } catch { /* retry next time */ }
    }
  }
  // media: restore missing local copies from files, and save local copies to files
  const all = await listProjects();
  const seen = new Set<string>();
  for (const e of all) for (const a of e.project.assets ?? []) {
    if (a.kind === "image" || seen.has(a.id)) continue;
    seen.add(a.id);
    const local = await mediaBlob(a.id);
    if (local) await writeMedia(a.id, local).catch(() => {});
    else { const b = await readMedia(a.id, a.kind === "video" ? "video/*" : "audio/*"); if (b) await putMediaBlob(a.id, b).catch(() => {}); }
  }
  return added;
}
export async function removeProject(id: string) { deleted.add(id); await tx("readwrite", (s) => s.delete(id)); await deleteProjectFile(id).catch(() => {}); }

/** Switch the editor to a project (saving the one you were in first). */
export async function openInEditor(p: Project) {
  const s = useStore.getState();
  if (s.project && s.project.id !== p.id && s.project.items) await putProject(s.project).catch(() => {});
  deleted.delete(p.id);
  p.effects ??= [];
  normalizeProject(p);
  useStore.setState({ project: p, savedProject: p, past: [], pastTimes: [], future: [], selected: null, t: 0 });
  s.setUI({ view: "edit", multi: [], selGroup: null, panel: null, ctx: null, viewStart: 0, pps: 100 });
  await putProject(p).catch(() => {});
}

/** Keep the open project in the library as you work. */
export function startLibrarySync() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = useStore.getState().project;
  return useStore.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    clearTimeout(timer);
    timer = setTimeout(() => { if (useStore.getState().ui.view !== "home") putProject(last).catch(() => {}); }, 800);
  });
}
