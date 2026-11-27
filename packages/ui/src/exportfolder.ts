/*
 * The Android app's export folder: a folder the person picks with Android's own picker (asked on the first start,
 * or at the first export), kept across restarts. Exports are written straight into it, where the gallery and the
 * file manager see them. Elsewhere (browser, desktop app) none of this applies and exports download as before.
 */
interface Files {
  folder(): string;
  pickFolder(): void;
  begin(name: string, mime: string): string;
  write(id: string, b64: string): boolean;
  finish(id: string): string;
  open(uri: string, mime: string): void;
  share(uri: string, mime: string): void;
}
const files = (): Files | undefined => (window as unknown as { InertiaFiles?: Files }).InertiaFiles;

/** The Android app (the only place with an export folder). */
export const hasExportFolder = () => !!files();
/** The chosen folder's name ("Movies/Inertia"), or "" when none is chosen (or access was taken back). */
export const exportFolder = () => { try { return files()?.folder() ?? ""; } catch { return ""; } };

/** Ask for a folder with Android's picker: its name, or "" if the person backed out. */
export function pickExportFolder(): Promise<string> {
  const f = files();
  if (!f) return Promise.resolve("");
  return new Promise((res) => {
    (window as unknown as { __inertiaFolder?: (n: string) => void }).__inertiaFolder = (n) => {
      try { localStorage.setItem("inertia.exportAsked", "1"); } catch { /* storage unavailable */ }
      res(n);
    };
    f.pickFolder();
  });
}
/** First start of the Android app: whether to ask where exports go (asked once). */
export function shouldAskExportFolder() {
  if (!files() || exportFolder()) return false;
  try { return !localStorage.getItem("inertia.exportAsked"); } catch { return false; }
}
export function skipExportFolder() { try { localStorage.setItem("inertia.exportAsked", "1"); } catch { /* storage unavailable */ } }

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Write a file into the export folder, piece by piece. Returns where it went (to open or share it). */
export async function saveToExportFolder(blob: Blob, name: string, onProgress?: (f: number) => void): Promise<{ uri: string; mime: string }> {
  const f = files();
  if (!f) throw new Error("No export folder here");
  const mime = blob.type || "application/octet-stream";
  const id = f.begin(name, mime);
  if (!id) throw new Error("Couldn't write in that folder. Pick the folder again (Export → Change).");
  const CH = 768 * 1024;
  for (let at = 0; at < blob.size; at += CH) {
    const part = new Uint8Array(await blob.slice(at, at + CH).arrayBuffer());
    if (!f.write(id, b64(part))) { f.finish(id); throw new Error("Writing the file stopped part way. Is the phone full?"); }
    onProgress?.(Math.min(1, (at + CH) / blob.size));
    await new Promise((r) => setTimeout(r, 0));
  }
  const uri = f.finish(id);
  if (!uri) throw new Error("Couldn't finish writing the file.");
  return { uri, mime };
}
export const openSaved = (uri: string, mime: string) => files()?.open(uri, mime);
export const shareSaved = (uri: string, mime: string) => files()?.share(uri, mime);
