import { useEffect, useState } from "react";

/** A phone (or small tablet) held upright: the editor stacks like a phone video editor instead of sitting side by side. */
export const isStacked = (w: number, h: number) => w < h && w < 900;

export function useWindowSize() {
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  return size;
}

export function useStacked() {
  const { w, h } = useWindowSize();
  return isStacked(w, h);
}

/* ---------- interface size ("DPI") ---------- */
let applied = 1;
const subs = new Set<(k: number) => void>();
const setApplied = (k: number) => { applied = k; subs.forEach((f) => f(k)); };
const desktopApp = () => "__TAURI_INTERNALS__" in window && !/Android|iPhone|iPad/i.test(navigator.userAgent);

/** Whether this screen can draw the interface smaller: phones/tablets (the page's viewport) and the desktop app (its zoom). */
export const canScaleUi = () => desktopApp() || matchMedia("(pointer: coarse)").matches;

/**
 * Draw the whole interface smaller (like a higher DPI). The video area keeps its size on screen, so the canvas gets
 * more room while buttons and panels shrink. Touch and pointer positions stay right, because the browser (or the
 * desktop app's web view) does the scaling itself. A desktop browser can't be scaled from the page: there it does
 * nothing (Ctrl − / Ctrl + zoom does the same job).
 */
export function applyUiScale(k: number) {
  const s = Math.min(1, Math.max(0.5, k || 1));
  if (desktopApp()) {
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setZoom(s)).then(() => setApplied(s)).catch(() => {});
    return;
  }
  const m = document.querySelector('meta[name="viewport"]');
  if (!m) return;
  m.setAttribute("content", s === 1 ? "width=device-width, initial-scale=1.0, viewport-fit=cover"
    : `width=device-width, initial-scale=${s}, minimum-scale=${s}, maximum-scale=${s}, user-scalable=no, viewport-fit=cover`);
  // what the browser actually did (a desktop browser ignores it and stays at 1)
  const read = () => setApplied(Math.round((window.visualViewport?.scale ?? 1) * 100) / 100);
  requestAnimationFrame(() => requestAnimationFrame(read));
  setTimeout(read, 300);
}

/** The interface size actually in effect (1 where it couldn't be applied). */
export function useAppliedUiScale() {
  const [k, setK] = useState(applied);
  useEffect(() => { subs.add(setK); setK(applied); return () => { subs.delete(setK); }; }, []);
  return k;
}
