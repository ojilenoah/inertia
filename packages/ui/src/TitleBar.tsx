import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "./store";
import { putProject } from "./library";
import { Mark } from "./Home";

/** The installed desktop app draws its own title bar (Windows' own bar is turned off). `?frame` shows it in a browser. */
export const hasTitleBar = () =>
  typeof window !== "undefined" &&
  (("__TAURI_INTERNALS__" in window && !/Android|iPhone|iPad/i.test(navigator.userAgent)) || new URLSearchParams(location.search).has("frame"));

const win = () => { try { return getCurrentWindow(); } catch { return null; } };

export function TitleBar() {
  const view = useStore((s) => s.ui.view);
  const name = useStore((s) => s.project.name);
  const [max, setMax] = useState(false);
  useEffect(() => {
    const w = win(); if (!w) return;
    let off: (() => void) | undefined, live = true;
    const check = () => w.isMaximized().then((m) => live && setMax(m)).catch(() => {});
    check();
    w.onResized(check).then((u) => { if (live) off = u; else u(); }).catch(() => {});
    return () => { live = false; off?.(); };
  }, []);
  // closing saves the open project first (never waits more than a moment)
  const close = () => {
    const w = win(); if (!w) return;
    Promise.race([putProject(useStore.getState().project).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]).finally(() => w.close());
  };
  return (
    <div className={"tbar" + (view === "home" ? " onhome" : "")} data-tauri-drag-region>
      <span className="tbrand" data-tauri-drag-region>
        <Mark size={15} />
        <b data-tauri-drag-region>inertia</b>
        {view !== "home" && <span className="tbname" data-tauri-drag-region>{name || "Untitled"}</span>}
      </span>
      <span className="sp" data-tauri-drag-region />
      <span className="tbctl">
        <button title="Minimise" aria-label="Minimise" onClick={() => win()?.minimize()}>
          <svg viewBox="0 0 10 10"><path d="M0 5h10" /></svg>
        </button>
        <button title={max ? "Restore" : "Maximise"} aria-label={max ? "Restore" : "Maximise"} onClick={() => win()?.toggleMaximize()}>
          {max
            ? <svg viewBox="0 0 10 10"><path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /></svg>
            : <svg viewBox="0 0 10 10"><path d="M.5.5h9v9h-9z" /></svg>}
        </button>
        <button className="tbx" title="Close" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
        </button>
      </span>
    </div>
  );
}
