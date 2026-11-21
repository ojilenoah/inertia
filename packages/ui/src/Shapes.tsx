import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Item, LineSpec, ShapeSpec } from "@moshion/engine";
import { SHAPES_LIST, placeItem, shapeD, smoothStroke, uid } from "@moshion/engine";
import { addChart, addParticles, importSVG } from "./newitems";
import { useStore } from "./store";
import { Icon } from "./Icon";
import { addItem, inkFor } from "./Panels";

/** A small picture of a shape. */
export function ShapeIcon({ spec }: { spec: ShapeSpec }) {
  const { d, evenodd } = shapeD(spec, 24, 24);
  return <svg viewBox="-1 -1 26 26" aria-hidden="true"><path d={d} fill="currentColor" fillRule={evenodd ? "evenodd" : "nonzero"} /></svg>;
}

const PALETTE = ["#3A5BFF", "#7B4DFF", "#E0571A", "#1F9D63", "#E2A100", "#D9338A", "#111111"];

/** The single Shapes button on the toolbar, with every shape in a little picker. */
export function ShapePicker() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  /** The picker is drawn above everything (the toolbar would cut it off), next to the button. */
  const popPos = (): React.CSSProperties => {
    const b = ref.current?.getBoundingClientRect();
    if (!b) return {};
    const left = b.right + 8 + 264 > innerWidth ? b.left - 8 - 264 : b.right + 8;
    return { left, top: Math.min(b.top, innerHeight - 300) };
  };
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("pointerdown", off, true);
    return () => removeEventListener("pointerdown", off, true);
  }, [open]);
  const add = (type: ShapeSpec["type"]) => {
    const info = SHAPES_LIST.find((x) => x.type === type)!;
    const i = SHAPES_LIST.indexOf(info);
    const wide = type === "arrow" || type === "capsule" || type === "chevron" || type === "bubble";
    const b = ref.current?.getBoundingClientRect();
    addItem({ kind: "shape", name: info.label, w: wide ? 420 : 340, h: wide ? (type === "chevron" ? 340 : 220) : 340, fill: PALETTE[i % PALETTE.length], tint: "--blue", radius: 0, shape: { ...info.spec } } as Partial<Item>);
    setOpen(false);
    // open the new shape's Shape card straight away, next to the toolbar, so it can be tweaked
    const id = useStore.getState().selected;
    if (id && b) useStore.getState().setUI({ panel: { section: "shape", itemId: id, x: (b.right + 8 + 340 > innerWidth ? b.left - 180 : b.right + 180), y: Math.max(8, b.top - 40) } });
  };
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className={"ib" + (open ? " on" : "")} title="Shapes" aria-label="Add a shape" onClick={() => setOpen(!open)}><Icon name="shapes" /></button>
      {open && createPortal(
        <div className="shpop" ref={popRef} style={{ position: "fixed", ...popPos() }}>
          <div className="psub">Shapes · edit points, rounding & more in the Shape card</div>
          <div className="shgrid">
            {SHAPES_LIST.map((x) => <button key={x.type} title={x.label} onClick={() => add(x.type)}><ShapeIcon spec={x.spec} /></button>)}
          </div>
          <div className="psub">More</div>
          <div className="shmore">
            <button onClick={() => { setOpen(false); importSVG(); }}>Import SVG…</button>
            <button onClick={() => { setOpen(false); addChart(); }}>Chart</button>
            {(["confetti", "sparks", "snow", "dust"] as const).map((k) => <button key={k} onClick={() => { setOpen(false); addParticles(k); }}>{k[0].toUpperCase() + k.slice(1)}</button>)}
          </div>
        </div>,
        document.querySelector(".mo") ?? document.body,
      )}
    </div>
  );
}

/** Line and Pen tools: drag on the canvas to draw; the result is a line item you can style and draw on over time. */
export function LineDrawLayer({ k, stage }: { k: number; stage: React.RefObject<HTMLDivElement | null> }) {
  const tool = useStore((s) => s.ui.lineTool);
  const [live, setLive] = useState<[number, number][] | null>(null);
  const pts = useRef<[number, number][]>([]);
  useEffect(() => {
    if (!tool) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); useStore.getState().setUI({ lineTool: null }); } };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [tool]);
  if (!tool) return null;
  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  };
  const straight = (a: [number, number], b: [number, number], snap: boolean): [number, number] => {
    if (!snap) return b;
    const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
  };
  const finish = () => {
    let raw = pts.current; pts.current = []; setLive(null);
    if (raw.length < 2) return;
    if (tool === "pen") raw = smoothStroke(raw, 3);
    const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (Math.hypot(x1 - x0, y1 - y0) < 6) return;
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const line: LineSpec = { pts: raw.map(([x, y]) => [Math.round(((x - cx) / w) * 1e4) / 1e4, Math.round(((y - cy) / h) * 1e4) / 1e4]), width: 10, color: inkFor(useStore.getState().project, useStore.getState().t), dash: "solid", arrow: "none", cap: "round" };
    const { project, t, edit, select, setUI } = useStore.getState();
    const id = uid("item");
    const start = Math.max(0, Math.min(t, project.duration)), end = start + 3;
    edit((p) => {
      const pl = placeItem(p, "video", start, end, useStore.getState().project.items.find((q) => q.id === useStore.getState().selected)?.trackId, () => uid("V"));
      let trackId: string | undefined = pl.trackId;
      if (!trackId) { trackId = uid("V"); p.tracks.unshift({ id: trackId, name: `Track ${p.tracks.filter((x) => x.kind === "video").length + 1}`, kind: "video" }); }
      p.items.push({ id, name: tool === "pen" ? "Drawing" : "Line", kind: "line", trackId, lane: pl.lane, start, end, w: Math.round(w), h: Math.round(h), fill: "transparent", tint: "--green", keys: {}, line,
        base: { x: Math.round(cx), y: Math.round(cy), z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 } });
    });
    select(id); setUI({ lineTool: null });
    useStore.getState().toast("Line added · style it in its Line card (dashes, arrows, draw on)");
  };
  return (
    <>
      <div className="linedraw"
        onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current = [toWorld(e)]; setLive([...pts.current]); }}
        onPointerMove={(e) => {
          if (!pts.current.length) return;
          const p = toWorld(e);
          if (tool === "line") pts.current = [pts.current[0], straight(pts.current[0], p, e.shiftKey)]; else pts.current.push(p);
          setLive([...pts.current]);
        }}
        onPointerUp={finish} />
      {live && live.length > 1 && (
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible", zIndex: 61 }}>
          <path d={live.map(([x, y], i) => `${i ? "L" : "M"}${x * k} ${y * k}`).join("")} fill="none" stroke="var(--sel)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <div className="pathhint"><b>{tool === "pen" ? "Pen" : "Line"}</b><span>{tool === "pen" ? "drag to draw freehand" : "drag from start to end · Shift: straight angles"}</span><button onClick={() => useStore.getState().setUI({ lineTool: null })}>Esc</button></div>
    </>
  );
}
