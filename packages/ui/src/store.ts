import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Project, Prop } from "@moshion/engine";
import { dropMaskParents, fitLength, fixPathPivots, upgradePaths, flattenLanes, hasLanes, normalizeProject, sampleProject, unifyTracks } from "@moshion/engine";
import type { TrackSort } from "@moshion/engine";
import { loadAutosave } from "./persist";

export type Side = "left" | "right";
export type Tool = "select" | "blade" | "ripple";
export type Section = "exact";
export type PanelSection = "animate" | "text" | "fill" | "transform" | "rotate" | "opacity" | "effects" | "keys" | "layer" | "group" | "scene" | "motion" | "shape" | "line" | "media" | "chart" | "particles" | "mask" | "track";
export type View = "home" | "edit" | "nodes" | "board";

/** Picked keyframes: for each clip, the times (the item's own) that are picked. */
export type KeyPick = { itemId: string; times: number[] }[];
/** The picked keyframe times on one clip. */
export const pickedOn = (ks: KeyPick | null | undefined, id: string) => ks?.find((q) => q.itemId === id)?.times ?? [];
/** How many keyframes are picked in all. */
export const pickedCount = (ks: KeyPick | null | undefined) => (ks ?? []).reduce((n, q) => n + q.times.length, 0);

export interface UIState {
  view: View;
  side: Side;
  theme: "light" | "dark";
  /** Timeline zoom: pixels per second, and the time at the left edge. */
  pps: number;
  viewStart: number;
  snap: boolean;
  grid: boolean;
  gridOpts: GridOpts;
  tool: Tool;
  graph: boolean;
  /** Which curve the keyframe graph edits: "pos" is position as a whole. */
  graphProp: Prop | "pos" | "along" | "gap";
  hdrW: number;
  /** Phones: how big the buttons and panels are drawn (1 = normal; smaller leaves more room for the video). */
  uiScale: number;
  /** Phones: share of the height the video takes (dragged with the bar on top of the tracks); null = automatic. */
  phoneVid: number | null;
  /** The canvas seen at an angle (3D orbit view). */
  orbit: boolean;
  /** How big the video area is (1 = automatic size); drag its edge to change it. */
  viewK: number;
  /** How the timeline lists tracks (only the view: "layer" is the real front-to-back order). */
  trackSort: TrackSort;
  /** Media panel open. */
  assets: boolean;
  /** Selected track headers (for grouping). */
  selTracks: string[];
  /** The right-click gimbal: on an item, a group track, or the scene (empty canvas / canvas track). */
  wheel: { x: number; y: number; itemId: string | null; trackId?: string; scene?: boolean } | null;
  /** Canvas edit mode: 2D (X/Y box) or 3D (move/rotate gizmo + orientation ball). */
  mode3d: boolean;
  /** The edit panel opened from the floating bar (or a track header). */
  /** `anchor`: the top/bottom of what opened it (the bar over a clip); the card opens above it. */
  panel: { section: PanelSection; itemId: string | null; trackId?: string; bgId?: string; fxId?: string; canvas?: boolean; x: number; y: number; anchor?: { top: number; bottom: number };
    /** opened from the item's popup menu (phones: the card opens right where the menu was) */
    fromMenu?: boolean } | null;
  /** Loop an item's In / Out / Throughout animation on the canvas while picking it. */
  animPreview: { itemId: string; slot: "in" | "out" | "loop" | "tin" | "tout" | "tloop" } | null;
  /** Right-click menu on the canvas (stacking order etc.). */
  ctx: { x: number; y: number; itemId: string } | null;
  /** All selected items when more than one is selected (canvas Shift-click or box). */
  multi: string[];
  /** A selected group track (its bar was clicked). */
  selGroup: string | null;
  /** The group whose items you're editing one by one (double-click a grouped item); otherwise a click picks the whole group. */
  inGroup: string | null;
  /** Item whose placed image is being moved/zoomed inside its shape. */
  cropping: string | null;
  /** Text item being typed into on the canvas. */
  editingText: string | null;
  /** Export window open. */
  exporting: boolean;
  /** Onion skin: faint copies of the selected item at its previous and next keyframes. */
  onion: boolean;
  /** Loop region for playback (I / O set its ends, L turns it on and off). */
  loop: { a: number; b: number; on: boolean } | null;
  /** Keyframes picked with Shift-click on a clip (times are the item's own), to move, stretch, copy or delete together. */
  keySel?: KeyPick | null;
  /** Asking before the browser's Back leaves the app. */
  leaveAsk: boolean;
  /** Drawing a motion clip's path: which block is being drawn. */
  /** Drawing a motion's path; place: the next click sets where it starts. */
  pathDraw: { motionId: string; block: number; place?: boolean; pen?: boolean; after?: number } | null;
  /** On a motion path: the picked node, the picked line (to bend it), or the whole path (Ctrl-click) to move it. */
  pathSel?: { motionId: string; node?: number; seg?: number; whole?: boolean } | null;
  /** Line tool: drawing a straight line or a freehand one. */
  lineTool: "line" | "pen" | null;
  /** Corner pin: the item whose corners are being dragged. */
  pinning?: string | null;
  /** Motion tracking: the video whose tracker is shown on the canvas (its points to place and drag), and a run in progress. */
  tracking?: { itemId: string; trackerId: string; run?: { dir: 1 | -1; done: number; total: number } } | null;
  /** The 3D rotate gimbal's look: a ball to tumble (default) or three rings, one per axis. */
  gimbal?: "ball" | "rings";
  /** Hand: the canvas only moves and zooms (dragging pans it, nothing gets picked). */
  hand?: boolean;
  /** Picking a mask by pointing at it ("with": it masks this item; "for": this item masks it); onion: how onion skin was before. */
  pickMask?: { itemId: string; mode: "with" | "for"; onion: boolean } | null;
  modal: { section: Section; itemId: string | null; trackId?: string; x: number; y: number } | null;
  toast: string | null;
}

interface State {
  project: Project;
  /** The project as last saved to a file (to show unsaved changes). */
  savedProject: Project | null;
  /** Saving the open project failed (shown as a small warning in the header); null when it's saved. */
  saveIssue: string | null;
  t: number;
  playing: boolean;
  selected: string | null;
  ui: UIState;
  past: Project[];
  /** When each undo step was made. */
  pastTimes: number[];
  future: Project[];
  setT(t: number): void;
  togglePlay(): void;
  select(id: string | null): void;
  /** Select several items at once (the last one is the primary). */
  selectMany(ids: string[]): void;
  /** Mutate the project. `commit` records an undo step first. */
  edit(fn: (p: Project) => void, commit?: boolean): void;
  /** Record an undo step without changing anything (call at drag start, then edit(fn,false)). */
  checkpoint(): void;
  undo(): void;
  redo(): void;
  setUI(patch: Partial<UIState> | ((u: UIState) => void)): void;
  toast(msg: string): void;
}

/** A reload keeps you in the project you were in; a fresh launch starts on the start screen. */
const SESSION_KEY = "moshion.session.inProject";
function inProjectAtLoad() { try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; } }

/** Canvas grid: an editing aid only, never rendered into the video. */
export interface GridOpts { style: "dots" | "cross" | "lines"; size: number; color: "blue" | "pink" | "white" | "black"; opacity: number; snap: boolean; thirds: boolean }

const prefersDark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function makeStore() {
  return create<State>()(
  immer((set, get) => ({
    project: (() => {
      // a fresh demo gets its own id, so a new browser's untouched demo never clashes with a real project
      const p = loadAutosave() ?? Object.assign(sampleProject(), { id: "sample_" + Math.random().toString(36).slice(2, 10) });
      normalizeProject(p); return p;
    })(),
    savedProject: null,
    saveIssue: null,
    t: 3.2,
    playing: false,
    selected: null,
    past: [],
    pastTimes: [],
    future: [],
    ui: {
      view: inProjectAtLoad() ? "edit" : "home", side: "left", theme: prefersDark ? "dark" : "light",
      pps: 100, viewStart: 0, snap: true, grid: false, gridOpts: { style: "dots", size: 90, color: "blue", opacity: 0.45, snap: true, thirds: false }, tool: "select",
      graph: true, graphProp: "pos", hdrW: 64, uiScale: 1, phoneVid: null, orbit: false, viewK: 1, trackSort: "layer", assets: false, selTracks: [], mode3d: false, multi: [], selGroup: null, inGroup: null, cropping: null, panel: null, ctx: null, editingText: null, wheel: null, modal: null, animPreview: null, exporting: false, onion: false, loop: null, leaveAsk: false, pathDraw: null, lineTool: null, toast: null,
    },
    setT: (t) => set((s) => { s.t = Math.max(0, Math.min(s.project.duration, t)); }),
    togglePlay: () => set((s) => { s.playing = !s.playing; if (s.playing && s.t >= s.project.duration - 1e-3) s.t = 0; }),
    select: (id) => set((s) => {
      s.selected = id; s.ui.multi = []; s.ui.selGroup = null;
      // selecting one item of a group (timeline, double-click) means editing inside that group
      const it = id ? s.project.items.find((i) => i.id === id) : undefined;
      s.ui.inGroup = it ? s.project.tracks.find((t) => t.id === it.trackId)?.parent ?? null : null;
      // if the playhead isn't on the item, move it onto the item so it shows on the canvas
      if (it && it.kind !== "audio" && (s.t < it.start || s.t >= it.end)) s.t = s.t < it.start ? it.start : Math.max(it.start, it.end - 1 / (s.project.fps || 30));
    }),
    selectMany: (ids) => set((s) => { s.selected = ids[ids.length - 1] ?? null; s.ui.multi = ids.length > 1 ? ids : []; s.ui.selGroup = null; }),
    edit: (fn, commit = true) => {
      if (commit) get().checkpoint();
      set((s) => {
        fn(s.project);
        if (hasLanes(s.project)) flattenLanes(s.project);
        if (s.project.tracks.some((t) => t.kind === "audio")) unifyTracks(s.project);
        fitLength(s.project); if (s.t > s.project.duration) s.t = s.project.duration;
        dropMaskParents(s.project); // masks aren't parents (that was tried and taken back): clear any links it made
        if (s.project.items.some((i) => i.kind === "motion" && !i.pathV2)) upgradePaths(s.project);
        fixPathPivots(s.project); // a turned / tilted / sized path keeps its turning point while its nodes are edited
      });
    },
    checkpoint: () => set((s) => {
      s.past.push(get().project); s.pastTimes.push(Date.now());
      if (s.past.length > 200) { s.past.shift(); s.pastTimes.shift(); }
      s.future = [];
    }),
    undo: () => set((s) => {
      const prev = s.past.pop(); s.pastTimes.pop();
      if (prev) { s.future.push(get().project); s.project = prev; }
    }),
    redo: () => set((s) => {
      const next = s.future.pop();
      if (next) { s.past.push(get().project); s.pastTimes.push(Date.now()); s.project = next; }
    }),
    setUI: (patch) => set((s) => {
      if (typeof patch === "function") patch(s.ui); else Object.assign(s.ui, patch);
    }),
    toast: (msg) => {
      set((s) => { s.ui.toast = msg; });
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => set((s) => { s.ui.toast = null; }), 1700);
    },
  })),
  );
}

/**
 * One store for the life of the page. Live code updates (HMR) re-run this module;
 * reusing the existing store keeps every component, shortcut and undo history on
 * the same state instead of splitting them across two copies.
 */
const g = globalThis as unknown as { __moshionStore?: ReturnType<typeof makeStore>; __moshionInit?: boolean };
export const useStore = (g.__moshionStore ??= makeStore());
const firstLoad = !g.__moshionInit;
g.__moshionInit = true;

export const isVertical = (p: Project) => p.height > p.width;

/** Delete the selected item, or every selected item. Items on locked tracks stay. */
export function deleteSelection(): number {
  const s = useStore.getState();
  const ids = s.ui.multi.length ? s.ui.multi : s.selected ? [s.selected] : [];
  const locked = (trackId: string) => {
    const t = s.project.tracks.find((x) => x.id === trackId);
    return !!t?.locked || (!!t?.parent && !!s.project.tracks.find((g) => g.id === t.parent)?.locked);
  };
  const del = s.project.items.filter((i) => ids.includes(i.id) && !locked(i.trackId));
  if (!del.length) { if (ids.length) s.toast("Those items are on a locked track"); return 0; }
  s.edit((p) => {
    p.items = p.items.filter((i) => !del.some((d) => d.id === i.id));
    if (s.ui.tool === "ripple") for (const it of del) { const d = it.end - it.start; for (const o of p.items) if (o.trackId === it.trackId && o.start >= it.end - 1e-4) { o.start -= d; o.end -= d; } }
  });
  s.select(null);
  s.setUI({ wheel: null, modal: null, panel: null, ctx: null });
  s.toast(`${del.length === 1 ? del[0].name : `${del.length} items`} deleted · Ctrl+Z brings ${del.length === 1 ? "it" : "them"} back`);
  return del.length;
}

// a freshly loaded project counts as saved until something changes
if (firstLoad) useStore.setState({ savedProject: useStore.getState().project });

/** Open the edit panel at a point (group tracks, the canvas track). */
export function openPanelAt(e: { clientX: number; clientY: number }, target: { section: PanelSection; itemId: string | null; trackId?: string }) {
  useStore.getState().setUI({ wheel: null, ctx: null, panel: { x: e.clientX, y: e.clientY, ...target } });
}

/* remember interface choices (2D/3D, side, theme, track-name width…) across reloads */
const UI_KEY = "moshion.ui.v1";
type Prefs = Pick<UIState, "mode3d" | "side" | "theme" | "hdrW" | "uiScale" | "phoneVid" | "viewK" | "trackSort" | "graph" | "snap" | "grid" | "assets" | "gridOpts">;
if (firstLoad) try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) ?? "null") as Partial<Prefs> | null;
  if (saved && (saved.hdrW ?? 0) >= 150) delete saved.hdrW; // the old wide default
  if (saved?.hdrW != null && saved.hdrW < 48) saved.hdrW = 48; // narrow enough to still show show/lock
  if (saved) { const def = useStore.getState().ui.gridOpts; useStore.getState().setUI({ ...saved, gridOpts: { ...def, ...(saved.gridOpts ?? {}) } }); }
} catch { /* storage unavailable */ }
if (firstLoad) useStore.subscribe((s) => {
  try { if (s.ui.view === "home") sessionStorage.removeItem(SESSION_KEY); else sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
});
let lastPrefs = "";
if (firstLoad) useStore.subscribe((s) => {
  const { mode3d, side, theme, hdrW, uiScale, phoneVid, viewK, trackSort, graph, snap, grid, assets, gridOpts } = s.ui;
  const next = JSON.stringify({ mode3d, side, theme, hdrW, uiScale, phoneVid, viewK, trackSort, graph, snap, grid, assets, gridOpts } satisfies Prefs);
  if (next !== lastPrefs) { lastPrefs = next; try { localStorage.setItem(UI_KEY, next); } catch { /* ignore */ } }
});

// dev-only handle for debugging in the browser console
if (import.meta.env?.DEV) (window as unknown as { __moshion: typeof useStore }).__moshion = useStore;

