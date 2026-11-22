import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Item, Project } from "@moshion/engine";
import { itemLocked, itemState } from "@moshion/engine";
import { useStore } from "./store";
import { askConfirm } from "./Confirm";
import { itemToWorld, toItemBox } from "./extras";

type Pt = [number, number];
type Ctrl = [Pt, Pt] | null;
/** Freehand lines have many points: past this many, only their two ends get handles. */
const MAX_HANDLES = 30;
/** A line that was just added: its editor opens with this node picked (its + showing), like a new motion path. */
export const pendingPick: { id: string; node: number } = { id: "", node: -1 };

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

/** A cubic piece split at u (de Casteljau): the two halves' control points and the point where they meet. */
function splitCubic(a: Pt, c: [Pt, Pt], b: Pt, u: number): { mid: Pt; left: [Pt, Pt]; right: [Pt, Pt] } {
  const L = (p: Pt, q: Pt): Pt => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const ab = L(a, c[0]), bc = L(c[0], c[1]), cd = L(c[1], b), abc = L(ab, bc), bcd = L(bc, cd), mid = L(abc, bcd);
  return { mid, left: [ab, abc], right: [bcd, cd] };
}
const cubicAt = (a: Pt, c: [Pt, Pt], b: Pt, u: number): Pt => {
  const v = 1 - u;
  return [v * v * v * a[0] + 3 * v * v * u * c[0][0] + 3 * v * u * u * c[1][0] + u * u * u * b[0], v * v * v * a[1] + 3 * v * v * u * c[0][1] + 3 * v * u * u * c[1][1] + u * u * u * b[1]];
};

/**
 * A selected line, edited the way a motion path is (but its nodes are only its shape, not keyframes):
 *  - tap a node to pick it (drag it to move it; it snaps to 15° angles from its neighbour); a + appears beside it:
 *    tap the +, then tap where each next node goes (hold, right-click, Escape or Done to stop)
 *  - tap a piece of the line to get two bend handles that curve it
 *  - right-click (long-press) a piece to add a node there; right-click (long-press) a node to delete it
 *  - a plain drag on the line moves the whole line
 * After each change the line's box is fitted around it.
 */
export function LineEditor({ project, item, t, k }: { project: Project; item: Item; t: number; k: number }) {
  const [sel, setSel] = useState<{ node?: number; seg?: number } | null>(null);
  const [ext, setExt] = useState<number | null>(null); // adding nodes after this one
  const [hover, setHover] = useState<Pt | null>(null);
  useEffect(() => {
    const pick = pendingPick.id === item.id ? pendingPick.node : -1;
    // forgotten a moment later (not at once: this can run twice when the editor first appears)
    if (pick >= 0) setTimeout(() => { if (pendingPick.id === item.id) pendingPick.id = ""; }, 400);
    setSel(pick >= 0 ? { node: pick } : null); setExt(null); setHover(null);
  }, [item.id]);
  useEffect(() => {
    if (ext == null) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") { e.stopPropagation(); setExt(null); setHover(null); } };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [ext]);
  const l = item.line;
  if (!l || l.pts.length < 1 || itemLocked(project, item)) return null;
  const s = itemState(project, item, t);
  if (!s.visible) return null;
  const local = (p: Pt): Pt => [(p[0] + 0.5) * item.w, (p[1] + 0.5) * item.h];
  const W = (p: Pt) => itemToWorld(s, item, local(p));
  const world = l.pts.map((p) => W(p as Pt));
  const ctrlW: (([Pt, Pt]) | null)[] = world.slice(0, -1).map((_, i) => { const c = l.ctrl?.[i]; return c ? [W(c[0] as Pt), W(c[1] as Pt)] : null; });
  const showAll = l.pts.length <= MAX_HANDLES;
  const { edit, checkpoint } = useStore.getState();
  const sw = 2 / k, col = "var(--sel)";

  /** a pointer position on the canvas (the layer is the canvas, scaled by k) */
  const canvasPt = (e: { clientX: number; clientY: number }, svg: Element): Pt => {
    const b = svg.getBoundingClientRect();
    return [(e.clientX - b.left) / k, (e.clientY - b.top) / k];
  };
  /** a canvas point as a point of the line (fractions of its box) */
  const toPt = (w: Pt): Pt => { const [x, y] = toItemBox(s, item, w); return [x / item.w - 0.5, y / item.h - 0.5]; };
  const change = (fn: (pts: Pt[], ctrl: Ctrl[]) => void, commit = false) =>
    edit((p) => {
      const it = p.items.find((q) => q.id === item.id);
      if (!it?.line) return;
      const ctrl = (it.line.ctrl ??= it.line.pts.slice(0, -1).map(() => null)) as Ctrl[];
      while (ctrl.length < it.line.pts.length - 1) ctrl.push(null);
      fn(it.line.pts as Pt[], ctrl);
      if (!ctrl.some(Boolean)) delete it.line.ctrl;
    }, commit);
  const svgOf = (e: React.SyntheticEvent) => (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;

  /** press on a node: drag to move it; a tap picks it (its + appears) */
  const downNode = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const svg = svgOf(e), x0 = e.clientX, y0 = e.clientY;
    const nb: Pt | undefined = world[i > 0 ? i - 1 : 1]; // its neighbour, to snap angles around (none for a lone node)
    let moved = false;
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) { moved = true; checkpoint(); }
      const w = canvasPt(ev, svg), q = toPt(nb ? snapAngle(nb, w, ev) : w);
      change((pts) => { pts[i] = q; });
    };
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      if (moved) fitBox(item.id); else { setSel({ node: i }); setExt(null); }
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  /** a node between two others is smooth when its two handles are out and point opposite ways */
  const isSmooth = (i: number) => {
    if (i <= 0 || i >= world.length - 1) return false;
    const c1 = ctrlW[i - 1], c2 = ctrlW[i], P = world[i];
    if (!c1 || !c2) return false;
    const v1 = [c1[1][0] - P[0], c1[1][1] - P[1]], v2 = [c2[0][0] - P[0], c2[0][1] - P[1]];
    const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
    return l1 > 0.5 && l2 > 0.5 && (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2) < -0.98;
  };
  /** make a node smooth (the line curves through it) or a sharp corner again; the node stays put */
  const setSmooth = (i: number, on: boolean) => {
    const A = world[i - 1], P = world[i], B = world[i + 1];
    const third = (p: Pt, q: Pt): Pt => [p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3];
    const c1: [Pt, Pt] = ctrlW[i - 1] ? [[...ctrlW[i - 1]![0]] as Pt, [...ctrlW[i - 1]![1]] as Pt] : [third(A, P), third(P, A)];
    const c2: [Pt, Pt] = ctrlW[i] ? [[...ctrlW[i]![0]] as Pt, [...ctrlW[i]![1]] as Pt] : [third(P, B), third(B, P)];
    if (on) {
      const tx = B[0] - A[0], ty = B[1] - A[1], tl = Math.hypot(tx, ty) || 1;
      const l1 = Math.hypot(P[0] - A[0], P[1] - A[1]) / 3, l2 = Math.hypot(B[0] - P[0], B[1] - P[1]) / 3;
      c1[1] = [P[0] - (tx / tl) * l1, P[1] - (ty / tl) * l1];
      c2[0] = [P[0] + (tx / tl) * l2, P[1] + (ty / tl) * l2];
    } else { c1[1] = third(P, A); c2[0] = third(P, B); }
    const straight = (c: [Pt, Pt], a: Pt, b: Pt) => Math.hypot(c[0][0] - third(a, b)[0], c[0][1] - third(a, b)[1]) < 0.5 && Math.hypot(c[1][0] - third(b, a)[0], c[1][1] - third(b, a)[1]) < 0.5;
    const n1 = straight(c1, A, P) ? null : ([toPt(c1[0]), toPt(c1[1])] as [Pt, Pt]);
    const n2 = straight(c2, P, B) ? null : ([toPt(c2[0]), toPt(c2[1])] as [Pt, Pt]);
    checkpoint();
    change((_pts, ctrl) => { ctrl[i - 1] = n1; ctrl[i] = n2; });
    fitBox(item.id);
  };
  const deleteNode = (e: React.MouseEvent, i: number) => {
    e.preventDefault(); e.stopPropagation();
    if (l.pts.length <= 1) { useStore.getState().toast("A line keeps at least one node"); return; }
    const mid = i > 0 && i < world.length - 1, smooth = mid && isSmooth(i);
    askConfirm(e, "Delete this node?", () => {
      checkpoint();
      change((pts, ctrl) => {
        pts.splice(i, 1);
        if (i === 0) ctrl.shift(); else if (i >= ctrl.length) ctrl.pop(); else ctrl.splice(i - 1, 2, null);
      });
      setSel(null); fitBox(item.id);
    }, "Delete", true, mid ? [{ label: smooth ? "Make sharp" : "Make smooth", hint: smooth ? "A corner again" : "The line curves smoothly through this node", run: () => setSmooth(i, !smooth) }] : undefined);
  };
  /** a node on piece `seg`, at the point of it nearest to canvas point `at` (a bent piece keeps its shape) */
  const insertOn = (seg: number, at: Pt) => {
    const a = world[seg], b = world[seg + 1], c = ctrlW[seg];
    let u = 0.5;
    if (c) { let best = Infinity; for (let n = 1; n < 40; n++) { const q = cubicAt(a, c, b, n / 40), d = Math.hypot(q[0] - at[0], q[1] - at[1]); if (d < best) { best = d; u = n / 40; } } }
    else { const dx = b[0] - a[0], dy = b[1] - a[1]; u = Math.min(0.98, Math.max(0.02, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); }
    checkpoint();
    if (c) {
      const sp = splitCubic(a, c, b, u);
      const mid = toPt(sp.mid), left = [toPt(sp.left[0]), toPt(sp.left[1])] as [Pt, Pt], right = [toPt(sp.right[0]), toPt(sp.right[1])] as [Pt, Pt];
      change((pts, ctrl) => { pts.splice(seg + 1, 0, mid); ctrl.splice(seg, 1, left, right); });
    } else {
      const q = toPt([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      change((pts, ctrl) => { pts.splice(seg + 1, 0, q); ctrl.splice(seg, 0, null); });
    }
    setSel({ node: seg + 1 });
    useStore.getState().toast("Node added");
  };
  /** press on a piece of the line: dragging moves the whole line (the line underneath takes it); a tap bends it */
  const downSeg = (e: React.PointerEvent, seg: number) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest(".lineedit"));
    if (under) { e.stopPropagation(); under.dispatchEvent(new PointerEvent("pointerdown", e.nativeEvent)); }
    const up = (ev: PointerEvent) => {
      removeEventListener("pointerup", up);
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) { setSel({ seg }); setExt(null); }
    };
    addEventListener("pointerup", up);
  };
  /** drag one of a piece's bend handles (a straight piece gets its handles on first drag) */
  const downHandle = (e: React.PointerEvent, seg: number, end: 0 | 1) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const svg = svgOf(e);
    checkpoint();
    const a = world[seg], b = world[seg + 1];
    const start: [Pt, Pt] = ctrlW[seg] ?? [[a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3]];
    const base: [Pt, Pt] = [toPt(start[0]), toPt(start[1])];
    // the node this handle belongs to; when it's smooth, the handle on its other side stays opposite this one
    const node = end ? seg + 1 : seg, pSeg = end ? seg + 1 : seg - 1, pEnd = end ? 0 : 1;
    const partner = isSmooth(node) ? ctrlW[pSeg] : null, P = world[node];
    const pLen = partner ? Math.hypot(partner[pEnd][0] - P[0], partner[pEnd][1] - P[1]) : 0;
    const mv = (ev: PointerEvent) => {
      const w = canvasPt(ev, svg), q = toPt(w);
      const hx = w[0] - P[0], hy = w[1] - P[1], hl = Math.hypot(hx, hy) || 1;
      const opp = partner ? toPt([P[0] - (hx / hl) * pLen, P[1] - (hy / hl) * pLen]) : null;
      change((_pts, ctrl) => {
        const c = (ctrl[seg] ?? [base[0], base[1]]) as [Pt, Pt]; c[end] = q; ctrl[seg] = [c[0], c[1]];
        if (opp && ctrl[pSeg]) { const pc = ctrl[pSeg] as [Pt, Pt]; pc[pEnd] = opp; ctrl[pSeg] = [pc[0], pc[1]]; }
      });
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); fitBox(item.id); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };

  // adding nodes after a picked one: a quick tap adds the next (when the finger lifts); holding stops
  const from = ext != null ? world[ext] : null;
  const stop = () => { setExt(null); setHover(null); };
  const addAt = (e: React.PointerEvent) => {
    if (ext == null || !from) return;
    e.stopPropagation(); e.preventDefault();
    if (e.button === 2) return;
    const svg = svgOf(e), x0 = e.clientX, y0 = e.clientY, mods = { shiftKey: e.shiftKey, altKey: e.altKey };
    const at = snapAngle(from, canvasPt(e, svg), mods); // where the node goes
    let done = false, dragged = false;
    const off = () => { clearTimeout(hold); removeEventListener("pointerup", up); removeEventListener("pointermove", mv); };
    const hold = window.setTimeout(() => { done = true; off(); navigator.vibrate?.(12); stop(); }, 450);
    const mv = (ev: PointerEvent) => {
      if (!dragged && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) { dragged = true; clearTimeout(hold); } // dragging: it curves, not a hold
      if (dragged) setHover(canvasPt(ev, svg));
    };
    const up = (ev: PointerEvent) => {
      off();
      if (done) return;
      const q = toPt(at);
      // dragged out: the piece arriving at this node curves, pulled by the drag (like the path's pen)
      const pull = dragged ? canvasPt(ev, svg) : null;
      const c: Ctrl = pull ? [toPt([from[0] + (at[0] - from[0]) / 3, from[1] + (at[1] - from[1]) / 3]), toPt([2 * at[0] - pull[0], 2 * at[1] - pull[1]])] : null;
      checkpoint();
      change((pts, ctrl) => { pts.splice(ext + 1, 0, q); ctrl.splice(ext, ext < ctrl.length ? 1 : 0, c, ...(ext < ctrl.length ? [null] : [])); });
      fitBox(item.id);
      setHover(null); setExt(ext + 1); setSel({ node: ext + 1 });
    };
    addEventListener("pointerup", up); addEventListener("pointermove", mv);
  };
  const top = document.querySelector<HTMLElement>(".mo");
  const pickedNode = sel?.node != null && sel.node < world.length ? sel.node : null;
  const pickedSeg = sel?.seg != null && sel.seg < world.length - 1 ? sel.seg : null;

  return (
    <svg className="lineedit" width={project.width} height={project.height} style={{ overflow: "visible" }}>
      {/* the pieces: tap to bend, drag to move the line, right-click (long-press) to add a node */}
      {world.slice(0, -1).map((a, i) => {
        const b = world[i + 1], c = ctrlW[i];
        const d = c ? `M${a[0]} ${a[1]}C${c[0][0]} ${c[0][1]} ${c[1][0]} ${c[1][1]} ${b[0]} ${b[1]}` : `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
        return (
          <path key={"s" + i} className={"lseg" + (pickedSeg === i ? " on" : "")} d={d} strokeWidth={Math.max(14 / k, l.width * s.scale)}
            onPointerDown={(e) => downSeg(e, i)} onDoubleClick={(e) => { e.stopPropagation(); insertOn(i, canvasPt(e, svgOf(e))); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); insertOn(i, canvasPt(e, svgOf(e))); }}>
            <title>Tap to bend · hold to add a node</title>
          </path>
        );
      })}
      {/* bend handles on the picked piece */}
      {pickedSeg != null && (() => {
        const a = world[pickedSeg], b = world[pickedSeg + 1];
        const c = ctrlW[pickedSeg] ?? [[a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3]];
        return ([0, 1] as const).map((end) => {
          const p = c[end], base = end ? b : a;
          return (
            <g key={"h" + end}>
              <line x1={base[0]} y1={base[1]} x2={p[0]} y2={p[1]} stroke="var(--accent)" strokeWidth={sw * 0.6} style={{ pointerEvents: "none" }} />
              <rect className="lhandle" x={p[0] - 4.5 / k} y={p[1] - 4.5 / k} width={9 / k} height={9 / k} rx={2 / k} fill="#fff" stroke="var(--accent)" strokeWidth={sw * 0.8}
                onPointerDown={(e) => downHandle(e, pickedSeg, end)}><title>Drag to bend this piece</title></rect>
            </g>
          );
        });
      })()}
      {/* adding nodes: the whole canvas takes taps; the next piece shows where it would go */}
      {ext != null && from && (
        <>
          <rect className="lext" x={-20000} y={-20000} width={40000} height={40000} onPointerDown={addAt}
            onPointerMove={(e) => setHover(snapAngle(from, canvasPt(e, svgOf(e)), e.nativeEvent))}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); stop(); }} />
          {hover && <line className="lprev" x1={from[0]} y1={from[1]} x2={hover[0]} y2={hover[1]} strokeWidth={Math.max(2 / k, l.width * s.scale)} />}
          {top && createPortal(<div className="linehint"><b>Adding nodes</b><span>tap where each goes · hold to stop</span><button onClick={stop}>Done</button></div>, top)}
        </>
      )}
      {/* the nodes */}
      {world.map((p, i) => (showAll || i === 0 || i === world.length - 1) && (
        <circle key={"p" + i} className="lnode" cx={p[0]} cy={p[1]} r={(pickedNode === i ? 7.5 : 6) / k} fill={pickedNode === i ? "var(--accent)" : "#fff"} stroke={col} strokeWidth={sw}
          onPointerDown={(e) => downNode(e, i)} onContextMenu={(e) => deleteNode(e, i)}>
          <title>Drag to move · hold to delete</title>
        </circle>
      ))}
      {/* the picked node's +: add nodes after it */}
      {pickedNode != null && (() => {
        const [x, y] = world[pickedNode], px = x + 30 / k, on = ext === pickedNode;
        return (
          <g className={"lplus" + (on ? " on" : "")} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setHover(null); setExt(on ? null : pickedNode); }}>
            <title>{on ? "Stop adding nodes" : "Add nodes after this one"}</title>
            <circle cx={px} cy={y} r={9 / k} />
            <path d={`M${px - 4.5 / k} ${y}H${px + 4.5 / k}M${px} ${y - 4.5 / k}V${y + 4.5 / k}`} strokeWidth={sw} />
          </g>
        );
      })()}
    </svg>
  );
}

/** Fit a line's box around it again (nodes and bend handles); the line stays exactly where it is on the canvas. */
export function fitBox(id: string) {
  // its size and turn right now (they may be animated)
  const S = useStore.getState(), orig = S.project.items.find((q) => q.id === id);
  if (!orig) return;
  const now = itemState(S.project, orig, S.t);
  S.edit((p) => {
    const it = p.items.find((q) => q.id === id);
    const l = it?.line;
    if (!it || !l || l.pts.length < 1) return;
    const toPx = ([u, v]: [number, number]) => [(u + 0.5) * it.w, (v + 0.5) * it.h] as Pt;
    const px = l.pts.map(toPx), cpx = (l.ctrl ?? []).map((c) => (c ? ([toPx(c[0]), toPx(c[1])] as [Pt, Pt]) : null));
    const all = [...px, ...cpx.flatMap((c) => c ?? [])];
    const minX = Math.min(...all.map((q) => q[0])), maxX = Math.max(...all.map((q) => q[0]));
    const minY = Math.min(...all.map((q) => q[1])), maxY = Math.max(...all.map((q) => q[1]));
    const nw = Math.max(2, maxX - minX), nh = Math.max(2, maxY - minY);
    // how far the box's middle moves, in the item's own (turned, scaled) frame → on the canvas
    const cx = (minX + maxX) / 2 - it.w / 2, cy = (minY + maxY) / 2 - it.h / 2;
    const sc = now.scale || 1, a = (now.rz * Math.PI) / 180;
    const dx = (cx * Math.cos(a) - cy * Math.sin(a)) * sc, dy = (cx * Math.sin(a) + cy * Math.cos(a)) * sc;
    const back = ([x, y]: Pt): Pt => [(x - (minX + maxX) / 2 + nw / 2) / nw - 0.5, (y - (minY + maxY) / 2 + nh / 2) / nh - 0.5];
    l.pts = px.map(back);
    if (l.ctrl) l.ctrl = cpx.map((c) => (c ? [back(c[0]), back(c[1])] : null));
    it.w = nw; it.h = nh;
    it.base.x += dx; it.base.y += dy;
    for (const ky of it.keys.x ?? []) ky.v += dx;
    for (const ky of it.keys.y ?? []) ky.v += dy;
  }, false);
}
