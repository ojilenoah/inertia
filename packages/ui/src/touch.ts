import { useEffect, useState } from "react";

/*
 * Touch screens: what a mouse and keyboard do, done with fingers.
 *  - hold a finger still (~½ s)  → right-click (the same menus and actions)
 *  - double-tap                  → double-click
 *  - two fingers                 → pinch to zoom, drag to pan (a "mo-pinch" event the canvas and timeline listen to)
 *  - sticky Shift / Ctrl / Alt   → buttons in the tool sidebar; while one is on, every tap and drag acts as if it were held
 */

/* ---------- sticky modifier keys ---------- */
export type Mods = { shift: boolean; ctrl: boolean; alt: boolean };
let mods: Mods = { shift: false, ctrl: false, alt: false };
const modSubs = new Set<(m: Mods) => void>();
export function toggleMod(k: keyof Mods) { mods = { ...mods, [k]: !mods[k] }; modSubs.forEach((f) => f(mods)); }
export function useMods() {
  const [m, setM] = useState(mods);
  useEffect(() => { modSubs.add(setM); setM(mods); return () => { modSubs.delete(setM); }; }, []);
  return m;
}

/** A device with a touch screen (also touch laptops). */
export const isTouch = () => typeof matchMedia !== "undefined" && matchMedia("(any-pointer: coarse)").matches;
export function useTouch() {
  const [t, setT] = useState(isTouch);
  useEffect(() => {
    const q = matchMedia("(any-pointer: coarse)"), on = () => setT(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return t;
}

/** Two-finger gesture, sent to the element under the fingers: move by dx/dy (screen px), zoom by `scale` around cx/cy. */
export type PinchDetail = { dx: number; dy: number; scale: number; cx: number; cy: number };

const LONG = 480, SLOP = 10, DBL = 320;
let installed = false;

export function installTouch() {
  // once per page (a hot reload in development must not add a second set)
  const w = window as unknown as { __moTouch?: boolean };
  if (installed || typeof window === "undefined" || w.__moTouch) return;
  installed = w.__moTouch = true;

  // sticky modifiers: mark every pointer / mouse event as if the key were held
  const stamp = (e: Event) => {
    if (!mods.shift && !mods.ctrl && !mods.alt) return;
    if ((e.target as Element | null)?.closest?.(".tmods")) return; // the modifier buttons themselves
    if (mods.shift) Object.defineProperty(e, "shiftKey", { value: true });
    if (mods.ctrl) Object.defineProperty(e, "ctrlKey", { value: true });
    if (mods.alt) Object.defineProperty(e, "altKey", { value: true });
  };
  for (const t of ["pointerdown", "pointermove", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"]) addEventListener(t, stamp, true);

  const fingers = new Map<number, { x: number; y: number }>();
  let press: { id: number; x: number; y: number; target: Element; timer: number; moved: boolean } | null = null;
  let longAt = 0, dblAt = 0, swallowClick = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  let pinch: { el: Element; d: number; cx: number; cy: number } | null = null;
  const ignore = new Set<number>(); // fingers whose remaining moves/lift the app shouldn't see

  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  // end the drag a finger started (the app listens for pointerup on the window), as if it had been lifted
  // (our own lift: the finger is still down, so it must not count as lifted here)
  let releasing = false;
  const releaseDrag = (id: number, x: number, y: number) => {
    releasing = true;
    try { dispatchEvent(new PointerEvent("pointerup", { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true })); }
    finally { releasing = false; }
  };

  const midpoint = () => { const [a, b] = [...fingers.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };

  addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) {
      // a second finger: stop whatever the first one started and pan / zoom instead
      const first = press;
      cancelPress();
      for (const [id, p] of fingers) if (id !== e.pointerId) { releaseDrag(id, p.x, p.y); ignore.add(id); }
      ignore.add(e.pointerId);
      const m = midpoint();
      pinch = { el: (document.elementFromPoint(m.cx, m.cy) ?? first?.target ?? document.body), ...m };
      e.stopImmediatePropagation(); e.preventDefault();
      return;
    }
    if (fingers.size > 2) { ignore.add(e.pointerId); e.stopImmediatePropagation(); return; }
    const target = e.target as Element;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, target, moved: false, timer: window.setTimeout(() => {
      // held still: a right-click
      const p = press; press = null;
      if (!p) return;
      longAt = Date.now(); swallowClick = longAt + 800;
      navigator.vibrate?.(12);
      releaseDrag(p.id, p.x, p.y); ignore.add(p.id);
      p.target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 }));
    }, LONG) };
  }, true);

  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch") return;
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) { press.moved = true; clearTimeout(press.timer); }
    if (pinch && fingers.size >= 2) {
      const m = midpoint();
      const detail: PinchDetail = { dx: m.cx - pinch.cx, dy: m.cy - pinch.cy, scale: m.d / pinch.d, cx: m.cx, cy: m.cy };
      pinch = { ...pinch, ...m };
      pinch.el.dispatchEvent(new CustomEvent<PinchDetail>("mo-pinch", { bubbles: true, detail }));
    }
    if (ignore.has(e.pointerId)) { e.stopImmediatePropagation(); }
  }, true);

  const lift = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || releasing) return;
    fingers.delete(e.pointerId);
    const p = press && press.id === e.pointerId ? press : null;
    if (p) cancelPress();
    if (fingers.size < 2) pinch = null;
    if (ignore.has(e.pointerId)) { ignore.delete(e.pointerId); e.stopImmediatePropagation(); return; }
    // a quick second tap in the same spot: a double-click (sent after the tap's own click, like a mouse)
    if (e.type === "pointerup" && p && !p.moved) {
      const now = Date.now();
      if (now - lastTap.t < DBL && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 25) {
        lastTap.t = 0;
        const target = p.target, x = e.clientX, y = e.clientY;
        setTimeout(() => { dblAt = Date.now(); target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2 })); }, 0);
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  };
  addEventListener("pointerup", lift, true);
  addEventListener("pointercancel", lift, true);

  // the browser's own long-press menu or double-tap event, when it sends one too: only one of each gets through
  addEventListener("contextmenu", (e) => {
    if (!e.isTrusted || !isTouch()) return;
    if (Date.now() - longAt < 1500) { e.stopImmediatePropagation(); e.preventDefault(); return; }
    cancelPress(); longAt = Date.now(); swallowClick = longAt + 800;
  }, true);
  addEventListener("dblclick", (e) => {
    if (e.isTrusted && Date.now() - dblAt < 700) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  addEventListener("click", (e) => {
    if (e.isTrusted && Date.now() < swallowClick) { e.stopImmediatePropagation(); e.preventDefault(); swallowClick = 0; }
  }, true);
}
