import type { ItemState, Prop } from "@moshion/engine";
import { useStore } from "./store";
import { pickedProp } from "./EditTools";

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
  const P = (p: Prop) => pickedProp(itemId, undefined, p);
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
  const P = (p: Prop) => pickedProp(itemId, trackId, p);
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
  const style = useStore((x) => x.ui.gimbal ?? "ball");
  return (
    <div className={"rgimbal" + (inline ? " inline" : "")} onPointerDown={(e) => e.stopPropagation()}>
      {style === "rings" ? <Rings s={s} P={P} /> :
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
      </svg>}
      <div className="rread">
        <span style={{ color: C.x }}>X {deg(s.rx)}</span><span style={{ color: C.y }}>Y {deg(s.ry)}</span><span style={{ color: C.z }}>Z {deg(s.rz)}</span>
      </div>
      <div className="rbtns">
        <button title="Reset rotation" onClick={() => { useStore.getState().checkpoint(); P("rx").set(0); P("ry").set(0); P("rz").set(0); }}>Reset</button>
        <button title={style === "rings" ? "Switch to the ball" : "Switch to rings: one per axis"} onClick={() => useStore.getState().setUI({ gimbal: style === "rings" ? "ball" : "rings" })}>{style === "rings" ? "Ball" : "Rings"}</button>
        {!inline && <button title="Back to 2D editing" onClick={onExit}>2D</button>}
      </div>
    </div>
  );
}

/**
 * The ring gimbal: one ring per axis, drawn the way the item is turned (X around the canvas's X; Y around the
 * X-turned Y; Z around the item's own Z — the order the turns are applied in). Drag along a ring to turn round that
 * axis (Shift: 15° steps). The near half of each ring is bright, the far half faint.
 */
/** The item's turn as a matrix (columns: where its own X, Y, Z axes point), in the same order the turns are applied. */
function turnMatrix(rx: number, ry: number, rz: number): number[][] {
  const cx = rotate([1, 0, 0], rx, ry, rz), cy = rotate([0, 1, 0], rx, ry, rz), cz = rotate([0, 0, 1], rx, ry, rz);
  return [0, 1, 2].map((r) => [cx[r], cy[r], cz[r]]);
}
const mulM = (A: number[][], B: number[][]) => A.map((row) => [0, 1, 2].map((c) => row[0] * B[0][c] + row[1] * B[1][c] + row[2] * B[2][c]));
/** The X / Y / Z turns that give this matrix, the set nearest to `near` (no jumps of 360° or flips mid-drag). */
function turnAngles(m: number[][], near: [number, number, number]): [number, number, number] {
  const D = 180 / Math.PI, sb = Math.max(-1, Math.min(1, m[0][2]));
  const close = (v: number, to: number) => v + Math.round((to - v) / 360) * 360;
  const cands: [number, number, number][] = [];
  if (Math.abs(sb) > 0.99999) cands.push([Math.atan2(m[2][1], m[1][1]) * D, Math.asin(sb) * D, near[2]]);
  else {
    const rx = Math.atan2(-m[1][2], m[2][2]) * D, ry = Math.asin(sb) * D, rz = Math.atan2(-m[0][1], m[0][0]) * D;
    cands.push([rx, ry, rz], [rx + 180, 180 - ry, rz + 180]);
  }
  let best = cands[0], bd = Infinity;
  for (const c of cands) {
    const w: [number, number, number] = [close(c[0], near[0]), close(c[1], near[1]), close(c[2], near[2])];
    const d = Math.abs(w[0] - near[0]) + Math.abs(w[1] - near[1]) + Math.abs(w[2] - near[2]);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

/**
 * The ring gimbal, like any 3D app's rotate gizmo: one ring per axis of the item as it's turned now (red X, green Y,
 * blue Z). Dragging a ring turns the item round that ring's own axis, however it's already turned (Shift: 15°
 * steps); the item's X / Y / Z angles are worked out from the result. The near half of each ring is bright.
 */
function Rings({ s, P, R = 52, bare }: { s: Pick<ItemState, "rx" | "ry" | "rz">; P: (p: Prop) => { get: () => number; set: (v: number) => void }; R?: number; bare?: boolean }) {
  const N = 64, H = R + 16;
  const rings = (["x", "y", "z"] as const).map((a, k) => {
    // in the item's own frame: each ring sits round its own axis as the item is turned now
    const fr = (v: V3) => rotate(v, s.rx, s.ry, s.rz);
    const axis = fr(k === 0 ? [1, 0, 0] : k === 1 ? [0, 1, 0] : [0, 0, 1]);
    const pts = Array.from({ length: N + 1 }, (_, i) => {
      const th = (i / N) * Math.PI * 2, c = Math.cos(th), n = Math.sin(th);
      return fr(k === 0 ? [0, c, n] : k === 1 ? [c, 0, n] : [c, n, 0]);
    });
    return { a, k, axis, pts };
  });
  const path = (pts: V3[], front: boolean) => {
    let d = "", on = false;
    pts.forEach(([x, y, z]) => { const show = front ? z >= -0.02 : true; if (show) { d += `${on ? "L" : "M"}${(x * R).toFixed(1)} ${(y * R).toFixed(1)}`; on = true; } else on = false; });
    return d;
  };
  const grab = (e: React.PointerEvent, r: (typeof rings)[number]) => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const mx = e.clientX - (svg.left + svg.width / 2), my = e.clientY - (svg.top + svg.height / 2);
    const [ax, ay, az] = r.axis;
    // how a point of the ring moves on screen as the turn grows (axis × point)
    const speed = (p: V3): [number, number] => [(ay * p[2] - az * p[1]) * R, (az * p[0] - ax * p[2]) * R];
    let vx: number, vy: number;
    if (Math.abs(az) < 0.35) {
      // seen (nearly) edge-on: drag the way its nearest-to-you point moves (along the line)
      [vx, vy] = speed(r.pts.reduce((q, p) => (p[2] > q[2] ? p : q), r.pts[0]));
    } else {
      // the grabbed point (the near half wins where front and back overlap)
      let best = r.pts[0], bd = Infinity;
      for (const p of r.pts) { const d = Math.hypot(p[0] * R - mx, p[1] * R - my) - (p[2] >= 0 ? 4 : 0); if (d < bd) { bd = d; best = p; } }
      [vx, vy] = speed(best);
    }
    const v2 = Math.max(vx * vx + vy * vy, (0.3 * R) ** 2);
    const chans = (["rx", "ry", "rz"] as const).map((q) => P(q));
    const e0 = chans.map((c) => c.get()) as [number, number, number];
    const M0 = turnMatrix(...e0);
    dragger(e, (dx, dy, ev) => {
      let d = (((dx * vx + dy * vy) / v2) * 180) / Math.PI;
      if (ev.shiftKey) d = Math.round(d / 15) * 15;
      // turn round the item's own axis: after what it's turned by already
      const Rk = turnMatrix(r.k === 0 ? d : 0, r.k === 1 ? d : 0, r.k === 2 ? d : 0);
      const out = turnAngles(mulM(M0, Rk), e0);
      out.forEach((v, i) => { if (Math.abs(v - chans[i].get()) > 1e-3) chans[i].set(Math.round(v * 10) / 10); });
    });
  };
  return (
    <svg width={H * 2} height={H * 2} viewBox={`${-H} ${-H} ${H * 2} ${H * 2}`} className={"rrings" + (bare ? " bare" : "")}>
      {bare ? <circle r={R} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth={1} strokeDasharray="2 4" /> : <circle r={R} className="obg" />}
      {rings.map((r) => <path key={r.a + "b"} d={path(r.pts, false)} fill="none" stroke={C[r.a]} strokeWidth={1.5} opacity={0.3} />)}
      {[...rings.slice(1), rings[0]].map((r) => (
        <g key={r.a} className="rring" onPointerDown={(e) => grab(e, r)}>
          <title>{`Turn around ${r.a.toUpperCase()} · Shift: 15°`}</title>
          <path d={path(r.pts, false)} fill="none" stroke="transparent" strokeWidth={12} />
          <path d={path(r.pts, true)} fill="none" stroke={C[r.a]} strokeWidth={2.5} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

