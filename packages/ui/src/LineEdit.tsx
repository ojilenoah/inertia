import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Item, Project } from "@moshion/engine";
import { itemLocked, itemState } from "@moshion/engine";
import { useStore } from "./store";
import { askConfirm } from "./Confirm";
import { itemToWorld, toItemBox } from "./extras";
import { Fader } from "./Fader";
import { Icon } from "./Icon";
import { useStacked } from "./layout";
import { isTouch } from "./touch";

type Pt = [number, number];

/**
 * Angle snapping for lines: the direction from `a` to `b` locks to 15° steps (0°, 15°, 30°, 45°, 90°…) when it's
 * within about 5° of one; with Shift it always locks; with Alt it never does.
 */
export function snapAngle(a: Pt, b: Pt, ev?: { shiftKey?: boolean; altKey?: boolean }): Pt {
  if (ev?.altKey) return b;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return b;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), step = Math.PI / 12, to = Math.round(ang / step) * step;
  if (!ev?.shiftKey && Math.abs(ang - to) > (5 * Math.PI) / 180) return b;
  return [a[0] + Math.cos(to) * len, a[1] + Math.sin(to) * len];
}
/** Freehand lines have many points: past this many, only their two ends get handles. */
const MAX_HANDLES = 30;

/**
 * A selected line's points, editable on the canvas:
 *  - drag a point to move it
 *  - double-click (double-tap) the line to add a point there
 *  - right-click (long-press) a point to delete it (a line keeps at least two)
 *  - the + past either end: tap it, then tap where each next point goes (a chain from that end); Done to stop
 * Points snap to 15° angles from their neighbour (see snapAngle). A plain press on the line still moves the whole
 * line. After each change the line's box is fitted to its points.
 */
export function LineEditor({ project, item, t, k }: { project: Project; item: Item; t: number; k: number }) {
  // adding points from one end (and where the next one would go)
  const [ext, setExt] = useState<"start" | "end" | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  // phones: long-press the line for a small menu (add a node there, or set the corners' roundness)
  const [pop, setPop] = useState<{ x: number; y: number; seg: number; at: Pt; mode: "menu" | "round" } | null>(null);
  const phone = useStacked();
  useEffect(() => { setExt(null); setHover(null); setPop(null); }, [item.id]);
  useEffect(() => {
    if (!ext) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") { e.stopPropagation(); setExt(null); setHover(null); } };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [ext]);
  const l = item.line;
  if (!l || l.pts.length < 2 || itemLocked(project, item)) return null;
  const s = itemState(project, item, t);
  if (!s.visible) return null;
  const local = (p: Pt): Pt => [(p[0] + 0.5) * item.w, (p[1] + 0.5) * item.h];
  const world = l.pts.map((p) => itemToWorld(s, item, local(p)));
  const showAll = l.pts.length <= MAX_HANDLES;
  const { edit, checkpoint } = useStore.getState();
  const r = 7 / k, sw = 1.6 / k;

  /** a pointer position on the canvas (the layer is the canvas, scaled by k) */
  const canvasPt = (e: { clientX: number; clientY: number }, svg: Element): Pt => {
    const b = svg.getBoundingClientRect();
    return [(e.clientX - b.left) / k, (e.clientY - b.top) / k];
  };
  /** a canvas point as a point of the line (fractions of its box) */
  const toPt = (w: Pt): Pt => { const [x, y] = toItemBox(s, item, w); return [x / item.w - 0.5, y / item.h - 0.5]; };
  const setPts = (fn: (pts: Pt[]) => void, commit = false) =>
    edit((p) => { const it = p.items.find((q) => q.id === item.id); if (it?.line) fn(it.line.pts as Pt[]); }, commit);

  const dragPoint = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    checkpoint();
    const nb = world[i > 0 ? i - 1 : 1]; // the neighbour it snaps around
    const mv = (ev: PointerEvent) => { const q = toPt(snapAngle(nb, canvasPt(ev, svg), ev)); setPts((pts) => { pts[i] = q; }); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); fitBox(item.id); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const deletePoint = (e: React.MouseEvent, i: number) => {
    e.preventDefault(); e.stopPropagation();
    if (l.pts.length <= 2) { useStore.getState().toast("A line needs at least two points"); return; }
    askConfirm(e, "Delete this point?", () => { checkpoint(); setPts((pts) => { pts.splice(i, 1); }); fitBox(item.id); });
  };
  /** double-click on a piece of the line: a new point there */
  const addPoint = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    const [px, py] = canvasPt(e, svg), [ax, ay] = world[i], [bx, by] = world[i + 1];
    const dx = bx - ax, dy = by - ay, u = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const q = toPt([ax + dx * u, ay + dy * u]);
    checkpoint();
    setPts((pts) => { pts.splice(i + 1, 0, q); });
    useStore.getState().toast("Point added · drag it · right-click (long-press) deletes it");
  };
  /** a plain press on the line goes to the line itself underneath (so it still moves as a whole) */
  const passDown = (e: React.PointerEvent) => {
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest(".lineedit"));
    if (under) { e.stopPropagation(); under.dispatchEvent(new PointerEvent("pointerdown", e.nativeEvent)); }
  };

  // where the + sits: a little past each end, in the line's direction
  const plusAt = (end: "start" | "end"): Pt => {
    const [a, b] = end === "end" ? [world[world.length - 2], world[world.length - 1]] : [world[1], world[0]];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, off = 24 / k;
    return [b[0] + ((b[0] - a[0]) / d) * off, b[1] + ((b[1] - a[1]) / d) * off];
  };
  const from = ext === "end" ? world[world.length - 1] : ext === "start" ? world[0] : null;
  // a quick tap adds the next point (when the finger lifts); holding still for a moment stops adding instead
  const addFromEnd = (e: React.PointerEvent) => {
    if (!ext || !from) return;
    e.stopPropagation(); e.preventDefault();
    if (e.button === 2) return;
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    const x0 = e.clientX, y0 = e.clientY, mods = { shiftKey: e.shiftKey, altKey: e.altKey };
    let done = false;
    const off = () => { clearTimeout(hold); removeEventListener("pointerup", up); };
    const hold = window.setTimeout(() => { done = true; off(); navigator.vibrate?.(12); stop(); }, 450);
    const up = (ev: PointerEvent) => {
      off();
      if (done || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 12) return;
      const q = toPt(snapAngle(from, canvasPt(ev, svg), { shiftKey: mods.shiftKey || ev.shiftKey, altKey: mods.altKey || ev.altKey }));
      checkpoint();
      setPts((pts) => { if (ext === "end") pts.push(q); else pts.unshift(q); });
      fitBox(item.id);
    };
    addEventListener("pointerup", up);
  };
  const stop = () => { setExt(null); setHover(null); };
  const top = document.querySelector<HTMLElement>(".mo");

  return (
    <svg className="lineedit" width={project.width} height={project.height} style={{ overflow: "visible" }}>
      {ext && from && (
        <>
          {/* adding points: the whole canvas takes taps; the next piece shows where it would go */}
          <rect className="lext" x={-20000} y={-20000} width={40000} height={40000}
            onPointerDown={addFromEnd}
            onPointerMove={(e) => { const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!; setHover(snapAngle(from, canvasPt(e, svg), e.nativeEvent)); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); stop(); }} />
          {hover && <line className="lprev" x1={from[0]} y1={from[1]} x2={hover[0]} y2={hover[1]} strokeWidth={Math.max(2 / k, l.width * s.scale)} />}
          {top && createPortal(
            <div className="linehint"><b>Adding points</b><span>tap where each goes · hold to stop</span><button onClick={stop}>Done</button></div>, top)}
        </>
      )}
      {world.slice(0, -1).map((a, i) => (
        <line key={"s" + i} className="lseg" x1={a[0]} y1={a[1]} x2={world[i + 1][0]} y2={world[i + 1][1]} strokeWidth={Math.max(14 / k, l.width * s.scale)}
          onPointerDown={passDown} onDoubleClick={(e) => addPoint(e, i)}
          onContextMenu={(e) => {
            if (!phone && !isTouch()) return; // desktop: right-click keeps the item's menu
            e.preventDefault(); e.stopPropagation();
            const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
            setPop({ x: e.clientX, y: e.clientY, seg: i, at: canvasPt(e, svg), mode: "menu" });
          }} />
      ))}
      {pop && top && createPortal(
        <>
          <div className="lpopback" onPointerDown={() => setPop(null)} />
          <div className="linepop" style={{ left: Math.min(Math.max(pop.x, 120), innerWidth - 120), top: Math.max(8, pop.y - 64) }}>
            {pop.mode === "menu" ? (
              <>
                <button onClick={() => {
                  // a node right where the finger was
                  const [ax, ay] = world[pop.seg], [bx, by] = world[pop.seg + 1], [px, py] = pop.at;
                  const dx = bx - ax, dy = by - ay, u = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
                  const q = toPt([ax + dx * u, ay + dy * u]);
                  checkpoint(); setPts((pts) => { pts.splice(pop.seg + 1, 0, q); }); setPop(null);
                  useStore.getState().toast("Node added · drag it · long-press it to delete");
                }}><Icon name="plus" size={15} />Node</button>
                <button onClick={() => { checkpoint(); setPop({ ...pop, mode: "round" }); }}><Icon name="curve" size={15} />Roundness</button>
              </>
            ) : (
              <>
                <span className="lpround"><Fader value={l.round ?? 0} min={0} max={300} step={1} label="Roundness"
                  onChange={(v) => edit((p) => { const it = p.items.find((q) => q.id === item.id); if (it?.line) it.line.round = v || undefined; }, false)} /></span>
                <b className="lpval">{l.round ? Math.round(l.round) : 0}</b>
                <button className="lpok" title="Done" aria-label="Done" onClick={() => setPop(null)}><Icon name="check" size={16} /></button>
              </>
            )}
          </div>
        </>, top)}
      {/* + past each end: keep drawing from there */}
      {(["start", "end"] as const).map((end) => {
        const [px, py] = plusAt(end), on = ext === end;
        return (
          <g key={end} className={"lplus" + (on ? " on" : "")} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setHover(null); setExt(on ? null : end); }}>
            <title>{on ? "Stop adding points" : `Add points from the ${end === "end" ? "end" : "start"}: tap here, then tap where each goes`}</title>
            <circle cx={px} cy={py} r={9 / k} />
            <path d={`M${px - 4.5 / k} ${py}H${px + 4.5 / k}M${px} ${py - 4.5 / k}V${py + 4.5 / k}`} strokeWidth={1.8 / k} />
          </g>
        );
      })}
      {world.map((p, i) => (showAll || i === 0 || i === world.length - 1) && (
        <circle key={"p" + i} className="lpt" cx={p[0]} cy={p[1]} r={r} strokeWidth={sw}
          onPointerDown={(e) => dragPoint(e, i)} onContextMenu={(e) => deletePoint(e, i)}>
          <title>{i === 0 ? "Start" : i === world.length - 1 ? "End" : `Point ${i + 1}`} · drag to move · right-click (long-press) to delete · double-click the line to add a point</title>
        </circle>
      ))}
    </svg>
  );
}

/** Fit a line's box to its points again (the line stays exactly where it is on the canvas). */
export function fitBox(id: string) {
  // its size and turn right now (they may be animated)
  const S = useStore.getState(), orig = S.project.items.find((q) => q.id === id);
  if (!orig) return;
  const now = itemState(S.project, orig, S.t);
  S.edit((p) => {
    const it = p.items.find((q) => q.id === id);
    const l = it?.line;
    if (!it || !l || l.pts.length < 2) return;
    const px = l.pts.map(([u, v]) => [(u + 0.5) * it.w, (v + 0.5) * it.h] as Pt);
    const minX = Math.min(...px.map((q) => q[0])), maxX = Math.max(...px.map((q) => q[0]));
    const minY = Math.min(...px.map((q) => q[1])), maxY = Math.max(...px.map((q) => q[1]));
    const nw = Math.max(2, maxX - minX), nh = Math.max(2, maxY - minY);
    // how far the box's middle moves, in the item's own (turned, scaled) frame → on the canvas
    const cx = (minX + maxX) / 2 - it.w / 2, cy = (minY + maxY) / 2 - it.h / 2;
    const sc = now.scale || 1, a = (now.rz * Math.PI) / 180;
    const dx = (cx * Math.cos(a) - cy * Math.sin(a)) * sc, dy = (cx * Math.sin(a) + cy * Math.cos(a)) * sc;
    l.pts = px.map(([x, y]) => [(x - (minX + maxX) / 2 + nw / 2) / nw - 0.5, (y - (minY + maxY) / 2 + nh / 2) / nh - 0.5] as Pt);
    it.w = nw; it.h = nh;
    it.base.x += dx; it.base.y += dy;
    for (const ky of it.keys.x ?? []) ky.v += dx;
    for (const ky of it.keys.y ?? []) ky.v += dy;
  }, false);
}
