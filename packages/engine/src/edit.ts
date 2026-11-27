import { migrateTextAnim } from "./textanim";
import { allKeyTimes } from "./morph";
// Pure-ish edit helpers. They mutate the draft they are given (use with immer).
import { itemsInGroup, ownValue, parentState } from "./evaluate";
import { splitMotionAt } from "./motion";
import type { ItemKind, Ease, Item, Keyframe, Project, Prop, Seconds, Track } from "./types";

export const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}`;

const EPS = 1e-4;

/**
 * Set a value at absolute time t, auto-keying like a motion tool should:
 * - at the item's first frame, an un-animated property just takes the new value;
 * - anywhere else, the old value is pinned with a key on the first frame and the new
 *   value gets a key at t, so the item only moves between keyframes;
 * - an animated property gets (or updates) a key at t.
 */
/**
 * How close (s) the playhead must be to a keyframe to edit that keyframe instead of adding a new one.
 * The timeline sets it from its zoom so "close" means a few pixels on screen.
 */
export const keySnap = { s: 0.02 };
/** The keyframe time (from `times`) the playhead counts as being on, if any. */
export function keyAt(times: number[], local: number): number | null {
  let best: number | null = null, bd = keySnap.s;
  for (const k of times) { const d = Math.abs(k - local); if (d <= bd) { bd = d; best = k; } }
  return best;
}

/**
 * Auto-key. An item with no keyframes is simply changed everywhere (add a keyframe to start animating).
 * Once it has keyframes: on a keyframe (any property's), the change goes into that keyframe only.
 * A property animated for the first time gets keys at the item's other keyframes holding
 * its old value, so changing it at one keyframe never changes it at the others.
 */
export function setValue(item: Item, prop: Prop, t: Seconds, v: number) {
  let local = Math.min(Math.max(t - item.start, 0), item.end - item.start);
  const times = keyTimes(item);
  const near = keyAt(times, local);
  if (near != null) local = near;
  const keys = item.keys[prop];
  if (!keys?.length) {
    // no keyframes on the item yet: the edit changes the whole item
    if (!times.length) { item.base[prop] = v; return; }
    {
      const old = item.base[prop];
      item.keys[prop] = times.filter((k) => Math.abs(k - local) >= EPS).map((k) => ({ t: k, v: old, ease: "ease" as const }));
    }
  }
  addKey(item, prop, local, v);
}

export function addKey(item: Item, prop: Prop, local: Seconds, v?: number, ease: Ease = "ease") {
  // a path: a new node goes where the motion already is (and cuts its line there), so nothing moves
  if (item.kind === "motion" && (prop === "x" || prop === "y") && !item.keys[prop]?.some((k) => Math.abs(k.t - local) < EPS)) {
    splitMotionAt(item, local);
    if (v != null) { const k = item.keys[prop]?.find((q) => Math.abs(q.t - local) < EPS); if (k) k.v = v; }
    return;
  }
  const keys = (item.keys[prop] ??= []);
  const value = v ?? ownValue(item, prop, item.start + local);
  const hit = keys.find((k) => Math.abs(k.t - local) < EPS);
  if (hit) { hit.v = value; return; }
  keys.push({ t: local, v: value, ease });
  keys.sort((a, b) => a.t - b.t);
}

export function removeKey(item: Item, prop: Prop, local: Seconds) {
  const keys = item.keys[prop];
  if (!keys) return;
  const i = keys.findIndex((k) => Math.abs(k.t - local) < EPS);
  if (i >= 0) {
    const [k] = keys.splice(i, 1);
    if (!keys.length) { item.base[prop] = k.v; delete item.keys[prop]; }
  }
}

export function hasKeyAt(item: Item, prop: Prop, local: Seconds) {
  return !!item.keys[prop]?.some((k) => Math.abs(k.t - local) < EPS);
}

/** All key times (relative) across props, deduped. */
export function keyTimes(item: Item): Seconds[] {
  return allKeyTimes(item);
}

export function splitItem(project: Project, id: string, t: Seconds): Item | null {
  const it = project.items.find((i) => i.id === id);
  if (!it || t <= it.start + EPS || t >= it.end - EPS) return null;
  const cut = t - it.start;
  const b: Item = JSON.parse(JSON.stringify(it));
  b.id = uid("item");
  b.start = t;
  if (it.src) b.mediaOffset = (it.mediaOffset ?? 0) + cut;
  for (const [p, ks] of Object.entries(it.keys) as [Prop, Keyframe[]][]) {
    const vAtCut = ownValue(it, p, t);
    const left = ks.filter((k) => k.t <= cut + EPS);
    const right = ks.filter((k) => k.t > cut + EPS).map((k) => ({ ...k, t: k.t - cut }));
    it.keys[p] = left.length ? left : [{ t: 0, v: vAtCut, ease: "ease" }];
    b.keys[p] = [{ t: 0, v: vAtCut, ease: "ease" }, ...right];
  }
  // look / text keyframes: the second part continues from the cut
  if (it.lookKeys) for (const [k, ks] of Object.entries(it.lookKeys) as [string, Keyframe[]][]) {
    const left = ks.filter((q) => q.t <= cut + EPS), right = ks.filter((q) => q.t > cut + EPS).map((q) => ({ ...q, t: q.t - cut }));
    const v = left.length ? left[left.length - 1].v : ks[0].v;
    (it.lookKeys as Record<string, Keyframe[]>)[k] = left.length ? left : [{ t: 0, v, ease: "ease" }];
    (b.lookKeys as Record<string, Keyframe[]>)[k] = [{ t: 0, v, ease: "ease" }, ...right];
  }
  if (it.textKeys) {
    const left = it.textKeys.filter((q) => q.t <= cut + EPS), right = it.textKeys.filter((q) => q.t > cut + EPS).map((q) => ({ ...q, t: q.t - cut }));
    const txt = left.length ? left[left.length - 1].text : it.textKeys[0].text;
    it.textKeys = left.length ? left : [{ t: 0, text: txt }];
    b.textKeys = [{ t: 0, text: txt }, ...right];
  }
  if (it.shapeKeys) {
    const left = it.shapeKeys.filter((q) => q.t <= cut + EPS), right = it.shapeKeys.filter((q) => q.t > cut + EPS).map((q) => ({ ...q, t: q.t - cut }));
    const sp = left.length ? left[left.length - 1].spec : it.shapeKeys[0].spec;
    it.shapeKeys = left.length ? left : [{ t: 0, spec: sp }];
    b.shapeKeys = [{ t: 0, spec: sp }, ...right];
  }
  it.end = t;
  project.items.push(b);
  return b;
}

/** Shift every item on `trackId` that starts at/after `from` by `delta`. */
export function ripple(project: Project, trackId: string, from: Seconds, delta: number, except?: string) {
  for (const it of project.items) {
    if (it.trackId === trackId && it.id !== except && it.start >= from - EPS) {
      it.start += delta; it.end += delta;
    }
  }
}

export function snapTargets(project: Project, playhead: Seconds, exceptId?: string): Seconds[] {
  const out = [0, playhead, project.duration];
  for (const it of project.items) if (it.id !== exceptId) out.push(it.start, it.end);
  for (const m of project.markers ?? []) out.push(m.t);
  for (const k of project.canvasKeys ?? []) out.push(k);
  // canvas track: background and look clips
  for (const c of [...(project.backgrounds ?? []), ...project.effects]) if (c.id !== exceptId) out.push(c.start, c.end);
  for (const tr of project.tracks) for (const ks of Object.values(tr.keys ?? {})) ks?.forEach((k) => out.push(k.t));
  return out;
}

export function snap(t: Seconds, targets: Seconds[], tolerance: Seconds): [Seconds, Seconds | null] {
  let best: number | null = null, bd = tolerance;
  for (const g of targets) { const d = Math.abs(g - t); if (d < bd) { bd = d; best = g; } }
  return best == null ? [t, null] : [best, best];
}

/* ---------------- tracks ---------------- */

/** Visual tracks in display order (groups followed by their children), audio tracks last. */
export function orderTracks(project: Project) {
  const top = project.tracks.filter((t) => !t.parent || !project.tracks.some((g) => g.id === t.parent));
  for (const t of top) if (t.parent) delete t.parent; // a group that's gone frees its tracks
  const out: Track[] = [];
  // each group is followed by everything inside it (groups inside groups too)
  const emit = (t: Track, depth: number) => {
    out.push(t);
    if (t.kind === "group" && depth < 20) for (const c of project.tracks.filter((x) => x.parent === t.id)) emit(c, depth + 1);
  };
  for (const t of top.filter((t) => t.kind !== "audio")) emit(t, 0);
  out.push(...top.filter((t) => t.kind === "audio"));
  project.tracks = out;
}

export function addTrack(project: Project, kind: "video" | "audio"): string {
  const prefix = kind === "audio" ? "A" : "V";
  let n = 1;
  while (project.tracks.some((t) => t.id === `${prefix}${n}`)) n++;
  const id = `${prefix}${n}`;
  project.tracks.unshift({ id, name: kind === "audio" ? `Audio ${n}` : `Track ${n}`, kind });
  orderTracks(project);
  return id;
}

/** Insert a new track directly under `afterId` (inside the same group, if any). */
export function insertTrackAfter(project: Project, afterId: string): string {
  const after = project.tracks.find((t) => t.id === afterId);
  const kind = after?.kind === "audio" ? "audio" : "video";
  const prefix = kind === "audio" ? "A" : after?.parent ? "H" : "V";
  let n = 1;
  while (project.tracks.some((t) => t.id === `${prefix}${n}`)) n++;
  const id = `${prefix}${n}`;
  const t: Track = { id, name: kind === "audio" ? `Audio ${n}` : `Track ${n}`, kind };
  // a new track under a group header goes inside that group
  if (after?.kind === "group") t.parent = after.id;
  else if (after?.parent) t.parent = after.parent;
  let at = project.tracks.indexOf(after!) + 1;
  // skip past a folded group's children so the new track lands after the whole group
  if (after?.kind === "group" && !after.open) { delete t.parent; while (project.tracks[at]?.parent === after.id) at++; }
  project.tracks.splice(after ? at : 0, 0, t);
  orderTracks(project);
  return id;
}

/** Wrap normal top-level tracks into a new group track. Returns the group id or null. */
export function groupTracks(project: Project, ids: string[], name?: string): string | null {
  // tracks and groups side by side (same parent) go into a new group there — so groups can be grouped too
  const first = project.tracks.find((t) => ids.includes(t.id) && (t.kind === "video" || t.kind === "group"));
  if (!first) return null;
  const pick = project.tracks.filter((t) => ids.includes(t.id) && (t.kind === "video" || t.kind === "group") && t.parent === first.parent);
  let n = 1;
  while (project.tracks.some((t) => t.id === `G${n}`)) n++;
  const gid = `G${n}`;
  const at = project.tracks.indexOf(pick[0]);
  project.tracks.splice(at, 0, { id: gid, name: name ?? `Group ${n}`, kind: "group", open: true, keys: {}, ...(first.parent ? { parent: first.parent } : {}) });
  for (const t of pick) t.parent = gid;
  orderTracks(project);
  return gid;
}

export function ungroupTrack(project: Project, gid: string) {
  const g = project.tracks.find((t) => t.id === gid && t.kind === "group");
  if (!g) return;
  // what the group carried goes to what was in it: its mask and its parent (each piece keeps its own if it has one)
  for (const t of project.tracks.filter((x) => x.parent === gid)) {
    if (t.kind === "group") {
      if (g.mask && !t.mask) t.mask = { ...g.mask };
      if (g.parentLink && !t.parentLink) t.parentLink = { ...g.parentLink };
    } else for (const it of project.items.filter((i) => i.trackId === t.id)) {
      if (g.mask && !it.mask && g.mask.by !== it.id) it.mask = { ...g.mask };
      if (g.parentLink && !it.parentLink && g.parentLink.id !== it.id) it.parentLink = { ...g.parentLink };
    }
  }
  // anything masked by the group itself is masked by nothing now (there's no group left to cut with)
  for (const it of project.items) if (it.mask?.by === gid) delete it.mask;
  for (const t of project.tracks) if (t.mask?.by === gid) delete t.mask;
  // its tracks (and groups) move up one level
  for (const t of project.tracks) if (t.parent === gid) { if (g.parent) t.parent = g.parent; else delete t.parent; }
  project.tracks = project.tracks.filter((t) => t !== g);
  orderTracks(project);
}

/* ---------------- layer order ----------------
 * Stacking comes from track order: upper tracks draw on top. Moving an item
 * forward/backward moves it to the neighbouring track (among its siblings, i.e.
 * inside the same group), adding a new track when the neighbour is busy.
 */
export type LayerMove = "front" | "forward" | "backward" | "back";

function freeOn(project: Project, trackId: string, it: Item) {
  return !project.items.some((o) => o !== it && o.trackId === trackId && o.start < it.end - EPS && o.end > it.start + EPS);
}

function newTrackNear(project: Project, ref: Track, where: "above" | "below"): Track {
  const prefix = ref.parent ? "H" : "V";
  let n = 1;
  while (project.tracks.some((t) => t.id === `${prefix}${n}`)) n++;
  const t: Track = { id: `${prefix}${n}`, name: `Track ${n}`, kind: "video", ...(ref.parent ? { parent: ref.parent } : {}) };
  let i = project.tracks.indexOf(ref);
  if (where === "below") { i++; if (ref.kind === "group") while (project.tracks[i]?.parent === ref.id) i++; }
  project.tracks.splice(i, 0, t);
  return t;
}

/** Returns false when the item is already at that end of the stack. */
export function moveLayer(project: Project, itemId: string, dir: LayerMove): boolean {
  const it = project.items.find((i) => i.id === itemId);
  const cur = it && project.tracks.find((t) => t.id === it.trackId);
  if (!it || !cur) return false;
  // siblings: normal tracks and whole groups at the same level (a group stacks as one layer)
  const sib = project.tracks.filter((t) => (t.kind === "video" || t.kind === "group") && t.parent === cur.parent);
  const idx = sib.indexOf(cur);
  // only layers that actually hold something overlapping in time affect what's in front
  const busy = (t: Track) => t.kind === "group"
    ? project.tracks.some((c) => c.parent === t.id && !freeOn(project, c.id, it))
    : !freeOn(project, t.id, it);
  const usable = (t: Track | undefined) => !!t && t.kind === "video" && freeOn(project, t.id, it);
  if (dir === "forward" || dir === "front") {
    const above = sib.slice(0, idx).filter(busy);
    if (!above.length) return false;
    const target = dir === "forward" ? above[above.length - 1] : above[0];
    const slot = sib[sib.indexOf(target) - 1];
    it.trackId = usable(slot) ? slot.id : newTrackNear(project, target, "above").id;
  } else {
    const below = sib.slice(idx + 1).filter(busy);
    if (!below.length) return false;
    const target = dir === "backward" ? below[0] : below[below.length - 1];
    const slot = sib[sib.indexOf(target) + 1];
    it.trackId = usable(slot) ? slot.id : newTrackNear(project, target, "below").id;
  }
  return true;
}

/**
 * Group items: a new group track gets one nested track per item (top item first),
 * placed where the highest of those items was. Normal tracks left empty are removed.
 * Returns the group id, or null when fewer than two visual items were given.
 */
export function groupItems(project: Project, ids: string[], name?: string): string | null {
  const items = ids.map((id) => project.items.find((i) => i.id === id)).filter((i): i is Item => !!i && i.kind !== "audio");
  if (items.length < 2) return null;
  const rank = (id: string) => project.tracks.findIndex((t) => t.id === id);
  const path = (it: Item) => upChain(project, it.trackId).map((t) => t.id); // item's track, its group, …, outermost
  const paths = items.map(path);
  // the innermost group holding all of them (or none): the new group goes there
  const common = paths[0].slice(1).find((g) => paths.every((p) => p.includes(g)));
  // what of each item sits directly in that place: its own track, or a group around it
  const nodeOf = (p: string[]) => { const k = common ? p.indexOf(common) : p.length; return p[Math.max(0, k - 1)]; };
  const nodes = [...new Set(paths.map(nodeOf))].sort((a, b) => rank(a) - rank(b));
  const used = new Set(project.tracks.map((t) => t.id));
  const nextId = (prefix: string) => { let n = 1; while (used.has(`${prefix}${n}`)) n++; used.add(`${prefix}${n}`); return `${prefix}${n}`; };
  const gid = nextId("G");
  const top = project.tracks.find((t) => t.id === nodes[0])!;
  const oldTracks = new Set(items.map((it) => it.trackId));
  const group: Track = { id: gid, name: name ?? `Group ${gid.slice(1)}`, kind: "group", open: true, keys: {}, ...(common ? { parent: common } : {}) };
  let kidN = 0;
  for (const nid of nodes) {
    const t = project.tracks.find((x) => x.id === nid)!;
    if (t.kind === "group") { t.parent = gid; continue; } // a whole group goes inside
    // an item's own track: the chosen items on it move to a fresh track in the new group, at that track's place
    // in the stack (so what was in front stays in front — a mask stays under what it holds)
    const fresh: Track[] = [];
    for (const it of items.filter((x) => x.trackId === nid)) { const k: Track = { id: nextId("H"), name: `Track ${++kidN}`, kind: "video", parent: gid }; fresh.push(k); it.trackId = k.id; }
    project.tracks.splice(project.tracks.indexOf(t), 0, ...fresh);
  }
  project.tracks.splice(project.tracks.indexOf(top) >= 0 ? Math.min(project.tracks.indexOf(top), ...project.tracks.map((x, i) => (x.parent === gid ? i : Infinity))) : 0, 0, group);
  // remove tracks the items left empty (keep at least one normal track)
  project.tracks = project.tracks.filter((t) => {
    if (!oldTracks.has(t.id) || t.kind !== "video" || project.items.some((i) => i.trackId === t.id)) return true;
    return project.tracks.filter((x) => x.kind === "video" && !x.parent && x.id !== t.id).length === 0;
  });
  // a group with nothing left inside goes too
  project.tracks = project.tracks.filter((t) => t.kind !== "group" || t.id === gid || project.tracks.some((c) => c.parent === t.id));
  orderTracks(project);
  return gid;
}

/* ---------------- track visibility / lock (a group's setting covers its tracks) ---------------- */
/** A track and every group around it. */
function upChain(project: Project, trackId: string): Track[] {
  const out: Track[] = [];
  let t = project.tracks.find((x) => x.id === trackId);
  for (let n = 0; t && n < 22; n++) { out.push(t); t = t.parent ? project.tracks.find((x) => x.id === t!.parent) : undefined; }
  return out;
}
export function trackHidden(project: Project, trackId: string): boolean {
  return upChain(project, trackId).some((t) => t.muted);
}
export function trackLocked(project: Project, trackId: string): boolean {
  return upChain(project, trackId).some((t) => t.locked);
}

/* ---------------- video length ---------------- */
/** Where the last item ends (0 when there are none). */
export function contentEnd(project: Project): Seconds {
  // items, and every canvas after the first (a new canvas makes the video longer)
  const bgs = project.backgrounds ?? [];
  const canv = bgs.length > 1 ? Math.max(...bgs.map((b) => b.end)) : 0;
  return Math.max(canv, project.items.reduce((m, i) => Math.max(m, i.end), 0));
}
/** With automatic length, the video ends where the last item ends. An empty project keeps its length. */
export function fitLength(project: Project) {
  if (project.autoLength === false) return;
  const end = contentEnd(project);
  if (end > 0) project.duration = Math.max(0.1, Math.round(end * 1000) / 1000);
}

/** Bring a loaded project up to date (older text animations, automatic length). */
/**
 * Tracks with nothing on them go: a row with no items (and a group with no tracks left in it). Placing an item
 * makes a track when it needs one. Returns whether anything was removed.
 */
export function dropEmptyTracks(project: Project): boolean {
  let changed = false;
  for (;;) {
    const used = new Set(project.items.map((i) => i.trackId));
    const parents = new Set(project.tracks.map((t) => t.parent).filter(Boolean));
    const keep = project.tracks.filter((t) => used.has(t.id) || parents.has(t.id));
    if (keep.length === project.tracks.length) return changed;
    project.tracks = keep; changed = true;
  }
}

export function normalizeProject(project: Project) {
  for (const it of project.items) migrateTextAnim(it);
  dropEmptyTracks(project);
  unifyTracks(project);
  if (hasLanes(project)) flattenLanes(project);
  fitLength(project);
  repairCanvas(project);
  upgradePaths(project);
  dropMaskParents(project);
}

/** Remove the parent links masks made (masks no longer become parents; links made by hand stay). */
export function dropMaskParents(project: Project) {
  for (const it of project.items) if (it.parentLink?.auto) delete it.parentLink;
  for (const tr of project.tracks) if (tr.parentLink?.auto) delete tr.parentLink;
}

/**
 * Canvas parts and their looks, put back in step (older versions could leave them apart): a look that starts with a
 * part and stops partway through it runs to the part's end again, and the last part reaches the end of the video.
 */
/** Paths from before their own turn / tilt / size: node turns (then kept in rz keys) move to numKeys.turn. */
export function upgradePaths(project: Project) {
  for (const m of project.items) {
    if (m.kind !== "motion" || m.pathV2) continue;
    if (m.keys.rz?.length) { (m.numKeys ??= {}).turn = m.keys.rz.map((k) => ({ ...k })); delete m.keys.rz; }
    m.base.rz = 0; m.base.rx = 0; m.base.ry = 0; m.base.scale = 1;
    delete m.keys.rx; delete m.keys.ry; delete m.keys.scale;
    m.pathV2 = true;
  }
}

export function repairCanvas(project: Project) {
  const parts = [...(project.backgrounds ?? [])].sort((a, b) => a.start - b.start);
  if (!parts.length) return;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
  const last = parts[parts.length - 1], dur = project.duration ?? 0;
  if (dur > last.end + 0.01) {
    for (const f of project.effects ?? []) if (near(f.end, last.end) && f.start >= last.start - 0.03) f.end = dur;
    last.end = dur;
  }
  for (const b of parts) {
    for (const f of project.effects ?? []) {
      // a look of this part (it starts with the part) that ends early, with nothing of its kind after it in the part
      if (!near(f.start, b.start) || f.end >= b.end - 0.03 || f.end <= b.start) continue;
      const later = (project.effects ?? []).some((g) => g !== f && g.kind === f.kind && g.start >= f.end - 0.03 && g.start < b.end - 0.03);
      if (!later) f.end = b.end;
    }
  }
}

/* ---------------- rows: every track is one row; rows come and go as they're needed ---------------- */
export const LANE_H = 30;
/** (Rows no longer hold lanes: always 1.) */
export function laneCount(_project: Project, _trackId: string): number { return 1; }
/** Is a row empty between s and e? */
export function rowFree(project: Project, trackId: string, s: Seconds, e: Seconds, exceptId?: string): boolean {
  return !project.items.some((o) => o.id !== exceptId && o.trackId === trackId && o.start < e - 1e-4 && o.end > s + 1e-4);
}
export function laneFree(project: Project, trackId: string, _lane: number, s: Seconds, e: Seconds, exceptId?: string): boolean {
  return rowFree(project, trackId, s, e, exceptId);
}
/** A new empty row right above or below another one (inside the same group). */
export function insertRow(project: Project, nearId: string, below = true): string {
  if (below) return insertTrackAfter(project, nearId);
  const near = project.tracks.find((t) => t.id === nearId);
  const prev = near ? project.tracks[project.tracks.indexOf(near) - 1] : undefined;
  // above the first row of a group (or the first row of all): insert after the header, or at the very top
  if (prev && (prev.parent === near?.parent || prev.id === near?.parent)) return insertTrackAfter(project, prev.id);
  const id = insertTrackAfter(project, nearId);
  const t = project.tracks.find((x) => x.id === id)!;
  project.tracks.splice(project.tracks.indexOf(t), 1);
  project.tracks.splice(project.tracks.indexOf(near!), 0, t);
  return id;
}
/** The first row below `fromId` (same kind and group) with room for s..e, or a new row right below it. */
export function rowBelow(project: Project, fromId: string, s: Seconds, e: Seconds, exceptId?: string): string {
  const from = project.tracks.find((t) => t.id === fromId);
  if (!from) return fromId;
  const i = project.tracks.indexOf(from);
  let last = from.id;
  for (const t of project.tracks.slice(i + 1)) {
    if (t.kind !== from.kind || t.parent !== from.parent) break;
    if (rowFree(project, t.id, s, e, exceptId)) return t.id;
    last = t.id;
  }
  return insertRow(project, last, true);
}
/** Kept for older callers: rows have no lanes, so this is always 0. */
export function firstFreeLane(_project: Project, _trackId: string, _s: Seconds, _e: Seconds, _from = 0, _exceptId?: string): number { return 0; }
export function compactLanes(_project: Project, _trackId: string) { /* rows have no lanes */ }

/** Older projects had lanes inside tracks: each lane becomes a row of its own, right below. */
export function flattenLanes(project: Project) {
  for (const t of [...project.tracks]) {
    if (t.kind === "group") { delete t.lanes; continue; }
    const items = project.items.filter((i) => i.trackId === t.id && (i.lane ?? 0) > 0);
    const n = Math.max(t.lanes?.length ?? 1, ...items.map((i) => (i.lane ?? 0) + 1));
    let after = t.id;
    for (let l = 1; l < n; l++) {
      const its = items.filter((i) => i.lane === l);
      if (!its.length) continue;
      const id = insertTrackAfter(project, after), nt = project.tracks.find((x) => x.id === id)!;
      if (t.lanes?.[l]?.hidden) nt.muted = true;
      if (t.lanes?.[l]?.locked) nt.locked = true;
      for (const i of its) i.trackId = id;
      after = id;
    }
    if (t.lanes?.[0]?.hidden) t.muted = true;
    if (t.lanes?.[0]?.locked) t.locked = true;
    delete t.lanes;
  }
  for (const i of project.items) delete i.lane;
}
export const hasLanes = (p: Project) => p.items.some((i) => i.lane != null) || p.tracks.some((t) => t.lanes);

/** Remove rows with nothing on them. The video keeps at least one row, and a group at least one. */
export function pruneRows(project: Project) {
  const used = new Set(project.items.map((i) => i.trackId));
  const keep = new Set<string>();
  for (const t of project.tracks) if (t.kind === "group" || used.has(t.id)) keep.add(t.id);
  for (const g of project.tracks.filter((t) => t.kind === "group")) {
    const kids = project.tracks.filter((t) => t.parent === g.id);
    if (kids.length && !kids.some((k) => keep.has(k.id))) keep.add(kids[0].id);
  }
  if (!project.tracks.some((t) => keep.has(t.id) && t.kind === "video")) {
    const first = project.tracks.find((t) => t.kind === "video" && !t.parent);
    if (first) keep.add(first.id);
  }
  if (keep.size !== project.tracks.length) project.tracks = project.tracks.filter((t) => keep.has(t.id));
}

/** Delete a track and everything on it (a group header only ungroups its tracks). */
export function deleteTrack(project: Project, trackId: string) {
  const t = project.tracks.find((x) => x.id === trackId);
  if (!t) return;
  if (t.kind === "group") { for (const c of project.tracks) if (c.parent === t.id) delete c.parent; }
  const gone = new Set(project.items.filter((i) => i.trackId === trackId).map((i) => i.id));
  project.items = project.items.filter((i) => !gone.has(i.id));
  for (const i of project.items) {
    if (i.follow && gone.has(i.follow.motionId)) delete i.follow;
    if (i.mask && gone.has(i.mask.by)) delete i.mask;
    if (i.onPath && gone.has(i.onPath)) delete i.onPath;
  }
  project.tracks = project.tracks.filter((x) => x.id !== trackId);
}
/** Every track holds any kind of item (older projects had separate audio tracks). */
export function unifyTracks(project: Project) { for (const t of project.tracks) if (t.kind === "audio") t.kind = "video"; }

/** Ways to order the track list in the timeline. "layer" is the real order (front to back); the others only change the view. */
export type TrackSort = "layer" | "type" | "start" | "created" | "name";
export const TRACK_SORTS: { id: TrackSort; label: string }[] = [
  { id: "layer", label: "Layer" }, { id: "type", label: "Type" }, { id: "start", label: "Start" }, { id: "created", label: "Created" }, { id: "name", label: "Name" },
];
const KIND_ORDER: ItemKind[] = ["text", "rect", "ellipse", "star", "shape", "line", "glass", "image", "video", "motion", "audio"];
/** The tracks in the order a sort shows them (groups keep their tracks under them). */
export function sortTracks(project: Project, mode: TrackSort): Track[] {
  if (mode === "layer") return project.tracks;
  const index = new Map(project.items.map((it, i) => [it.id, i]));
  const itemsOf = (t: Track) => project.items.filter((i) => i.trackId === t.id || (t.kind === "group" && project.tracks.some((c) => c.parent === t.id && c.id === i.trackId)));
  const key = (t: Track): number | string => {
    const its = itemsOf(t);
    if (!its.length) return mode === "name" ? "\uffff" : Infinity;
    switch (mode) {
      case "type": return Math.min(...its.map((i) => { const k = KIND_ORDER.indexOf(i.kind); return k < 0 ? 50 : k; }));
      case "start": return Math.min(...its.map((i) => i.start));
      case "created": return Math.min(...its.map((i) => index.get(i.id) ?? 0));
      case "name": return [...its].sort((a, b) => a.start - b.start)[0].name.toLowerCase();
    }
  };
  const cmp = (a: Track, b: Track) => { const ka = key(a), kb = key(b); return ka < kb ? -1 : ka > kb ? 1 : project.tracks.indexOf(a) - project.tracks.indexOf(b); };
  const out: Track[] = [];
  const emit = (t: Track, depth: number) => {
    out.push(t);
    if (t.kind === "group" && depth < 20) for (const c of project.tracks.filter((x) => x.parent === t.id).sort(cmp)) emit(c, depth + 1);
  };
  for (const t of project.tracks.filter((x) => !x.parent).sort(cmp)) emit(t, 0);
  return out;
}

/** Where a new item goes: the selected item's row if there's room, else the first free row from the top, else a new row on top. */
export function placeItem(project: Project, _kind: "video" | "audio", s: Seconds, e: Seconds, preferTrackId?: string, newId = () => "V" + Math.random().toString(36).slice(2, 6)): { trackId: string; lane: number } {
  // any track takes any item (sounds included)
  const pref = preferTrackId ? project.tracks.find((t) => t.id === preferTrackId && t.kind !== "group") : undefined;
  if (pref && rowFree(project, pref.id, s, e)) return { trackId: pref.id, lane: 0 };
  const rows = project.tracks.filter((t) => t.kind !== "group" && !t.parent);
  const free = rows.find((t) => rowFree(project, t.id, s, e));
  if (free) return { trackId: free.id, lane: 0 };
  if (rows.length) return { trackId: insertRow(project, rows[0].id, false), lane: 0 };
  const tr: Track = { id: newId(), name: "Track 1", kind: "video" };
  project.tracks.unshift(tr);
  return { trackId: tr.id, lane: 0 };
}
export function itemHidden(project: Project, it: Item): boolean {
  const t = project.tracks.find((x) => x.id === it.trackId);
  return trackHidden(project, it.trackId) || !!t?.lanes?.[0]?.hidden;
}
export function itemLocked(project: Project, it: Item): boolean {
  const t = project.tracks.find((x) => x.id === it.trackId);
  return !!it.locked || trackLocked(project, it.trackId) || !!t?.lanes?.[0]?.locked;
}

/**
 * A mask that takes what it masks along ("Takes this along", the default) is its parent: the item (or the whole
 * group) moves, turns and grows with it — when it's dragged, keyframed or moved in time. "Leaves this put" (or no
 * mask) removes that link. Links made by hand are left alone. Run after every edit.
 */
export function syncMaskParents(p: Project, t: Seconds) {
  const link = (by: Item, child: Item | Track) => {
    const P = parentState(p, by, Math.min(Math.max(t, by.start), by.end - 1e-3), child);
    return { id: by.id, x0: P.x, y0: P.y, rz0: P.rz, s0: P.scale, auto: true };
  };
  const want = (m: Item["mask"]) => (m && !m.free ? p.items.find((i) => i.id === m.by) : undefined);
  for (const it of p.items) {
    const by = want(it.mask);
    if (by && by.id !== it.id && by.parentLink?.id !== it.id) { if (!it.parentLink || (it.parentLink.auto && it.parentLink.id !== by.id)) it.parentLink = link(by, it); }
    else if (it.parentLink?.auto) delete it.parentLink;
  }
  for (const tr of p.tracks) {
    if (tr.kind !== "group") continue;
    const by = want(tr.mask);
    const inside = by && itemsInGroup(p, tr.id).some((i) => i.id === by.id);
    if (by && !inside) { if (!tr.parentLink || (tr.parentLink.auto && tr.parentLink.id !== by.id)) tr.parentLink = link(by, tr); }
    else if (tr.parentLink?.auto) delete tr.parentLink;
  }
}
