import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Item, ItemState } from "@moshion/engine";
import { pinAt, pinQuad, setPinCorner, clearPin } from "@moshion/engine";
import { useStore } from "./store";

type P2 = [number, number];

/**
 * Corner pin: the item's four corners, each draggable on its own; the item warps in perspective to fit.
 * Drawn in the item's own frame (it turns and scales with the item). Shift keeps a corner moving straight
 * (across or up/down); right-click (long-press) a corner puts it back. With keyframes, a change goes into the
 * keyframe at the playhead, so the pin can animate.
 * `edit` false: only the outline of a pinned item (while it's selected but not being pinned).
 */
export function PinEditor({ item, s, k, edit }: { item: Item; s: ItemState; k: number; edit: boolean }) {
  const t = useStore((x) => x.t);
  const local = t - item.start;
  const off = pinAt(item, local) ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
  const quad = pinQuad(item.w, item.h, off).map(([x, y]) => [x + item.w / 2, y + item.h / 2] as P2);
  const sc = Math.max(0.02, Math.abs(s.scale)), u = 1 / (k * sc); // one screen px in the item's own px

  const stop = () => useStore.getState().setUI({ pinning: null });
  useEffect(() => {
    if (!edit) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") { e.stopPropagation(); stop(); } };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [edit]);

  const down = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const st = useStore.getState();
    st.checkpoint();
    const sx = e.clientX, sy = e.clientY, o0 = off[i];
    const ang = (s.rz * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      // the pointer's movement along the item's own (turned, scaled) sides
      let lx = (dx * ca + dy * sa) / sc, ly = (-dx * sa + dy * ca) / sc;
      if (ev.shiftKey) { if (Math.abs(lx) > Math.abs(ly)) ly = 0; else lx = 0; }
      const to: P2 = [Math.round((o0[0] + lx) * 10) / 10, Math.round((o0[1] + ly) * 10) / 10];
      st.edit((p) => { const it = p.items.find((q) => q.id === item.id); if (it) setPinCorner(it, useStore.getState().t, i, to); }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const resetCorner = (e: React.MouseEvent, i: number) => {
    e.preventDefault(); e.stopPropagation();
    const st = useStore.getState();
    st.edit((p) => { const it = p.items.find((q) => q.id === item.id); if (it) setPinCorner(it, st.t, i, [0, 0]); });
  };
  const resetAll = () => {
    const st = useStore.getState();
    st.edit((p) => { const it = p.items.find((q) => q.id === item.id); if (it) clearPin(it); });
    st.toast("Corner pin removed");
  };
  const top = document.querySelector<HTMLElement>(".mo");
  const d = quad.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + "Z";

  return (
    <div className="pinframe" style={{ left: s.x - item.w / 2, top: s.y - item.h / 2, width: item.w, height: item.h,
      transform: `perspective(1400px) translateZ(${s.z}px) rotateX(${s.rx}deg) rotateY(${s.ry}deg) rotateZ(${s.rz}deg) scale(${s.scale})` }}>
      <svg width={item.w} height={item.h} style={{ overflow: "visible" }}>
        <path d={d} className={"pinquad" + (edit ? " on" : "")} strokeWidth={1.5 * u} />
        {edit && quad.map(([x, y], i) => (
          <g key={i} className="pincorner" onPointerDown={(e) => down(e, i)} onContextMenu={(e) => resetCorner(e, i)} data-nolongpress={undefined}>
            <title>Drag · hold to reset</title>
            <circle cx={x} cy={y} r={16 * u} className="pinhit" />
            <circle cx={x} cy={y} r={7 * u} strokeWidth={2 * u} />
          </g>
        ))}
      </svg>
      {edit && top && createPortal(
        <div className="linehint"><b>Corner pin</b><span>drag the corners · Shift: straight</span>
          <button className="ghost" onClick={resetAll}>Reset</button>
          <button onClick={stop}>Done</button>
        </div>, top)}
    </div>
  );
}
