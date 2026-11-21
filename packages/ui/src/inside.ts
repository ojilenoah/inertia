import type { Item, Project } from "@moshion/engine";
import { insertRow, ownValue, uid } from "@moshion/engine";
import { useStore } from "./store";
import { pickImageFile } from "./persist";
import { importFiles } from "./media";

/*
 * Putting things inside other things is masking: the inner item is clipped to the shape, and the shape
 * stays visible. Items keep their own layer (group them yourself if they should move together); only
 * brand-new ones are placed, centred, on a track just above the shape.
 */
export const CONTAINER_KINDS = ["shape", "rect", "ellipse", "star", "image", "video", "glass"];

/** Mask `childId` with `containerId`'s shape, keeping the shape visible. Nothing moves to another layer: that's up to you. */
function putInside(p: Project, containerId: string, childId: string) {
  const c = p.items.find((i) => i.id === containerId), ch = p.items.find((i) => i.id === childId);
  if (!c || !ch || c.id === ch.id) return;
  ch.mask = { by: c.id, inside: true };
}
/** A brand-new inner item goes on a new track right above the shape, so it shows on top of it. */
function addAbove(p: Project, containerId: string, it: Item) {
  const c = p.items.find((i) => i.id === containerId)!;
  it.trackId = insertRow(p, c.trackId, false);
  p.items.push(it);
  putInside(p, containerId, it.id);
}

/** Where a new inner item starts: centred on the container, for as long as the container is on screen. */
function newInner(c: Item, t: number, extra: Partial<Item>): Item {
  return {
    id: uid("item"), name: "Item", kind: "rect", trackId: c.trackId, start: c.start, end: c.end, w: 300, h: 300, fill: "#888888", tint: "--blue", keys: {},
    base: { x: ownValue(c, "x", t), y: ownValue(c, "y", t), z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 },
    ...extra,
  } as Item;
}
/** The size that covers (fill) or fits inside (keep) the container, for media w×h. */
function sized(c: Item, w: number, h: number, fill: boolean) {
  const s = fill ? Math.max(c.w / w, c.h / h) : Math.min(1, c.w / w, c.h / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

const done = (what: string, where: string) => useStore.getState().toast(`${what} is masked by ${where}`);

export async function placeImageInside(containerId: string, fill: boolean) {
  const f = await pickImageFile();
  const s = useStore.getState(), c = s.project.items.find((i) => i.id === containerId);
  if (!f || !c) return;
  if (fill) { s.edit((p) => { const it = p.items.find((i) => i.id === containerId)!; it.fill = `url("${f.url}")`; it.fit = "cover"; }); s.toast(`${f.name} fills ${c.name}`); return; }
  const dim = await new Promise<{ w: number; h: number }>((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 400, h: 300 }); im.src = f.url; });
  const it = newInner(c, s.t, { name: f.name.replace(/\.[^.]+$/, ""), kind: "image", fill: `url("${f.url}")`, fit: "cover", tint: "--green", ...sized(c, dim.w, dim.h, false) });
  s.edit((p) => addAbove(p, containerId, it));
  s.select(it.id); done(f.name, c.name);
}

export async function placeVideoInside(containerId: string, fill: boolean) {
  const files = await new Promise<File[]>((res) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "video/*"; inp.onchange = () => res([...(inp.files ?? [])]); inp.click(); });
  if (!files.length) return;
  const [a] = await importFiles(files);
  const s = useStore.getState(), c = s.project.items.find((i) => i.id === containerId);
  if (!a || a.kind !== "video" || !c) return;
  const it = newInner(c, s.t, { name: a.name.replace(/\.[^.]+$/, ""), kind: "video", src: a.id, fill: "#000000", fit: "cover", tint: "--purple", ...sized(c, a.w || 1920, a.h || 1080, fill) });
  s.edit((p) => addAbove(p, containerId, it));
  s.select(it.id); done(a.name, c.name);
}

export function placeNewInside(containerId: string, kind: "text" | "shape") {
  const s = useStore.getState(), c = s.project.items.find((i) => i.id === containerId);
  if (!c) return;
  const it = kind === "text"
    ? newInner(c, s.t, { name: "Text", kind: "text", text: "Text", fontSize: Math.round(Math.max(24, Math.min(c.w, c.h) / 4)), color: "#111111", fill: "transparent", w: 200, h: 80, tint: "--orange" })
    : newInner(c, s.t, { name: "Shape", kind: "shape", shape: { type: "ellipse" }, fill: "#3A5BFF", w: Math.round(c.w / 2), h: Math.round(c.h / 2), tint: "--blue" });
  s.edit((p) => addAbove(p, containerId, it));
  s.select(it.id); done(kind === "text" ? "Text" : "A shape", c.name);
}

export function moveInside(containerId: string, childId: string) {
  const s = useStore.getState(), c = s.project.items.find((i) => i.id === containerId), ch = s.project.items.find((i) => i.id === childId);
  if (!c || !ch) return;
  s.edit((p) => putInside(p, containerId, childId));
  done(ch.name, c.name);
}

export function takeOut(childId: string) {
  useStore.getState().edit((p) => { const it = p.items.find((i) => i.id === childId); if (it) delete it.mask; });
}
