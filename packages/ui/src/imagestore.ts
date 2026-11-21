/*
 * Pictures inside a project are data URLs (the whole picture written out as text), and the same picture is often
 * there twice (in Media and in the item using it). The quick-save copy kept in browser storage has little room, so
 * before it's written each picture goes into the browser's media storage once, and the copy keeps a short
 * reference ("moshion-img:<id>") instead. Opening the copy swaps the references back for the pictures.
 * (No imports from the rest of the app: this runs while the store is being created.)
 */

const DB = "moshion-media", STORE = "blobs";
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function put(id: string, b: Blob) {
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(b, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function get(id: string): Promise<Blob | null> {
  const d = await db();
  return new Promise((res) => { const r = d.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => res((r.result as Blob) ?? null); r.onerror = () => res(null); });
}

const PICTURE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const REF = /moshion-img:(img_[a-z0-9_]+)/g;
/** picture → its id, and the ids already stored this session */
const ids = new Map<string, string>(), stored = new Set<string>();

function idOf(data: string): string {
  let id = ids.get(data);
  if (id) return id;
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  id = `img_${data.length.toString(36)}_${h.toString(36)}`;
  ids.set(data, id);
  return id;
}

/** A project's saved text with every picture stored separately and replaced by a short reference. */
export async function packPictures(json: string): Promise<string> {
  const found = [...new Set(json.match(PICTURE) ?? [])];
  for (const data of found) {
    const id = idOf(data);
    if (stored.has(id)) continue;
    await put(id, await (await fetch(data)).blob());
    stored.add(id);
  }
  return found.length ? json.replace(PICTURE, (m) => `moshion-img:${idOf(m)}`) : json;
}

const asData = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** Put the pictures back in. Pictures that can't be found keep their reference (reported in `missing`). */
export async function unpackPictures(json: string): Promise<{ json: string; missing: number }> {
  const refs = [...new Set([...json.matchAll(REF)].map((m) => m[1]))];
  if (!refs.length) return { json, missing: 0 };
  const back = new Map<string, string>();
  for (const id of refs) {
    const b = await get(id).catch(() => null);
    if (!b) continue;
    const data = await asData(b);
    back.set(id, data); ids.set(data, id); stored.add(id);
  }
  return { json: json.replace(REF, (m, id: string) => back.get(id) ?? m), missing: refs.length - back.size };
}
export const hasPictureRefs = (json: string) => json.includes("moshion-img:");
