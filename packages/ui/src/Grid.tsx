import { useEffect, useRef, useState } from "react";
import type { Project } from "@moshion/engine";
import { useStore } from "./store";
import type { GridOpts } from "./store";
import { Icon } from "./Icon";

const COLORS: Record<GridOpts["color"], string> = { blue: "#2f6bff", pink: "#ff2e88", white: "#ffffff", black: "#000000" };

/** The grid as an SVG tile in project pixels; `k` keeps marks the same size on screen at any zoom. */
function tile(o: GridOpts, k: number) {
  const S = o.size, c = COLORS[o.color], a = o.opacity, w = 1.2 / k;
  let body = "";
  if (o.style === "lines") body = `<path d="M0 0H${S}M0 0V${S}" stroke="${c}" stroke-opacity="${a}" stroke-width="${w * 2}"/>`;
  else if (o.style === "dots") body = `<circle cx="0" cy="0" r="${1.8 / k}"/><circle cx="${S}" cy="0" r="${1.8 / k}"/><circle cx="0" cy="${S}" r="${1.8 / k}"/><circle cx="${S}" cy="${S}" r="${1.8 / k}"/>`.replace(/<circle/g, `<circle fill="${c}" fill-opacity="${a}"`);
  else {
    const m = 5 / k;
    const plus = (x: number, y: number) => `M${x - m} ${y}H${x + m}M${x} ${y - m}V${y + m}`;
    body = `<path d="${plus(0, 0)}${plus(S, 0)}${plus(0, S)}${plus(S, S)}" stroke="${c}" stroke-opacity="${a}" stroke-width="${w}"/>`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${body}</svg>`)}")`;
}

/** Drawn over the canvas while the grid is on (never part of the video). */
export function GridOverlay({ project, k }: { project: Project; k: number }) {
  const o = useStore((s) => s.ui.gridOpts);
  const show = useStore((s) => s.ui.grid);
  const thirds = o.thirds ? (
    <svg className="gridthirds" viewBox={`0 0 ${project.width} ${project.height}`} preserveAspectRatio="none">
      {[1, 2].map((i) => <line key={"v" + i} x1={(project.width * i) / 3} x2={(project.width * i) / 3} y1={0} y2={project.height} />)}
      {[1, 2].map((i) => <line key={"h" + i} y1={(project.height * i) / 3} y2={(project.height * i) / 3} x1={0} x2={project.width} />)}
      <line x1={project.width / 2 - 24} x2={project.width / 2 + 24} y1={project.height / 2} y2={project.height / 2} />
      <line y1={project.height / 2 - 24} y2={project.height / 2 + 24} x1={project.width / 2} x2={project.width / 2} />
    </svg>
  ) : null;
  if (!show) return thirds;
  return (
    <>
      <div className="gridov" style={{ backgroundImage: tile(o, k), backgroundSize: `${o.size}px ${o.size}px`, backgroundPosition: `${(project.width / 2) % o.size}px ${(project.height / 2) % o.size}px` }} />
      {thirds}
    </>
  );
}

/** Grid button with its options. */
export function GridButton() {
  const grid = useStore((s) => s.ui.grid);
  const o = useStore((s) => s.ui.gridOpts);
  const { setUI } = useStore.getState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("pointerdown", off, true); addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off, true); removeEventListener("keydown", esc); };
  }, [open]);
  const set = (p: Partial<GridOpts>) => setUI((u) => { Object.assign(u.gridOpts, p); });
  const seg = <T extends string | number>(v: T, opts: [T, string][], on: (v: T) => void) => (
    <span className="gseg2">{opts.map(([x, l]) => <button key={String(x)} className={v === x ? "on" : ""} onClick={() => on(x)}>{l}</button>)}</span>
  );
  return (
    <div className="gridbtn" ref={ref}>
      <button className={"ib" + (grid ? " on" : "")} title="Grid (G)" onClick={() => setUI({ grid: !grid })}><Icon name="grid" /></button>
      <button className={"gchev" + (open ? " on" : "")} title="Grid options" onClick={() => setOpen(!open)}>▾</button>
      {open && (
        <div className="gridpop" onPointerDown={(e) => e.stopPropagation()}>
          <div className="gprow"><span>Show</span>
            <button className={"gtog" + (grid ? " on" : "")} onClick={() => setUI({ grid: !grid })}>{grid ? "On" : "Off"}</button>
          </div>
          <div className="gprow"><span>Style</span>{seg(o.style, [["dots", "Dots"], ["cross", "Crosses"], ["lines", "Lines"]], (v) => set({ style: v }))}</div>
          <div className="gprow"><span>Spacing</span>{seg(o.size, [[30, "30"], [60, "60"], [90, "90"], [120, "120"], [180, "180"]], (v) => set({ size: v }))}</div>
          <div className="gprow"><span>Colour</span>
            <span className="gcols">{(Object.keys(COLORS) as GridOpts["color"][]).map((c) => <button key={c} className={o.color === c ? "on" : ""} style={{ background: COLORS[c] }} title={c} onClick={() => set({ color: c })} />)}</span>
          </div>
          <div className="gprow"><span>Strength</span>{seg(o.opacity, [[0.2, "Faint"], [0.45, "Medium"], [0.8, "Strong"]], (v) => set({ opacity: v }))}</div>
          <div className="gprow"><span>Snap to grid</span><button className={"gtog" + (o.snap ? " on" : "")} onClick={() => set({ snap: !o.snap })}>{o.snap ? "On" : "Off"}</button></div>
          <div className="gprow"><span>Thirds guide</span><button className={"gtog" + (o.thirds ? " on" : "")} onClick={() => set({ thirds: !o.thirds })}>{o.thirds ? "On" : "Off"}</button></div>
          <div className="gnote">Shown only while editing, never in the video. Alt while dragging skips snapping.</div>
        </div>
      )}
    </div>
  );
}
