import { useState } from "react";
import type { Item } from "@moshion/engine";
import { useStore } from "./store";
import { Icon } from "./Icon";
import { PINNABLE } from "./Viewer";
import { addTracker, followTrack, keepCentred, pinToTrack, runTracking, stabilise, stopTracking } from "./tracker";

/**
 * Motion tracking for a video clip: add a point (or four corners), place it on the canvas, track it forwards or
 * backwards from the playhead, then use it.
 */
export function TrackBody({ item }: { item: Item }) {
  const tracking = useStore((s) => s.ui.tracking);
  const items = useStore((s) => s.project.items);
  const setUI = useStore((s) => s.setUI);
  const edit = useStore((s) => s.edit);
  const trs = item.trackers ?? [];
  const active = tracking?.itemId === item.id ? trs.find((t) => t.id === tracking.trackerId) : undefined;
  const run = tracking?.itemId === item.id ? tracking.run : undefined;
  const others = items.filter((q) => q.id !== item.id && !["audio", "motion", "camera"].includes(q.kind));
  const [target, setTarget] = useState("");
  const tg = others.find((q) => q.id === target) ?? others[0];

  return (
    <>
      <div className="chips">
        <button className="chip" onClick={() => addTracker(item.id, 1)}><Icon name="target" size={12} />Point</button>
        <button className="chip" onClick={() => addTracker(item.id, 4)}><Icon name="pin" size={12} />4 corners</button>
      </div>
      {trs.length > 0 && <div className="trklist">
        {trs.map((tr) => {
          const n = tr.pts.length, a = tr.pts[0]?.t ?? 0, b = tr.pts[n - 1]?.t ?? 0;
          const on = active?.id === tr.id;
          return (
            <div key={tr.id} className={"trkrow" + (on ? " on" : "")} onClick={() => setUI({ tracking: on ? null : { itemId: item.id, trackerId: tr.id }, pinning: null })} title={on ? "Hide its points" : "Show its points on the video"}>
              <Icon name={tr.n === 1 ? "target" : "pin"} size={13} />
              <b>{tr.name}</b>
              <small>{n > 1 ? `${n} frames · ${a.toFixed(1)}–${b.toFixed(1)}s` : "not tracked yet"}</small>
              <button className="ib" title="Delete" onClick={(e) => { e.stopPropagation(); edit((p) => { const q = p.items.find((x) => x.id === item.id); if (q) q.trackers = q.trackers?.filter((x) => x.id !== tr.id); if (q && !q.trackers?.length) delete q.trackers; }); if (on) setUI({ tracking: null }); }}><Icon name="trash" size={12} /></button>
            </div>
          );
        })}
      </div>}
      {active && <>
        <div className="psub">Track</div>
        {run ? (
          <div className="trkrun">
            <span>Tracking {run.dir > 0 ? "forwards" : "backwards"}… {Math.min(100, Math.round((run.done / run.total) * 100))}%</span>
            <button className="chip" onClick={stopTracking}>Stop</button>
          </div>
        ) : (
          <div className="chips">
            <button className="chip" onClick={() => runTracking(item.id, active.id, -1)} title="From the playhead back to the clip's start">◀ Backwards</button>
            <button className="chip" onClick={() => runTracking(item.id, active.id, 1)} title="From the playhead to the clip's end">Forwards ▶</button>
          </div>
        )}
        {active.pts.length > 1 && !run && <>
          <div className="psub">Use it</div>
          {others.length > 0 && (
            <div className="trkuse">
              <select className="psel" value={tg?.id ?? ""} onChange={(e) => setTarget(e.target.value)}>
                {others.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
              <button className="chip" onClick={() => tg && followTrack(item.id, active.id, tg.id)} title="Its position follows the tracked spot (keyframes you can adjust)">Follow</button>
              {active.n === 4 && tg && PINNABLE(tg) && <button className="chip" onClick={() => pinToTrack(item.id, active.id, tg.id)} title="Its corners are pinned to the tracked corners in every frame">Pin onto it</button>}
            </div>
          )}
          {active.n === 1 && <div className="chips">
            <button className="chip" onClick={() => stabilise(item.id, active.id)} title="The video moves against the shake so the spot stays still (it zooms in a little to hide the edges)">Steady the video</button>
            <button className="chip" onClick={() => keepCentred(item.id, active.id)} title="The video pans so the spot stays in the middle of the frame (wide video in a tall frame)">Keep it centred</button>
          </div>}
        </>}
      </>}
    </>
  );
}
