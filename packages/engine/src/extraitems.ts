import type { Item, Seconds } from "./types";

/*
 * Charts and particles: items drawn from numbers, the same way in the editor and the export.
 * Both are pure functions of time, so playback and export always match.
 */

/* ---------------- charts ---------------- */
export interface ChartSpec { type: "bar" | "line" | "pie"; labels: string[]; values: number[]; colors?: string[]; grow?: boolean; labelColor?: string }
const PALETTE = ["#3A5BFF", "#E0571A", "#1F9D63", "#F4C400", "#7B4DFF", "#D9338A", "#13B5C9", "#8A8A8A"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const f = (n: number) => Math.round(n * 10) / 10;

/** How far a chart has grown in (0..1): over its first second if it grows in. */
export function chartProgress(item: Item, local: Seconds): number {
  if (!item.chart?.grow) return 1;
  const p = Math.min(1, Math.max(0, local / 1));
  return 1 - Math.pow(1 - p, 3);
}

/** The chart as SVG markup in a w×h box. */
export function chartSVG(c: ChartSpec, w: number, h: number, p: number, font = "Inter, sans-serif"): string {
  const vals = c.values.map((v) => (isFinite(v) ? v : 0)), n = Math.max(1, vals.length), max = Math.max(1e-9, ...vals.map(Math.abs));
  const col = (i: number) => c.colors?.[i] ?? PALETTE[i % PALETTE.length], ink = c.labelColor ?? "#555";
  const fs = Math.max(10, Math.min(w, h) * 0.06);
  let body = "";
  if (c.type === "pie") {
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1, cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.42;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2 * p;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      if (a1 - a0 > 1e-4) body += `<path d="M${f(cx)} ${f(cy)}L${f(cx + r * Math.cos(a0))} ${f(cy + r * Math.sin(a0))}A${f(r)} ${f(r)} 0 ${large} 1 ${f(cx + r * Math.cos(a1))} ${f(cy + r * Math.sin(a1))}Z" fill="${col(i)}"/>`;
      a0 = a1;
    });
  } else {
    const padB = fs * 2, padT = fs * 0.6, ch = h - padB - padT, base = padT + ch;
    if (c.type === "bar") {
      const slot = w / n, bw = slot * 0.62;
      vals.forEach((v, i) => {
        const bh = (Math.abs(v) / max) * ch * p;
        body += `<rect x="${f(i * slot + (slot - bw) / 2)}" y="${f(base - bh)}" width="${f(bw)}" height="${f(bh)}" rx="${f(bw * 0.08)}" fill="${col(i)}"/>`;
      });
    } else {
      const pts = vals.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * (w - fs * 2) + fs, base - (v / max) * ch] as const);
      const L = pts.length - 1, upto = p * L, shown: string[] = [];
      pts.forEach(([x, y], i) => { if (i <= upto) shown.push(`${f(x)} ${f(y)}`); });
      const k = Math.floor(upto);
      if (k < L) { const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], u = upto - k; shown.push(`${f(x0 + (x1 - x0) * u)} ${f(y0 + (y1 - y0) * u)}`); }
      body += `<polyline points="${shown.join(" ")}" fill="none" stroke="${col(0)}" stroke-width="${f(Math.max(3, h * 0.012))}" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach(([x, y], i) => { if (i <= upto + 1e-6) body += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(Math.max(4, h * 0.015))}" fill="${col(0)}"/>`; });
    }
    body += `<line x1="0" x2="${f(w)}" y1="${f(base)}" y2="${f(base)}" stroke="${ink}" stroke-opacity=".35" stroke-width="2"/>`;
    const slot = w / n;
    c.labels.slice(0, n).forEach((l, i) => {
      const x = c.type === "bar" ? i * slot + slot / 2 : n === 1 ? w / 2 : (i / (n - 1)) * (w - fs * 2) + fs;
      body += `<text x="${f(x)}" y="${f(base + fs * 1.3)}" font-size="${f(fs)}" text-anchor="middle" fill="${ink}" font-family="${esc(font)}">${esc(l)}</text>`;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}">${body}</svg>`;
}

/* ---------------- particles ---------------- */
export interface ParticleSpec { kind: "confetti" | "sparks" | "snow" | "dust"; count: number; speed: number; size: number; gravity: number; colors: string[] }
export const PARTICLE_DEFAULTS: Record<ParticleSpec["kind"], ParticleSpec> = {
  confetti: { kind: "confetti", count: 120, speed: 1, size: 1, gravity: 1, colors: ["#E0571A", "#F4C400", "#3A5BFF", "#1F9D63", "#D9338A"] },
  sparks: { kind: "sparks", count: 80, speed: 1.2, size: 0.6, gravity: 0.4, colors: ["#FFD27A", "#FFFFFF", "#FF9A3C"] },
  snow: { kind: "snow", count: 140, speed: 0.5, size: 0.8, gravity: 0.2, colors: ["#FFFFFF"] },
  dust: { kind: "dust", count: 90, speed: 0.25, size: 0.5, gravity: 0, colors: ["#FFFFFF", "#FFE9C2"] },
};
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export interface Particle { x: number; y: number; r: number; rot: number; color: string; alpha: number; shape: "rect" | "dot" | "line"; len: number }
/** Every particle at local time t, in the item's w×h box. Bursts start at the centre; snow and dust drift across. */
export function particlesAt(spec: ParticleSpec, w: number, h: number, t: Seconds, life: Seconds): Particle[] {
  const out: Particle[] = [], n = Math.max(1, Math.min(600, Math.round(spec.count))), S = Math.min(w, h);
  for (let i = 0; i < n; i++) {
    const r1 = rnd(i * 4 + 1), r2 = rnd(i * 4 + 2), r3 = rnd(i * 4 + 3), r4 = rnd(i * 4 + 4), color = spec.colors[i % spec.colors.length] ?? "#fff";
    if (spec.kind === "confetti" || spec.kind === "sparks") {
      const born = r4 * 0.15, a = t - born;
      if (a < 0) continue;
      const ang = r1 * Math.PI * 2, v = (0.35 + r2 * 0.65) * S * 1.1 * spec.speed, g = S * 1.4 * spec.gravity;
      const x = w / 2 + Math.cos(ang) * v * a * (spec.kind === "confetti" ? 1 : 1.2);
      const y = h / 2 + Math.sin(ang) * v * a * 0.9 + 0.5 * g * a * a - (spec.kind === "confetti" ? S * 0.35 * a : 0);
      const fade = spec.kind === "sparks" ? Math.max(0, 1 - a / (0.6 + r3 * 0.8)) : Math.max(0, Math.min(1, (life - t) / 0.6));
      if (fade <= 0) continue;
      out.push({ x, y, r: (spec.kind === "confetti" ? 10 + r3 * 10 : 3 + r3 * 4) * spec.size * (S / 1080) * 2, rot: (r3 * 360 + a * 540 * (r1 - 0.5)) % 360, color, alpha: fade, shape: spec.kind === "confetti" ? "rect" : "line", len: Math.min(60, v * 0.06) });
    } else {
      // snow falls (and loops); dust floats
      const fall = spec.kind === "snow" ? (0.05 + r2 * 0.12) * h * spec.speed * (1 + spec.gravity) : 0;
      const drift = Math.sin(t * (0.5 + r3) + r1 * 6) * S * 0.03 * (spec.kind === "dust" ? 1.5 : 1);
      const x = ((r1 * w + drift + (spec.kind === "dust" ? t * S * 0.02 * spec.speed * (r2 - 0.5) : 0)) % w + w) % w;
      const y = spec.kind === "snow" ? ((r2 * h + fall * t) % (h + 40)) - 20 : ((r2 * h + Math.cos(t * (0.4 + r2) + r4 * 6) * S * 0.04) % h + h) % h;
      const tw = spec.kind === "dust" ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1 + r4 * 2) + r1 * 9)) : 0.85;
      out.push({ x, y, r: (spec.kind === "snow" ? 4 + r3 * 7 : 2 + r3 * 3) * spec.size * (S / 1080) * 2, rot: 0, color, alpha: tw, shape: "dot", len: 0 });
    }
  }
  return out;
}
