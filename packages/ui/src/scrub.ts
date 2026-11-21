import type React from "react";

/**
 * Drag left or right on a number to change it (Shift: finer). A click without dragging calls onClick instead
 * (to start typing). While a number's text box is being typed in, pointer presses there edit the text as usual.
 */
export function scrub(e: React.PointerEvent, o: { value: number; step: number; min?: number; max?: number; onStart: () => void; onChange: (v: number) => void; onClick?: () => void }) {
  if (e.button !== 0) return;
  const el = e.target as HTMLElement;
  if (el.tagName === "INPUT" && document.activeElement === el) return;
  e.preventDefault();
  const sx = e.clientX, v0 = o.value;
  const dec = Math.max(0, Math.min(4, -Math.floor(Math.log10(o.step || 1)) + 1));
  let started = false;
  const mv = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    if (!started) { if (Math.abs(dx) < 3) return; started = true; o.onStart(); document.body.classList.add("scrubbing"); }
    let v = v0 + (dx - Math.sign(dx) * 3) * o.step * (ev.shiftKey ? 0.2 : 1);
    if (o.min != null) v = Math.max(o.min, v);
    if (o.max != null) v = Math.min(o.max, v);
    o.onChange(+v.toFixed(dec));
  };
  const up = () => {
    removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
    document.body.classList.remove("scrubbing");
    if (!started) o.onClick?.();
  };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
}
