import { useState } from "react";
import type { Item, ItemKind, Project } from "@moshion/engine";
import { activeBackground, fmtTimecode, placeItem, uid } from "@moshion/engine";
import { isVertical, useStore } from "./store";
import { putProject } from "./library";
import { importFiles, pickMedia, placeAsset } from "./media";
import { addCamera, addMotion } from "./MotionPath";
import { HistoryButton, RedoButton, UndoButton } from "./History";
import { ShapePicker, addLine } from "./Shapes";
import { Icon, PlayIcon } from "./Icon";
import { canScaleUi, useStacked } from "./layout";
import { toggleMod, useMods, useTouch } from "./touch";
import { GridButton } from "./Grid";
import { motion } from "motion/react";
import { anim } from "./anim";

/* ---------------- header: projects, title, views, export ---------------- */
/** Save, then back to the projects screen. */
async function goHome() {
  await putProject(useStore.getState().project).catch(() => {});
  useStore.setState({ playing: false });
  useStore.getState().setUI({ view: "home", panel: null, ctx: null });
}

export function Header() {
  const ui = useStore((s) => s.ui);
  const project = useStore((s) => s.project);
  const { setUI } = useStore.getState();
  return (
    <header className="card head">
      <button className="ib" title="All projects" aria-label="All projects" onClick={goHome}><Icon name="board" /></button>
      {/* just the name: the size shows under the canvas and the frame rate in the player */}
      <div className="ptitle">
        <input
          className="pname" value={project.name} aria-label="Project name" title="Rename the project"
          onFocus={() => useStore.getState().checkpoint()}
          onChange={(e) => useStore.getState().edit((p) => { p.name = e.target.value; }, false)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="seg" role="group" aria-label="View">
        {([["edit", "edit", "Edit"], ["nodes", "nodes", "Nodes"], ["board", "board", "Board"]] as const).map(([v, ic, label]) => (
          <button key={v} className={ui.view === v ? "on" : ""} title={label} aria-label={label} onClick={() => setUI({ view: v, wheel: null, modal: null })}><Icon name={ic} /></button>
        ))}
      </div>
      <span className="sp" />
      <SaveWarning />
      <button className="btn dark" onClick={() => setUI({ exporting: true })}><Icon name="export" />Export</button>
    </header>
  );
}

/**
 * Phone held upright: no top bar. The menu button sits at the top of the tools sidebar; its menu holds the project's
 * name, Export, the views, the interface size, the theme and the way back to all projects.
 */
export function PhoneMenu() {
  const ui = useStore((s) => s.ui);
  const project = useStore((s) => s.project);
  const issue = useStore((s) => s.saveIssue);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const { setUI } = useStore.getState();
  const close = () => setAt(null);
  return (
    <>
      <button className={"ib pmbtn" + (at ? " on" : "")} title={issue ? "Menu · not saved" : "Menu"} aria-label="Menu"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(at ? null : r.left > innerWidth / 2 ? { x: -(innerWidth - r.left + 8), y: r.top } : { x: r.right + 8, y: r.top }); }}>
        <Icon name="menu" />{issue && <i className="pmdot" />}
      </button>
      {at && (
        <>
          <div className="pmback" onPointerDown={close} />
          <motion.div {...anim.pop} className="pmenu" style={at.x < 0 ? { right: -at.x, top: at.y } : { left: at.x, top: at.y }}>
            <div className="pmname">
              <input className="pname" value={project.name} aria-label="Project name"
                onFocus={() => useStore.getState().checkpoint()}
                onChange={(e) => useStore.getState().edit((p) => { p.name = e.target.value; }, false)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
              <span className="lbl">{project.width}×{project.height} · {project.fps} fps</span>
            </div>
            <SaveWarning />
            <button className="pmitem pmexport" onClick={() => { close(); setUI({ exporting: true }); }}><Icon name="export" />Export</button>
            <div className="pmrow"><em>Canvas</em>
              <span className="pmtools">
                <button className={"ib" + (ui.onion ? " on" : "")} title="Onion skin" aria-label="Onion skin" onClick={() => setUI({ onion: !ui.onion })}><Icon name="frame" /></button>
                <GridButton />
                <button className={"ib" + (ui.orbit ? " on" : "")} title="3D orbit view" aria-label="3D orbit view" onClick={() => setUI({ orbit: !ui.orbit })}><Icon name="cube" /></button>
              </span>
            </div>
            <div className="pmrow"><em>View</em>
              <div className="seg" role="group" aria-label="View">
                {([["edit", "edit", "Edit"], ["nodes", "nodes", "Nodes"], ["board", "board", "Board"]] as const).map(([v, ic, label]) => (
                  <button key={v} className={ui.view === v ? "on" : ""} title={label} aria-label={label} onClick={() => { setUI({ view: v, wheel: null, modal: null }); close(); }}><Icon name={ic} /></button>
                ))}
              </div>
            </div>
            <div className="pmrow" title={canScaleUi() ? "Smaller controls leave more room for the video" : "Works on phones and in the desktop app. In a desktop browser, use Ctrl − and Ctrl + instead."}><em>Interface size</em>
              <div className="seg" role="group" aria-label="Interface size">
                {[1, 0.85, 0.7, 0.6].map((k) => (
                  <button key={k} className={(ui.uiScale ?? 1) === k ? "on" : ""} title={k === 1 ? "Normal" : `${Math.round(k * 100)}%: smaller controls, more room for the video`} onClick={() => setUI({ uiScale: k })}>{Math.round(k * 100)}</button>
                ))}
              </div>
            </div>
            <button className="pmitem" onClick={() => setUI({ theme: ui.theme === "dark" ? "light" : "dark" })}><Icon name={ui.theme === "dark" ? "moon" : "sun"} />{ui.theme === "dark" ? "Dark" : "Light"} theme</button>
            <button className="pmitem" onClick={goHome}><Icon name="board" />All projects</button>
          </motion.div>
        </>
      )}
    </>
  );
}

/** A small warning when the open project couldn't be saved; click it to try again. */
function SaveWarning() {
  const issue = useStore((s) => s.saveIssue);
  if (!issue) return null;
  return (
    <button className="savewarn" title={`${issue} · click to try again`}
      onClick={() => { const s = useStore.getState(); putProject(s.project).then(() => s.toast(useStore.getState().saveIssue ? "Still couldn't save" : "Saved")).catch(() => s.toast("Still couldn't save — use Save (Ctrl+S) to keep a file")); }}>
      <i />Not saved
    </button>
  );
}

/** Play controls and timecode (sits on top of the timeline). */
/** The fixed bar under the tracks: player, then layout and theme. */
export function PlayerBar() {
  const ui = useStore((s) => s.ui);
  const vertical = useStore((s) => isVertical(s.project));
  const stacked = useStacked();
  const touch = useTouch();
  const { setUI } = useStore.getState();
  const sideTip = `Put the video on the ${ui.side === "left" ? "right" : "left"}`;
  const sideTurn = ui.side === "right" ? "scaleX(-1)" : undefined;
  const loopBtn = <LoopButton />;
  // phones: a sidebar beside the video: menu and History on top; held keys, then undo / redo at the bottom
  if (stacked) return (
    <div className="pbar">
      <div className="pbgroup pbtop"><PhoneMenu /><HistoryButton />{loopBtn}</div>
      <span />
      {/* the play controls are in the track toolbar on phones */}
      <div className="pbgroup pbbot">{touch && <TouchMods />}<UndoButton /><RedoButton /></div>
    </div>
  );
  return (
    <div className="pbar">
      <Transport />
      {loopBtn}
      <span className="pbsep" />
      <UndoButton />
      <RedoButton />
      <HistoryButton />
      <span className="sp" />
      <button className="ib" title={sideTip} aria-label={sideTip} onClick={() => setUI({ side: ui.side === "left" ? "right" : "left" })}>
        <span style={{ display: "inline-flex", transform: sideTurn }}><Icon name="side" /></span>
      </button>
      <span className="pbar-ratio" title="Layout follows the video shape">{vertical ? "Tall" : "Wide"}</span>
      <button className="ib" title="Toggle theme" onClick={() => setUI({ theme: ui.theme === "dark" ? "light" : "dark" })}><Icon name={ui.theme === "dark" ? "moon" : "sun"} /></button>
    </div>
  );
}

/** Loop: the selected item (or the range set with I / O) plays over and over (L). */
/** Select or hand: with the hand, the canvas only moves and zooms (drag to move around, scroll or pinch to zoom). */
function SelectHand() {
  const hand = useStore((s) => !!s.ui.hand);
  // the arrow is the one select: it also puts the timeline back from Blade / Ripple (like V)
  const set = (on: boolean) => useStore.getState().setUI({ hand: on, ...(on ? { pinning: null, ctx: null } : { tool: "select" }) });
  return <>
    <button className={"ib" + (hand ? "" : " on")} title="Select (V)" aria-label="Select" onClick={() => set(false)}><Icon name="cursor" /></button>
    <button className={"ib" + (hand ? " on" : "")} title="Hand (H): move and zoom the canvas" aria-label="Hand" onClick={() => set(!hand)}><Icon name="hand" /></button>
  </>;
}

export function LoopButton() {
  const ui = useStore((s) => s.ui);
  return (
    <button className={"ib" + (ui.loop?.on ? " on" : "")} title={ui.loop ? `Loop ${ui.loop.a.toFixed(2)}–${ui.loop.b.toFixed(2)}s (L) · I / O set its ends` : "Loop: plays the selected item (or a range set with I and O) over and over (L)"}
        onClick={() => { const s = useStore.getState(); const lp = s.ui.loop; if (lp) s.setUI({ loop: { ...lp, on: !lp.on } }); else { const it = s.project.items.find((i) => i.id === s.selected); s.setUI({ loop: { a: it?.start ?? 0, b: it?.end ?? s.project.duration, on: true } }); } }}>
        <Icon name="cycle" />
      </button>
  );
}

export function Transport() {
  const t = useStore((s) => s.t);
  const playing = useStore((s) => s.playing);
  const fps = useStore((s) => s.project.fps);
  const { togglePlay, setT } = useStore.getState();
  const tc = fmtTimecode(t);
  const project = { fps };
  return (
    <div className="transport">
        <button className="ib" title="Go to start (Home)" onClick={() => setT(0)}><Icon name="prev" /></button>
        <button className="play" title="Play / pause (Space)" onClick={togglePlay}><PlayIcon playing={playing} /></button>
        <button className="ib" title="Next keyframe" onClick={() => nextKey()}><Icon name="next" /></button>
        <div className="tc"><span className="dim">{tc.head}</span>{tc.tail}</div>
        <div className="tcm">{project.fps} fps<br />f {Math.floor(t * project.fps)}</div>
    </div>
  );
}

function nextKey() {
  const { project, t, setT } = useStore.getState();
  const times: number[] = [];
  for (const it of project.items) for (const ks of Object.values(it.keys)) ks?.forEach((k) => times.push(it.start + k.t));
  for (const tr of project.tracks) for (const ks of Object.values(tr.keys ?? {})) ks?.forEach((k) => times.push(k.t));
  const n = times.filter((x) => x > t + 1e-4).sort((a, b) => a - b)[0];
  if (n != null) setT(n);
}

/* ---------------- tool rail: add things ---------------- */
const SHAPES: Record<string, Partial<Item>> = {
  rect: { kind: "rect", name: "Rectangle", w: 420, h: 300, fill: "#3A5BFF", radius: 24, tint: "--blue" },
  ellipse: { kind: "ellipse", name: "Ellipse", w: 380, h: 380, fill: "#7B4DFF", tint: "--violet" },
  star: { kind: "star", name: "Star", w: 300, h: 300, fill: "#111111", tint: "--pink" },
  text: { kind: "text", name: "Text", w: 700, h: 200, fill: "transparent", text: "Type here", fontSize: 120, color: "#111111", tint: "--violet" },
};

/** Black or white, whichever shows up on the background at time t. */
export function inkFor(project: Project, t: number): string {
  const bg = activeBackground(project, t);
  const c = bg ? bg.colors[0] : project.background;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c ?? "");
  if (!m) return "#111111";
  const lum = (0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16)) / 255;
  return lum < 0.5 ? "#ffffff" : "#111111";
}

export function addItem(spec: Partial<Item>) {
  const { project, t, edit, select, toast } = useStore.getState();
  if (spec.kind === "text" && (!spec.color || spec.color === "#111111")) spec = { ...spec, color: inkFor(project, t) };
  const id = uid("item");
  const auto = project.autoLength !== false;
  const start = auto ? (project.items.length ? Math.min(t, project.duration) : 0) : Math.min(t, project.duration - 0.5);
  const end = auto ? start + 3 : Math.min(project.duration, start + 3);
  const prefer = project.items.find((i) => i.id === useStore.getState().selected)?.trackId;
  edit((p: Project) => {
    const { trackId, lane } = placeItem(p, "video", start, end, prefer, () => uid("V"));
    p.items.push({
      id, name: "Item", kind: "rect" as ItemKind, trackId, lane, start, end, w: 300, h: 300, fill: "#888", tint: "--blue", keys: {},
      base: { x: p.width / 2, y: p.height / 2, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 },
      ...JSON.parse(JSON.stringify(spec)),
    });
  });
  select(id);
  toast(`${spec.name} added · right-click it to edit`);
}

export function Rail() {
  const assetsOn = useStore((s) => s.ui.assets);
  const wide = useStore((s) => !isVertical(s.project));
  const stacked = useStacked();
  const touch = useTouch();
  const tools: [string, string, string][] = [["text", "type", "Text"]];
  const lineTool = useStore((s) => s.ui.lineTool);
  const blade = useStore((s) => s.ui.tool === "blade");
  return (
    <nav className="card rail" aria-label="Tools">
      {/* phones: the menu, History and the held keys are on the right sidebar */}
      {touch && !stacked && <><TouchMods /><hr /></>}
      <SelectHand />
      {/* phones: the blade (cut a clip where you tap it) lives here; tap again to put it away */}
      {stacked && <button className={"ib" + (blade ? " on" : "")} title="Blade: tap a clip to cut it there (B)" aria-label="Blade" onClick={() => useStore.getState().setUI({ tool: blade ? "select" : "blade", hand: false })}><Icon name="scissors" /></button>}
      <hr />
      <ShapePicker />
      <button className="ib" title="Line" aria-label="Add a line" onClick={() => addLine()}><Icon name="line" /></button>
      <button className={"ib" + (lineTool === "pen" ? " on" : "")} title="Pen: draw a freehand line" aria-label="Draw freehand" onClick={() => useStore.getState().setUI({ lineTool: lineTool === "pen" ? null : "pen" })}><Icon name="pen" /></button>
      {tools.map(([k, ic, label]) => (
        <button key={k} className="ib" title={`Add ${label}`} aria-label={`Add ${label}`} onClick={() => addItem(SHAPES[k])}><Icon name={ic} /></button>
      ))}
      <button className="ib" title="Motion path" aria-label="Add motion path" onClick={() => addMotion()}><Icon name="motion" /></button>
      <button className="ib" title="Camera" aria-label="Add camera" onClick={() => addCamera()}><Icon name="camera" /></button>
      <hr />
      {(!wide || stacked) && <button className={"ib" + (assetsOn ? " on" : "")} title="Media: imported pictures, videos and audio" aria-label="Media" onClick={() => useStore.getState().setUI({ assets: !assetsOn })}><Icon name="image" /></button>}
      {/* phones: importing is in Media (its + button) */}
      {!stacked && <button className="ib" title="Import pictures, videos or audio" aria-label="Import media" onClick={async () => {
        const f = await pickMedia();
        if (!f.length) return;
        const added = await importFiles(f);
        useStore.getState().setUI({ assets: true });
        if (added.length === 1) placeAsset(added[0]);
      }}><Icon name="plus" /></button>}
      <button className="ib" title="Import .obj 3D model (coming next)" aria-label="Import 3D model" onClick={() => useStore.getState().toast("3D models (.obj) come with the WebGL renderer")}><Icon name="cube" /></button>
    </nav>
  );
}

/**
 * Touch screens: sticky Shift / Ctrl / Alt. While one is on, every tap and drag acts as if that key were held
 * (Shift: add to the selection, straight angles · Ctrl: pick the item behind, move a whole path · Alt: stretch keyframes).
 */
function TouchMods() {
  const m = useMods();
  const b = (k: "shift" | "ctrl" | "alt", label: string, tip: string) => (
    <button className={"tmod" + (m[k] ? " on" : "")} title={tip} aria-pressed={m[k]} onClick={() => toggleMod(k)}>{label}</button>
  );
  return (
    <div className="tmods" role="group" aria-label="Held keys">
      {b("shift", "⇧", "Shift held: tap more items to add them to the selection, keep angles and lines straight")}
      {b("ctrl", "Ctrl", "Ctrl held: tap again to pick the item behind, tap a path to move all of it")}
      {b("alt", "Alt", "Alt held: dragging a clip's edge stretches its keyframes")}
    </div>
  );
}

/* ---------------- layers ---------------- */
export function Layers() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const { select, setUI } = useStore.getState();
  const row = (it: Item, child: boolean) => (
    <button
      key={it.id}
      className={"lr" + (child ? " ch" : "") + (selected === it.id ? " on" : "")}
      onClick={() => select(it.id)}
      onContextMenu={(e) => { e.preventDefault(); select(it.id); setUI({ modal: null, wheel: { x: e.clientX, y: e.clientY, itemId: it.id } }); }}
    >
      <span className="sw" style={{ background: it.kind === "text" ? it.color : it.fill, backgroundSize: "cover" }} />
      <span className="nm">{it.name}</span>
      <span className="tag">{it.trackId}</span>
    </button>
  );
  return (
    <aside className="card layers" aria-label="Layers">
      <div className="lhead"><span className="lbl">Project · {project.width}×{project.height}</span><b>{project.name}</b></div>
      <div className="lyr">
        {project.tracks.filter((tr) => !tr.parent).flatMap((tr) => {
          if (tr.kind === "group") {
            const kids = project.tracks.filter((c) => c.parent === tr.id).flatMap((c) => project.items.filter((i) => i.trackId === c.id));
            return [
              <button key={tr.id} className="lr grp" onContextMenu={(e) => { e.preventDefault(); setUI({ modal: null, wheel: { x: e.clientX, y: e.clientY, itemId: null, trackId: tr.id } }); }}>
                <Icon name="group" className="gi" /><span className="nm">{tr.name}</span><span className="tag">{kids.length}</span>
              </button>,
              ...kids.map((k) => row(k, true)),
            ];
          }
          return project.items.filter((i) => i.trackId === tr.id && i.kind !== "audio").map((i) => row(i, false));
        })}
      </div>
    </aside>
  );
}
