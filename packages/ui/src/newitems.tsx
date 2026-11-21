import { useEffect, useRef } from "react";
import type { Item, Project, ShapeSpec } from "@moshion/engine";
import { PARTICLE_DEFAULTS, chartProgress, chartSVG, particlesAt, placeItem, uid } from "@moshion/engine";
import type { Particle, ParticleSpec } from "@moshion/engine";
import { useStore } from "./store";

/*
 * Charts, particles and SVG shapes: adding them, and drawing them in the editor.
 * (The export draws them with the same engine functions.)
 */

function addItem(make: (p: Project, trackId: string, start: number, end: number) => Item) {
  const { project, t, edit, select } = useStore.getState();
  const start = Math.max(0, Math.min(t, project.duration)), end = start + 3;
  let id = "";
  edit((p) => {
    const { trackId } = placeItem(p, "video", start, end, useStore.getState().project.items.find((q) => q.id === useStore.getState().selected)?.trackId, () => uid("V"));
    const it = make(p, trackId, start, end); id = it.id; p.items.push(it);
  });
  select(id);
}
const base = (p: Project) => ({ x: p.width / 2, y: p.height / 2, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 });

export function addChart() {
  addItem((p, trackId, start, end) => ({
    id: uid("item"), name: "Chart", kind: "chart", trackId, start, end, w: Math.round(p.width * 0.7), h: Math.round(Math.min(p.height * 0.4, p.width * 0.5)), fill: "transparent", tint: "--green", keys: {}, base: base(p),
    chart: { type: "bar", labels: ["Mon", "Tue", "Wed", "Thu", "Fri"], values: [12, 19, 8, 24, 16], grow: true, labelColor: "#555555" },
  } as Item));
  useStore.getState().toast("Chart added · edit its numbers in the Chart card");
}
export function addParticles(kind: ParticleSpec["kind"]) {
  addItem((p, trackId, start, end) => ({
    id: uid("item"), name: kind[0].toUpperCase() + kind.slice(1), kind: "particles", trackId, start, end, w: p.width, h: p.height, fill: "transparent", tint: "--orange", keys: {}, base: base(p),
    particles: { ...PARTICLE_DEFAULTS[kind], colors: [...PARTICLE_DEFAULTS[kind].colors] },
  } as Item));
  useStore.getState().toast(`${kind[0].toUpperCase() + kind.slice(1)} added · tune it in the Particles card`);
}

/* ---------------- drawing ---------------- */
export function drawParticles(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, parts: Particle[]) {
  for (const q of parts) {
    ctx.globalAlpha = q.alpha; ctx.fillStyle = q.color; ctx.strokeStyle = q.color;
    if (q.shape === "dot") { ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill(); continue; }
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate((q.rot * Math.PI) / 180);
    if (q.shape === "rect") ctx.fillRect(-q.r / 2, -q.r * 0.3, q.r, q.r * 0.6);
    else { ctx.lineWidth = Math.max(1, q.r * 0.5); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-q.len / 2, 0); ctx.lineTo(q.len / 2, 0); ctx.stroke(); }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function ChartView({ item, local }: { item: Item; local: number }) {
  if (!item.chart) return null;
  return <div style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: chartSVG(item.chart, item.w, item.h, chartProgress(item, local)) }} />;
}
export function ParticlesView({ item, local }: { item: Item; local: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !item.particles) return;
    const q = Math.min(1, 1400 / Math.max(item.w, item.h)); // keep the canvas light
    c.width = Math.round(item.w * q); c.height = Math.round(item.h * q);
    const g = c.getContext("2d")!;
    g.setTransform(q, 0, 0, q, 0, 0); g.clearRect(0, 0, item.w, item.h);
    drawParticles(g, particlesAt(item.particles, item.w, item.h, local, item.end - item.start));
  });
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}

/* ---------------- SVG import: each part becomes a shape you can edit and morph ---------------- */
const hex = (c: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? "#" + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("") : /^#[0-9a-f]{6}$/i.test(c) ? c : null;
};
export async function importSVG() {
  const file = await new Promise<File | null>((res) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".svg,image/svg+xml"; inp.onchange = () => res(inp.files?.[0] ?? null); inp.click(); });
  if (!file) return;
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-99999px;top:0;width:1000px;height:1000px;visibility:hidden";
  holder.innerHTML = await file.text();
  document.body.appendChild(holder);
  const svg = holder.querySelector("svg");
  const parts: { name: string; rings: [number, number][][]; bbox: { x: number; y: number; w: number; h: number }; fill: string; stroke?: { width: number; color: string } }[] = [];
  try {
    if (!svg) throw new Error("no svg");
    const els = [...svg.querySelectorAll<SVGGeometryElement>("path, rect, circle, ellipse, polygon, polyline")].slice(0, 80);
    for (const el of els) {
      const st = getComputedStyle(el), m = el.getCTM(), rm = svg.getCTM();
      if (!m || st.display === "none") continue;
      const toRoot = rm ? rm.inverse().multiply(m) : m;
      const L = el.getTotalLength(), steps = Math.min(600, Math.max(40, Math.round(L / 2))), step = L / steps;
      const rings: [number, number][][] = [];
      let ring: [number, number][] = [], prev: DOMPoint | null = null;
      for (let i = 0; i <= steps; i++) {
        const p = el.getPointAtLength(i * step);
        // a jump means a new part of the path (letters with holes, separate pieces)
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > step * 3 && ring.length > 2) { rings.push(ring); ring = []; }
        const q = new DOMPoint(p.x, p.y).matrixTransform(toRoot);
        ring.push([q.x, q.y]); prev = p;
      }
      if (ring.length > 2) rings.push(ring);
      if (!rings.length) continue;
      const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
      const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(1, Math.max(...xs) - Math.min(...xs)), h: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
      const fill = st.fill && st.fill !== "none" ? hex(st.fill) ?? "#111111" : "transparent";
      const sw = parseFloat(st.strokeWidth) || 0, sc = st.stroke && st.stroke !== "none" ? hex(st.stroke) : null;
      parts.push({ name: el.id || el.tagName, rings, bbox, fill, stroke: sc && sw ? { width: sw / 2, color: sc } : undefined });
    }
  } catch { /* handled below */ }
  holder.remove();
  if (!parts.length) { useStore.getState().toast("No shapes found in that SVG"); return; }
  // fit the whole drawing into the canvas (70% of it), keeping its proportions
  const X0 = Math.min(...parts.map((q) => q.bbox.x)), Y0 = Math.min(...parts.map((q) => q.bbox.y));
  const X1 = Math.max(...parts.map((q) => q.bbox.x + q.bbox.w)), Y1 = Math.max(...parts.map((q) => q.bbox.y + q.bbox.h));
  const { project, t, edit, select, toast } = useStore.getState();
  const k = Math.min((project.width * 0.7) / (X1 - X0), (project.height * 0.7) / (Y1 - Y0));
  const ox = project.width / 2 - ((X0 + X1) / 2) * k, oy = project.height / 2 - ((Y0 + Y1) / 2) * k;
  const start = Math.max(0, Math.min(t, project.duration)), end = start + 3, ids: string[] = [];
  edit((p) => {
    let { trackId } = placeItem(p, "video", start, end, undefined, () => uid("V"));
    parts.forEach((q, i) => {
      const spec: ShapeSpec = { type: "path", rings: q.rings.map((r) => r.map(([x, y]) => [Math.round(((x - q.bbox.x) / q.bbox.w) * 1e4) / 1e4, Math.round(((y - q.bbox.y) / q.bbox.h) * 1e4) / 1e4] as [number, number])) };
      if (i > 0) trackId = insertAbove(p, trackId);
      const id = uid("item"); ids.push(id);
      p.items.push({ id, name: `${file.name.replace(/\.svg$/i, "")} ${i + 1}`, kind: "shape", shape: spec, trackId, start, end, w: Math.round(q.bbox.w * k), h: Math.round(q.bbox.h * k), fill: q.fill, stroke: q.stroke ? { width: q.stroke.width * k, color: q.stroke.color } : undefined, tint: "--blue", keys: {},
        base: { x: Math.round(ox + (q.bbox.x + q.bbox.w / 2) * k), y: Math.round(oy + (q.bbox.y + q.bbox.h / 2) * k), z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 } } as Item);
    });
  });
  if (ids.length) { useStore.getState().selectMany(ids); }
  else select(null);
  toast(`${parts.length} shape${parts.length === 1 ? "" : "s"} imported · Ctrl+G groups them`);
}
/** A new track right above another (each SVG part gets its own, later parts in front). */
function insertAbove(p: Project, trackId: string): string {
  const i = p.tracks.findIndex((t) => t.id === trackId);
  let n = 1; while (p.tracks.some((t) => t.id === `V${n}`)) n++;
  const id = `V${n}`;
  p.tracks.splice(Math.max(0, i), 0, { id, name: `Track ${n}`, kind: "video", parent: p.tracks[i]?.parent });
  return id;
}
