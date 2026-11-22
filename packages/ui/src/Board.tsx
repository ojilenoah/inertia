import { useEffect, useState } from "react";
import type { Background, Project } from "@moshion/engine";
import { activeBackground, boardPos, canvases, deleteCanvas, duplicateCanvas, fmtClock, insertCanvasAfter, uid } from "@moshion/engine";
import { askConfirm } from "./Confirm";
import { useStore } from "./store";
import { prepare, renderFrame, type RenderSession } from "./render";
import { Icon } from "./Icon";

/*
 * Board mode: the preview becomes an endless flat plane. The canvas under the playhead is live and
 * editable (items off its edges show faded around it); the other canvases show their first frame.
 * Still frames of canvases come from the export renderer, made in the background after edits.
 */

/* ---------------- still frames ---------------- */
const SNAP_W = 540;
let session: { key: string; rs: RenderSession } | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, string>();
const keyOf = (p: Project) => `${p.width}x${p.height}|${p.items.map((i) => i.src ?? "").join(",")}`;

async function still(project: Project, t: number): Promise<string> {
  const w = Math.min(SNAP_W, project.width), h = Math.round((w * project.height) / project.width);
  const k = keyOf(project);
  if (!session || session.key !== k) session = { key: k, rs: await prepare(project, w, h) };
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  await renderFrame(out, project, t, session.rs, false);
  return out.toDataURL("image/jpeg", 0.85);
}

/** What a still at time t depends on. Unchanged items keep their identity, so editing one canvas doesn't redraw the others. */
const objIds = new WeakMap<object, number>();
let objCount = 0;
const oid = (o: object | undefined) => { if (!o) return 0; let v = objIds.get(o); if (v == null) { v = ++objCount; objIds.set(o, v); } return v; };
function stillKey(p: Project, t: number): string {
  const its = p.items.filter((i) => i.start <= t + 1e-3 && i.end > t - 1e-3).map((i) => oid(i)).join(".");
  const bg = activeBackground(p, t);
  const bgk = bg ? JSON.stringify({ ...bg, board: undefined, trans: undefined }) : p.background;
  return `${p.width}x${p.height}|${t}|${its}|${bgk}|${oid(p.effects)}|${oid(p.canvasFx)}`;
}
const lastGood = new Map<number, string>();

/** Still frames of the project at the given times, made a moment after something on them changes. */
export function useStills(project: Project, times: number[]): Map<number, string> {
  const [, bump] = useState(0);
  const want = times.map((t) => Math.round(t * 1000) / 1000);
  const keys = want.map((t) => stillKey(project, t));
  const sig = keys.join("~");
  useEffect(() => {
    if (!want.length || keys.every((k) => cache.has(k))) return;
    let dead = false;
    const id = setTimeout(() => {
      queue = queue.then(async () => {
        for (let i = 0; i < want.length; i++) {
          if (dead) return;
          if (cache.has(keys[i])) continue;
          try {
            cache.set(keys[i], await still(useStore.getState().project, want[i]));
            if (cache.size > 80) cache.delete(cache.keys().next().value!);
            bump((n) => n + 1);
          } catch { /* skip this one */ }
        }
      });
    }, 350);
    return () => { dead = true; clearTimeout(id); };
  }, [sig]);
  const out = new Map<number, string>();
  want.forEach((t, i) => {
    const url = cache.get(keys[i]);
    if (url) lastGood.set(t, url);
    const show = url ?? lastGood.get(t);
    if (show) out.set(t, show);
  });
  return out;
}

/* ---------------- the board ---------------- */
export interface Cam { x: number; y: number; z: number }

/** A camera that shows every canvas. */
export function fitCam(p: Project, w: number, h: number): Cam {
  const cs = canvases(p).map((c) => boardPos(p, c));
  const x0 = Math.min(...cs.map((c) => c.x)), y0 = Math.min(...cs.map((c) => c.y));
  const x1 = Math.max(...cs.map((c) => c.x)) + p.width, y1 = Math.max(...cs.map((c) => c.y)) + p.height;
  const z = Math.min(1, Math.min((w - 80) / (x1 - x0), (h - 90) / (y1 - y0)));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 10 / z, z: Math.max(0.02, z) };
}

type Menu = { x: number; y: number; canvasId?: string; bx: number; by: number };

/** Everything on the board except the live canvas: the plane, the other canvases, their names, and the board menu. */
export function BoardPlane({ project, cam, setCam, size, live }: { project: Project; cam: Cam; setCam: (c: Cam) => void; size: { w: number; h: number }; live: Background }) {
  const { edit, checkpoint, setT, toast, setUI } = useStore.getState();
  const cs = canvases(project);
  const stills = useStills(project, cs.filter((c) => c.id !== live.id).map((c) => c.start));
  const [menu, setMenu] = useState<Menu | null>(null);
  const sx = (x: number) => (x - cam.x) * cam.z + size.w / 2, sy = (y: number) => (y - cam.y) * cam.z + size.h / 2;
  const W = project.width * cam.z, H = project.height * cam.z;
  const toBoard = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = el.closest(".stagewrap")!.getBoundingClientRect();
    return { bx: cam.x + (e.clientX - r.left - size.w / 2) / cam.z, by: cam.y + (e.clientY - r.top - size.h / 2) / cam.z };
  };
  const openMenu = (e: React.MouseEvent, canvasId?: string) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, canvasId, ...toBoard(e, e.currentTarget) }); };

  /** Drag a canvas (by its body, name or edge) to move it on the board; a click puts the playhead in it. */
  const grab = (e: React.PointerEvent, c: Background) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, p0 = boardPos(project, c);
    let moved = false;
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) {
        moved = true; checkpoint();
        // the first time anything moves, every canvas gets its place written down
        edit((p) => { if (!p.backgrounds?.length) p.backgrounds = [{ ...c, id: c.id || uid("bg") }]; for (const q of p.backgrounds) q.board ??= boardPos(p, q); }, false);
      }
      edit((p) => {
        const q = p.backgrounds?.find((b) => b.id === c.id) ?? (c.id ? undefined : p.backgrounds?.[0]);
        if (q) q.board = { x: Math.round(p0.x + (ev.clientX - x0) / cam.z), y: Math.round(p0.y + (ev.clientY - y0) / cam.z) };
      }, false);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (!moved) setT(Math.min(c.start + 1e-3, c.end)); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };

  const go = (c: Background) => setT(Math.min(c.start + 1e-3, c.end));
  const actions = {
    add: (m: Menu) => {
      let c: Background | null = null;
      const after = m.canvasId ?? cs.at(-1)!.id;
      edit((p) => { c = insertCanvasAfter(p, after, uid("bg"), 3, m.canvasId ? undefined : { x: Math.round(m.bx - project.width / 2), y: Math.round(m.by - project.height / 2) }); });
      if (c) { go(c); toast(`${(c as Background).name} added · it fades in from the canvas before it`); }
    },
    dup: (id: string) => {
      let c: Background | null = null;
      edit((p) => { c = duplicateCanvas(p, id, uid("bg"), () => uid("item")); });
      if (c) { go(c); toast(`${(c as Background).name} added after it`); }
    },
    del: (e: React.MouseEvent, id: string) => {
      const c = cs.find((q) => q.id === id)!;
      const n = project.items.filter((i) => i.start >= c.start - 1e-4 && i.start < c.end - 1e-4).length;
      askConfirm(e, `Delete ${c.name || "this canvas"}${n ? ` and its ${n} item${n === 1 ? "" : "s"}` : ""}? Later canvases move up.`, () => { edit((p) => { deleteCanvas(p, id); }); toast("Canvas deleted · Ctrl+Z brings it back"); });
    },
    settings: (m: Menu, id: string) => setUI({ panel: { section: "scene", itemId: null, canvas: !id, bgId: id || undefined, x: m.x, y: m.y + 8 } }),
  };

  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => { if (!(e.target as Element).closest?.(".bmenu")) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    addEventListener("pointerdown", off, true); addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off, true); removeEventListener("keydown", esc); };
  }, [menu]);

  const dot = Math.max(8, 60 * cam.z);
  const lp = boardPos(project, live), EDGE = 10;
  const mc = menu?.canvasId != null ? cs.find((c) => c.id === menu.canvasId) : undefined;
  return (
    <>
    <div className="bplane" style={{ backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${sx(0)}px ${sy(0)}px` }}
      onContextMenu={(e) => openMenu(e)}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 1) return;
        if (e.target !== e.currentTarget) return;
        useStore.getState().select(null);
        const x0 = e.clientX, y0 = e.clientY, c0 = cam;
        let moved = false;
        const mv = (ev: PointerEvent) => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; moved = true; setCam({ ...c0, x: c0.x - (ev.clientX - x0) / c0.z, y: c0.y - (ev.clientY - y0) / c0.z }); };
        // dragging empty board pans it; the board menu opens on right-click (a long press on phones), not on a click or tap
        const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
        addEventListener("pointermove", mv); addEventListener("pointerup", up);
      }} />
    {/* the other canvases sit above the live one's faded surroundings, so they're never dimmed */}
    <div className="blayer">
      {cs.map((c, i) => {
        const pos = boardPos(project, c), isLive = c.id === live.id;
        return (
          <div key={c.id || "c"}>
            <div className={"blabel" + (isLive ? " on" : "")} style={{ left: sx(pos.x), top: sy(pos.y) - 19, maxWidth: Math.max(60, W) }}
              onPointerDown={(e) => grab(e, c)} onContextMenu={(e) => openMenu(e, c.id)}
              title={`${c.name || `Canvas ${i + 1}`} · ${fmtClock(c.start)}–${fmtClock(c.end)}${i > 0 && c.trans ? ` · ${c.trans.kind === "board" ? "board move" : c.trans.kind} in` : ""} · drag to move · right-click for more`}>
              {c.name || `Canvas ${i + 1}`}
            </div>
            {!isLive && (
              <div className="bcanvas" style={{ left: sx(pos.x), top: sy(pos.y), width: W, height: H, background: stills.has(Math.round(c.start * 1000) / 1000) ? `center / cover no-repeat url(${stills.get(Math.round(c.start * 1000) / 1000)})` : c.colors[0] }}
                onPointerDown={(e) => grab(e, c)} onContextMenu={(e) => openMenu(e, c.id)} />
            )}
          </div>
        );
      })}
      {/* the live canvas can be moved by its edges (its inside is for editing items) */}
      {([["t", sx(lp.x) - EDGE, sy(lp.y) - EDGE, W + 2 * EDGE, EDGE], ["b", sx(lp.x) - EDGE, sy(lp.y) + H, W + 2 * EDGE, EDGE], ["l", sx(lp.x) - EDGE, sy(lp.y), EDGE, H], ["r", sx(lp.x) + W, sy(lp.y), EDGE, H]] as const).map(([k, l, t, w, h]) => (
        <i key={k} className="bedge" style={{ left: l, top: t, width: w, height: h }} title="Drag to move this canvas · right-click for more"
          onPointerDown={(e) => {
            // a motion path's node sitting on the edge: it gets the press (to drag the node), not the canvas
            const node = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains("mnode"));
            if (node) { e.stopPropagation(); node.dispatchEvent(new PointerEvent("pointerdown", e.nativeEvent)); return; }
            grab(e, live);
          }} onContextMenu={(e) => openMenu(e, live.id)} />
      ))}
    </div>
    {menu && (
      <div className="pop bmenu" style={{ left: Math.min(menu.x, innerWidth - 200), top: Math.min(menu.y, innerHeight - 220) }}>
        {mc ? <>
          <button onClick={() => { go(mc); setMenu(null); }}><Icon name="next" size={13} />Go to this canvas</button>
          <button onClick={() => { actions.settings(menu, mc.id); setMenu(null); }}><Icon name="sparkle" size={13} />Canvas settings</button>
          <span className="bsep" />
          <button onClick={() => { actions.add(menu); setMenu(null); }}><Icon name="plus" size={13} />New canvas after this</button>
          <button onClick={() => { actions.dup(mc.id); setMenu(null); }}><Icon name="frame" size={13} />Duplicate canvas</button>
          <span className="bsep" />
          <button className="danger" disabled={cs.length < 2} onClick={(e) => { actions.del(e, mc.id); setMenu(null); }}><Icon name="trash" size={13} />Delete canvas</button>
        </> : <>
          <button onClick={() => { actions.add(menu); setMenu(null); }}><Icon name="plus" size={13} />New canvas here</button>
          <button onClick={() => { actions.dup(live.id); setMenu(null); }}><Icon name="frame" size={13} />Duplicate this canvas</button>
          <span className="bsep" />
          <button onClick={() => { setCam(fitCam(project, size.w, size.h)); setMenu(null); }}><Icon name="zout" size={13} />Show all canvases</button>
          <button onClick={() => { const p = boardPos(project, live); setCam({ x: p.x + project.width / 2, y: p.y + project.height / 2, z: Math.min((size.w - 60) / project.width, (size.h - 60) / project.height) }); setMenu(null); }}><Icon name="zin" size={13} />Zoom to this canvas</button>
        </>}
      </div>
    )}
    </>
  );
}
