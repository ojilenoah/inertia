import type { Project } from "@moshion/engine";
import { useStore } from "./store";
import { packPictures } from "./imagestore";

/*
 * Quick-save: every project keeps its own copy in browser storage ("moshion.autosave.v1:<id>"), pictures stored
 * apart. Each tab remembers which project it has open (sessionStorage), so two tabs never take over each other's
 * project on reload; a new tab opens the project opened last.
 */
const KEY = "moshion.autosave.v1";
const keyOf = (id: string) => `${KEY}:${id}`;
/** When a project's quick-save copy was last written (the library copy wins when it's newer). */
export const autosaveAtKey = (id: string) => `moshion.autosave.at:${id}`;
const OPEN = "moshion.open", LAST = "moshion.last";
const EXT = ".moshion";

type FileHandle = { name: string; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> };
let handle: FileHandle | null = null;

export function loadAutosave(): Project | null {
  try {
    const id = sessionStorage.getItem(OPEN) ?? localStorage.getItem(LAST);
    const raw = (id ? localStorage.getItem(keyOf(id)) : null) ?? localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!(p?.items && p?.tracks)) return null;
    try { sessionStorage.setItem(OPEN, p.id); } catch { /* storage unavailable */ } // this tab now has this project
    return p as Project;
  } catch { return null; }
}

/** Keep the current project in browser storage so a reload never loses work. */
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = useStore.getState().project;
  return useStore.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const p = last;
      let text: string;
      try { text = await packPictures(JSON.stringify(p)); } catch { text = JSON.stringify(p); }
      if (p !== last) return; // changed again meanwhile: the next save covers it
      const write = () => { localStorage.setItem(keyOf(p.id), text); localStorage.setItem(autosaveAtKey(p.id), String(Date.now())); };
      try {
        try { write(); }
        catch {
          // no room: drop other projects' quick copies (the library still has them) and the old shared one, then retry
          for (const k of Object.keys(localStorage)) if ((k === KEY || k.startsWith(KEY + ":")) && k !== keyOf(p.id)) localStorage.removeItem(k);
          write();
        }
        localStorage.removeItem(KEY); // the old copy shared by every tab
      } catch { try { localStorage.setItem(autosaveAtKey(p.id), "0"); } catch { /* storage unavailable */ } }
      try { sessionStorage.setItem(OPEN, p.id); localStorage.setItem(LAST, p.id); } catch { /* storage unavailable */ }
    }, 400);
  });
}

const serialize = (p: Project) => JSON.stringify({ moshion: 1, savedAt: new Date().toISOString(), project: p }, null, 1);

export async function saveProject(saveAs = false) {
  const s = useStore.getState();
  const text = serialize(s.project);
  const w = window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileHandle> };
  try {
    if (w.showSaveFilePicker) {
      if (!handle || saveAs) {
        handle = await w.showSaveFilePicker({
          suggestedName: `${s.project.name.replace(/[^\w\- ]+/g, "").trim() || "project"}${EXT}`,
          types: [{ description: "Moshion project", accept: { "application/json": [EXT] } }],
        });
      }
      const out = await handle.createWritable();
      await out.write(text); await out.close();
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = `${s.project.name || "project"}${EXT}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    useStore.setState({ savedProject: s.project });
    s.toast(handle ? `Saved to ${handle.name}` : "Project saved");
  } catch (e) {
    if ((e as Error).name !== "AbortError") s.toast("Couldn't save: " + (e as Error).message);
  }
}

export async function openProject() {
  const s = useStore.getState();
  const w = window as unknown as { showOpenFilePicker?: (o: object) => Promise<(FileHandle & { getFile(): Promise<File> })[]> };
  try {
    let file: File;
    if (w.showOpenFilePicker) {
      const [h] = await w.showOpenFilePicker({ types: [{ description: "Moshion project", accept: { "application/json": [EXT, ".json"] } }] });
      handle = h; file = await h.getFile();
    } else {
      file = await new Promise<File>((res, rej) => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = `${EXT},.json`;
        inp.onchange = () => (inp.files?.[0] ? res(inp.files[0]) : rej(new Error("No file")));
        inp.click();
      });
    }
    const data = JSON.parse(await file.text());
    const project: Project = data.project ?? data;
    if (!project?.items || !project?.tracks) throw new Error("not a Moshion project");
    project.effects ??= [];
    useStore.setState({ project, savedProject: project, past: [], pastTimes: [], future: [], selected: null, t: 0 });
    s.toast(`Opened ${file.name}`);
  } catch (e) {
    if ((e as Error).name !== "AbortError") s.toast("Couldn't open: " + (e as Error).message);
  }
}

/** Read an image file into a data URL so it is stored inside the project file. */
export function readImage(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function pickImageFile(): Promise<{ url: string; name: string } | null> {
  return new Promise((res) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => { const f = inp.files?.[0]; res(f ? { url: await readImage(f), name: f.name } : null); };
    inp.click();
  });
}
