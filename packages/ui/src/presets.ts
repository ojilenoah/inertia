import { useEffect, useState } from "react";
import type { Item, Project } from "@moshion/engine";
import { placeItem, uid } from "@moshion/engine";
import { useStore } from "./store";

/*
 * Item presets: a styled, animated item saved to reuse in any project.
 * Kept in this browser and, when the dev server's project folder is available, in that folder too
 * (so every browser on the computer sees the same presets).
 */
export interface Preset { id: string; name: string; item: Item; savedAt: number }
const KEY = "moshion.presets.v1";
let list: Preset[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Preset[]; } catch { return []; } })();
const subs = new Set<(p: Preset[]) => void>();
function store(next: Preset[], push = true) {
  list = next;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full */ }
  subs.forEach((f) => f(list));
  if (push) fetch("/__moshion/project/presets", { method: "PUT", body: JSON.stringify({ presets: list }) }).catch(() => {});
}
/** Pull presets saved by other browsers (dev server folder). */
export async function syncPresets() {
  try {
    const r = await fetch("/__moshion/project/presets", { cache: "no-store" });
    if (!r.ok) return;
    const remote = ((await r.json()) as { presets?: Preset[] }).presets ?? [];
    const merged = [...list];
    for (const p of remote) if (!merged.some((q) => q.id === p.id)) merged.push(p);
    store(merged.sort((a, b) => b.savedAt - a.savedAt), merged.length !== remote.length);
  } catch { /* not on the dev server */ }
}
export function usePresets() {
  const [p, set] = useState(list);
  useEffect(() => { subs.add(set); set(list); return () => { subs.delete(set); }; }, []);
  return p;
}

export function savePreset(item: Item) {
  const copy: Item = JSON.parse(JSON.stringify(item));
  store([{ id: uid("preset"), name: item.name, item: copy, savedAt: Date.now() }, ...list]);
  useStore.getState().toast("Saved as a preset");
}
export function deletePreset(id: string) { store(list.filter((p) => p.id !== id)); }

/** Put a preset into the project at the playhead. */
export function usePreset(p: Preset) {
  const { project, t, edit, select, toast } = useStore.getState();
  const it: Item = JSON.parse(JSON.stringify(p.item));
  const len = it.end - it.start;
  it.id = uid("item"); it.start = Math.max(0, Math.min(t, project.duration)); it.end = it.start + len;
  delete it.follow; delete it.mask; delete it.onPath; // links to other items don't travel between projects
  edit((d: Project) => {
    const pl = placeItem(d, "video", it.start, it.end, useStore.getState().project.items.find((q) => q.id === useStore.getState().selected)?.trackId, () => uid("V"));
    const trackId = pl.trackId; it.lane = pl.lane;
    it.trackId = trackId;
    d.items.push(it);
  });
  select(it.id);
  toast(`${p.name} added`);
}
