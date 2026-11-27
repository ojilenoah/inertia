import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
/** Popups drawn at the app's top level: never shut inside a track's own layer (or under the phone's blur). */
const topLayer = () => (document.querySelector(".mo") as HTMLElement | null) ?? document.body;
import type { Bezier, EaseName, Item, Keyframe, Project, Prop, Track, TrackSort } from "@moshion/engine";
import {
  EASE_PRESETS, sampleKeys, remapKeyTimes, smoothValue, backgroundCSS, TRACK_SORTS, sortTracks, deleteTrack, insertRow, insertTrackAfter, rowFree, TRANSITIONS, addCanvasKey, splitBackground, moveCanvasKey, removeCanvasKey, contentEnd, itemHidden, itemLocked, keyAt, keySnap, loopLabel, stepLabel, uid, NICE_STEPS, PROP_LABEL, PROPS, SCENE_EFFECTS, addKey, fmtClock, fmtStep, fmtTick, groupTracks, keyTimes,
  ownValue, removeKey, removeLookAndTextKeys, ripple, shiftLookAndTextKeys, snap, snapTargets, splitItem, toBezier, ungroupTrack,
} from "@moshion/engine";
import type { NumKey } from "@moshion/engine";
import { itemsInGroup, orderTracks, addCanvas, canvases, insertCanvasAfter } from "@moshion/engine";
import type { Background } from "@moshion/engine";
import { numAt as numAtE } from "@moshion/engine";
import { addMarker, copyKeyframe, hasKeyClip, loopIn, loopOut, pasteKeyframe, toggleLock } from "./editing";
import { AnimatePresence, motion } from "motion/react";
import { anim } from "./anim";
import type { PinchDetail } from "./touch";
import { openPanelAt, pickedCount, pickedOn, useStore } from "./store";
import { Icon } from "./Icon";
import { placeAsset } from "./media";
import { LoopButton, PlayerBar, Transport } from "./Panels";
import { useAppliedUiScale, useStacked } from "./layout";
import { Fader } from "./Fader";
import { askConfirm } from "./Confirm";
import { PEAKS_PER_SEC, usePeaks } from "./waveform";
import { thumbs, thumbTime, videoSource } from "./videoengine";
import { mediaTime as mediaTimeE } from "@moshion/engine";

const ZMAX = 6.5;
/** Zoom fader runs 0..ZSTEPS for fine control over the log zoom range. */
const ZSTEPS = 10000;
const v2pps = (v: number) => 2 * 10 ** ((v / ZSTEPS) * ZMAX);
const pps2v = (p: number) => (Math.log10(p / 2) / ZMAX) * ZSTEPS;
const GRAPH_H = 160;
/** Space at the top of the graph row for its own controls, kept clear of the curves. */
const GRAPH_TOP = 12;

type Row =
  | { kind: "track"; track: Track; h: number }
  | { kind: "graph"; item: Item; h: number; group?: string }
  | { kind: "canvas"; h: number };

const canvasH = (_p: Project) => CV_H;
/** Height of a row in the timeline (clips are ROW_H - 2 × CLIP_PAD tall). Phones use thinner rows (set by the timeline). */
let ROW_H = 32, CLIP_PAD = 4;
/** The background (canvas) row: phones give it more height than a track row. */
let CV_H = 32;
/** Phones: thin rows that keep the same size on screen whatever the interface size. */
function setRowSize(phone: boolean, uiScale: number) {
  const k = Math.min(1, Math.max(0.5, uiScale || 1));
  // phones: rows only a little taller than their clips (no lines between them), so more tracks fit; the same size
  // on screen at any interface size
  ROW_H = phone ? Math.round(28 / k) : 32;
  CLIP_PAD = phone ? Math.round(1.5 / k) : 4;
  CV_H = phone ? Math.round(40 / k) : ROW_H;
}

/** Normal and group tracks, then audio tracks, then the canvas track at the very bottom. */
/** A group's own keys look like an item spanning the whole scene, so the same graph editor works on them. */
function groupAsItem(p: Project, g: Track): Item {
  return {
    id: g.id, name: g.name, kind: "rect", trackId: g.id, start: 0, end: p.duration, w: 0, h: 0, fill: "", tint: "",
    base: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1, ...g.base } as Item["base"], keys: g.keys ?? {},
  } as Item;
}

function visibleRows(p: Project, selected: string | null, graph: boolean, selGroup: string | null = null, sort: TrackSort = "layer"): Row[] {
  const sel = p.items.find((i) => i.id === selected);
  const rows: Row[] = [];
  const push = (tr: Track) => {
    // hidden while any group around it is folded
    for (let par = tr.parent, n = 0; par && n < 20; n++) { const g = p.tracks.find((x) => x.id === par); if (!g) break; if (!g.open) return; par = g.parent; }
    rows.push({ kind: "track", track: tr, h: tr.kind === "group" && ROW_H >= 30 ? 30 : ROW_H });
    if (graph && !sel && tr.kind === "group" && selGroup === tr.id && Object.values(tr.keys ?? {}).some((k) => k && k.length)) rows.push({ kind: "graph", item: groupAsItem(p, tr), h: GRAPH_H, group: tr.id });
    if (graph && sel && sel.trackId === tr.id && sel.kind !== "audio" && (Object.values(sel.keys).some((k) => k && k.length) || !!sel.numKeys?.pathOffset?.length || !!sel.numKeys?.pathGap?.length)) rows.push({ kind: "graph", item: sel, h: GRAPH_H });
  };
  sortTracks(p, sort).forEach(push);
  return rows;
}

export function Timeline() {
  const project = useStore((s) => s.project);
  const t = useStore((s) => s.t);
  const selected = useStore((s) => s.selected);
  const ui = useStore((s) => s.ui);
  const { setT, select, edit, checkpoint, setUI, toast } = useStore.getState();

  const lanesRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [tlBox, setTlBox] = useState<{ left: number; top: number; width: number; height: number; keys: boolean } | null>(null);
  /** Track under a dragged item: ok = it moved there, !ok = that track is busy at this time. */
  const [drop, setDrop] = useState<{ id: string; ok: boolean; ins?: "above" | "below" } | null>(null);
  // a clip being moved between rows follows the pointer up and down (dy from its row), then glides into place
  const [lift, setLift] = useState<{ id: string; dy: number } | null>(null);
  const glide = useRef<{ id: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const g = glide.current;
    if (!g) return;
    glide.current = null;
    const el = rowsRef.current?.querySelector<HTMLElement>(`.clip[data-item="${CSS.escape(g.id)}"]`);
    if (!el) return;
    const d = g.top - el.getBoundingClientRect().top;
    if (Math.abs(d) > 0.5) el.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
  });

  useEffect(() => {
    const el = lanesRef.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // first layout: fit the whole scene
  // keep the whole scene fitted until the user zooms or scrolls the timeline themselves
  const userZoomed = useRef(false);
  useEffect(() => {
    if (!userZoomed.current && W > 100) setUI({ pps: (W - 36) / (project.duration * 1.25 + 0.5), viewStart: 0 });
  }, [W, project.id]);

  const { pps, viewStart } = ui;
  /** Breathing room between the track names and the first frame. */
  const PAD = 12;
  const x = (tt: number) => (tt - viewStart) * pps + PAD;
  const tOf = (px: number) => (px - PAD) / pps + viewStart;
  // the playhead "touches" a keyframe when it is within ~7px of it at this zoom
  keySnap.s = Math.min(0.5, Math.max(0.02, 7 / ui.pps));
  const phone = useStacked();
  // the track names column; collapsed on a phone it hugs the eye / lock buttons
  const headW = phone && ui.hdrW < 56 ? 40 : ui.hdrW;
  // rows keep their size on screen at whatever interface size is really in effect
  const uiK = useAppliedUiScale();
  setRowSize(phone, uiK);
  const rows = useMemo(() => visibleRows(project, selected, ui.graph, ui.selGroup, ui.trackSort), [project, selected, ui.graph, ui.selGroup, ui.trackSort, phone, uiK]);

  // ruler
  const major = NICE_STEPS.find((n) => n * pps >= 90) ?? 600;
  const minor = major / 5;
  const ticks: { x: number; maj: boolean; label?: string }[] = [];
  const t0 = Math.floor(viewStart / minor) * minor;
  for (let i = 0; i < 400; i++) {
    const tt = t0 + i * minor, px = x(tt);
    if (px > W) break;
    if (px < -2) continue;
    const maj = Math.abs(tt / major - Math.round(tt / major)) < 1e-6;
    ticks.push({ x: px, maj, label: maj ? fmtTick(Math.max(0, tt), major) : undefined });
  }
  // beside the zoom slider: how far apart the ruler's small ticks are (whole frames when zoomed in that far)
  const tickFrames = minor * project.fps;
  const tickLabel = W / pps <= 4 && tickFrames >= 1 && Math.abs(tickFrames - Math.round(tickFrames)) < 1e-6 ? `${Math.round(tickFrames)}f`
    : minor >= 0.1 ? `${+minor.toPrecision(3)}s` : fmtStep(minor);
  const fpx = pps / project.fps;

  function zoomTo(p: number, anchorX = x(t)) {
    userZoomed.current = true;
    p = Math.min(Math.max(p, 2), 2 * 10 ** ZMAX);
    const ta = tOf(anchorX);
    setUI({ pps: p, viewStart: Math.max(0, ta - (anchorX - PAD) / p) });
  }

  function scrub(e: { clientX: number }) {
    const r = lanesRef.current!.getBoundingClientRect();
    let tt = Math.min(Math.max(tOf(e.clientX - r.left), 0), project.duration);
    if (ui.snap && pps <= 6000) tt = Math.round(tt * project.fps) / project.fps;
    setT(tt);
  }
  // the ruler's menu (right-click, or hold a finger on it): marker and loop ends at that spot
  const [rmenu, setRmenu] = useState<{ x: number; y: number } | null>(null);
  // two fingers on the tracks: pinch to zoom the time, drag to scroll
  const pinchRef = useRef<(d: PinchDetail) => void>(() => {});
  pinchRef.current = (d) => {
    const r = lanesRef.current?.getBoundingClientRect();
    if (!r) return;
    if (Math.abs(d.scale - 1) > 0.002) zoomTo(pps * d.scale, d.cx - r.left);
    else if (d.dx) { userZoomed.current = true; setUI({ viewStart: Math.max(0, viewStart - d.dx / pps) }); }
    if (d.dy && rowsRef.current) rowsRef.current.scrollTop -= d.dy;
  };
  useEffect(() => {
    const el = lanesRef.current?.closest(".timeline");
    if (!el) return;
    const on = (ev: Event) => pinchRef.current((ev as CustomEvent<PinchDetail>).detail);
    el.addEventListener("mo-pinch", on);
    return () => el.removeEventListener("mo-pinch", on);
  }, []);

  /**
   * The ruler. Desktop: press and drag to move the playhead. Phones: a quick tap moves the playhead there when the
   * finger lifts; holding opens the ruler's menu (marker, loop); sliding right makes the ticks finer (zooms in),
   * sliding left makes them coarser.
   */
  /** Fit: from the start to the end of whatever runs longest (a clip, a canvas or a canvas effect), edge to edge. */
  function fitAll() {
            // from the start to the end of whatever runs longest (a clip, a canvas or a canvas effect), edge to edge
            const end = Math.max(0.5, ...project.items.map((i) => i.end), ...(project.backgrounds ?? []).map((b) => b.end), ...project.effects.map((f) => f.end));
            userZoomed.current = true;
            // measured now (never a remembered width)
            const w = lanesRef.current?.clientWidth || W;
            if (w !== W) setW(w);
            setUI({ pps: Math.max(2, (w - PAD - 14) / end), viewStart: 0 });
          }

  function startRuler(e: React.PointerEvent) {
    if (!(phone || e.pointerType === "touch")) return startScrub(e);
    e.stopPropagation();
    const r = lanesRef.current!.getBoundingClientRect();
    const x0 = e.clientX, t0 = performance.now(), pps0 = pps, anchor = e.clientX - r.left, ta = tOf(anchor);
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 8) return;
      moved = true;
      userZoomed.current = true;
      // about 60px of slide doubles (right) or halves (left) the zoom, around the spot under the finger
      const p = Math.min(Math.max(pps0 * 2 ** (dx / 60), 2), 2 * 10 ** ZMAX);
      setUI({ pps: p, viewStart: Math.max(0, ta - (anchor - PAD) / p) });
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      if (!moved && performance.now() - t0 < 450) scrub(ev); // a quick tap: the playhead goes there now
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /** The track item (or group bar) under a point, looking through the playhead line; null on empty space. */
  function clipUnder(x: number, y: number): HTMLElement | null {
    for (const el of document.elementsFromPoint(x, y)) {
      if ((el as HTMLElement).classList?.contains("phgrab") || el.closest(".playhead")) continue;
      return el.closest<HTMLElement>(".clip[data-item], .clip[data-group]");
    }
    return null;
  }
  /** The time span of the track item (or group) under a point. */
  function clipSpanAt(x: number, y: number): { start: number; end: number } | null {
    const el = clipUnder(x, y), p = useStore.getState().project;
    if (!el) return null;
    if (el.dataset.item) { const it = p.items.find((i) => i.id === el.dataset.item); return it ? { start: it.start, end: it.end } : null; }
    const its = itemsInGroup(p, el.dataset.group!);
    return its.length ? { start: Math.min(...its.map((i) => i.start)), end: Math.max(...its.map((i) => i.end)) } : null;
  }
  /**
   * The playhead's grab strip runs over the track items, but only empty space grabs it there: on an item the press
   * (and a right-click / long-press or double-click) goes to the item underneath instead.
   */
  function passToClip(e: React.PointerEvent | React.MouseEvent): boolean {
    const under = clipUnder(e.clientX, e.clientY);
    if (!under) return false;
    e.stopPropagation(); e.preventDefault();
    const tgt = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !(el as HTMLElement).classList?.contains("phgrab") && !el.closest(".playhead")) ?? under;
    const n = e.nativeEvent;
    const init = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey };
    tgt.dispatchEvent(n instanceof PointerEvent ? new PointerEvent(n.type, { ...init, pointerId: n.pointerId, pointerType: n.pointerType, isPrimary: n.isPrimary }) : new MouseEvent(n.type, init));
    return true;
  }
  function grabDown(e: React.PointerEvent) {
    if (passToClip(e)) return;
    startScrub(e);
  }

  function startScrub(e: React.PointerEvent) {
    e.stopPropagation();
    scrub(e);
    const mv = (ev: PointerEvent) => scrub(ev);
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /** The track row under the pointer, read from the page itself so it is always current. */
  function trackAtY(clientY: number): Track | null {
    const r = rowsRef.current!.getBoundingClientRect();
    const el = document.elementsFromPoint(r.left + 4, clientY).find((e) => (e as HTMLElement).dataset?.track) as HTMLElement | undefined;
    const id = el?.dataset.track;
    return id ? useStore.getState().project.tracks.find((t) => t.id === id) ?? null : null;
  }

  /**
   * Everything that hangs off these items, at any depth: items whose parent is one of them, items following
   * one of them as a motion path, and text running along one of them. They slide with their parent in time.
   */
  function childrenOf(p: Project, ids: string[]): Item[] {
    const out: Item[] = [], seen = new Set(ids);
    for (let grew = true, n = 0; grew && n < 20; n++) {
      grew = false;
      for (const o of p.items) {
        if (seen.has(o.id)) continue;
        // its own links, and its groups' parents (a mask carrying a whole group)
        const groupsUp: string[] = [];
        for (let tr = p.tracks.find((x) => x.id === o.trackId), n2 = 0; tr?.parent && n2 < 20; n2++) { const g = p.tracks.find((x) => x.id === tr!.parent); if (!g) break; if (g.parentLink) groupsUp.push(g.parentLink.id); tr = g; }
        const up = [o.parentLink?.id, o.follow?.motionId, o.onPath, ...groupsUp].filter(Boolean) as string[];
        if (up.some((u) => seen.has(u))) { seen.add(o.id); out.push(o); grew = true; }
      }
    }
    return out.filter((o) => !itemLocked(p, o));
  }
  /** After a slide: a child that now overlaps something on its row gets a new row right under it. */
  function settleRows(p: Project, ids: string[]) {
    for (const id of ids) {
      const o = p.items.find((i) => i.id === id);
      if (o && !rowFree(p, o.trackId, o.start, o.end, o.id)) o.trackId = insertRow(p, o.trackId, true);
    }
  }

  function clipDown(e: React.PointerEvent, item: Item) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (itemLocked(project, item)) { select(item.id); toast(item.locked ? `${item.name} is locked · Ctrl+Shift+L unlocks it` : "That row is locked"); return; }
    const r = ((e.currentTarget as HTMLElement).closest(".clip") ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    const lr = lanesRef.current!.getBoundingClientRect();
    if (ui.tool === "blade") {
      const at = tOf(e.clientX - lr.left);
      edit((p) => { const b = splitItem(p, item.id, at); if (b) select(b.id); });
      toast(`Cut ${item.name} at ${fmtClock(at)}`);
      return;
    }
    // Ctrl- or Shift-click: add this clip to (or take it out of) the selection
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      const cur = ui.multi.length ? ui.multi : selected ? [selected] : [];
      const next = cur.includes(item.id) ? cur.filter((x2) => x2 !== item.id) : [...cur, item.id];
      if (next.length === 1) select(next[0]); else useStore.getState().selectMany(next);
      return;
    }
    // one of several selected clips: dragging its middle slides them all along in time
    if (ui.multi.length > 1 && ui.multi.includes(item.id) && Math.min(e.clientX - r.left, r.right - e.clientX) >= 8) {
      const sel0 = project.items.filter((i) => ui.multi.includes(i.id) && !itemLocked(project, i));
      // their children come along too (hold Alt to move only the selected ones)
      const kids = e.altKey ? [] : childrenOf(project, sel0.map((i) => i.id));
      const its = [...sel0, ...kids];
      const st0 = its.map((i) => [i.id, i.start, i.end] as const), lo = -Math.min(...its.map((i) => i.start)), x0 = e.clientX;
      let moved = false;
      const mv = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        if (!moved) { moved = true; checkpoint(); }
        const d = Math.max((ev.clientX - x0) / pps, lo);
        edit((p) => { for (const [id, s, en] of st0) { const o = p.items.find((i) => i.id === id); if (o) { o.start = s + d; o.end = en + d; } } }, false);
      };
      const up = () => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
        if (!moved) select(item.id); else if (kids.length) edit((p) => settleRows(p, kids.map((k) => k.id)), false);
      };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
      return;
    }
    select(item.id);
    const off = e.clientX - r.left;
    const mode = off < 8 ? "l" : r.right - e.clientX < 8 ? "r" : "m";
    const s0 = item.start, e0 = item.end, x0 = e.clientX;
    const followers = project.items.filter((o) => o.trackId === item.trackId && o.id !== item.id && o.start >= e0 - 1e-4).map((o) => [o.id, o.start, o.end] as const);
    // its children slide with it (Alt: only this clip)
    const kids = mode === "m" && !e.altKey ? childrenOf(project, [item.id]).map((o) => [o.id, o.start, o.end] as const) : [];
    const kidMin = kids.length ? Math.min(...kids.map((k) => k[1])) : Infinity;
    const targets = snapTargets(project, t, item.id);
    const tol = 9 / pps;
    // Alt on an edge: stretch — every keyframe (and the In/Out lengths) moves in proportion, closer together or further apart
    // (a path's nodes always stretch with its clip: they're spread over it)
    const stretch = mode !== "m" && (e.altKey || item.kind === "motion");
    const orig = stretch ? JSON.parse(JSON.stringify(item)) as Item : null;
    // resizing a parent (a path, or anything with children): its children scale with it in time, keyframes and all
    const kidsAt = mode !== "m" ? childrenOf(project, [item.id]).map((o) => JSON.parse(JSON.stringify(o)) as Item) : [];
    const KEYED = ["keys", "lookKeys", "numKeys", "colorKeys", "textKeys", "shapeKeys", "layerKeys", "textRanges", "fx", "strokes"] as const;
    const scaleKids = (p: Project, it: Item) => {
      const f = (it.end - it.start) / (e0 - s0 || 1);
      for (const k0 of kidsAt) {
        const o = p.items.find((q) => q.id === k0.id); if (!o) continue;
        for (const key of KEYED) (o as unknown as Record<string, unknown>)[key] = JSON.parse(JSON.stringify((k0 as unknown as Record<string, unknown>)[key] ?? null)) ?? undefined;
        remapKeyTimes(o, (q) => Math.round(q * f * 1e4) / 1e4);
        if (k0.anim) { const a = JSON.parse(JSON.stringify(k0.anim)) as NonNullable<Item["anim"]>; for (const slot of ["in", "out"] as const) { const st = a[slot]; if (st) { st.dur *= f; if (st.at != null) st.at *= f; } } o.anim = a; }
        o.start = Math.max(0, it.start + (k0.start - s0) * f); o.end = Math.max(o.start + 1 / p.fps, it.start + (k0.end - s0) * f);
      }
    };
    let moved = false;
    let pending: { id: string; below: boolean; bottom?: boolean } | null = null;
    const grabY = e.clientY - r.top; // where in the clip it was grabbed (it stays under the pointer there)
    // dragging near either side of the timeline scrolls it, so items can be lengthened / moved past the view
    const vs0 = useStore.getState().ui.viewStart;
    let scrollAdd = 0;
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3 && mode !== "m") return;
      if (!moved) { moved = true; checkpoint(); }
      const lrNow = lanesRef.current!.getBoundingClientRect();
      if (ev.clientX > lrNow.right - 40) scrollAdd += 14 / pps;
      else if (ev.clientX < lrNow.left + 40 && vs0 + scrollAdd > 0) scrollAdd = Math.max(-vs0, scrollAdd - 14 / pps);
      if (scrollAdd) setUI({ viewStart: Math.max(0, vs0 + scrollAdd) });
      const dt = (ev.clientX - x0) / pps + scrollAdd;
      let hit: number | null = null;
      const target = mode === "m" ? trackAtY(ev.clientY) : null;
      // a track accepts the item when it's the right kind and nothing else is there at that time
      const okKind = (tr: Track | null) => !!tr && tr.kind !== "group";
      edit((p) => {
        const it = p.items.find((i) => i.id === item.id)!;
        if (mode === "m") {
          let ns = s0 + dt;
          if (ui.snap) {
            const [a, ha] = snap(ns, targets, tol); const [b, hb] = snap(ns + (e0 - s0), targets, tol);
            if (ha != null) { ns = a; hit = ha; } else if (hb != null) { ns = b - (e0 - s0); hit = hb; }
          }
          ns = Math.max(0, s0 - kidMin, ns);
          it.start = ns; it.end = ns + (e0 - s0);
          for (const [kid, ks0, ke0] of kids) { const o = p.items.find((i) => i.id === kid); if (o) { o.start = ks0 + ns - s0; o.end = ke0 + ns - s0; } }
          // the row under the pointer takes it when there's room there; if it's busy, a new row opens next to it on release
          pending = null;
          // below the last track (over the canvas row or empty space): a new track there, on release
          if (!target) {
            const rows = [...rowsRef.current!.querySelectorAll<HTMLElement>("[data-track]")].filter((x) => p.tracks.some((tr) => tr.id === x.dataset.track && tr.kind !== "audio"));
            const last = rows.sort((a2, b2) => a2.getBoundingClientRect().bottom - b2.getBoundingClientRect().bottom).pop();
            if (last && ev.clientY > last.getBoundingClientRect().bottom - 2) pending = { id: last.dataset.track!, below: true, bottom: true };
          }
          if (okKind(target)) {
            if (rowFree(p, target!.id, it.start, it.end, item.id)) it.trackId = target!.id;
            else {
              const rr = rowsRef.current!.querySelector<HTMLElement>(`[data-track="${target!.id}"]`)?.getBoundingClientRect();
              pending = { id: target!.id, below: !rr || ev.clientY > rr.top + rr.height / 2 };
            }
          }
        } else if (stretch && orig) {
          let ns = s0, ne = e0;
          if (mode === "l") { const [v, h] = ui.snap ? snap(s0 + dt, targets, tol) : [s0 + dt, null]; hit = h; ns = Math.min(Math.max(v, 0), e0 - 1 / p.fps); }
          else { const [v, h] = ui.snap ? snap(e0 + dt, targets, tol) : [e0 + dt, null]; hit = h; ne = Math.max(s0 + 1 / p.fps, v); }
          const f = (ne - ns) / (e0 - s0 || 1);
          // from the keyframes as they were when the drag began, so it never drifts
          for (const k of ["keys", "lookKeys", "numKeys", "colorKeys", "textKeys", "shapeKeys", "layerKeys", "textRanges", "fx", "strokes"] as const) (it as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify((orig as unknown as Record<string, unknown>)[k] ?? null)) ?? undefined;
          remapKeyTimes(it, (q) => Math.round(q * f * 1e4) / 1e4);
          if (orig.anim) {
            const a = JSON.parse(JSON.stringify(orig.anim)) as NonNullable<Item["anim"]>;
            for (const slot of ["in", "out"] as const) { const st = a[slot]; if (st) { st.dur = st.dur * f; if (st.at != null) st.at = st.at * f; } }
            it.anim = a;
          }
          it.start = ns; it.end = ne;
        } else if (mode === "l") {
          let [ns, h] = ui.snap ? snap(s0 + dt, targets, tol) : [s0 + dt, null];
          hit = h; ns = Math.min(Math.max(ns, 0), it.end - 1 / p.fps);
          // keep keys pinned in absolute time while trimming the head
          const shift = ns - it.start;
          for (const ks of Object.values(it.keys)) ks?.forEach((k: Keyframe) => (k.t -= shift));
          shiftLookAndTextKeys(it, -shift);
          if (it.src) it.mediaOffset = Math.max(0, (it.mediaOffset ?? 0) + shift);
          it.start = ns;
        } else {
          let [ne, h] = ui.snap ? snap(e0 + dt, targets, tol) : [e0 + dt, null];
          hit = h; it.end = Math.max(it.start + 1 / p.fps, ne);
          if (ui.tool === "ripple") {
            const d = it.end - e0;
            for (const [id, s, en] of followers) { const o = p.items.find((i) => i.id === id)!; o.start = s + d; o.end = en + d; }
          }
        }
        if (kidsAt.length && mode !== "m") scaleKids(p, it);
      }, false);
      setSnapAt(hit);
      if (mode === "m") {
        setDrop(pending ? { id: pending.id, ok: true, ins: pending.below ? "below" : "above" } : target && target.id !== item.trackId && okKind(target) ? { id: target.id, ok: true } : null);
        // follow the pointer up and down from the row it's in now
        const tid = useStore.getState().project.items.find((i) => i.id === item.id)?.trackId;
        const row = tid ? rowsRef.current!.querySelector<HTMLElement>(`[data-track="${CSS.escape(tid)}"]`)?.getBoundingClientRect() : undefined;
        if (row) setLift({ id: item.id, dy: Math.round(ev.clientY - grabY - (row.top + CLIP_PAD)) });
      }
    };
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setSnapAt(null); setDrop(null);
      // where it is on screen now: after it lands in its row it glides there from here
      if (mode === "m") {
        const el = rowsRef.current?.querySelector<HTMLElement>(`.clip[data-item="${CSS.escape(item.id)}"]`);
        if (el && moved) glide.current = { id: item.id, top: el.getBoundingClientRect().top };
        setLift(null);
      }
      // dropped on a busy row: it gets a new row of its own there; below the last track: a new track at the bottom;
      // rows left empty close up
      if (moved && mode === "m") edit((p) => {
        const it = p.items.find((i) => i.id === item.id);
        if (it && pending?.bottom) {
          let n = 1;
          while (p.tracks.some((tr) => tr.id === `V${n}`)) n++;
          const nt: Track = { id: `V${n}`, name: `Track ${p.tracks.filter((tr) => tr.kind === "video").length + 1}`, kind: "video" };
          let at = -1;
          p.tracks.forEach((tr, i) => { if (tr.kind !== "audio") at = i; });
          p.tracks.splice(at + 1, 0, nt);
          orderTracks(p);
          it.trackId = nt.id;
        } else if (it && pending) it.trackId = insertRow(p, pending.id, pending.below);
        if (kids.length) settleRows(p, kids.map((k) => k[0]));
      }, false);
      if (moved && mode !== "m" && kidsAt.length) edit((p) => settleRows(p, kidsAt.map((k) => k.id)), false);
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /**
   * Drag on empty space in the tracks to draw a box: it selects the clips it touches (Shift adds to the selection).
   * Hold Ctrl (or Cmd) while dragging and it picks the keyframes inside the box instead, across every clip.
   */
  function startTlBox(e: React.PointerEvent) {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    if (e.pointerType === "touch" || phone) return touchOnTracks(e); // phone layout: hold first to draw a box (mouse too)
    boxFrom(e.clientX, e.clientY, e.ctrlKey || e.metaKey, e.shiftKey);
  }
  /**
   * A finger on empty track space: dragging scrolls the tracks (sideways through time, up and down through the rows).
   * Holding still for a moment first draws a selection box instead; a quick tap clears the selection.
   */
  function touchOnTracks(e: React.PointerEvent) {
    const sx = e.clientX, sy = e.clientY, vs0 = viewStart, st0 = rowsRef.current?.scrollTop ?? 0;
    const keys = e.ctrlKey || e.metaKey, add = e.shiftKey;
    let mode: "wait" | "pan" | "box" = "wait";
    const timer = window.setTimeout(() => {
      if (mode !== "wait") return;
      mode = "box";
      navigator.vibrate?.(10);
      off();
      boxFrom(sx, sy, keys, add);
    }, 420);
    const mv = (ev: PointerEvent) => {
      if (mode === "wait" && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { mode = "pan"; clearTimeout(timer); }
      if (mode !== "pan") return;
      userZoomed.current = true;
      setUI({ viewStart: Math.max(0, vs0 - (ev.clientX - sx) / pps) });
      if (rowsRef.current) rowsRef.current.scrollTop = st0 - (ev.clientY - sy);
    };
    const up = () => {
      clearTimeout(timer); off();
      if (mode === "wait" && !add) { select(null); if (ui.keySel) setUI({ keySel: null }); }
    };
    const off = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  /** Draw a selection box from this point (Ctrl: pick keyframes instead; Shift: add to the selection). */
  function boxFrom(sx: number, sy: number, keys: boolean, add: boolean) {
    const base = add ? (ui.multi.length ? ui.multi : selected ? [selected] : []) : [];
    let big = false;
    const rectOf = (ev: { clientX: number; clientY: number }) => ({ l: Math.min(sx, ev.clientX), t: Math.min(sy, ev.clientY), r: Math.max(sx, ev.clientX), b: Math.max(sy, ev.clientY) });
    const touches = (q: DOMRect, b: ReturnType<typeof rectOf>) => q.right >= b.l && q.left <= b.r && q.bottom >= b.t && q.top <= b.b;
    const clipsIn = (b: ReturnType<typeof rectOf>) => [...rowsRef.current!.querySelectorAll<HTMLElement>(".lrow .clip[data-item]")].filter((c) => touches(c.getBoundingClientRect(), b));
    const pick = (b: ReturnType<typeof rectOf>) => {
      if (keys) {
        const by = new Map<string, number[]>();
        rowsRef.current!.querySelectorAll<HTMLElement>(".lrow .clip[data-item] .kd[data-t]").forEach((d) => {
          const q = d.getBoundingClientRect(), mx = (q.left + q.right) / 2, my = (q.top + q.bottom) / 2;
          if (mx < b.l || mx > b.r || my < b.t || my > b.b) return;
          const id = d.closest<HTMLElement>(".clip")!.dataset.item!;
          by.set(id, [...(by.get(id) ?? []), Number(d.dataset.t)]);
        });
        const ks = [...by].map(([itemId, times]) => ({ itemId, times: [...new Set(times)].sort((a2, b2) => a2 - b2) }));
        setUI({ keySel: ks.length ? ks : null });
        return ks;
      }
      const ids = [...new Set([...base, ...clipsIn(b).map((c) => c.dataset.item!)])];
      return ids;
    };
    const mv = (ev: PointerEvent) => {
      const b = rectOf(ev);
      if (!big && b.r - b.l < 4 && b.b - b.t < 4) return;
      big = true;
      setTlBox({ left: b.l, top: b.t, width: b.r - b.l, height: b.b - b.t, keys });
      if (keys) pick(b);
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setTlBox(null);
      if (!big) { if (!add) { select(null); if (ui.keySel) setUI({ keySel: null }); } return; }
      const got = pick(rectOf(ev));
      if (keys) {
        const n = (got as { times: number[] }[]).reduce((m, q) => m + q.times.length, 0);
        if (n) toast(`${n} keyframe${n === 1 ? "" : "s"} picked`);
        return;
      }
      const ids = got as string[];
      if (!ids.length) select(null);
      else if (ids.length === 1) select(ids[0]);
      else { useStore.getState().selectMany(ids); toast(`${ids.length} items selected`); }
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  function startHeaderResize(e: React.PointerEvent) {
    const body = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const mv = (ev: PointerEvent) => setUI({ hdrW: Math.min(Math.max(ev.clientX - body.left, 48), 220) });
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  const totalH = rows.reduce((a, r) => a + r.h, 0) + 24;
  const phx = x(t);
  const dec = pps > 200000 ? 6 : pps > 20000 ? 5 : pps > 2000 ? 4 : 3;
  const tools: [typeof ui.tool, string, string][] = [["select", "cursor", "Select (V)"], ["blade", "scissors", "Blade: click an item to cut it there (B)"], ["ripple", "ripple", "Ripple: trims and deletes close the gap (R)"]];

  return (
    <section className="card timeline" aria-label="Timeline" style={{ ["--rowh" as string]: `${ROW_H}px`, ["--cvh" as string]: `${CV_H}px`, ["--clippad" as string]: `${CLIP_PAD}px` }}>
      <AnimatePresence>{rmenu && (
        <motion.div key="rmenu" className="rmenu-back" {...anim.fade} onPointerDown={(e) => { if (e.target === e.currentTarget) setRmenu(null); }}>
          <motion.div className="cmenu rmenu" role="menu" {...anim.pop} style={{ left: Math.min(rmenu.x, innerWidth - 230), top: Math.min(rmenu.y + 6, innerHeight - 200) }}>
            <button className="cm-row" onClick={() => { addMarker(); setRmenu(null); }}><span>Add a marker here</span><kbd>M</kbd></button>
            <button className="cm-row" onClick={() => { loopIn(); setRmenu(null); }}><span>Loop starts here</span><kbd>I</kbd></button>
            <button className="cm-row" onClick={() => { loopOut(); setRmenu(null); }}><span>Loop ends here</span><kbd>O</kbd></button>
            {ui.loop && <button className="cm-row" onClick={() => { setUI({ loop: { ...ui.loop!, on: !ui.loop!.on } }); setRmenu(null); }}><span>Loop {ui.loop.on ? "off" : "on"}</span><kbd>L</kbd></button>}
            {ui.loop && <button className="cm-row danger" onClick={() => { setUI({ loop: null }); setRmenu(null); }}><span>Remove the loop</span><kbd /></button>}
          </motion.div>
        </motion.div>
      )}</AnimatePresence>
      <div className="tlbar">
        {/* phones: start / play / next sit in the exact middle; the tools to their left; loop, split, snapping,
            the graph and the tick size to their right */}
        {phone ? (<>
        <div className="tlside left">
          <div className="seg sm" role="group" aria-label="Timeline tool">
            {tools.map(([id, ic, tip]) => (
              <button key={id} className={ui.tool === id ? "on" : ""} title={tip} onClick={() => setUI({ tool: id })}><Icon name={ic} /></button>
            ))}
          </div>
        </div>
        <div className="tlplay"><Transport /></div>
        <div className="tlside right">
          <LoopButton />
          <button className="ib" title="Split at playhead (S)" onClick={() => splitSelected()}><Icon name="scissors" /></button>
          <button className={"ib" + (ui.snap ? " on" : "")} title="Snapping (N)" onClick={() => setUI({ snap: !ui.snap })}><Icon name="magnet" /></button>
          <button className={"ib" + (ui.graph ? " on" : "")} title="Keyframe graph under the selected item (C)" onClick={() => setUI({ graph: !ui.graph })}><Icon name="curve" /></button>
          <span className="zunit" title="Time between the ruler's small ticks">{tickLabel}</span>
        </div>
        </>) : (<>
        <div className="seg sm" role="group" aria-label="Timeline tool">
          {tools.map(([id, ic, tip]) => (
            <button key={id} className={ui.tool === id ? "on" : ""} title={tip} onClick={() => setUI({ tool: id })}><Icon name={ic} /></button>
          ))}
        </div>
        <div className="sep" />
        <button className="ib" title="Split at playhead (S)" onClick={() => splitSelected()}><Icon name="scissors" /></button>
        <button className={"ib" + (ui.snap ? " on" : "")} title="Snapping (N)" onClick={() => setUI({ snap: !ui.snap })}><Icon name="magnet" /></button>
        <button className={"ib" + (ui.graph ? " on" : "")} title="Keyframe graph under the selected item (C)" onClick={() => setUI({ graph: !ui.graph })}><Icon name="curve" /></button>
        <div className="sep" />{groupBtn()}
        <span className="sp" />
        <div className="zoomer">
          <button className="ib" title="Zoom out (−)" onClick={() => zoomTo(pps / 2.5)}><Icon name="zout" /></button>
          <ZoomFader value={pps2v(pps)} onChange={(v) => zoomTo(v2pps(v))} />
          <span className="zunit" title="Time between the ruler's small ticks">{tickLabel}</span>
          <button className="ib" title="Zoom in (+)" onClick={() => zoomTo(pps * 2.5)}><Icon name="zin" /></button>
          <button className="chip" title="Fit everything in view" onClick={fitAll}>Fit</button>
        </div>
        </>)}
      </div>

      <div className={"tlbody" + (ui.hdrW < 56 ? " narrow" : "") + (ui.hdrW < 74 ? " noid" : "")} style={{ gridTemplateColumns: `${headW}px minmax(0,1fr)` }}>
        <div className="heads">
          <div className="rulerpad">{phone ? <button className="chip fitpad" title="Fit everything in view" onClick={fitAll}>Fit</button> : <SortButton />}</div>
          <div className="hrows" ref={headsRef} onWheel={(e) => { rowsRef.current!.scrollTop += e.deltaY; }}>
            <AnimatePresence initial={false}>
            {rows.map((row, i) => row.kind === "graph"
              ? <GraphHead key={"gh" + i} item={row.item} />
              : row.kind === "canvas" ? null
              : <Fold key={row.track.id} h={row.h}><TrackHead track={row.track} alt={i % 2 === 1} selected={ui.selTracks.includes(row.track.id)} /></Fold>)}
            </AnimatePresence>
          </div>
          {/* the canvas has its own fixed row under the scrolling rows */}
          <CanvasHead project={project} h={canvasH(project)} />
          <div className="rulerpad bot" />
        </div>
        <div className="hresize" style={{ left: headW }} onPointerDown={startHeaderResize} title="Drag to resize track names" />

        <div
          className={"lanes" + (ui.tool === "blade" ? " blade" : "")}
          ref={lanesRef}
          // clicking in the tracks while it plays stops it. On empty space the playhead goes where you clicked; on a
          // track item it stays put if it's over that item, else it moves to the item's nearer end (so it shows)
          onPointerDownCapture={(e) => {
            const s = useStore.getState();
            if (!s.playing || e.button !== 0) return;
            useStore.setState({ playing: false });
            const span = clipSpanAt(e.clientX, e.clientY);
            if (span) {
              const fr = 1 / (s.project.fps || 30);
              if (s.t < span.start) s.setT(span.start);
              else if (s.t >= span.end) s.setT(Math.max(span.start, span.end - fr));
              return;
            }
            s.setT(Math.min(Math.max(tOf(e.clientX - lanesRef.current!.getBoundingClientRect().left), 0), s.project.duration));
          }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("moshion/asset")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(e) => {
            const a = project.assets?.find((q) => q.id === e.dataTransfer.getData("moshion/asset"));
            if (!a) return;
            e.preventDefault();
            placeAsset(a, Math.max(0, tOf(e.clientX - lanesRef.current!.getBoundingClientRect().left)));
          }}
          onWheel={(e) => {
            const r = lanesRef.current!.getBoundingClientRect();
            if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); zoomTo(pps * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left); }
            else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) userZoomed.current = true, setUI({ viewStart: Math.max(0, viewStart + (e.deltaX || e.deltaY) / pps) });
          }}
        >
          {/* everything after the video's end is dimmed; drag the end marker to change the length */}
          <div className="tlafter" style={{ left: Math.max(0, x(project.duration)) }} />
          {/* …and the strip before 0:00, shaded the same way */}
          {x(0) > 0 && <div className="tlafter tlbefore" style={{ width: x(0) }} />}
          <div className="ruler" onPointerDown={startRuler} onContextMenu={(e) => { e.preventDefault(); scrub(e); setRmenu({ x: e.clientX, y: e.clientY }); }}>
            {/* phones have only this ruler, so the time marks and numbers are here */}
            {phone && ticks.map((k, i) => <i key={i} className={"tick" + (k.maj ? " maj" : "")} style={{ left: k.x }} />)}
            {phone && ticks.filter((k) => k.label).map((k, i) => <span key={"l" + i} className="tlab" style={{ left: k.x }}>{k.label}</span>)}
            {ui.loop && (
              <div className={"loopband" + (ui.loop.on ? " on" : "")} style={{ left: x(ui.loop.a), width: Math.max(2, (ui.loop.b - ui.loop.a) * pps) }}
                title={`Loop ${ui.loop.a.toFixed(2)}s → ${ui.loop.b.toFixed(2)}s`}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setUI({ loop: null }); }} />
            )}
            {(project.markers ?? []).map((mk) => (
              <Marker key={mk.id} mk={mk} left={x(mk.t)} />
            ))}
            <i className={"tend" + (project.autoLength === false ? " manual" : "")} style={{ left: x(project.duration) }}
              title={`Video ends at ${project.duration.toFixed(2)}s · drag to change`}
              onPointerDown={(e) => {
                e.stopPropagation(); e.preventDefault();
                const lr = lanesRef.current!.getBoundingClientRect();
                checkpoint();
                const mv = (ev: PointerEvent) => {
                  let v = Math.max(0.1, tOf(ev.clientX - lr.left));
                  const end = contentEnd(useStore.getState().project);
                  if (ui.snap && end > 0 && Math.abs(v - end) * pps < 8) v = end;
                  edit((p) => { p.autoLength = false; p.duration = Math.round(v * 1000) / 1000; }, false);
                };
                const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
                addEventListener("pointermove", mv); addEventListener("pointerup", up);
              }} />
            {ticks.map((k, i) => <i key={i} className={"tick" + (k.maj ? " maj" : "")} style={{ left: k.x }} />)}
            {ticks.filter((k) => k.label).map((k, i) => <span key={"l" + i} className="tlab" style={{ left: k.x }}>{k.label}</span>)}
          </div>
          <div
            className="lrows"
            ref={rowsRef}
            onScroll={() => { headsRef.current!.scrollTop = rowsRef.current!.scrollTop; }}
            onPointerDown={startTlBox} data-nolongpress
            style={fpx > 14 ? { backgroundImage: `repeating-linear-gradient(90deg,transparent 0 ${fpx - 1}px,color-mix(in srgb,var(--ink) 7%,transparent) ${fpx - 1}px ${fpx}px)`, backgroundPosition: `${PAD - ((viewStart * project.fps) % 1) * fpx}px 0` } : undefined}
          >
            {tlBox && <div className={"tlbox" + (tlBox.keys ? " keys" : "")} style={{ left: tlBox.left, top: tlBox.top, width: tlBox.width, height: tlBox.height }} />}
            <AnimatePresence initial={false}>
            {rows.map((row, i) => row.kind === "graph"
              ? <GraphRow key={"g" + i} item={row.item} group={row.group} W={W} x={x} tOf={tOf} />
              : row.kind === "canvas" ? null
              : (
                <Fold key={row.track.id} h={row.h}>
                <div
                  key={row.track.id}
                  className={"lrow" + (row.track.kind === "group" ? " grp" : row.track.parent ? " ch" : i % 2 ? " alt" : "") + (drop?.id === row.track.id ? (drop.ins ? " drop-" + drop.ins : drop.ok ? " drop-ok" : " drop-no") : "")}
                  style={{ height: row.h }} data-track={row.track.id}
                  onPointerDown={startTlBox} data-nolongpress
                >
                  {row.track.kind === "group"
                    ? <GroupBar project={project} track={row.track} x={x} pps={pps} />
                    : project.items.filter((it) => it.trackId === row.track.id).map((it) => {
                      const left = x(it.start), w = (it.end - it.start) * pps;
                      if (left > W || left + w < 0) return null;
                      return (
                        <div
                          key={it.id}
                          className={"clip" + (lift?.id === it.id ? " lifting" : "") + (it.kind === "motion" ? " mclip" : "") + (selected === it.id || ui.multi.includes(it.id) ? " sel" : "") + (itemHidden(project, it) ? " hid" : "") + (itemLocked(project, it) ? " lck" : "")} data-item={it.id}
                          style={{ left, width: Math.max(4, w), top: CLIP_PAD, height: ROW_H - 2 * CLIP_PAD, bottom: "auto", ["--c" as string]: `var(${it.tint})`, ...(lift?.id === it.id ? { transform: `translateY(${lift.dy}px)`, zIndex: 20 } : {}) }}
                          onPointerDown={(e) => clipDown(e, it)}
                          onPointerMove={(e) => {
                            if (ui.tool === "blade") return;
                            const r = e.currentTarget.getBoundingClientRect();
                            e.currentTarget.style.cursor = e.clientX - r.left < 8 || r.right - e.clientX < 8 ? "ew-resize" : "grab";
                          }}
                          onContextMenu={(e) => { e.preventDefault(); select(it.id); /* selecting shows the floating bar above it on the canvas */ }}
                        >
                          {it.kind === "video" && it.src && <Filmstrip item={it} w={w} h={ROW_H - 2 * CLIP_PAD} />}
                          {(it.kind === "audio" || it.kind === "video") && it.src && <Wave item={it} w={w} />}
                          {/* grab strips on both ends: always trim the clip, above keyframes and IN/OUT blocks */}
                          <i className="cedge l" title="Drag to change where it starts" onPointerDown={(e) => clipDown(e, it)} />
                          <i className="cedge r" title="Drag to change how long it lasts" onPointerDown={(e) => clipDown(e, it)} />
                          {it.anim?.in && <AnimZone item={it} slot="in" w={w} pps={pps} />}
                          {it.anim?.out && <AnimZone item={it} slot="out" w={w} pps={pps} />}
                          {renaming === it.id ? (
                            <input className="clipname" autoFocus defaultValue={it.name}
                              onPointerDown={(e) => e.stopPropagation()}
                              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
                              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.name) edit((p) => { p.items.find((x) => x.id === it.id)!.name = v; }); setRenaming(null); }} />
                          ) : <span className="cliphit" onDoubleClick={(e) => { e.stopPropagation(); setRenaming(it.id); }} title={it.name} />}
                          {it.locked && (
                            <button className="cliplock" title={`${it.name} is locked · click to unlock`}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); toggleLock([it.id]); }}><Icon name="lock" size={10} /></button>
                          )}
                          {it.anim?.loop && <b className="loopb" title={`Throughout: ${loopLabel(it.anim.loop)}`}>∞</b>}
                          {keyTimes(it).map((kt) => (
                            <i key={kt} className={"kd" + (keyAt(keyTimes(it), t - it.start) === kt ? " now" : "") + (pickedOn(ui.keySel, it.id).some((q) => Math.abs(q - kt) < 1e-3) ? " ksel" : "")} data-t={kt} style={{ left: kt * pps }} title={`Keyframe at ${fmtClock(it.start + kt)}`}
                              onContextMenu={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                const at = it.start + kt;
                                askConfirm(e, `Keyframe at ${fmtClock(at)}`, () => deleteItemKey(it.id, kt), "Delete", true, [
                                  { label: "Copy settings", hint: "Copy what this keyframe sets (position, size, turn, colours, looks…)", run: () => copyKeyframe(it.id, at) },
                                  { label: "Paste settings", hint: hasKeyClip() ? "Set this keyframe to the copied settings" : "Copy a keyframe's settings first", disabled: !hasKeyClip(), run: () => { pasteKeyframe(it.id, at); } },
                                ]);
                              }}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation(); e.preventDefault();
                                // Shift-click: add this keyframe to (or take it out of) the picked ones
                                if (e.shiftKey) {
                                  const cur = pickedOn(ui.keySel, it.id);
                                  const has = cur.some((q) => Math.abs(q - kt) < 1e-3);
                                  const times = has ? cur.filter((q) => Math.abs(q - kt) >= 1e-3) : [...cur, kt].sort((a2, b2) => a2 - b2);
                                  const rest = (ui.keySel ?? []).filter((q) => q.itemId !== it.id);
                                  const nextSel = times.length ? [...rest, { itemId: it.id, times }] : rest;
                                  setUI({ keySel: nextSel.length ? nextSel : null });
                                  const n = pickedCount(nextSel);
                                  if (n > 1 && !has) toast(`${n} keyframes picked`);
                                  return;
                                }
                                select(it.id);
                                // dragging one of several picked keyframes moves (or with Alt, stretches) them all, on every clip
                                const picks = pickedCount(ui.keySel) > 1 && pickedOn(ui.keySel, it.id).some((q) => Math.abs(q - kt) < 1e-3) ? ui.keySel! : null;
                                if (picks) {
                                  const x0 = e.clientX, first = pickedOn(picks, it.id)[0];
                                  const lives = picks.map((pk) => { const q = project.items.find((z) => z.id === pk.itemId); return q ? q.end - q.start : 0; });
                                  // how far they can all move without any key leaving its clip
                                  const lo = Math.max(...picks.map((pk) => -pk.times[0])), hi = Math.min(...picks.map((pk, n) => lives[n] - pk.times[pk.times.length - 1]));
                                  let cur = picks, started = false;
                                  const mv = (ev: PointerEvent) => {
                                    if (!started) { if (Math.abs(ev.clientX - x0) < 2) return; started = true; checkpoint(); }
                                    const dt = (ev.clientX - x0) / pps;
                                    const stretch = ev.altKey && Math.abs(kt - first) > 1e-3;
                                    const f = stretch ? Math.max(0.05, (kt - first + dt) / (kt - first)) : 1, d2 = Math.min(Math.max(dt, lo), hi);
                                    const next = picks.map((pk, n) => ({ itemId: pk.itemId, times: pk.times.map((q) => (stretch ? Math.min(lives[n], pk.times[0] + (q - pk.times[0]) * f) : q + d2)) }));
                                    const from = cur;
                                    edit((p) => {
                                      for (const [n, pk] of next.entries()) {
                                        const d3 = p.items.find((q) => q.id === pk.itemId); if (!d3) continue;
                                        const was = from[n].times;
                                        remapKeyTimes(d3, (q) => { const i2 = was.findIndex((z) => Math.abs(z - q) < 1e-3); return i2 >= 0 ? pk.times[i2] : null; });
                                        // a path and what rides it share nodes: their keyframes at those moments move too
                                        moveShared(p, d3, was.map((w, i2) => [w, pk.times[i2]] as [number, number]), next.map((q) => q.itemId));
                                      }
                                    }, false);
                                    cur = next;
                                    setUI({ keySel: next });
                                  };
                                  const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!started) useStore.getState().setT(it.start + kt); };
                                  addEventListener("pointermove", mv); addEventListener("pointerup", up);
                                  return;
                                }
                                if (ui.keySel) setUI({ keySel: null });
                                const x0 = e.clientX, life = it.end - it.start;
                                let at = kt, started = false;
                                const mv = (ev: PointerEvent) => {
                                  if (!started) { if (Math.abs(ev.clientX - x0) < 2) return; started = true; checkpoint(); }
                                  let nt = Math.min(Math.max(kt + (ev.clientX - x0) / pps, 0), life);
                                  if (ui.snap) { const pt = useStore.getState().t - it.start; if (Math.abs(nt - pt) * pps < 8) nt = pt; }
                                  edit((p) => {
                                    const d2 = p.items.find((q) => q.id === it.id)!;
                                    // everything keyed at that moment moves (a path's lines too); never onto another keyframe
                                    if (keyTimes(d2).some((q) => Math.abs(q - nt) < 1e-3 && Math.abs(q - at) >= 1e-3)) return;
                                    const from = at;
                                    remapKeyTimes(d2, (q) => (Math.abs(q - from) < 1e-3 ? nt : null));
                                    // a path and what rides it share nodes: the matching keyframe moves on them too
                                    moveShared(p, d2, [[from, nt]]);
                                  }, false);
                                  at = nt;
                                };
                                // a click (no drag) jumps the playhead to the keyframe
                                const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!started) useStore.getState().setT(it.start + kt); };
                                addEventListener("pointermove", mv); addEventListener("pointerup", up);
                              }} />
                          ))}
                        </div>
                      );
                    })}
                </div></Fold>
              ))}
            </AnimatePresence>
          </div>
          {snapAt != null && <div className="snapline" style={{ left: x(snapAt) }} />}
          <div className="cvdock"><CanvasRow h={canvasH(project)} x={x} pps={pps} tOf={tOf} /></div>
          <div className="ruler bottom" onPointerDown={(e) => { if (e.button === 0) startScrub(e); }} title="Drag to move the playhead · right-click for markers and the loop"
            onContextMenu={(e) => { e.preventDefault(); scrub(e); setRmenu({ x: e.clientX, y: Math.max(8, e.clientY - 190) }); }}>
            {ticks.map((k, i) => <i key={i} className={"tick" + (k.maj ? " maj" : "")} style={{ left: k.x }} />)}
            {ticks.filter((k) => k.label).map((k, i) => <span key={"l" + i} className="tlab" style={{ left: k.x }}>{k.label}</span>)}
          </div>
          {phx > -40 && phx < W + 40 && (
            <div className="playhead" style={{ left: phx }}>
              <div className="phtag" onPointerDown={startScrub}>{fmtClock(t, dec)}</div>
              <div className="phtag bot" onPointerDown={startScrub}>{fmtClock(t, dec)}</div>
              {/* the line itself can be grabbed and dragged too */}
              <i className="phgrab" onPointerDown={grabDown} onContextMenu={(e) => { passToClip(e); }} onDoubleClick={(e) => { passToClip(e); }} title="Drag to move the playhead" />
            </div>
          )}
          <span style={{ display: "none" }}>{totalH}</span>
        </div>
      </div>
      {/* phones: the play controls are a sidebar beside the video instead */}
      {!phone && <PlayerBar />}
    </section>
  );

  function groupBtn() {
    const sel = ui.selTracks;
    const grp = sel.length === 1 ? project.tracks.find((t) => t.id === sel[0] && t.kind === "group") : undefined;
    if (grp) return <button className="chip" title="Ungroup (Ctrl+Shift+G)" onClick={() => { edit((p) => ungroupTrack(p, grp.id)); setUI({ selTracks: [] }); }}>Ungroup</button>;
    const n = project.tracks.filter((t) => sel.includes(t.id) && t.kind === "video" && !t.parent).length;
    return (
      <button className="chip" disabled={!n} style={{ opacity: n ? 1 : 0.4 }} title="Group the selected tracks (Ctrl+G)"
        onClick={() => { let g: string | null = null; edit((p) => { g = groupTracks(p, sel); }); setUI({ selTracks: g ? [g] : [] }); }}>
        Group{n ? ` ${n}` : ""}
      </button>
    );
  }
  function splitSelected() {
    const p = useStore.getState().project, tt = useStore.getState().t;
    const it = p.items.find((i) => i.id === selected) ?? p.items.find((i) => tt > i.start && tt < i.end && i.kind !== "audio");
    if (!it || !(tt > it.start && tt < it.end)) { toast("Put the playhead over an item to split it"); return; }
    edit((d) => { const b = splitItem(d, it.id, tt); if (b) select(b.id); });
    toast(`Split ${it.name} at ${fmtClock(tt)}`);
  }
}

/** Items that share nodes with this one: a path and everything riding it (following it, or running along it). */
function nodePartners(p: Project, it: Item): Item[] {
  const rides = (o: Item) => o.follow?.motionId ?? (o.onPath && p.items.find((m) => m.id === o.onPath)?.kind === "motion" ? o.onPath : undefined);
  const mid = it.kind === "motion" ? it.id : rides(it);
  if (!mid) return [];
  return p.items.filter((o) => o.id !== it.id && (o.id === mid || rides(o) === mid));
}
/**
 * After keyframes of `it` moved (local times from → to): the partners' keyframes at those same moments (on the
 * canvas clock) move to the same new moments. `skip`: items already moved by hand.
 */
function moveShared(p: Project, it: Item, pairs: [number, number][], skip: string[] = []) {
  for (const o of nodePartners(p, it)) {
    if (skip.includes(o.id)) continue;
    const times = keyTimes(o), life = o.end - o.start;
    const map = pairs.map(([a, b]) => [it.start + a - o.start, it.start + b - o.start] as [number, number]).filter(([a]) => times.some((k) => Math.abs(k - a) < 1e-3));
    if (!map.length) continue;
    if (map.some(([a, b]) => times.some((k) => Math.abs(k - b) < 1e-3 && Math.abs(k - a) >= 1e-3))) continue; // would land on another keyframe
    remapKeyTimes(o, (q) => { const m = map.find(([a]) => Math.abs(a - q) < 1e-3); return m ? Math.min(Math.max(m[1], 0), life) : null; });
  }
}

/** Delete the keyframe at `local` (item time) on every property, or only on `props`. */
export function deleteItemKey(itemId: string, local: number, props?: Prop[]) {
  const s = useStore.getState();
  s.edit((p) => {
    const it = p.items.find((i) => i.id === itemId); if (!it) return;
    for (const pr of props ?? (Object.keys(it.keys) as Prop[])) removeKey(it, pr, local);
    if (!props) removeLookAndTextKeys(it, local);
  });
  s.toast("Keyframe deleted · Ctrl+Z brings it back");
}
/** Same for a group's own keyframes (absolute time). The value it held stays as the group's resting value. */
export function deleteGroupKey(trackId: string, at: number, props?: Prop[]) {
  const s = useStore.getState();
  s.edit((p) => {
    const g = p.tracks.find((x) => x.id === trackId); if (!g?.keys) return;
    for (const pr of props ?? (Object.keys(g.keys) as Prop[])) {
      const ks = g.keys[pr]; if (!ks) continue;
      const i = ks.findIndex((k) => Math.abs(k.t - at) < 1e-3);
      if (i < 0) continue;
      const [k] = ks.splice(i, 1);
      if (!ks.length) { (g.base ??= {})[pr] = k.v; delete g.keys[pr]; }
    }
  });
  s.toast("Keyframe deleted · Ctrl+Z brings it back");
}

export function selectTrack(id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  const { ui, setUI } = useStore.getState();
  const multi = e.ctrlKey || e.metaKey || e.shiftKey;
  const cur = ui.selTracks;
  setUI({ selTracks: multi ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : cur.length === 1 && cur[0] === id ? [] : [id] });
}

/** The In or Out part of a clip: shaded, labelled, and its inner edge drags to change the length. */
function AnimZone({ item, slot, w, pps }: { item: Item; slot: "in" | "out"; w: number; pps: number }) {
  const a = item.anim![slot]!;
  const life = item.end - item.start;
  const at = Math.min(a.at ?? 0, Math.max(0, life - a.dur));
  const width = Math.min(w, a.dur * pps);
  const { edit, checkpoint, select } = useStore.getState();
  const label = stepLabel(a);
  /** body: move when it plays · edge: how long it takes */
  const drag = (e: React.PointerEvent, what: "move" | "len") => {
    if (e.button !== 0) return;
    // the clip's own ends (outer 8px) still trim the clip, even under an IN/OUT block
    const cr = (e.currentTarget as HTMLElement).closest(".clip")?.getBoundingClientRect();
    if (what === "move" && cr && (e.clientX - cr.left < 8 || cr.right - e.clientX < 8)) return;
    e.stopPropagation(); e.preventDefault();
    const x0 = e.clientX, d0 = a.dur, at0 = at;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      if (!moved) { if (Math.abs(ev.clientX - x0) < 3) return; moved = true; checkpoint(); }
      const dt = (ev.clientX - x0) / pps;
      edit((p) => {
        const z = p.items.find((q) => q.id === item.id)?.anim?.[slot]; if (!z) return;
        if (what === "move") z.at = Math.round(Math.min(Math.max(0, at0 + (slot === "in" ? dt : -dt)), Math.max(0, life - z.dur)) * 100) / 100;
        else z.dur = Math.round(Math.min(Math.max(0.05, d0 + (slot === "in" ? dt : -dt)), life - (z.at ?? 0)) * 100) / 100;
      }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!moved) select(item.id); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  return (
    <div className={"azone " + slot} style={slot === "in" ? { left: at * pps, width } : { right: at * pps, width }}
      title={`${slot === "in" ? "In" : "Out"}: ${label} · ${slot === "in" ? `starts ${at.toFixed(2)}s in` : `ends ${at.toFixed(2)}s before the end`} · ${a.dur.toFixed(2)}s long\nDrag to move it · drag its inner edge to change the length`}
      onPointerDown={(e) => drag(e, "move")}>
      {width > 54 && <span>{slot === "in" ? "IN" : "OUT"} · {label}</span>}
      <i className="azedge" onPointerDown={(e) => drag(e, "len")} />
    </div>
  );
}

/** A marker on the ruler: click to jump, drag to move, double-click to rename, right-click to delete. */
function Marker({ mk, left }: { mk: { id: string; t: number; label: string; note?: string; chapter?: boolean }; left: number }) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const { edit, setT, checkpoint } = useStore.getState();
  const upd = (fn: (m: { label: string; note?: string; chapter?: boolean }) => void, commit = true) => edit((p) => { const m = p.markers?.find((q) => q.id === mk.id); if (m) fn(m); }, commit);
  return (
    <div className={"marker" + (mk.chapter ? " chapter" : "") + (mk.note ? " noted" : "") + (open ? " mo-focus" : "")} style={{ left }}
      title={`${mk.label}${mk.chapter ? " · chapter" : ""}${mk.note ? ` · ${mk.note}` : ""} · ${mk.t.toFixed(2)}s · drag to move · double-click for name, note & chapter · right-click to delete`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const x0 = e.clientX, t0 = mk.t, pps = useStore.getState().ui.pps;
        let moved = false;
        const mv = (ev: PointerEvent) => {
          if (!moved) { if (Math.abs(ev.clientX - x0) < 3) return; moved = true; checkpoint(); }
          edit((p) => { const m = p.markers?.find((q) => q.id === mk.id); if (m) m.t = Math.max(0, t0 + (ev.clientX - x0) / pps); }, false);
        };
        const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!moved) setT(mk.t); };
        addEventListener("pointermove", mv); addEventListener("pointerup", up);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); setOpen({ x: e.clientX, y: e.clientY }); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); askConfirm(e, `Delete marker “${mk.label}”?`, () => edit((p) => { p.markers = (p.markers ?? []).filter((q) => q.id !== mk.id); })); }}>
      <i />
      <span>{mk.label}</span>
      {open && createPortal(
        <div className="pop mkpop" style={{ position: "fixed", left: Math.min(open.x, innerWidth - 250), top: Math.min(open.y + 10, innerHeight - 220) }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <input autoFocus defaultValue={mk.label} placeholder="Name" onFocus={() => checkpoint()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setOpen(null); }} onChange={(e) => upd((m) => { m.label = e.target.value || "Marker"; }, false)} />
          <textarea rows={3} defaultValue={mk.note ?? ""} placeholder="Note (only you see it)" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => upd((m) => { m.note = e.target.value || undefined; }, false)} />
          <label className="mkchk"><input type="checkbox" defaultChecked={!!mk.chapter} onChange={(e) => upd((m) => { m.chapter = e.target.checked || undefined; })} /> Chapter (listed when exporting)</label>
          <button className="chip" onClick={() => setOpen(null)}>Done</button>
        </div>, topLayer())}
    </div>
  );
}

/** The video's length: follows the last item (Auto), or a value you type / drag. */
/** Cycle how the track list is ordered: layer order (the real front-to-back order), or by type, start time, creation or name. */
/** A track row folding open or shut (a group's rows when it folds), quickly; the names column and the tracks move together. */
function Fold({ h, children }: { h: number; children: React.ReactNode }) {
  return (
    // clipped only while it moves (afterwards things that poke out of a row, like the add-track button, show again)
    <motion.div className="fold" initial={{ height: 0, opacity: 0, overflow: "hidden" }} animate={{ height: h, opacity: 1, transitionEnd: { overflow: "visible" } }}
      exit={{ height: 0, opacity: 0, overflow: "hidden" }} transition={{ duration: 0.16, ease: [0.3, 0.7, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

function SortButton() {
  const sort = useStore((s) => s.ui.trackSort ?? "layer");
  const i = Math.max(0, TRACK_SORTS.findIndex((q) => q.id === sort));
  const next = TRACK_SORTS[(i + 1) % TRACK_SORTS.length];
  return (
    <button className={"tsort" + (sort !== "layer" ? " on" : "")}
      title={`Sorted by ${TRACK_SORTS[i].label.toLowerCase()}`}
      onClick={() => useStore.getState().setUI({ trackSort: next.id })}>
      <Icon name={({ layer: "sortLayer", type: "sortType", start: "sortStart", created: "sortNew", name: "sortName" } as Record<string, string>)[sort]} size={14} />
    </button>
  );
}

/** Show/hide and lock buttons on a track name (a group's buttons cover all its tracks). */
function TrackToggles({ track }: { track: Track }) {
  const { edit } = useStore.getState();
  const flip = (k: "muted" | "locked") => (e: React.MouseEvent) => {
    e.stopPropagation();
    edit((p) => { const t = p.tracks.find((x) => x.id === track.id); if (t) t[k] = !t[k]; });
  };
  // a track with only sounds on it gets a mute button instead of an eye
  const audio = useStore((s) => { const its = s.project.items.filter((i) => i.trackId === track.id); return its.length > 0 && its.every((i) => i.kind === "audio"); });
  return (
    <span className="tico">
      <button className={"tt" + (track.muted ? " off" : "")} title={audio ? (track.muted ? "Unmute" : "Mute") : track.muted ? "Show this track" : "Hide this track"} onClick={flip("muted")}>
        <Icon name={audio ? "music" : track.muted ? "eyeoff" : "eye"} />
      </button>
      <button className={"tt" + (track.locked ? " on" : "")} title={track.locked ? "Unlock" : "Lock: nothing on this track can be moved or edited"} onClick={flip("locked")}>
        <Icon name={track.locked ? "lock" : "unlock"} />
      </button>
    </span>
  );
}

/** Timeline zoom: the app's standard fader. */
function ZoomFader({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="zf">
      <Fader value={value} min={0} max={ZSTEPS} step={1} onChange={onChange} label="Timeline zoom" touchNudge={1300 /* ≈ 60px of finger travel doubles the zoom */}
        title="Zoom the timeline" />
    </div>
  );
}

function TrackHead({ track, alt, selected }: { track: Track; alt: boolean; selected: boolean }) {
  const { edit } = useStore.getState();
  // how deep it sits (groups inside groups are indented a step each)
  const depth = useStore((s) => { let n = 0, par = track.parent; while (par && n < 20) { n++; par = s.project.tracks.find((x) => x.id === par)?.parent; } return n; });
  const indent = depth > 1 ? { paddingLeft: 8 + depth * 10 } : {};
  const selStyle = selected ? { background: "color-mix(in srgb, var(--ink) 9%, var(--panel))", color: "var(--ink)" } : {};
  if (track.kind === "group") {
    return (
      <div
        className={"th grp" + (track.parent ? " ch" : "")} style={{ height: 30, ...indent, ...selStyle }}
        onClick={(e) => selectTrack(track.id, e)}
        onContextMenu={(e) => { e.preventDefault(); openPanelAt(e, { section: "transform", itemId: null, trackId: track.id }); }}
        title="Click to select · right-click to animate the whole group"
      >
        <button className={"chev" + (track.open ? " open" : "")} aria-label={track.open ? "Fold group" : "Unfold group"}
          onClick={(e) => { e.stopPropagation(); edit((p) => { const g = p.tracks.find((x) => x.id === track.id)!; g.open = !g.open; }, false); }}><Icon name="chev" /></button>
        {/* the group's icon also folds / unfolds it (the only control left when the names column is narrow) */}
        <button className="gibtn" aria-label={track.open ? "Fold group" : "Unfold group"} title={`${track.name} · tap to ${track.open ? "fold" : "unfold"}`}
          onClick={(e) => { e.stopPropagation(); edit((p) => { const g = p.tracks.find((x) => x.id === track.id)!; g.open = !g.open; }, false); }}><Icon name="group" className="gi" /></button>
        <span className="nm">{track.name}</span>
        <span className="badge" title="Group keys apply on top of each item's own keys">∆ GROUP</span>
        <TrackToggles track={track} />
        <InsertTrack after={track.id} />
      </div>
    );
  }
  return (
    <div className={"th row" + (track.parent ? " ch" : "") + (track.kind === "audio" ? " aud" : "")} style={{ height: ROW_H, ...indent, background: alt && !track.parent && track.kind !== "audio" ? "var(--lane)" : undefined, cursor: "pointer", ...selStyle }}
      onClick={(e) => selectTrack(track.id, e)}
      onContextMenu={(e) => { e.preventDefault(); askDeleteTrack(e, track); }}
      title={track.name}>
      <span className="tid">{track.id}</span>
      <TrackToggles track={track} />
      <InsertTrack after={track.id} />
    </div>
  );
}

/** Right-click a track: delete it, after a confirm that says what goes with it. */
function askDeleteTrack(e: React.MouseEvent, track: Track) {
  const { project, edit, toast, setUI } = useStore.getState();
  const n = project.items.filter((i) => i.trackId === track.id).length;
  askConfirm(e, `Delete track ${track.id}${n ? ` and its ${n} item${n === 1 ? "" : "s"}` : ""}?`, () => {
    edit((p) => deleteTrack(p, track.id));
    setUI({ selTracks: useStore.getState().ui.selTracks.filter((x) => x !== track.id) });
    toast(`Track ${track.id} deleted · Ctrl+Z brings it back`);
  });
}

/** The + under a track name: a new track right there. */
function InsertTrack({ after }: { after: string }) {
  const { edit, toast } = useStore.getState();
  return (
    <button className="tins" title="Add a track here"
      onClick={(e) => { e.stopPropagation(); let id = ""; edit((p) => { id = insertTrackAfter(p, after); }); toast(`Track ${id} added`); }}>
      <Icon name="plus" size={12} />
    </button>
  );
}

/* ---------------- canvas track: scene effects for the whole frame ---------------- */
/** Is a background light enough that dark text reads better on it? */
function isLightBg(colors: string[]): boolean {
  const ls = colors.map((c) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return 0.3;
    const n = parseInt(m[1], 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  });
  return ls.reduce((a, b) => a + b, 0) / (ls.length || 1) > 0.4;
}

/** Choose the transition into a canvas: kind, direction and length. */
function TransPicker({ id, x, y, close }: { id: string; x: number; y: number; close: () => void }) {
  const tr = useStore((s) => s.project.backgrounds?.find((b) => b.id === id)?.trans);
  const { edit, checkpoint } = useStore.getState();
  const set = (fn: (b: NonNullable<Project["backgrounds"]>[number]) => void, commit = true) => edit((p) => { const b = p.backgrounds?.find((q) => q.id === id); if (b) fn(b); }, commit);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".trbadge")) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("pointerdown", off, true); addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off, true); removeEventListener("keydown", esc); };
  }, []);
  const W = 252, H = 150;
  const top = y - H - 8 < 8 ? y + 26 : y - H - 8;
  const kind = TRANSITIONS.find((q) => q.kind === tr?.kind);
  return createPortal(
    <div ref={ref} className="pop trpick" style={{ position: "fixed", left: Math.min(Math.max(x - W / 2, 8), innerWidth - W - 8), top, width: W }}>
      <div className="trkinds">
        <button className={!tr ? "on" : ""} onClick={() => set((b) => { delete b.trans; })}>Cut</button>
        {TRANSITIONS.map((q) => (
          <button key={q.kind} className={tr?.kind === q.kind ? "on" : ""} onClick={() => set((b) => { b.trans = { kind: q.kind, dur: b.trans?.dur ?? 0.6, dir: b.trans?.dir }; })}>{q.label}</button>
        ))}
      </div>
      {tr && <>
        {kind?.dir && (
          <div className="trrow"><span>Direction</span>
            <span className="trdirs">
              {([["l", "←"], ["r", "→"], ["u", "↑"], ["d", "↓"]] as const).map(([v, l]) => <button key={v} className={(tr.dir ?? "l") === v ? "on" : ""} onClick={() => set((b) => { b.trans!.dir = v; })}>{l}</button>)}
            </span>
          </div>
        )}
        <div className="trrow"><span>Length</span>
          <input type="range" min={0.1} max={3} step={0.05} value={tr.dur} onPointerDown={() => checkpoint()} onChange={(e) => set((b) => { b.trans!.dur = +e.target.value; }, false)} />
          <b>{tr.dur.toFixed(2)}s</b>
        </div>
      </>}
    </div>, topLayer());
}

/** The small bar over a clicked canvas part: settings, keyframes, split, delete. */
function CanvasBar({ id, x, t, close }: { id: string; x: number; t: number; close: () => void }) {
  const project = useStore((s) => s.project);
  const { edit, setUI, toast, checkpoint } = useStore.getState();
  const [y, setY] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`.cvseg[data-cv="${id}"]`);
    const r = el?.getBoundingClientRect();
    setY(r ? (r.top - 36 < 4 ? r.bottom + 4 : r.top - 34) : null);
  });
  const keys = project.canvasKeys ?? [];
  const onKey = keys.some((k) => Math.abs(k - t) <= 0.02);
  const parts = project.backgrounds ?? [];
  const W = 6 * 31;
  if (y == null) return null;
  return createPortal(
    <div className="fbar cvbar" style={{ position: "fixed", left: Math.min(Math.max(x - W / 2, 8), innerWidth - W - 8), top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <button className="ib" title="Canvas settings: size, length, background, looks, effects"
        onClick={(e) => { const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); setUI({ panel: { section: "scene", itemId: null, canvas: !id, bgId: id || undefined, x: r.left + r.width / 2, y: r.top, anchor: { top: r.top, bottom: r.bottom } } }); close(); }}><Icon name="sparkle" /></button>
      <span className="fsep" />
      <button className="ib" title="Add a canvas keyframe"
        onClick={() => { edit((p) => addCanvasKey(p, useStore.getState().t)); toast(onKey ? "Already a canvas keyframe here" : "Canvas keyframe added · change a look or effect amount at another time to animate it"); }}><Icon name="keyadd" /></button>
      <button className="ib" disabled={!onKey} title={onKey ? "Delete the canvas keyframe at the playhead" : "Move the playhead onto a canvas keyframe to delete it"}
        onClick={() => edit((p) => removeCanvasKey(p, useStore.getState().t))}><Icon name="keydel" /></button>
      <span className="fsep" />
      <button className="ib" title="Split the canvas at the playhead"
        onClick={() => {
          let ok = false; checkpoint();
          edit((p) => {
            if (!p.backgrounds?.length) (p.backgrounds ??= []).push({ id: uid("bg"), name: "Canvas", start: 0, end: p.duration, kind: "solid", colors: [p.background], angle: 0, speed: 0 });
            const at = useStore.getState().t;
            ok = splitBackground(p, at, uid("bg"));
            if (ok) for (const f of [...p.effects]) if (f.start < at - 0.02 && f.end > at + 0.02) { p.effects.push({ ...JSON.parse(JSON.stringify(f)), id: uid("fx"), start: at }); f.end = at; }
          }, false);
          toast(ok ? `Canvas split at ${fmtClock(useStore.getState().t)}` : "Move the playhead inside the canvas to split it");
          close();
        }}><Icon name="scissors" /></button>
      <button className="ib danger" disabled={!id || parts.length < 2} title={id && parts.length > 1 ? "Delete this part of the canvas" : "Split the canvas first to delete a part"}
        onClick={(e) => askConfirm(e, "Delete this part of the canvas?", () => { edit((p) => { p.backgrounds = p.backgrounds?.filter((b) => b.id !== id); }); close(); })}><Icon name="trash" /></button>
    </div>, topLayer());
}

function CanvasHead({ project, h }: { project: Project; h: number }) {
  const open = (e: React.MouseEvent) => { e.preventDefault(); openPanelAt(e, { section: "scene", itemId: null }); };
  return (
    <div className="th canvas" style={{ height: h }} onClick={open} onContextMenu={open} title="Canvas track: effects for the whole frame">
      <span className="tid" style={{ width: 16, height: 16, borderRadius: 3, background: project.background, boxShadow: "inset 0 0 0 1px rgba(128,128,128,.35)" }} />
      <span className="nm"><b style={{ color: "var(--ink)" }}>Canvas</b> · {project.effects.length} fx</span>
      <span className="tico"><Icon name="sparkle" /></span>
      {/* no add button on the canvas row */}
    </div>
  );
}

function CanvasRow({ h, x, pps, tOf }: { h: number; x: (t: number) => number; pps: number; tOf: (px: number) => number }) {
  const project = useStore((s) => s.project);
  const tool = useStore((s) => s.ui.tool);
  const panel = useStore((s) => s.ui.panel);
  const { edit, checkpoint, setUI, toast } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ id: string; x: number } | null>(null);
  const [tpick, setTpick] = useState<{ id: string; x: number; y: number } | null>(null);
  const t = useStore((s) => s.t);
  // the bar closes when you click anywhere else
  useEffect(() => {
    if (!bar) return;
    const off = (e: PointerEvent) => { const el = e.target as Element; if (!el.closest?.(".cvbar") && !el.closest?.(".cvseg")) setBar(null); };
    addEventListener("pointerdown", off, true);
    return () => removeEventListener("pointerdown", off, true);
  }, [bar]);
  type Clip = { id: string; start: number; end: number };
  /** Drag to move, drag an end to trim, Blade to cut, click to edit. */
  function down(e: React.PointerEvent, c: Clip, list: "backgrounds" | "effects") {
    if (e.button !== 0) return;
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = tOf(e.clientX - ref.current!.getBoundingClientRect().left);
    if (tool === "blade") {
      if (at <= c.start + 0.02 || at >= c.end - 0.02) return;
      edit((p) => {
        const arr = (list === "backgrounds" ? p.backgrounds : p.effects) as Clip[] | undefined;
        const src = arr?.find((q) => q.id === c.id);
        if (!arr || !src) return;
        arr.push({ ...JSON.parse(JSON.stringify(src)), id: uid(list === "backgrounds" ? "bg" : "fx"), start: at });
        src.end = at;
        // cutting a canvas part cuts its looks too, so each part keeps its own
        if (list === "backgrounds") for (const f of [...p.effects]) if (f.start < at - 0.02 && f.end > at + 0.02) { p.effects.push({ ...JSON.parse(JSON.stringify(f)), id: uid("fx"), start: at }); f.end = at; }
      });
      toast(`Cut at ${fmtClock(at)}`);
      return;
    }
    const mode = e.clientX - r.left < 8 ? "l" : r.right - e.clientX < 8 ? "r" : "m";
    const x0 = e.clientX, s0 = c.start, e0 = c.end;
    // snap to items, the other canvas clips, keyframes, the playhead and the video's ends (Alt: no snapping)
    const st0 = useStore.getState();
    const targets = snapTargets(st0.project, st0.t, c.id), tol = 8 / pps;
    // a canvas part's looks and keyframes go with it: looks inside it move with it, looks that end (or start)
    // where it does stretch with that end; canvas keyframes inside it move with it
    const near2 = (a: number, b: number) => Math.abs(a - b) < 0.03;
    const looks0 = list === "backgrounds" ? st0.project.effects.filter((f) => f.start > s0 - 0.03 && f.end < e0 + 0.03).map((f) => ({ id: f.id, s: f.start, e: f.end })) : [];
    const keys0 = list === "backgrounds" ? (st0.project.canvasKeys ?? []).filter((k) => k > s0 - 0.03 && k < e0 + 0.03) : [];
    const curKeys = [...keys0];
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps;
      if (!moved) { if (Math.abs(ev.clientX - x0) < 3) return; moved = true; checkpoint(); }
      const snapOn = useStore.getState().ui.snap && !ev.altKey;
      edit((p) => {
        const arr = (list === "backgrounds" ? p.backgrounds : p.effects) as Clip[] | undefined;
        const q = arr?.find((z) => z.id === c.id);
        if (!q) return;
        if (mode === "m") {
          let ns = Math.max(0, s0 + dt);
          if (snapOn) {
            const [a, ha] = snap(ns, targets, tol), [b, hb] = snap(ns + (e0 - s0), targets, tol);
            if (ha != null && (hb == null || Math.abs(a - ns) <= Math.abs(b - (ns + e0 - s0)))) ns = a; else if (hb != null) ns = b - (e0 - s0);
          }
          ns = Math.max(0, ns); q.start = ns; q.end = ns + (e0 - s0);
          const d = ns - s0;
          for (const l of looks0) { const f = p.effects.find((z) => z.id === l.id); if (f) { f.start = l.s + d; f.end = l.e + d; } }
          // canvas keyframes inside the part (and the values they hold) move with it; the front one first so none collide
          if (keys0.length) { const order = keys0[0] + d > curKeys[0] ? [...curKeys.keys()].reverse() : [...curKeys.keys()]; for (const n of order) { moveCanvasKey(p, curKeys[n], keys0[n] + d); curKeys[n] = keys0[n] + d; } }
        } else if (mode === "l") {
          let v = s0 + dt; if (snapOn) v = snap(v, targets, tol)[0];
          q.start = Math.min(Math.max(0, v), q.end - 0.05);
          for (const l of looks0) { if (!near2(l.s, s0)) continue; const f = p.effects.find((z) => z.id === l.id); if (f) f.start = Math.min(q.start, f.end - 0.05); }
        } else {
          let v = e0 + dt; if (snapOn) v = snap(v, targets, tol)[0];
          q.end = Math.max(q.start + 0.05, v);
          for (const l of looks0) { if (!near2(l.e, e0)) continue; const f = p.effects.find((z) => z.id === l.id); if (f) f.end = Math.max(q.end, f.start + 0.05); }
        }
      }, false);
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      if (!moved) { useStore.getState().select(null); setUI({ wheel: null, ctx: null, panel: null }); setBar({ id: c.id, x: ev.clientX }); }
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  const cursor = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool === "blade") { e.currentTarget.style.cursor = "crosshair"; return; }
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.cursor = e.clientX - r.left < 8 || r.right - e.clientX < 8 ? "ew-resize" : "grab";
  };
  const bgs = project.backgrounds ?? [];
  return (
    <div ref={ref} className="lrow canvas" style={{ height: h }}
      onContextMenu={(e) => { e.preventDefault(); openPanelAt(e, { section: "scene", itemId: null }); }}>
      {/* the canvas: one item on its own row, made of parts (Blade splits it); its looks show inside each part */}
      {(bgs.length ? bgs : [{ id: "", name: "Canvas", start: 0, end: project.duration, kind: "solid" as const, colors: [project.background], angle: 0, speed: 0 }]).map((b) => {
        const prev = backgroundCSS(b, 0);
        const looks = project.effects.filter((f) => f.start < b.end - 0.01 && f.end > b.start + 0.01);
        const on = bar?.id === b.id || (b.id ? panel?.bgId === b.id : panel?.section === "scene" && !!panel?.canvas);
        const light = isLightBg(b.kind === "solid" ? b.colors.slice(0, 1) : b.colors);
        return (
          <div key={b.id || "canvas"} data-cv={b.id} className={"clip fxclip bgclip cvseg" + (on ? " sel" : "") + (light ? " light" : "")}
            title={`Canvas${b.id ? ` · ${b.name}` : ""} · click for options · Blade splits it`}
            style={{ left: x(b.start), width: Math.max(4, (b.end - b.start) * pps), top: CLIP_PAD, height: ROW_H - 2 * CLIP_PAD, bottom: "auto", ["--c" as string]: "var(--gray)" }}
            onPointerDown={(e) => {
              if (!b.id) { if (e.button !== 0) return; e.stopPropagation(); useStore.getState().select(null); setUI({ wheel: null, ctx: null, panel: null }); setBar({ id: "", x: e.clientX }); return; }
              down(e, b, "backgrounds");
            }} onPointerMove={b.id ? cursor : undefined}>
            <i className="bgsw" style={{ background: prev.background }} />
            <span>{b.id ? b.name : "Canvas"}</span>
            {looks.map((f) => <em key={f.id} className="cvlook" title={`${SCENE_EFFECTS[f.kind]} · ${Math.round(f.amount * 100)}%`}>{SCENE_EFFECTS[f.kind]}</em>)}
            {project.canvasFx?.length ? <em className="cvlook fx">{project.canvasFx.length} fx</em> : null}
          </div>
        );
      })}
      {/* + right after the last canvas: a new canvas there (the video gets longer) */}
      {(() => {
        const end = bgs.length ? Math.max(...bgs.map((q) => q.end)) : project.duration;
        return (
          <button className="cvadd" title="Add a canvas" aria-label="Add a canvas" style={{ left: x(end) + 4, top: 0, width: Math.min(CV_H, 32), height: CV_H }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              let c: Background | null = null;
              edit((p) => {
                const last = canvases(p).at(-1);
                c = last?.id ? insertCanvasAfter(p, last.id, uid("bg"), 3) : addCanvas(p, uid("bg"));
              });
              if (c) { useStore.getState().setT(Math.min((c as Background).start + 1e-3, (c as Background).end)); toast(`${(c as Background).name} added`); }
            }}><Icon name="plus" size={14} /></button>
        );
      })()}
      {(project.canvasKeys ?? []).map((k) => (
        <i key={k} className="kd cvkd" style={{ left: x(k) }} title={`Canvas keyframe at ${fmtClock(k)}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation(); e.preventDefault();
            const x0 = e.clientX; let at = k, moved = false;
            const mv = (ev: PointerEvent) => {
              if (!moved) { if (Math.abs(ev.clientX - x0) < 3) return; moved = true; checkpoint(); }
              const nt = Math.max(0, k + (ev.clientX - x0) / pps);
              edit((p) => moveCanvasKey(p, at, nt), false); at = nt;
            };
            const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!moved) useStore.getState().setT(k); };
            addEventListener("pointermove", mv); addEventListener("pointerup", up);
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); askConfirm(e, "Delete this canvas keyframe?", () => edit((p) => removeCanvasKey(p, k))); }} />
      ))}
      {bar && <CanvasBar id={bar.id} x={bar.x} t={t} close={() => setBar(null)} />}
      {/* the transition into each canvas after the first: its span, and a button to change it */}
      {bgs.slice().sort((a, b) => a.start - b.start).slice(1).map((b) => {
        const tr = b.trans, d = tr?.dur ?? 0;
        return (
          <div key={"tr" + b.id}>
            {d > 0 && <i className="trspan" style={{ left: x(b.start - d / 2), width: d * pps }} />}
            <button className={"trbadge" + (tr ? " on" : "") + (tpick?.id === b.id ? " mo-focus" : "")} style={{ left: x(b.start) }}
              title={tr ? `${TRANSITIONS.find((q) => q.kind === tr.kind)?.label} · ${tr.dur.toFixed(2)}s · click to change` : "Add a transition between these canvases"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTpick(tpick?.id === b.id ? null : { id: b.id, x: r.left + r.width / 2, y: r.top }); }}>
              <Icon name="cycle" size={10} />
            </button>
          </div>
        );
      })}
      {tpick && <TransPicker id={tpick.id} x={tpick.x} y={tpick.y} close={() => setTpick(null)} />}
    </div>
  );
}

function GroupBar({ project, track, x, pps }: { project: Project; track: Track; x: (t: number) => number; pps: number }) {
  const selGroup = useStore((s) => s.ui.selGroup);
  const t = useStore((s) => s.t);
  const kids = project.items.filter((it) => project.tracks.some((tr) => tr.id === it.trackId && tr.parent === track.id));
  if (!kids.length) return null;
  const s0 = Math.min(...kids.map((c) => c.start)), e0 = Math.max(...kids.map((c) => c.end));
  const keys = [...new Set(Object.values(track.keys ?? {}).flatMap((ks) => ks?.map((k) => k.t) ?? []))];
  const { select, setUI, edit, checkpoint } = useStore.getState();
  const dragKey = (e: React.PointerEvent, k: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    select(null); setUI({ selGroup: track.id });
    const x0 = e.clientX; let at = k, started = false;
    const mv = (ev: PointerEvent) => {
      if (!started) { if (Math.abs(ev.clientX - x0) < 2) return; started = true; checkpoint(); }
      const nt = Math.max(0, k + (ev.clientX - x0) / pps);
      edit((p) => {
        const g = p.tracks.find((q) => q.id === track.id);
        for (const ks of Object.values(g?.keys ?? {})) {
          if (!ks) continue;
          const kk = ks.find((q) => Math.abs(q.t - at) < 1e-3);
          if (kk && !ks.some((q) => q !== kk && Math.abs(q.t - nt) < 1e-3)) { kk.t = nt; ks.sort((a, b) => a.t - b.t); }
        }
      }, false);
      at = nt;
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!started) useStore.getState().setT(k); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  return (
    <div
      className={"clip gclip" + (selGroup === track.id ? " sel" : "")} data-group={track.id}
      style={{ left: x(s0), width: Math.max(4, (e0 - s0) * pps), ["--c" as string]: "var(--violet)" }}
      title="The whole group · click to animate it"
      onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); select(null); setUI({ selGroup: track.id }); }}
    >
      {!track.open && kids.map((c) => <i key={c.id} className="gmini" style={{ left: (c.start - s0) * pps, width: (c.end - c.start) * pps }} />)}
      <span className="cliphit" title={`${track.name} · ${kids.length} items`} />
      {keys.map((k) => <i key={k} className={"kd" + (keyAt(keys, t) === k ? " now" : "")} style={{ left: x(k) - x(s0) }} title={`Group keyframe at ${fmtClock(k)}`} onPointerDown={(e) => dragKey(e, k)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); askConfirm(e, "Delete this group keyframe?", () => deleteGroupKey(track.id, k)); }} />)}
    </div>
  );
}

/* ---------------- channels: position is one, everything else per property ---------------- */
/**
 * Channels: position is one, everything else per property. Text running along a path also gets
 * "along" (where it is round the path, in %) and "gap" (how far off the edge) — numbers keyframed on the item.
 */
type Channel = Prop | "pos" | "along" | "gap";
const POS: Prop[] = ["x", "y", "z"];
const PCOL: Record<Channel, string> = {
  pos: "#3A5BFF", x: "#3A5BFF", y: "#0E9AA8", z: "#8A8780", rx: "#E0571A", ry: "#D9338A", rz: "#E2A100", scale: "#7B4DFF", opacity: "#1F9D63",
  along: "#FF5A1F", gap: "#9B59D0",
};
/** The keyframed number behind a path channel. */
const NUMCH: Partial<Record<Channel, NumKey>> = { along: "pathOffset", gap: "pathGap" };
export const chLabel = (c: Channel) => (c === "pos" ? "Position" : c === "along" ? "Along the path" : c === "gap" ? "Gap from the edge" : PROP_LABEL[c]);
/** Short names for the graph's channel list. */
const CH_SHORT: Record<string, string> = { pos: "Pos", x: "X", y: "Y", z: "Z", rx: "Rot X", ry: "Rot Y", rz: "Rot Z", scale: "Scale", opacity: "Opac", along: "Along", gap: "Gap" };
/** The real properties behind a channel (position keys x and y, plus z when z is animated). Path channels have none. */
export function channelProps(item: Item, c: Channel): Prop[] {
  return NUMCH[c] ? [] : c === "pos" ? (item.keys.z?.length ? POS : ["x", "y"]) : [c as Prop];
}
/** A keyframe on a path channel at `local`, holding its value there. Returns false for other channels. */
export function addChannelKey(it: Item, c: Channel, local: number): boolean {
  const nk = NUMCH[c];
  if (!nk) return false;
  const ks = ((it.numKeys ??= {})[nk] ??= []);
  if (!ks.some((k) => near(k.t, local))) { ks.push({ t: local, v: numAtE(it, nk, local), ease: ks[0]?.ease ?? "ease" }); ks.sort((a, b) => a.t - b.t); }
  return true;
}
function channels(item: Item): Channel[] {
  const out: Channel[] = [];
  const onPath = item.kind === "text" && !!item.onPath;
  // text on a path: where it is along the path comes first (its own position doesn't move it)
  if (item.kind === "text" && (item.onPath || item.follow) && item.numKeys?.pathOffset?.length) out.push("along");
  if (onPath && item.numKeys?.pathGap?.length) out.push("gap");
  if (!onPath && POS.some((p) => item.keys[p]?.length)) out.push("pos");
  for (const p of PROPS) if (!POS.includes(p) && item.keys[p]?.length) out.push(p);
  return out;
}
const fmtCh = (c: Channel, v: number) => (c === "along" ? `${Math.round(v * 10) / 10}%` : c === "gap" ? `${Math.round(v)}px` : c === "pos" ? `${Math.round(v)}px` : fmtVal(c, v));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
/**
 * Keys of a channel. Position becomes one curve: at each position key, the value is
 * how far (px) the item has travelled along its path, so the curve shows its speed.
 */
function chKeys(item: Item, c: Channel): Keyframe[] {
  const nk = NUMCH[c];
  if (nk) return item.numKeys?.[nk] ?? [];
  if (c !== "pos") return item.keys[c as Prop] ?? [];
  const ts = [...new Set(POS.flatMap((p) => item.keys[p]?.map((k) => Math.round(k.t * 1e4) / 1e4) ?? []))].sort((a, b) => a - b);
  let dist = 0, prev: number[] | null = null;
  return ts.map((t) => {
    const pt = POS.map((p) => ownValue(item, p, item.start + t));
    if (prev) dist += Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2]);
    prev = pt;
    const src = POS.map((p) => item.keys[p]?.find((k) => near(k.t, t))).find(Boolean);
    return { t, v: dist, ease: src?.ease ?? "ease" };
  });
}

function GraphHead({ item }: { item: Item }) {
  const graphProp = useStore((s) => s.ui.graphProp);
  const { setUI } = useStore.getState();
  const chs = channels(item);
  const focus = chs.includes(graphProp) ? graphProp : chs[0];
  return (
    <div className="th graph" style={{ height: GRAPH_H }}>
      <div className="gprops">
        <b>{item.name}</b>
        {chs.length ? chs.map((c) => (
          <button key={c} className={focus === c ? "on" : ""} onClick={() => setUI({ graphProp: c })} title={c === "pos" ? "Position as a whole: the curve shows how far it has travelled" : c === "along" ? "Where the text is round the path (%): shape this curve to make it speed up, slow down or glide" : `Edit the ${chLabel(c)} curve`}>
            <i style={{ background: PCOL[c] }} />{CH_SHORT[c] ?? chLabel(c)}<span className="sp" /><span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{chKeys(item, c).length}</span>
          </button>
        )) : <span className="hint">No keyframes yet</span>}
      </div>
    </div>
  );
}

/**
 * The selected item's keyframes, on the same time axis as the tracks.
 * Position is one curve (distance travelled); other properties each get their own.
 * The focused curve gets bezier handles. Click any curve or diamond to focus it.
 */
function GraphRow({ item, group, W, x, tOf }: { item: Item; group?: string; W: number; x: (t: number) => number; tOf: (px: number) => number }) {
  const graphProp = useStore((s) => s.ui.graphProp);
  const now = useStore((s) => s.t);
  const { edit, checkpoint, setUI } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  const H = GRAPH_H, pad = 16;
  const chs = channels(item);
  const focus = chs.includes(graphProp) ? graphProp : chs[0];
  /** Selected sections (segment i = key i → key i+1) of the focused curve. */
  const [segSel, setSegSel] = useState<number[]>([]);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setSegSel([]); setMenu(false); }, [item.id, focus]);

  if (!chs.length) {
    return (
      <div className="lrow" style={{ height: H, background: "var(--panel)" }}>
        <div className="hint" style={{ position: "absolute", left: Math.max(10, x(item.start) + 10), top: 40, maxWidth: 520 }}>
          No keyframes yet
        </div>
      </div>
    );
  }

  const keysOf: Partial<Record<Channel, Keyframe[]>> = {};
  for (const c of chs) keysOf[c] = chKeys(item, c);
  const range = (c: Channel): [number, number] => {
    const vs = keysOf[c]!.map((k) => k.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const m = (hi - lo) * 0.15;
    return [lo - m, hi + m];
  };
  const yv = (c: Channel, v: number) => { const [lo, hi] = range(c); return H - pad - ((v - lo) / (hi - lo)) * (H - pad - GRAPH_TOP); };
  const ax = (local: number) => x(item.start + local);
  const dvOf = (c: Channel, a: Keyframe, b: Keyframe) => b.v - a.v || (range(c)[1] - range(c)[0]) * 0.25;

  function pathOf(c: Channel) {
    const ks = keysOf[c]!;
    let dd = `M ${ax(ks[0].t)} ${yv(c, ks[0].v)}`;
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1], dt = b.t - a.t, dv = dvOf(c, a, b);
      const bz = toBezier(a.ease);
      if (!bz) { dd += ` L ${ax(b.t)} ${yv(c, a.v)} L ${ax(b.t)} ${yv(c, b.v)}`; continue; }
      if (b.v === a.v) { dd += ` L ${ax(b.t)} ${yv(c, b.v)}`; continue; }
      dd += ` C ${ax(a.t + bz[0] * dt)} ${yv(c, a.v + bz[1] * dv)}, ${ax(a.t + bz[2] * dt)} ${yv(c, a.v + bz[3] * dv)}, ${ax(b.t)} ${yv(c, b.v)}`;
    }
    return dd;
  }

  const fk = keysOf[focus]!;
  const handles: { seg: number; end: 1 | 2; hx: number; hy: number; kx: number; ky: number }[] = [];
  for (let i = 0; i < fk.length - 1; i++) {
    const a = fk[i], b = fk[i + 1], bz = toBezier(a.ease);
    if (!bz || a.v === b.v || !segSel.includes(i)) continue;
    const dt = b.t - a.t, dv = dvOf(focus, a, b);
    handles.push({ seg: i, end: 1, hx: ax(a.t + bz[0] * dt), hy: yv(focus, a.v + bz[1] * dv), kx: ax(a.t), ky: yv(focus, a.v) });
    handles.push({ seg: i, end: 2, hx: ax(a.t + bz[2] * dt), hy: yv(focus, a.v + bz[3] * dv), kx: ax(b.t), ky: yv(focus, b.v) });
  }

  function drag(e: React.PointerEvent, c: Channel, onMove: (local: number, v: number) => void, onTap?: () => void) {
    e.stopPropagation(); e.preventDefault();
    if (c !== graphProp) setUI({ graphProp: c });
    const r = ref.current!.getBoundingClientRect();
    const [lo0, hi0] = range(c); // freeze the scale while dragging
    let started = false;
    const mv = (ev: PointerEvent) => {
      if (!started) { started = true; checkpoint(); }
      const v = lo0 + ((H - pad - (ev.clientY - r.top)) / (H - pad - GRAPH_TOP)) * (hi0 - lo0);
      onMove(tOf(ev.clientX - r.left) - item.start, v);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!started) onTap?.(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  /** Apply a change to the real keys behind a channel key at time `at`. */
  const onRealKeys = (c: Channel, at: number, fn: (k: Keyframe, ks: Keyframe[]) => void) =>
    edit((dd) => {
      const nk = NUMCH[c];
      if (nk) { const ks = dd.items.find((q) => q.id === item.id)?.numKeys?.[nk]; const k = ks?.find((kk) => near(kk.t, at)); if (ks && k) fn(k, ks); return; }
      const keys = group ? dd.tracks.find((q) => q.id === group)?.keys : dd.items.find((q) => q.id === item.id)?.keys;
      if (!keys) return;
      for (const p of c === "pos" ? POS : [c as Prop]) { const ks = keys[p]; const k = ks?.find((kk) => near(kk.t, at)); if (ks && k) fn(k, ks); }
    }, false);
  /** Delete a keyframe from one curve (the last one of a path number leaves its value as it was). */
  const deleteChannelKey = (c: Channel, at: number) => {
    const nk = NUMCH[c];
    if (!nk) { if (group) deleteGroupKey(group, at, c === "pos" ? POS : [c as Prop]); else deleteItemKey(item.id, at, c === "pos" ? POS : [c as Prop]); return; }
    edit((dd) => {
      const it = dd.items.find((q) => q.id === item.id), ks = it?.numKeys?.[nk];
      if (!it || !ks) return;
      const i = ks.findIndex((k) => near(k.t, at)); if (i < 0) return;
      const [g] = ks.splice(i, 1);
      if (!ks.length) { (it as unknown as Record<string, number>)[nk] = g.v; delete it.numKeys![nk]; }
    });
  };

  function segPath(a: Keyframe, b: Keyframe) {
    const dt = b.t - a.t, dv = dvOf(focus, a, b), bz = toBezier(a.ease);
    const start = `M ${ax(a.t)} ${yv(focus, a.v)}`;
    if (a.ease === "smooth") {
      // drawn from the real curve through the neighbouring keyframes
      const i = fk.indexOf(a);
      return start + Array.from({ length: 24 }, (_, j) => { const tt = a.t + (dt * (j + 1)) / 24; return ` L ${ax(tt)} ${yv(focus, smoothValue(fk, i, tt))}`; }).join("");
    }
    if (!bz) return `${start} L ${ax(b.t)} ${yv(focus, a.v)} L ${ax(b.t)} ${yv(focus, b.v)}`;
    if (a.v === b.v) return `${start} L ${ax(b.t)} ${yv(focus, b.v)}`;
    return `${start} C ${ax(a.t + bz[0] * dt)} ${yv(focus, a.v + bz[1] * dv)}, ${ax(a.t + bz[2] * dt)} ${yv(focus, a.v + bz[3] * dv)}, ${ax(b.t)} ${yv(focus, b.v)}`;
  }
  const selEase = segSel.length ? fk[segSel[0]]?.ease : undefined;
  const easeName = segSel.length && segSel.every((i) => String(fk[i]?.ease) === String(selEase)) && typeof selEase === "string" ? selEase : "custom";
  const applyEase = (n: EaseName) => {
    checkpoint();
    for (const i of segSel) onRealKeys(focus, fk[i].t, (k) => { k.ease = n; });
    setMenu(false);
  };
  /** A new keyframe on the focused curve at `local`, holding the value the curve already has there. */
  const addNodeAt = (local: number) => {
    edit((p) => {
      if (group) {
        const g = p.tracks.find((q) => q.id === group);
        if (!g) return;
        const keys = (g.keys ??= {});
        for (const pp of channelProps(item, focus)) {
          const ks = (keys[pp] ??= []), def = g.base?.[pp] ?? (pp === "scale" || pp === "opacity" ? 1 : 0);
          if (ks.some((k) => Math.abs(k.t - (item.start + local)) < 1e-3)) continue;
          ks.push({ t: item.start + local, v: sampleKeys(ks, item.start + local, def), ease: ks[0]?.ease ?? "ease" }); ks.sort((q1, q2) => q1.t - q2.t);
        }
        return;
      }
      const it = p.items.find((q) => q.id === item.id);
      if (it && !addChannelKey(it, focus, local)) for (const pp of channelProps(it, focus)) addKey(it, pp, local);
    });
    useStore.getState().setT(item.start + local);
  };
  const [flo, fhi] = range(focus);
  const fmtC = fmtCh;

  return (
    <div ref={ref} className="lrow" style={{ height: H, background: "var(--panel)" }}>
      <svg className="gsvg" width={W} height={H}>
        <rect x={0} y={0} width={W} height={H} fill="transparent" onPointerDown={() => { setSegSel([]); setMenu(false); }} />
        {fk.length > 1 && <rect x={ax(fk[0].t)} y={GRAPH_TOP - 4} width={Math.max(0, ax(fk[fk.length - 1].t) - ax(fk[0].t))} height={H - GRAPH_TOP + 4} fill={PCOL[focus]} opacity={0.04} pointerEvents="none" />}
        {[flo + (fhi - flo) * 0.15 / 1.3, (flo + fhi) / 2, fhi - (fhi - flo) * 0.15 / 1.3].map((v, i) => (
          <g key={i}>
            <line x1={0} x2={W} y1={yv(focus, v)} y2={yv(focus, v)} stroke="var(--line)" />
            <text x={6} y={yv(focus, v) - 4} fontFamily="Geist Mono" fontSize={9.5} fill={PCOL[focus]}>{fmtC(focus, v)}</text>
          </g>
        ))}
        {chs.filter((c) => c !== focus).map((c) => (
          <path key={c} d={pathOf(c)} fill="none" stroke={PCOL[c]} strokeWidth={1.5} opacity={0.45} style={{ cursor: "pointer" }} onPointerDown={(e) => { e.stopPropagation(); setUI({ graphProp: c }); }} />
        ))}
        {fk.slice(0, -1).map((a, i) => {
          const b = fk[i + 1], on = segSel.includes(i), segD = segPath(a, b);
          return (
            <g key={"seg" + i} className="gseg" onContextMenu={(e) => {
              // right-click the curve: add a keyframe (node) right there, keeping the curve's shape
              e.preventDefault(); e.stopPropagation();
              const left = ref.current?.getBoundingClientRect().left ?? 0;
              const local = Math.min(Math.max(tOf(e.clientX - left) - item.start, a.t + 0.01), b.t - 0.01);
              askConfirm(e, `Add a keyframe here (${fmtClock(item.start + local)})?`, () => addNodeAt(local), "Add", false);
            }} onPointerDown={(e) => {
              e.stopPropagation();
              setSegSel((cur) => e.shiftKey || e.ctrlKey || e.metaKey ? (cur.includes(i) ? cur.filter((q) => q !== i) : [...cur, i]) : cur.length === 1 && cur[0] === i ? [] : [i]);
            }}>
              <title>{`Section ${i + 1}: ${fmtClock(item.start + a.t)} → ${fmtClock(item.start + b.t)}`}</title>
              <path d={segD} fill="none" stroke="transparent" strokeWidth={16} />
              <path className={on ? "segon" : "segoff"} d={segD} fill="none" stroke={on ? "var(--accent)" : PCOL[focus]} strokeWidth={on ? 3 : 1.6} opacity={on ? 1 : 0.4} />
            </g>
          );
        })}
        {handles.map((h, i) => (
          <g key={i}>
            <line x1={h.kx} y1={h.ky} x2={h.hx} y2={h.hy} stroke="var(--ink-3)" />
            <circle className="hdl" cx={h.hx} cy={h.hy} r={4.5} fill="var(--panel)" stroke={PCOL[focus]} strokeWidth={1.5}
              onPointerDown={(e) => drag(e, focus, (local, v) => {
                const a = fk[h.seg], b = fk[h.seg + 1], dt = b.t - a.t, dv = dvOf(focus, a, b);
                const bz = [...(toBezier(a.ease) ?? EASE_PRESETS.ease)] as Bezier;
                const fx = Math.min(Math.max((local - a.t) / dt, 0), 1), fy = (v - a.v) / dv;
                if (h.end === 1) { bz[0] = fx; bz[1] = fy; } else { bz[2] = fx; bz[3] = fy; }
                onRealKeys(focus, a.t, (k) => { k.ease = [...bz] as Bezier; });
              })} />
          </g>
        ))}
        {chs.flatMap((c) => keysOf[c]!.map((k, i) => {
          const on = c === focus, hot = keyAt(keysOf[c]!.map((q) => q.t), now - item.start) === k.t, sz = hot ? 12 : on ? 10 : 7, cx = ax(k.t), cy = yv(c, k.v);
          const ks = keysOf[c]!;
          return (
            <rect key={c + i} className="hdl" x={cx - sz / 2} y={cy - sz / 2} width={sz} height={sz} rx={1.5}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); askConfirm(e, "Delete this keyframe?", () => deleteChannelKey(c, k.t)); }}
              transform={`translate(${cx} ${cy}) scale(.74 1) rotate(45) translate(${-cx} ${-cy})`} fill={hot ? "var(--accent)" : on ? "#fff" : PCOL[c]} stroke={hot ? "#A07B00" : on ? PCOL[c] : "var(--panel)"} strokeWidth={1.5}
              onPointerDown={(e) => {
                let at = k.t;
                drag(e, c, (local, v) => {
                  const prev = ks[i - 1], next = ks[i + 1];
                  const nt = Math.min(Math.max(local, prev ? prev.t + 0.01 : 0), next ? next.t - 0.01 : item.end - item.start);
                  onRealKeys(c, at, (rk, rks) => {
                    rk.t = nt;
                    if (c !== "pos") rk.v = c === "opacity" ? Math.min(Math.max(v, 0), 1) : NUMCH[c] ? Math.round(v * 10) / 10 : v;
                    rks.sort((a2, b2) => a2.t - b2.t);
                  });
                  at = nt;
                }, () => useStore.getState().setT(item.start + k.t)); // a click jumps the playhead to the keyframe
              }}>
              <title>{c === "pos" ? `Position key at ${fmtClock(item.start + k.t)} ` : `${chLabel(c)} ${fmtCh(c, k.v)} at ${fmtClock(item.start + k.t)} · drag up/down to change it, sideways to retime`}</title>
            </rect>
          );
        }))}
      </svg>
      <div className="gease">
        <span className="chip" style={{ background: "none", color: PCOL[focus] }}>{chLabel(focus)}</span>
        <div className="emenu">
          <button className={"chip" + (menu ? " on" : "")} disabled={!segSel.length} style={{ opacity: segSel.length ? 1 : 0.45 }}
            title={segSel.length ? "Choose an ease for the selected sections" : "Select a section of the curve first"}
            onClick={() => setMenu(!menu)}>Ease ▾</button>
          {menu && segSel.length > 0 && (
            <div className="emenu-list" onPointerDown={(e) => e.stopPropagation()}>
              {(["ease", "easeOut", "easeIn", "smooth", "expo", "back", "linear", "hold", "wiggle"] as const).map((n) => (
                <button key={n} className={easeName === n ? "on" : ""} onClick={() => applyEase(n)} title={EASE_TIP[n]}>
                  <svg viewBox="0 0 40 24" width={40} height={24} aria-hidden="true"><path d={EASE_ICON[n]} fill="none" stroke="currentColor" strokeWidth={1.8} /></svg>
                  {EASE_LABEL[n]}
                </button>
              ))}
              <div className="emenu-note">Drag the round handles on a selected section for a custom curve.</div>
            </div>
          )}
        </div>
        {segSel.length > 0 && <span className="gsel">{segSel.length} selected</span>}
      </div>
    </div>
  );
}

const EASE_LABEL: Record<string, string> = {
  ease: "Ease", easeOut: "Slow into next", easeIn: "Slow start", smooth: "Smooth through", expo: "Expo", back: "Overshoot", linear: "Linear", hold: "Hold", wiggle: "Wiggle",
};
const EASE_TIP: Record<string, string> = {
  ease: "Starts and ends gently", easeOut: "Leaves at full speed and slows down into the next keyframe", easeIn: "Starts slowly and arrives at full speed",
  smooth: "Glides through the keyframes without stopping: no visible breaks between sections", expo: "A strong, snappy ease", back: "Goes a little past, then settles",
  linear: "Constant speed", hold: "Jumps at the next keyframe", wiggle: "Shakes on the way",
};
const EASE_ICON: Record<string, string> = {
  easeOut: "M3 21 C 10 10, 22 3, 37 3", easeIn: "M3 21 C 18 21, 30 14, 37 3", smooth: "M3 21 C 10 18, 12 12, 20 12 S 30 6, 37 3",
  ease: "M3 21 C 15 21, 25 3, 37 3", expo: "M3 21 C 30 21, 10 3, 37 3", back: "M3 21 C 14 21, 18 -4, 37 3",
  linear: "M3 21 L 37 3", hold: "M3 21 L 37 21 L 37 3", wiggle: "M3 21 L 9 13 L 13 18 L 18 9 L 23 14 L 28 5 L 32 9 L 37 3",
};

export function fmtVal(prop: Prop, v: number) {
  if (prop === "opacity" || prop === "scale") return `${Math.round(v * 100)}%`;
  if (prop.startsWith("r")) return `${Math.round(v)}°`;
  return `${Math.round(v)}`;
}

export { ripple };

/** The sound of a clip, drawn across it. */
/**
 * A video clip's frames along it (from the video engine): one small picture per clip-height of width, each the frame
 * at that point of the clip (speed, trims and backwards included). Redrawn shortly after zooming or trimming stops.
 */
function Filmstrip({ item, w, h }: { item: Item; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const len = item.end - item.start;
  useEffect(() => {
    let live = true;
    const run = setTimeout(async () => {
      const src = await videoSource(item.src);
      const c = ref.current;
      if (!src || !c || !live || w < 4 || h < 4) return;
      const dpr = Math.min(2, devicePixelRatio || 1), cw = Math.max(8, h * (src.w / src.h));
      const vis = Math.min(w, 6000); // very long clips: only the first stretch (it's off screen past that anyway)
      c.width = Math.round(vis * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.ceil(vis / cw);
      const slots = Array.from({ length: n }, (_, i) => thumbTime(mediaTimeE(item, Math.min(len, ((i + 0.5) * cw * len) / w), src.dur)));
      await thumbs(item.src!, slots, Math.round(h * dpr), (tt, f) => {
        slots.forEach((s2, i) => { if (s2 === tt) g.drawImage(f.img, i * cw, 0, cw, h); });
      }, () => live);
    }, 180);
    return () => { live = false; clearTimeout(run); };
  }, [item.src, w, h, len, item.mediaOffset, item.speed, item.reverse]);
  return <canvas ref={ref} className="film" style={{ width: Math.min(w, 6000), height: h }} aria-hidden="true" />;
}

function Wave({ item, w }: { item: Item; w: number }) {
  const pk = usePeaks(item.src);
  if (!pk || w < 8) return null;
  const n = Math.min(400, Math.max(8, Math.round(w / 3))), len = item.end - item.start, sp = item.speed ?? 1, off = item.mediaOffset ?? 0;
  const ys = Array.from({ length: n }, (_, i) => {
    let mt = off + ((i + 0.5) / n) * len * sp;
    if (item.reverse) mt = pk.dur - mt;
    const v = pk.peaks[Math.floor(mt * PEAKS_PER_SEC)] ?? 0;
    return Math.min(1, v * 1.4);
  });
  const d = ys.map((v, i) => `M${((i + 0.5) / n) * 100} ${50 - v * 46}V${50 + v * 46}`).join("");
  return <svg className="wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={d} vectorEffect="non-scaling-stroke" /></svg>;
}
