import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Item } from "@moshion/engine";
import { itemState } from "@moshion/engine";
import { useStore } from "./store";
import { useVideoSource } from "./videoview";
import { canvasToVideo, mediaTimeOf, projectTimeOf, runTracking, setTrackerPoints, stopTracking, trackerAt, videoToCanvas } from "./tracker";

type P2 = [number, number];

/**
 * A video's tracker on the canvas: its point(s) at the playhead to drag onto the spot, the box it matches, and the
 * tracked path around the playhead. Drawn in canvas px (the layer is scaled by k).
 */
export function TrackOverlay({ item, k }: { item: Item; k: number }) {
  const project = useStore((s) => s.project);
  const t = useStore((s) => s.t);
  const tracking = useStore((s) => s.ui.tracking);
  const src = useVideoSource(item.src);
  const tr = item.trackers?.find((q) => q.id === tracking?.trackerId);
  const [drag, setDrag] = useState<{ i: number; p: P2[] } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !useStore.getState().ui.tracking?.run) { e.stopPropagation(); useStore.getState().setUI({ tracking: null }); } };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, []);

  if (!src || !tr || !tracking) return null;
  const inside = t >= item.start && t < item.end;
  const tm = mediaTimeOf(item, t, src.dur);
  const here = trackerAt(tr, tm);
  // not tracked at this frame: the nearest found points, faded, to drag into place here
  const near = here ?? tr.pts.reduce<{ d: number; p: P2[] | null }>((b, q) => (Math.abs(q.t - tm) < b.d ? { d: Math.abs(q.t - tm), p: q.p } : b), { d: Infinity, p: null }).p;
  const pts = drag?.p ?? near;
  if (!pts || !inside) return null;
  const toC = (p: P2, T = t) => videoToCanvas(project, item, T, src.w, src.h, p);
  const C = pts.map((p) => toC(p));
  // the matched box (the patch the tracker compares), in canvas px
  const s = itemState(project, item, t);
  const fitK = (item.fit === "contain" ? Math.min(item.w / src.w, item.h / src.h) : Math.max(item.w / src.w, item.h / src.h)) * (item.imgZoom ?? 1);
  const box = 10.5 * (Math.max(src.w, src.h) / 640) * fitK * Math.abs(s.scale);
  const u = 1 / k; // one screen px in canvas px
  // the path around the playhead (±1.5 s)
  const trail = tr.pts.filter((q) => Math.abs(q.t - tm) < 1.5 * (item.speed ?? 1)).map((q) => ({ T: projectTimeOf(item, q.t, src.dur), p: q.p }));
  const trailD = pts.map((_, i) => trail.map((q, j) => { const c = toC(q.p[i], q.T); return `${j ? "L" : "M"}${c[0].toFixed(1)} ${c[1].toFixed(1)}`; }).join("")).join("");

  const down = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || tracking.run) return;
    e.stopPropagation(); e.preventDefault();
    const r = svg.current!.getBoundingClientRect();
    const start = pts.map((p) => [...p] as P2);
    const id0 = tr.id, item0 = item.id;
    let first = true, last = start;
    const at = (ev: PointerEvent): P2[] => {
      const cx = (ev.clientX - r.left) / k, cy = (ev.clientY - r.top) / k;
      const v = canvasToVideo(project, item, t, src.w, src.h, [cx, cy]);
      return start.map((p, j) => (j === i ? v : p));
    };
    const mv = (ev: PointerEvent) => { last = at(ev); setDrag({ i, p: last }); };
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      setTrackerPoints(item0, id0, t, last, first).finally(() => setDrag(null));
      first = false;
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };

  const top = document.querySelector<HTMLElement>(".mo");
  const run = tracking.run;
  return (
    <>
      <svg ref={svg} className="trkov" width={project.width} height={project.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
        {trailD && <path d={trailD} className="trktrail" strokeWidth={1.5 * u} />}
        {pts.length === 4 && <path d={C.map((c, i) => `${i ? "L" : "M"}${c[0]} ${c[1]}`).join("") + "Z"} className="trkquad" strokeWidth={1.5 * u} />}
        {C.map((c, i) => (
          <g key={i} className={"trkpt" + (here || drag ? "" : " off")} onPointerDown={(e) => down(e, i)} style={{ pointerEvents: run ? "none" : "auto" }}>
            <rect x={c[0] - box} y={c[1] - box} width={box * 2} height={box * 2} strokeWidth={1.5 * u} className="trkbox" />
            <circle cx={c[0]} cy={c[1]} r={18 * u} className="trkhit" />
            <path d={`M${c[0] - 7 * u} ${c[1]}H${c[0] + 7 * u}M${c[0]} ${c[1] - 7 * u}V${c[1] + 7 * u}`} strokeWidth={1.5 * u} className="trkcross" />
          </g>
        ))}
      </svg>
      {top && createPortal(
        <div className="linehint trkhint">
          <b>{tr.name}</b>
          {run ? <>
            <span>Tracking {run.dir > 0 ? "forwards" : "backwards"}… {Math.min(100, Math.round((run.done / run.total) * 100))}%</span>
            <button onClick={stopTracking}>Stop</button>
          </> : <>
            <span>{here ? "drag onto a clear spot · then track" : "not tracked here · drag it onto the spot"}</span>
            <button className="ghost" title="Track from here back to the clip's start" onClick={() => runTracking(item.id, tr.id, -1)}>◀</button>
            <button className="ghost" title="Track from here to the clip's end" onClick={() => runTracking(item.id, tr.id, 1)}>▶</button>
            <button onClick={() => useStore.getState().setUI({ tracking: null })}>Done</button>
          </>}
        </div>, top)}
    </>
  );
}
