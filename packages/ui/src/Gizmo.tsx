import type { ItemState, Prop } from "@moshion/engine";
import { useStore } from "./store";
import { prop } from "./EditTools";

const C = { x: "#E5484D", y: "#30A46C", z: "#3E63DD" };

/** Drag helper: records one undo step, then reports pointer deltas. */
function dragger(e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void) {
  e.preventDefault(); e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  useStore.getState().checkpoint();
  const mv = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy, ev);
  const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
}

/**
 * 3D transform gizmo drawn over the selected item: coloured arrows move it along
 * X / Y / Z, coloured rings rotate it around X / Y / Z. Everything is auto-keyed.
 */
export function Gizmo3D({ itemId, s, k }: { itemId: string; s: ItemState; k: number }) {
  const P = (p: Prop) => prop(itemId, undefined, p);
  const cx = s.x * k, cy = s.y * k, R = 62;
  const move = (p: Prop, fn: (dx: number, dy: number) => number) => (e: React.PointerEvent) => {
    const a = P(p), v0 = a.get();
    dragger(e, (dx, dy, ev) => a.set(Math.round(v0 + fn(dx, dy) * (ev.shiftKey ? 0.2 : 1))));
  };
  const turn = (p: Prop, fn: (dx: number, dy: number) => number) => (e: React.PointerEvent) => {
    const a = P(p), v0 = a.get();
    dragger(e, (dx, dy, ev) => { let v = v0 + fn(dx, dy); if (ev.shiftKey) v = Math.round(v / 15) * 15; a.set(Math.round(v * 10) / 10); });
  };
  const turnZ = (e: React.PointerEvent) => {
    const a = P("rz"), v0 = a.get();
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    const a0 = Math.atan2(e.clientY - oy, e.clientX - ox);
    dragger(e, (_dx, _dy, ev) => {
      let v = v0 + ((Math.atan2(ev.clientY - oy, ev.clientX - ox) - a0) * 180) / Math.PI;
      if (ev.shiftKey) v = Math.round(v / 15) * 15;
      a.set(Math.round(v * 10) / 10);
    });
  };
  const arrow = (x2: number, y2: number, col: string, label: string, onDown: (e: React.PointerEvent) => void, tip: string) => (
    <g className="gz" onPointerDown={onDown}>
      <title>{tip}</title>
      <line x1={0} y1={0} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
      <line x1={0} y1={0} x2={x2} y2={y2} stroke={col} strokeWidth={2.5} />
      <circle cx={x2} cy={y2} r={8} fill={col} />
      <text x={x2} y={y2 + 3.5} textAnchor="middle" className="gzl">{label}</text>
    </g>
  );
  return (
    <svg className="gizmo" style={{ left: cx - 110, top: cy - 110 }} width={220} height={220} viewBox="-110 -110 220 220">
      <g className="gz" onPointerDown={turn("rx", (_dx, dy) => -dy * 0.6)}>
        <title>Rotate around X (drag up/down) · Shift snaps 15°</title>
        <ellipse rx={R * 0.32} ry={R} fill="none" stroke="transparent" strokeWidth={12} />
        <ellipse rx={R * 0.32} ry={R} fill="none" stroke={C.x} strokeWidth={2} opacity={0.85} />
      </g>
      <g className="gz" onPointerDown={turn("ry", (dx) => dx * 0.6)}>
        <title>Rotate around Y (drag left/right) · Shift snaps 15°</title>
        <ellipse rx={R} ry={R * 0.32} fill="none" stroke="transparent" strokeWidth={12} />
        <ellipse rx={R} ry={R * 0.32} fill="none" stroke={C.y} strokeWidth={2} opacity={0.85} />
      </g>
      <g className="gz" onPointerDown={turnZ}>
        <title>Rotate around Z (drag around the ring) · Shift snaps 15°</title>
        <circle r={R + 14} fill="none" stroke="transparent" strokeWidth={12} />
        <circle r={R + 14} fill="none" stroke={C.z} strokeWidth={2} opacity={0.85} />
      </g>
      {arrow(96, 0, C.x, "X", move("x", (dx) => dx / k), "Move along X")}
      {arrow(0, -96, C.y, "Y", move("y", (_dx, dy) => dy / k), "Move along Y")}
      {arrow(-62, 62, C.z, "Z", move("z", (dx, dy) => (-dx + dy) / Math.SQRT2 / k), "Move in depth (Z): drag toward you or away")}
      <circle r={5} fill="#fff" stroke="#111" strokeWidth={1.5} />
    </svg>
  );
}

type V3 = [number, number, number];
function rotate(v: V3, rx: number, ry: number, rz: number): V3 {
  const r = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx * r), Math.sin(rx * r), Math.cos(ry * r), Math.sin(ry * r), Math.cos(rz * r), Math.sin(rz * r)];
  // same order as CSS rotateX() rotateY() rotateZ(): p' = Rx·Ry·Rz·p
  let [x, y, z] = v;
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return [x, y, z];
}

/**
 * The 3D rotation gimbal, docked in the canvas's bottom-right corner (never drawn over the item).
 * Drag the ball to tumble the item (X/Y), drag the blue ring to spin it (Z), click an axis to face it.
 */
export function RotationGimbal({ itemId, trackId, s, onExit, inline }: { itemId: string | null; trackId?: string; s: Pick<ItemState, "rx" | "ry" | "rz">; onExit: () => void; inline?: boolean }) {
  const R = 40, RING = 56;
  const axes = (["x", "y", "z"] as const).flatMap((a, i) => {
    const v: V3 = [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
    const p = rotate(v, s.rx, s.ry, s.rz), n = rotate([-v[0], -v[1], -v[2]], s.rx, s.ry, s.rz);
    return [{ a, pos: true, v: p }, { a, pos: false, v: n }];
  }).sort((u, w) => u.v[2] - w.v[2]);
  const P = (p: Prop) => prop(itemId, trackId, p);
  const snap = (a: "x" | "y" | "z", pos: boolean) => {
    const st = useStore.getState();
    st.checkpoint();
    const target: Record<string, [number, number]> = { x: [0, pos ? -90 : 90], y: [pos ? 90 : -90, 0], z: [0, pos ? 0 : 180] };
    const [rx, ry] = target[a];
    P("rx").set(rx); P("ry").set(ry); P("rz").set(0);
    st.toast(`Facing ${pos ? "+" : "−"}${a.toUpperCase()}`);
  };
  const tumble = (e: React.PointerEvent) => {
    const rx = P("rx"), ry = P("ry"), rx0 = rx.get(), ry0 = ry.get();
    dragger(e, (dx, dy, ev) => {
      const f = ev.shiftKey ? 0.2 : 0.8;
      rx.set(Math.round((rx0 - dy * f) * 10) / 10); ry.set(Math.round((ry0 + dx * f) * 10) / 10);
    });
  };
  const spin = (e: React.PointerEvent) => {
    const rz = P("rz"), v0 = rz.get();
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    const a0 = Math.atan2(e.clientY - oy, e.clientX - ox);
    dragger(e, (_dx, _dy, ev) => {
      let v = v0 + ((Math.atan2(ev.clientY - oy, ev.clientX - ox) - a0) * 180) / Math.PI;
      if (ev.shiftKey) v = Math.round(v / 15) * 15;
      rz.set(Math.round(v * 10) / 10);
    });
  };
  const deg = (v: number) => `${Math.round(v)}°`;
  return (
    <div className={"rgimbal" + (inline ? " inline" : "")} onPointerDown={(e) => e.stopPropagation()}>
      <svg width={136} height={136} viewBox="-68 -68 136 136">
        <g className="rring" onPointerDown={spin}>
          <title>Spin around Z: drag along the ring · Shift snaps 15°</title>
          <circle r={RING} fill="none" stroke="transparent" strokeWidth={14} />
          <circle r={RING} fill="none" stroke={C.z} strokeWidth={2} strokeDasharray="2 4" opacity={0.9} />
          <circle cx={Math.sin((s.rz * Math.PI) / 180) * RING} cy={-Math.cos((s.rz * Math.PI) / 180) * RING} r={5} fill={C.z} />
        </g>
        <g className="rball" onPointerDown={tumble}>
          <title>Tumble: drag to rotate around X and Y · Shift for fine</title>
          <circle r={R + 6} className="obg" />
          {axes.map(({ a, pos, v }) => (
            <g key={a + pos} className="oax" onPointerDown={(e) => { e.stopPropagation(); snap(a, pos); }}>
              <title>{`Face ${pos ? "+" : "−"}${a.toUpperCase()}`}</title>
              {pos && <line x1={0} y1={0} x2={v[0] * R} y2={v[1] * R} stroke={C[a]} strokeWidth={2} />}
              <circle cx={v[0] * R} cy={v[1] * R} r={pos ? 7.5 : 5.5} fill={pos ? C[a] : "var(--panel)"} stroke={C[a]} strokeWidth={pos ? 0 : 1.5} />
              {pos && <text x={v[0] * R} y={v[1] * R + 3.2} textAnchor="middle" className="gzl">{a.toUpperCase()}</text>}
            </g>
          ))}
        </g>
      </svg>
      <div className="rread">
        <span style={{ color: C.x }}>X {deg(s.rx)}</span><span style={{ color: C.y }}>Y {deg(s.ry)}</span><span style={{ color: C.z }}>Z {deg(s.rz)}</span>
      </div>
      <div className="rbtns">
        <button title="Reset rotation" onClick={() => { useStore.getState().checkpoint(); P("rx").set(0); P("ry").set(0); P("rz").set(0); }}>Reset</button>
        {!inline && <button title="Back to 2D editing" onClick={onExit}>2D</button>}
      </div>
    </div>
  );
}
