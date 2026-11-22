import { useRef } from "react";

/**
 * The one slider used across Moshion: a soft rounded track, a filled part
 * (from zero for ranges that go negative), and a round handle.
 * Drag anywhere (Shift = fine), ←/→ to nudge, double-click to reset.
 */
export function Fader({ value, min, max, step = 0, onChange, onStart, def, label, title, touchNudge }: {
  value: number; min: number; max: number; step?: number;
  /** Fingers: dragging moves the value from where it is (right = more); a quick tap jumps there on release.
   *  A number: how many px of finger travel cross the whole range (default 260). */
  touchNudge?: boolean | number;
  onChange: (v: number) => void; onStart?: () => void;
  /** Double-click resets to this. */
  def?: number; label?: string; title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const span = max - min || 1;
  const clamp = (v: number) => Math.min(Math.max(v, min), max);
  const q = (v: number) => clamp(step ? Math.round(v / step) * step : v);
  const f = Math.min(Math.max((value - min) / span, 0), 1);
  const zero = min < 0 && max > 0 ? -min / span : 0;
  return (
    <div
      ref={ref} className="fd" role="slider" tabIndex={0} aria-label={label} title={title}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        (e.currentTarget as HTMLElement).focus();
        onStart?.();
        const r = ref.current!.getBoundingClientRect();
        if (touchNudge && e.pointerType === "touch") {
          const x0 = e.clientX, t0 = performance.now(), v0 = value;
          let moved = false;
          ref.current!.classList.add("drag");
          const mv = (ev: PointerEvent) => {
            if (!moved && Math.abs(ev.clientX - x0) < 6) return;
            moved = true;
            // steady speed whatever the slider's width
            onChange(q(v0 + ((ev.clientX - x0) / Math.max(r.width, typeof touchNudge === "number" ? touchNudge : 260)) * span));
          };
          const up = (ev: PointerEvent) => {
            // a quick tap (not a long press, not a drag): go to that spot
            if (!moved && performance.now() - t0 < 450) onChange(q(min + ((ev.clientX - r.left) / r.width) * span));
            ref.current?.classList.remove("drag"); removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
          };
          addEventListener("pointermove", mv); addEventListener("pointerup", up);
          return;
        }
        let v0 = value;
        if (!(e.target as Element).closest(".fd-thumb")) { v0 = q(min + ((e.clientX - r.left) / r.width) * span); onChange(v0); }
        const x0 = e.clientX;
        ref.current!.classList.add("drag");
        const mv = (ev: PointerEvent) => onChange(q(v0 + ((ev.clientX - x0) / r.width) * span * (ev.shiftKey ? 0.1 : 1)));
        const up = () => { ref.current?.classList.remove("drag"); removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
        addEventListener("pointermove", mv); addEventListener("pointerup", up);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault(); e.stopPropagation();
        const s = (step || span / 100) * (e.shiftKey ? 0.1 : 1) * (e.key === "ArrowRight" ? 1 : -1);
        onStart?.(); onChange(q(value + s));
      }}
      onDoubleClick={() => { if (def != null) { onStart?.(); onChange(def); } }}
    >
      <div className="fd-track">
        <div className="fd-fill" style={{ left: `${Math.min(f, zero) * 100}%`, width: `${Math.abs(f - zero) * 100}%` }} />
        {zero > 0 && <i className="fd-zero" style={{ left: `${zero * 100}%` }} />}
      </div>
      <div className="fd-thumb" style={{ left: `${f * 100}%` }} />
    </div>
  );
}
