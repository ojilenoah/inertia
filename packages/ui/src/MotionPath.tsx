import { useEffect, useRef, useState } from "react";
import type { Item, Project, Pt } from "@moshion/engine";
import { insertRow, placeItem } from "@moshion/engine";
import { blockLine, motionBlocks, motionNodes, motionShown, movePath, nodePos, pathPivot, pathTransform, pathUntransform, penAddNode, penDeleteNode, penInsertNode, penSplitLine, sampleKeys, segPts, setSegHandles, setStroke, setValue, strokeFor, uid, newMotionItem } from "@moshion/engine";
import { useStore } from "./store";
import { askConfirm } from "./Confirm";

/** Add a Motion path at the playhead: one node in the middle of the canvas, picked, ready to drag or grow with +. */
export function addMotion() {
  const { project, t, edit, select, toast, setUI } = useStore.getState();
  const id = uid("motion");
  const start = Math.max(0, Math.min(t, project.duration)), end = start + 3;
  edit((p: Project) => {
    const { trackId, lane } = placeItem(p, "video", start, end, useStore.getState().project.items.find((q) => q.id === useStore.getState().selected)?.trackId, () => uid("V"));
    p.items.push({ ...newMotionItem(p, id, trackId, start, end), lane });
  });
  select(id);
  setUI({ pathSel: { motionId: id, node: 0 }, pathDraw: null });
  toast("Path added · drag its node to place it · click + to add nodes (right-click stops)");
}

/** A camera for the whole video: its frame is what's shown. Keyframe it to pan, zoom (make the frame smaller) and turn. */
export function addCamera() {
  const { project, t, edit, select, toast } = useStore.getState();
  const id = uid("camera"), start = 0, end = project.duration;
  edit((p: Project) => {
    const trackId = p.tracks.find((tr) => tr.kind !== "group" && !tr.parent) ? insertRow(p, p.tracks.find((tr) => tr.kind !== "group" && !tr.parent)!.id, false) : (p.tracks.unshift({ id: uid("V"), name: "Camera", kind: "video" }), p.tracks[0].id);
    p.items.push({ id, name: "Camera", kind: "camera", trackId, start, end, w: p.width, h: p.height, fill: "transparent", tint: "--gray",
      base: { x: p.width / 2, y: p.height / 2, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 }, keys: {} } as Item);
  });
  select(id);
  toast(`Camera added · move or shrink its frame and add keyframes to pan and zoom · it's hidden while not selected${t ? "" : ""}`);
}

/** The motion whose path should be shown: the selected motion, or the one the selected item follows. */
export function shownMotion(project: Project, selected: string | null): Item | undefined {
  const sel = project.items.find((i) => i.id === selected);
  if (!sel) return undefined;
  if (sel.kind === "motion") return sel;
  return sel.follow ? project.items.find((i) => i.id === sel.follow!.motionId && i.kind === "motion") : undefined;
}

const toD = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");

/** A smooth curve through the line's points (no corners between them). */
function smoothD(pts: Pt[]): string {
  if (pts.length < 3) return toD(pts);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/**
 * A motion path on the canvas (in video pixels, above the canvas's looks). It works like an object:
 * - click a node to pick it, drag it to move it; a picked node shows a turn knob and a + button
 *   (click +, then click to add nodes after it; right-click stops);
 * - click a line to bend it: it gets two handles (lines start straight);
 * - Ctrl-click any part (or the box's edge) to pick the whole path, then drag to move all of it;
 * - its box has the same handles as any item's: corners to size it, the knob to turn it; its 3D tilt is in the
 *   Rotate card. Turn, tilt and size are the path's own settings (keyframable): the nodes stay as placed.
 */
export function MotionOverlay({ m, k, t, active }: { m: Item; k: number; t: number; active: boolean }) {
  const pathSel = useStore((s) => s.ui.pathSel);
  const drawing = useStore((s) => s.ui.pathDraw);
  const blocks = motionBlocks(m), nodes = motionNodes(m);
  const local = Math.min(Math.max(t - m.start, 0), m.end - m.start);
  // the path's own turn / tilt / size: F shows a node where it is on the canvas, INV finds the node from there
  const Fx = pathTransform(m, local);
  const F = (p: Pt): Pt => (Fx ? Fx(p) : p), INV = (p: Pt): Pt => (Fx ? pathUntransform(Fx, p) : p);
  const here = motionShown(m, local);
  const sel = active && pathSel?.motionId === m.id ? pathSel : null;
  const sw = 2 / k;
  const st0 = useStore.getState;
  const pick = (ps: NonNullable<typeof pathSel>) => { const s = st0(); if (s.selected !== m.id) s.select(m.id); s.setUI({ pathSel: ps }); };
  const svgRect = (e: React.PointerEvent | React.MouseEvent) => (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();

  /** drag: move by dx, dy (video px), once the pointer has moved a little */
  const dragging = (e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onClick?: () => void) => {
    e.stopPropagation(); e.preventDefault();
    const { checkpoint } = st0();
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      if (!moved) { if (Math.hypot(dx, dy) * k < 3) return; moved = true; checkpoint(); }
      onMove(dx, dy, ev);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!moved) onClick?.(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  /** the whole path: Ctrl-click (or once it's picked whole), then drag */
  const dragWhole = (e: React.PointerEvent) => {
    pick({ motionId: m.id, whole: true });
    const snap = JSON.parse(JSON.stringify({ keys: m.keys, base: m.base, strokes: m.strokes ?? [], pivot: m.pivot ?? null }));
    const c = pathPivot(m), cs = F(c);
    dragging(e, (dx, dy) => st0().edit((p) => {
      const mm = p.items.find((q) => q.id === m.id); if (!mm) return;
      mm.keys = JSON.parse(JSON.stringify(snap.keys)); mm.base = { ...snap.base }; mm.strokes = JSON.parse(JSON.stringify(snap.strokes));
      if (snap.pivot) mm.pivot = [snap.pivot[0], snap.pivot[1]]; else delete mm.pivot;
      const r = INV([cs[0] + dx, cs[1] + dy]);
      movePath(mm, r[0] - c[0], r[1] - c[1]);
    }, false));
  };
  const downNode = (e: React.PointerEvent, n: number) => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || sel?.whole) { dragWhole(e); return; }
    pick({ motionId: m.id, node: n });
    const nd = nodes[n], last = blocks[blocks.length - 1], P0 = F(nd.p);
    const stl = !nd.key && last ? strokeFor(m, last[0], last[1]) : undefined, pts0 = stl?.pts.map((q) => [...q] as Pt);
    dragging(e, (dx, dy) => st0().edit((p) => {
      const mm = p.items.find((q) => q.id === m.id); if (!mm) return;
      const to = INV([P0[0] + dx, P0[1] + dy]), rdx = to[0] - nd.p[0], rdy = to[1] - nd.p[1];
      if (nd.key) { for (const [pr, v] of [["x", to[0]], ["y", to[1]]] as const) { const kk = mm.keys[pr]?.find((q) => Math.abs(q.t - nd.t) < 1e-3); if (kk) kk.v = Math.round(v * 10) / 10; } if (n === 0) { mm.base.x = to[0]; mm.base.y = to[1]; } }
      else if (pts0) {
        const st = strokeFor(mm, last![0], last![1]); if (!st) return;
        if (st.ctrl) st.pts = segPts(nodePos(mm, last![0]), to, st.ctrl);
        else { const nn = pts0.length - 1; st.pts = pts0.map(([x, y], i) => [Math.round((x + (rdx * i) / nn) * 10) / 10, Math.round((y + (rdy * i) / nn) * 10) / 10] as Pt); }
      }
    }, false), () => st0().setT(m.start + nd.t));
  };
  const downLine = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || sel?.whole) { dragWhole(e); return; }
    e.stopPropagation(); e.preventDefault();
    pick({ motionId: m.id, seg: i });
  };
  /** the turn knob on a picked node: sets the turn at that node (anything following the path turns with it) */
  const downTurn = (e: React.PointerEvent, n: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const nd = nodes[n], c = svgRect(e), P = F(nd.p);
    const cx = c.left + P[0] * k, cy = c.top + P[1] * k;
    const { checkpoint, edit } = st0();
    checkpoint();
    const mv = (ev: PointerEvent) => {
      let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      a = ev.shiftKey ? Math.round(a / 15) * 15 : Math.abs(a - Math.round(a / 15) * 15) < 3.5 && !ev.ctrlKey ? Math.round(a / 15) * 15 : Math.round(a * 10) / 10;
      edit((p) => {
        const mm = p.items.find((q) => q.id === m.id); if (!mm) return;
        const ks = ((mm.numKeys ??= {}).turn ??= []), kk = ks.find((q) => Math.abs(q.t - nd.t) < 1e-3);
        if (kk) kk.v = a; else { ks.push({ t: nd.t, v: a, ease: "linear" }); ks.sort((q1, q2) => q1.t - q2.t); }
      }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  /** + on a picked node: add nodes after it (each click adds one; right-click stops) */
  const startAdding = (e: React.PointerEvent, n: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    st0().setUI({ pathDraw: { motionId: m.id, block: 0, pen: true, after: n } });
  };
  /** bend handles on a picked pen line (straight lines show them a third of the way along, ready to pull) */
  const downHandle = (e: React.PointerEvent, i: number, end: 0 | 1, startRaw: Pt) => {
    if (e.button !== 0) return;
    const [a, b] = blocks[i], A = nodePos(m, a), B = nodePos(m, b), base = end ? B : A, S = F(startRaw);
    dragging(e, (dx, dy) => st0().edit((p) => {
      const mm = p.items.find((q) => q.id === m.id); if (!mm) return;
      const st = strokeFor(mm, a, b); if (!st) return;
      const c: [Pt, Pt] = st.ctrl ? [[...st.ctrl[0]] as Pt, [...st.ctrl[1]] as Pt] : [[0, 0], [0, 0]];
      const to = INV([S[0] + dx, S[1] + dy]);
      c[end] = [Math.round((to[0] - base[0]) * 10) / 10, Math.round((to[1] - base[1]) * 10) / 10];
      setSegHandles(mm, a, b, c);
    }, false));
  };

  const faint = !active;
  const col = "var(--sel)";
  // the path's box, as it shows: everything it covers (lines and nodes)
  const box = (() => {
    const pts = [...blocks.flatMap(([a, b]) => blockLine(m, a, b) ?? []), ...nodes.map((n) => n.p)].map(F);
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 6 / k;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  })();
  /** the box's corners: size the path (around the middle of its nodes) */
  const downCorner = (e: React.PointerEvent) => {
    if (e.button !== 0 || !box) return;
    e.stopPropagation(); e.preventDefault();
    pick({ motionId: m.id, whole: true });
    const r = svgRect(e), c = F(pathPivot(m)), cx = r.left + c[0] * k, cy = r.top + c[1] * k;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1, s0 = sampleKeys(m.keys.scale, local, m.base.scale ?? 1);
    const { checkpoint, edit } = st0();
    let started = false;
    const mv = (ev: PointerEvent) => {
      if (!started) { started = true; checkpoint(); }
      const s = Math.max(0.05, Math.round(s0 * (Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0) * 1000) / 1000);
      edit((p) => { const mm = p.items.find((q) => q.id === m.id); if (mm) setValue(mm, "scale", st0().t, s); }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  /** the box's knob: turn the path (its own turn setting; Shift: 15° steps) */
  const downRot = (e: React.PointerEvent) => {
    if (e.button !== 0 || !box) return;
    e.stopPropagation(); e.preventDefault();
    pick({ motionId: m.id, whole: true });
    const r = svgRect(e), c = F(pathPivot(m)), cx = r.left + c[0] * k, cy = r.top + c[1] * k;
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx), z0 = sampleKeys(m.keys.rz, local, m.base.rz ?? 0);
    const { checkpoint, edit } = st0();
    let started = false;
    const mv = (ev: PointerEvent) => {
      if (!started) { started = true; checkpoint(); }
      let d = ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
      d = ev.shiftKey ? Math.round(d / 15) * 15 : Math.round(d * 10) / 10;
      edit((p) => { const mm = p.items.find((q) => q.id === m.id); if (mm) setValue(mm, "rz", st0().t, Math.round((z0 + d) * 10) / 10); }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const hs = 9 / k, ho = 3 / k; // handle size, and how far the box sits outside (like other items' boxes)
  return (
    <svg className="mpath" width="100%" height="100%" style={{ overflow: "visible", opacity: faint ? 0.45 : 1 }} shapeRendering="geometricPrecision">
      {/* the box, like any item's: picked whole (Ctrl-click or its edge) it can be dragged from anywhere inside */}
      {active && box && (
        <g>
          <rect x={box.x - ho} y={box.y - ho} width={box.w + ho * 2} height={box.h + ho * 2} fill={sel?.whole ? "rgba(0,0,0,0.001)" : "none"} stroke={col} strokeWidth={1.5 / k}
            style={{ pointerEvents: drawing ? "none" : sel?.whole ? "all" : "stroke", cursor: "move" }} onPointerDown={(e) => { if (e.button === 0) dragWhole(e); }}>
            <title>The whole path · drag to move it with all its nodes · its 3D tilt is in the Rotate card</title>
          </rect>
          {!drawing && <>
            {[[box.x - ho, box.y - ho], [box.x + box.w + ho, box.y - ho], [box.x - ho, box.y + box.h + ho], [box.x + box.w + ho, box.y + box.h + ho]].map(([x, y], n) => (
              <rect key={n} className="mnode" x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} fill="#fff" stroke={col} strokeWidth={1.5 / k}
                style={{ pointerEvents: "auto", cursor: n === 0 || n === 3 ? "nwse-resize" : "nesw-resize" }} onPointerDown={downCorner}><title>Size the path</title></rect>
            ))}
            <line x1={box.x + box.w / 2} y1={box.y - ho} x2={box.x + box.w / 2} y2={box.y - ho - 26 / k} stroke={col} strokeWidth={1.5 / k} />
            <circle className="mnode" cx={box.x + box.w / 2} cy={box.y - ho - 32 / k} r={6 / k} fill={col} stroke="#fff" strokeWidth={2 / k} style={{ pointerEvents: "auto", cursor: "grab" }} onPointerDown={downRot}>
              <title>Turn the path (Shift: 15° steps) · tilt it in 3D from the Rotate card</title>
            </circle>
          </>}
        </g>
      )}
      {blocks.map(([a, b], i) => {
        const line = blockLine(m, a, b);
        if (!line) return null;
        const d = smoothD(line.map(F)), on = sel?.seg === i || sel?.whole;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={on ? "var(--accent)" : col} strokeWidth={on ? sw * 1.6 : sw} strokeLinecap="round" strokeLinejoin="round" />
            <path className="mlinehit" d={d} fill="none" stroke="transparent" strokeWidth={14 / k} style={{ pointerEvents: drawing ? "none" : "stroke", cursor: "pointer" }} onPointerDown={(e) => downLine(e, i)}
              onContextMenu={(e) => {
                // right-click a line: a new node right there (the line keeps its shape)
                e.preventDefault(); e.stopPropagation();
                const r = svgRect(e);
                const at = INV([(e.clientX - r.left) / k, (e.clientY - r.top) / k]);
                let n = -1;
                st0().edit((p) => { const mm = p.items.find((q) => q.id === m.id); if (mm) n = penSplitLine(mm, i, at); });
                if (n >= 0) pick({ motionId: m.id, node: n });
              }}>
              <title>Click to bend this line · right-click to add a node here · Ctrl-click to move the whole path</title>
            </path>
          </g>
        );
      })}
      {/* bend handles on the picked line */}
      {sel?.seg != null && blocks[sel.seg] && (() => {
        const [a, b] = blocks[sel.seg], st = strokeFor(m, a, b);
        if (!st) return null;
        const A = nodePos(m, a), B = nodePos(m, b), c = st.ctrl ?? [[0, 0], [0, 0]];
        const pos = (end: 0 | 1): Pt => {
          const h = c[end], base = end ? B : A, other = end ? A : B;
          return Math.hypot(h[0], h[1]) > 0.5 ? [base[0] + h[0], base[1] + h[1]] : [base[0] + (other[0] - base[0]) / 3, base[1] + (other[1] - base[1]) / 3];
        };
        if (!st.ctrl && st.pts.length > 2) return null; // a hand-drawn line keeps its own shape
        return ([0, 1] as const).map((end) => { const pr = pos(end), p = F(pr), base = F(end ? B : A); return (
          <g key={end}>
            <line x1={base[0]} y1={base[1]} x2={p[0]} y2={p[1]} stroke="var(--accent)" strokeWidth={sw * 0.6} />
            <rect className="mnode" x={p[0] - 4.5 / k} y={p[1] - 4.5 / k} width={9 / k} height={9 / k} rx={2 / k} fill="#fff" stroke="var(--accent)" strokeWidth={sw * 0.8}
              style={{ pointerEvents: "auto", cursor: "move" }} onPointerDown={(e) => downHandle(e, sel.seg!, end, pr)}><title>Drag to bend the line</title></rect>
          </g>
        ); });
      })()}
      {nodes.map((nd, n) => {
        const picked = sel?.node === n || sel?.whole, P = F(nd.p);
        return (
          <circle key={n} className="mnode" cx={P[0]} cy={P[1]} r={(picked ? 7.5 : 6) / k} fill={picked ? "var(--accent)" : "#fff"} stroke={col} strokeWidth={sw}
            style={{ pointerEvents: drawing ? "none" : "auto", cursor: "move" }} onPointerDown={(e) => downNode(e, n)}
            onContextMenu={(e) => {
              // right-click: delete this node (its lines join up); a path keeps its start node
              e.preventDefault(); e.stopPropagation();
              if (nodes.length <= 1) { st0().toast("A path needs at least one node"); return; }
              askConfirm(e, n === 0 ? "Delete the start node?" : nd.key ? "Delete this node?" : "Delete the end node?", () => {
                st0().edit((p) => { const mm = p.items.find((q) => q.id === m.id); if (mm) penDeleteNode(mm, n); });
                st0().setUI({ pathSel: { motionId: m.id, node: Math.max(0, n - 1) } });
              });
            }}>
            <title>{n === 0 ? "Start node" : nd.key ? `Node at ${nd.t.toFixed(2)}s` : "End node"} · drag to move · click for its turn knob and + · right-click to delete · Ctrl-click to move the whole path</title>
          </circle>
        );
      })}
      {/* the picked node's floating controls: a turn knob above it, + to its right */}
      {sel?.node != null && nodes[sel.node] && !drawing && (() => {
        const nd = nodes[sel.node], [x, y] = F(nd.p), r = (m.numKeys?.turn?.find((q) => Math.abs(q.t - nd.t) < 1e-3)?.v ?? 0) * (Math.PI / 180);
        const kx = x + Math.sin(r) * (34 / k), ky = y - Math.cos(r) * (34 / k), px = x + 30 / k;
        return (
          <g>
            <line x1={x} y1={y} x2={kx} y2={ky} stroke={col} strokeWidth={sw * 0.7} />
            <circle className="mnode" cx={kx} cy={ky} r={6 / k} fill="#fff" stroke={col} strokeWidth={sw} style={{ pointerEvents: "auto", cursor: "grab" }} onPointerDown={(e) => downTurn(e, sel.node!)}><title>Turn: anything following the path turns this much here (Shift: 15° steps)</title></circle>
            <g className="mnode" style={{ pointerEvents: "auto", cursor: "pointer" }} onPointerDown={(e) => startAdding(e, sel.node!)}>
              <circle cx={px} cy={y} r={9 / k} fill={col} />
              <path d={`M${px - 4.5 / k} ${y}H${px + 4.5 / k}M${px} ${y - 4.5 / k}V${y + 4.5 / k}`} stroke="#fff" strokeWidth={sw} strokeLinecap="round" />
              <title>Add nodes after this one: click where each goes · right-click to stop</title>
            </g>
          </g>
        );
      })()}
      <circle cx={here.x} cy={here.y} r={4 / k} fill={col} style={{ pointerEvents: "none" }} />
    </svg>
  );
}

/**
 * Drawing a path. Two tools:
 * - Pen (the default): click to add the next node (a straight piece); click and drag to pull out handles and bend
 *   it into a curve. Each node is a keyframe, spread evenly over the clip; the last one is the end. Enter finishes.
 * - Hand-draw: drag to draw the current block freehand. Enter moves on to the next block.
 * The first click of a new path places its start (anywhere, also off the canvas).
 */
export function PathDrawLayer({ k, stage }: { k: number; stage: React.RefObject<HTMLDivElement | null> }) {
  const draw = useStore((s) => s.ui.pathDraw);
  const project = useStore((s) => s.project);
  const { setUI, edit, checkpoint, setT, toast } = useStore.getState();
  const [live, setLive] = useState<Pt[] | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const m = draw ? project.items.find((i) => i.id === draw.motionId && i.kind === "motion") : undefined;
  const blocks = m ? motionBlocks(m) : [];
  const blk = draw && (blocks[draw.block] ?? blocks[blocks.length - 1]);
  const pts = useRef<Pt[]>([]);
  /** pen: where the press started, and the handle out of the last node (for the next piece) */
  const press = useRef<{ at: Pt; h: Pt | null; place: boolean } | null>(null);
  const penOut = useRef<Pt | undefined>(undefined);
  const pen = draw?.pen !== false;

  const go = (i: number) => {
    if (!m || !draw) return;
    const b = motionBlocks(m);
    if (pen || i >= b.length) { setUI({ pathDraw: null }); toast("Path done · drag its nodes and handles to adjust · double-click a node to make it smooth or sharp"); return; }
    setUI({ pathDraw: { motionId: m.id, block: i, pen: false } });
    setT(m.start + b[i][0]);
  };
  useEffect(() => {
    if (!draw) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input,textarea,[contenteditable]")) return;
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); go(draw.block + 1); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setUI({ pathDraw: null }); }
      else if (e.key === "Backspace" && e.shiftKey && !pen) { e.preventDefault(); e.stopPropagation(); go(Math.max(0, draw.block - 1)); }
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  });
  useEffect(() => { penOut.current = undefined; }, [draw?.motionId]);
  if (!draw || !m || !blk) return null;

  // through the path's own turn / tilt / size: a click lands on the path's plane, the preview shows on the canvas
  const Fx = pathTransform(m, Math.min(Math.max(useStore.getState().t - m.start, 0), m.end - m.start));
  const F = (p: Pt): Pt => (Fx ? Fx(p) : p);
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = stage.current!.getBoundingClientRect();
    const w: Pt = [((e.clientX - r.left) / k), ((e.clientY - r.top) / k)];
    const q = Fx ? pathUntransform(Fx, w) : w;
    return [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10];
  };
  const start = nodePos(m, blk[0]);
  const placing = !!draw.place;
  const nodes = motionNodes(m), lastNode = (draw.after != null ? nodes[draw.after]?.p : undefined) ?? nodes[nodes.length - 1]?.p ?? start;
  const setStart = (at: Pt) => edit((p) => {
    const mm = p.items.find((i) => i.id === m.id); if (!mm) return;
    for (const [pr, v] of [["x", at[0]], ["y", at[1]]] as const) { mm.base[pr] = v; const kk = mm.keys[pr]?.find((q) => Math.abs(q.t - blk[0]) < 1e-3); if (kk) kk.v = v; }
  }, false);
  // what the next pen piece would look like (from the last node to the pointer, or to where it was pressed)
  const preview: Pt[] | null = pen && !placing
    ? press.current && !press.current.place
      ? segPts(lastNode, press.current.at, [penOut.current ?? [0, 0], press.current.h ? [-press.current.h[0], -press.current.h[1]] : [0, 0]])
      : hover ? segPts(lastNode, hover, [penOut.current ?? [0, 0], [0, 0]]) : null
    : null;
  return (
    <>
      <div className={"pathdraw" + (pen ? " pen" : "")}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const at = toWorld(e);
          if (pen) {
            if (placing) { checkpoint(); setStart(at); setUI({ pathDraw: { motionId: m.id, block: 0, pen: true } }); }
            press.current = { at, h: null, place: placing };
            setHover(null);
            return;
          }
          if (placing) { setStart(at); setUI({ pathDraw: { motionId: m.id, block: draw.block, pen: false } }); pts.current = [at]; }
          else pts.current = [start, at];
          setLive([...pts.current]);
        }}
        onPointerMove={(e) => {
          const at = toWorld(e);
          if (pen) {
            if (press.current) { const h: Pt = [at[0] - press.current.at[0], at[1] - press.current.at[1]]; press.current = { ...press.current, h: Math.hypot(h[0], h[1]) * k > 4 ? h : null }; setHover(at); }
            else setHover(at);
            return;
          }
          if (!pts.current.length) return; pts.current.push(at); setLive([...pts.current]);
        }}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setUI({ pathDraw: null }); }}
        onPointerUp={() => {
          if (pen) {
            const pr = press.current; press.current = null;
            if (!pr) return;
            if (pr.place) { penOut.current = pr.h ?? undefined; setHover(null); return; } // dragging off the start pulls out its handle
            checkpoint();
            const prevOut = penOut.current, h = pr.h;
            const after = draw.after;
            edit((p) => {
              const mm = p.items.find((i) => i.id === m.id); if (!mm) return;
              const count = motionNodes(mm).length;
              if (after != null && after < count - 1) penInsertNode(mm, after + 1, pr.at); // in the middle: straight in and out
              else penAddNode(mm, pr.at, prevOut, h ? [-h[0], -h[1]] : undefined);
            }, false);
            if (after != null) { setUI({ pathDraw: { ...draw, after: after + 1 }, pathSel: { motionId: m.id, node: after + 1 } }); }
            penOut.current = h ?? undefined;
            return;
          }
          const raw = pts.current; pts.current = [];
          setLive(null);
          if (raw.length < 3) return;
          checkpoint();
          edit((p) => { const mm = p.items.find((i) => i.id === m.id); if (mm) setStroke(mm, blk[0], blk[1], raw); }, false);
          // one line from start to end: done (add keyframes later for more nodes)
          if (blocks.length === 1) { setUI({ pathDraw: null }); toast("Path drawn · drag its nodes to adjust · add keyframes on it for more nodes"); }
        }} />
      {(live || preview) && (
        <svg className="mpath live" width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
          {live && <path d={toD(live.map((q) => F(q)).map(([x, y]) => [x * k, y * k] as Pt))} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
          {preview && <path d={toD(preview.map((q) => F(q)).map(([x, y]) => [x * k, y * k] as Pt))} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" />}
          {pen && press.current?.h && !press.current.place && (() => {
            const a = press.current.at, h = press.current.h, P = F([a[0] + h[0], a[1] + h[1]]), Q = F([a[0] - h[0], a[1] - h[1]]);
            return <g><line x1={Q[0] * k} y1={Q[1] * k} x2={P[0] * k} y2={P[1] * k} stroke="var(--accent)" strokeWidth={1.5} /><circle cx={P[0] * k} cy={P[1] * k} r={4} fill="var(--accent)" /><circle cx={Q[0] * k} cy={Q[1] * k} r={4} fill="var(--accent)" /></g>;
          })()}
        </svg>
      )}
      <div className="pathhint">
        <b>{placing ? "Click where the path starts" : pen ? `Pen · ${nodes.length} node${nodes.length === 1 ? "" : "s"}` : blocks.length > 1 ? `Block ${draw.block + 1} of ${blocks.length}` : "Draw the path"}</b>
        <span>{placing ? (pen ? "anywhere, also off the canvas · then click for each next node" : "then drag to where it ends")
          : pen ? "click to add a node · right-click (or Enter) to stop"
          : `${blk[0].toFixed(2)}s → ${blk[1].toFixed(2)}s · drag from the start node to the end`}</span>
        <span className="sp" />
        <div className="seg sm">
          <button className={pen ? "on" : ""} title="Click to place nodes; drag to curve" onClick={() => setUI({ pathDraw: { ...draw, pen: true } })}>Pen</button>
          <button className={!pen ? "on" : ""} title="Draw each piece freehand" onClick={() => setUI({ pathDraw: { ...draw, pen: false, block: Math.min(draw.block, blocks.length - 1) } })}>Hand-draw</button>
        </div>
        {!pen && <button onClick={() => go(draw.block - 1)} disabled={draw.block === 0}>‹ Back</button>}
        <button className="on" onClick={() => go(draw.block + 1)}>{!pen && draw.block + 1 < blocks.length ? "Next block ↵" : "Done ↵"}</button>
        <button onClick={() => setUI({ pathDraw: null })}>Esc</button>
      </div>
    </>
  );
}
