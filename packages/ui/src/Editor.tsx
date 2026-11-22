import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { anim } from "./anim";
import { addKey, fmtClock, splitItem } from "@moshion/engine";
import { deleteSelection, isVertical, useStore } from "./store";
import { Viewer } from "./Viewer";
import { Assets } from "./Assets";
import { syncPresets } from "./presets";
import { syncBrand } from "./brand";
import { copyKeyframe, copyStyle, nudge, pasteKeyframe, pasteStyle, copyPickedKeys, deletePickedKeys, pastePickedKeys, toggleLock, addMarker, loopIn, loopOut, groupSelection, ungroupSelection } from "./editing";
import { Home } from "./Home";
import { TitleBar, hasTitleBar } from "./TitleBar";
import { installTouch } from "./touch";
import { ConfirmBubble } from "./Confirm";
import { ExportDialog } from "./Export";
import { openNewerCopy, putProject, restorePictures, startLibrarySync, syncWithDisk } from "./library";
import { diskInit } from "./disk";
import { Timeline, addChannelKey, channelProps, chLabel } from "./Timeline";
import { Header, PlayerBar, Rail } from "./Panels";
import { applyUiScale, isStacked, useWindowSize } from "./layout";
import { EditPanel, TrackBar } from "./EditPanel";
import { Tooltips } from "./Tooltips";
import { CanvasMenu, duplicate, layer } from "./CanvasMenu";
import { openProject, saveProject, startAutosave } from "./persist";
import "./styles.css";

function useLayoutVars(vertical: boolean, aspect: number, media: boolean, f = 1, split: number | null = null) {
  const size = useWindowSize();
  // upright phone: the video takes the full width, up to a bit under half the height
  // (no top bar there, and the tools sit beside the video)
  const auto = Math.min((size.h - 6) * 0.6, (size.w - 6 - 45 - 39) / aspect); // tools on the left, play controls on the right
  const sh = Math.round(Math.max(120, Math.min(size.h - 160, split != null ? (size.h - 6) * split : auto)));
  const vw = Math.round(Math.min(size.w * 0.75, Math.max(200, Math.min(size.w * 0.4, ((size.h - 6 - 34) * 9) / 16) * f)));
  const rows = size.h - 6;
  // horizontal: the video row takes ~58% of the height, the timeline the rest
  // wide videos: the video sits in a column beside the tracks; Media (when open) goes under it
  let hw = Math.round(Math.min(size.w - 320, Math.max(280, Math.max(360, size.w * 0.5) * f)));
  let vh = Math.round(hw / aspect + 34);
  const maxVh = Math.round(rows * (media ? 0.62 : 1));
  if (vh > maxVh) { vh = maxVh; hw = Math.round((vh - 34) * aspect); }
  vh = Math.max(vh, 140);
  return { ["--vw" as string]: `${vw}px`, ["--hw" as string]: `${hw}px`, ["--vh" as string]: `${vh}px`, ["--sh" as string]: `${sh}px`, vertical, stacked: isStacked(size.w, size.h) } as const;
}

function usePlayback() {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const { t, project, setT, setUI, ui } = useStore.getState();
      let nt = t + (now - last) / 1000; last = now;
      if (nt >= project.duration) nt = 0;
      const lp = useStore.getState().ui.loop;
      if (lp?.on && lp.b > lp.a && (nt >= lp.b || nt < lp.a - 0.05)) nt = lp.a;
      setT(nt);
      const W = 1000; // keep the playhead in view when it runs off the right edge
      const px = (nt - ui.viewStart) * ui.pps;
      if (px < 0 || px > W) setUI({ viewStart: Math.max(0, nt - 20 / ui.pps) });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function useShortcuts() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // only real typing fields swallow keys; sliders and buttons keep the shortcuts working
      if (useStore.getState().ui.view === "home") return;
      if ((e.target as HTMLElement).closest('input:not([type="range"]):not([type="checkbox"]):not([type="color"]),textarea,[contenteditable]')) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "c" && s.ui.keySel?.length) { e.preventDefault(); copyPickedKeys(); return; }
      if (mod && !e.altKey && e.key.toLowerCase() === "v" && pastePickedKeys()) { e.preventDefault(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && s.ui.keySel?.length) { e.preventDefault(); deletePickedKeys(); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && (e.code === "BracketRight" || e.code === "BracketLeft") && s.selected) {
        e.preventDefault();
        const fwd = e.code === "BracketRight";
        layer(s.selected, fwd ? (e.shiftKey ? "front" : "forward") : (e.shiftKey ? "back" : "backward"));
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && s.selected) { e.preventDefault(); duplicate(s.selected); return; }
      if (mod && e.altKey && e.key.toLowerCase() === "c") { e.preventDefault(); copyStyle(); return; }
      if (mod && e.altKey && e.key.toLowerCase() === "v") { e.preventDefault(); pasteStyle(); return; }
      if (!mod && e.altKey && e.key.toLowerCase() === "c") { e.preventDefault(); copyKeyframe(); return; }
      if (!mod && e.altKey && e.key.toLowerCase() === "v") { e.preventDefault(); pasteKeyframe(); return; }
      // Ctrl+S saves the project where it lives (no file window); Ctrl+Shift+S saves a copy as a .moshion file
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) { saveProject(true); return; }
        const p = s.project;
        putProject(p).then(() => { useStore.setState({ savedProject: p }); s.toast("Saved"); }).catch(() => s.toast("Couldn't save — try again"));
        return;
      }
      if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); openProject(); return; }
      // Ctrl+Shift+L: lock / unlock the selected items (one or many)
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); toggleLock(); return; }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection(); else groupSelection();
        return;
      }
      if (s.ui.editingText) return;
      if (s.ui.wheel && e.key !== "Delete" && e.key !== "Backspace") return;
      const fps = s.project.fps;
      switch (e.key) {
        case " ": e.preventDefault(); s.togglePlay(); break;
        case "Home": s.setT(0); break;
        // arrows nudge the selected items (Shift: 10px); with nothing selected (or Alt) they step the playhead
        case "ArrowRight": if (e.altKey || !nudge(e.shiftKey ? 10 : 1, 0)) s.setT(s.t + (e.shiftKey ? 1 : 1 / fps)); e.preventDefault(); break;
        case "ArrowLeft": if (e.altKey || !nudge(e.shiftKey ? -10 : -1, 0)) s.setT(s.t - (e.shiftKey ? 1 : 1 / fps)); e.preventDefault(); break;
        case "ArrowUp": if (nudge(0, e.shiftKey ? -10 : -1)) e.preventDefault(); break;
        case "ArrowDown": if (nudge(0, e.shiftKey ? 10 : 1)) e.preventDefault(); break;
        case ",": s.setT(s.t - 1 / fps); break;
        case ".": s.setT(s.t + 1 / fps); break;
        case "m": addMarker(); break;
        case "i": loopIn(); break;
        case "o": loopOut(); break;
        case "l": {
          const lp = s.ui.loop;
          if (lp) s.setUI({ loop: { ...lp, on: !lp.on } });
          else { const it = s.project.items.find((i) => i.id === s.selected); s.setUI({ loop: { a: it?.start ?? 0, b: it?.end ?? s.project.duration, on: true } }); }
          s.toast(lp?.on ? "Loop off" : "Loop on");
          break;
        }
        case "v": s.setUI({ tool: "select" }); break;
        case "b": s.setUI({ tool: "blade" }); break;
        case "r": s.setUI({ tool: "ripple" }); break;
        case "n": s.setUI({ snap: !s.ui.snap }); break;
        case "g": s.setUI({ grid: !s.ui.grid }); break;
        case "c": s.setUI({ graph: !s.ui.graph }); break;
        case "=": case "+": s.setUI({ pps: Math.min(s.ui.pps * 2, 6e6) }); break;
        case "-": s.setUI({ pps: Math.max(s.ui.pps / 2, 2) }); break;
        case "s": {
          const it = s.project.items.find((i) => i.id === s.selected) ?? s.project.items.find((i) => s.t > i.start && s.t < i.end);
          if (it && s.t > it.start && s.t < it.end) { s.edit((p) => { const b = splitItem(p, it.id, s.t); if (b) s.select(b.id); }); s.toast(`Split ${it.name} at ${fmtClock(s.t)}`); }
          break;
        }
        case "k": {
          const it = s.project.items.find((i) => i.id === s.selected);
          if (it) { s.edit((p) => { const d = p.items.find((i) => i.id === it.id)!; if (!addChannelKey(d, s.ui.graphProp, s.t - d.start)) channelProps(d, s.ui.graphProp).forEach((pp) => addKey(d, pp, s.t - d.start)); }); s.toast(`${chLabel(s.ui.graphProp)} key added`); }
          break;
        }
        case "Delete": case "Backspace": {
          if (!s.selected && !s.ui.multi.length) break;
          e.preventDefault();
          deleteSelection();
          break;
        }
        case "Escape": s.select(null); break;
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
}

export function Editor() {
  const project = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const vertical = isVertical(project);
  const { vertical: _v, stacked, ...vars } = useLayoutVars(vertical, project.width / project.height, true, ui.view === "board" ? ui.viewK ?? 1 : 1, ui.phoneVid ?? null);
  usePlayback();
  useShortcuts();
  useEffect(() => startAutosave(), []);
  // the quick-save copy may be older than the library's (it can't hold big projects): open the newer one
  useEffect(() => { restorePictures().catch(() => {}).finally(() => openNewerCopy().catch(() => {})); }, []);
  useEffect(() => startLibrarySync(), []);
  // the browser's Back button (or a mouse's back button) asks before leaving the app
  useEffect(() => {
    let leaving = false;
    history.pushState({ moshion: 1 }, "");
    const pop = () => {
      if (leaving) return;
      history.pushState({ moshion: 1 }, "");
      useStore.getState().setUI({ leaveAsk: true });
    };
    const leave = () => { leaving = true; putProject(useStore.getState().project).finally(() => history.go(-2)); };
    addEventListener("popstate", pop);
    addEventListener("moshion-leave", leave);
    return () => { removeEventListener("popstate", pop); removeEventListener("moshion-leave", leave); };
  }, []);
  // projects saved as files (Documents/Moshion, or the folder picked in the browser)
  useEffect(() => { diskInit().then(() => syncWithDisk()).catch(() => {}); syncPresets(); syncBrand(); }, []);
  // the project you had open before this update joins the library, so it shows up under "Your projects"
  useEffect(() => {
    try {
      if (localStorage.getItem("moshion.library.v1")) return;
      localStorage.setItem("moshion.library.v1", "1");
      if (Object.keys(localStorage).some((k) => k.startsWith("moshion.autosave.v1"))) putProject(useStore.getState().project).catch(() => {});
    } catch { /* storage unavailable */ }
  }, []);
  // upright phone: stacked, the video on top; otherwise side by side
  const layout = stacked ? "s-top" : `${vertical ? "v" : "h"}-${ui.side}`;
  const media = stacked ? ui.assets : ui.assets || !vertical;
  const framed = hasTitleBar();
  // touch screens: long-press, double-tap, two-finger gestures and the sticky modifier keys
  useEffect(() => installTouch(), []);
  useEffect(() => applyUiScale(ui.uiScale ?? 1), [ui.uiScale]);
  return (
    <div className={"mo" + (framed ? " framed" : "") + (stacked ? " phone" : "") + (stacked && (ui.panel || ui.ctx) ? " dimmed" : "")} data-theme={ui.theme} style={vars as React.CSSProperties} onContextMenu={(e) => e.preventDefault()}>
      {framed && <TitleBar />}
      {ui.view === "home" ? <Home /> : ui.view === "edit" || ui.view === "board" ? (
        <div className={"ws " + layout + (media ? " am" : "")}>
          {!stacked && <Header />}
          <Viewer />
          <Rail />
          {media && <Assets />}
          <Timeline />
          {stacked && <PlayerBar />}
          {/* phones: the handle on the gap between the video and the tracks: drag for more of either (double-tap: automatic) */}
          {stacked && <div className="tsplit" title="Drag to resize the video and the tracks · double-tap for the automatic size"
            onDoubleClick={() => useStore.getState().setUI({ phoneVid: null })}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              const ws = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              const mv = (ev: PointerEvent) => useStore.getState().setUI({ phoneVid: Math.round(Math.min(0.85, Math.max(0.15, (ev.clientY - ws.top) / ws.height)) * 1000) / 1000 });
              const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
              addEventListener("pointermove", mv); addEventListener("pointerup", up);
            }}><i /></div>}
        </div>
      ) : (
        <>
          <div className="ws" style={{ gridTemplateRows: "46px 1fr", gridTemplateColumns: "1fr", gridTemplateAreas: '"head" "rest"' }}><Header /></div>
          <div className="placeholder">{ui.view === "nodes" ? "Nodes view — transitions between items are built here (next milestone)." : "Board view — every scene on one infinite canvas (next milestone)."}</div>
        </>
      )}
      <Tooltips />
      <CanvasMenu />
      <TrackBar />
      <EditPanel />
      <ExportDialog />
      <ConfirmBubble />
      <AnimatePresence>{ui.leaveAsk && (
        <motion.div {...anim.fade} className="xback" onPointerDown={(e) => { if (e.target === e.currentTarget) useStore.getState().setUI({ leaveAsk: false }); }}>
          <motion.div {...anim.sheet} className="xbox" style={{ width: 320 }}>
            <div className="xhead"><b>Leave Inertia?</b></div>
            <div className="xrow"><span>Your project is saved. Going back leaves the app.</span></div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {ui.view !== "home" && <button className="hlink" onClick={() => useStore.getState().setUI({ leaveAsk: false, view: "home", panel: null })}>Go to projects</button>}
              <span className="sp" />
              <button className="hlink" onClick={() => dispatchEvent(new Event("moshion-leave"))}>Leave</button>
              <button className="hcreate" autoFocus onClick={() => useStore.getState().setUI({ leaveAsk: false })}>Stay</button>
            </div>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>
      <AnimatePresence>
        {ui.toast && (
          <motion.div key={ui.toast} className="toast" initial={{ opacity: 0, y: 12, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 8, x: "-50%" }} transition={{ type: "spring", stiffness: 500, damping: 34 }}>
            {ui.toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
