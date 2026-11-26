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

/* phones: the screen's real width in device pixels (dp). The Android app reports its own view's size (setViewSize);
   a mobile browser uses the screen's size the right way round. */
let viewDp: { w: number; h: number } | null = null;
let wanted = 1;
const screenDp = () => {
  if (viewDp) return viewDp.w;
  const a = screen.width, b = screen.height, portrait = matchMedia("(orientation: portrait)").matches;
  return portrait ? Math.min(a, b) : Math.max(a, b);
};
/** The Android app: its view's size in dp, sent on start and whenever it changes (rotation, split screen). */
export function setViewSize(w: number, h: number) {
  if (!(w > 0 && h > 0) || (viewDp && viewDp.w === w && viewDp.h === h)) return;
  viewDp = { w, h };
  if (wanted !== 1) applyUiScale(wanted);
}

/**
 * Draw the whole interface smaller, the way a phone's display-size (DPI) setting does: everything shrinks and
 * still fits the screen, nothing overflows or scrolls. The video area keeps its size on screen, so the canvas gets
 * more room while buttons and panels shrink. Touch and pointer positions stay right, because the browser (or the
 * desktop app's web view) does the scaling itself. A desktop browser can't be scaled from the page: there it does
 * nothing (Ctrl − / Ctrl + zoom does the same job).
 */
export function applyUiScale(k: number) {
  const s = Math.min(1, Math.max(0.5, k || 1));
  wanted = s;
  if (desktopApp()) {
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setZoom(s)).then(() => setApplied(s)).catch(() => {});
    return;
  }
  const m = document.querySelector('meta[name="viewport"]');
  if (!m) return;
  // phones: lay the page out 1/s times wider than the screen, then show it at exactly the screen's width. Only
  // "width=device-width, initial-scale=0.7" lets the page spill past the screen (wider, and scrolling).
  const dp = screenDp(), W = Math.round(dp / s), fit = Math.round((dp / W) * 10000) / 10000;
  m.setAttribute("content", s === 1 || !(dp > 0) ? "width=device-width, initial-scale=1.0, viewport-fit=cover"
    : `width=${W}, initial-scale=${fit}, minimum-scale=${fit}, maximum-scale=${fit}, user-scalable=no, viewport-fit=cover`);
  // what the browser actually did (a desktop browser ignores it and stays at 1)
  const read = () => {
    window.scrollTo(0, 0);
    setApplied(Math.round((window.visualViewport?.scale ?? 1) * 100) / 100);
  };
  requestAnimationFrame(() => requestAnimationFrame(read));
  setTimeout(read, 300);
}
// a browser on a phone: turning it changes the screen's width
if (typeof window !== "undefined") addEventListener("orientationchange", () => { if (wanted !== 1) setTimeout(() => applyUiScale(wanted), 250); });

/** The interface size actually in effect (1 where it couldn't be applied). */
export function useAppliedUiScale() {
  const [k, setK] = useState(applied);
  useEffect(() => { subs.add(setK); setK(applied); return () => { subs.delete(setK); }; }, []);
  return k;
}
