import { useEffect, useRef } from "react";
import type { Background, Project, SceneEffect } from "@moshion/engine";
import { activeBackground, backgroundCSS, bgVideoTime } from "@moshion/engine";
import { useMediaURL } from "./media";
import { ExactFrame, useVideoSource } from "./videoview";
import { useStore } from "./store";

/** Deterministic pseudo-random in [0,1) from an integer seed, so every frame looks the same on replay and export. */
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function activeLooks(project: Project, t: number) {
  const on = (k: SceneEffect["kind"]) => project.effects.find((f) => f.kind === k && t >= f.start && t < f.end);
  return { camcorder: on("camcorder"), glitch: on("glitch"), film: on("film"), chroma: on("chroma") };
}

/** The animated background layer (bottom of the canvas). */
export function BackgroundLayer({ project, t }: { project: Project; t: number }) {
  const bg = activeBackground(project, t);
  if (!bg) return null;
  const css = backgroundCSS(bg, t);
  return (
    <>
      <div className="bglayer" style={{ background: css.background, filter: css.filter, inset: css.filter ? -80 : 0, clipPath: css.filter ? "inset(80px)" : undefined }} />
      {bg.kind === "video" && bg.src && <BgVideo bg={bg} t={t} />}
    </>
  );
}

/** A video background, kept in step with the playhead. */
function BgVideo({ bg, t }: { bg: Background; t: number }) {
  const url = useMediaURL(bg.src);
  const ref = useRef<HTMLVideoElement>(null);
  const playing = useStore((s) => s.playing);
  // paused or scrubbing: the video engine's exact frame (the element only catches up once the playhead rests)
  const src = useVideoSource(bg.src);
  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return;
    const want = bgVideoTime(bg, t, el.duration || bg.mediaDur);
    if (playing) { if (el.paused) el.play().catch(() => {}); if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want; return; }
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - want) <= 0.02) return;
    if (!src) { el.currentTime = want; return; }
    const id = setTimeout(() => { el.currentTime = want; }, 250);
    return () => clearTimeout(id);
  }, [t, playing, url, bg.start, bg.once, src]);
  if (!url) return null;
  return <>
    <video ref={ref} className="bgvideo" src={url} muted playsInline loop={!bg.once} preload="auto" />
    {src && <ExactFrame src={src} className="bgvideo" time={bgVideoTime(bg, t, src.dur || bg.mediaDur)} active={!playing} />}
  </>;
}

/** Filter + jitter applied to everything on the canvas by the active looks. */
export function looksTransform(project: Project, t: number): { filter?: string; transform?: string } {
  const L = activeLooks(project, t);
  const f: string[] = [];
  let tr: string | undefined;
  if (L.film) {
    const a = L.film.amount, flick = (rnd(Math.floor(t * 24)) - 0.5) * 0.08 * a;
    f.push(`sepia(${0.45 * a}) contrast(${1 + 0.12 * a}) brightness(${1 + flick})`);
  }
  if (L.chroma) {
    const o = Math.max(1, L.chroma.amount * 10);
    f.push(`drop-shadow(${o}px 0 0 rgba(255,0,60,.55)) drop-shadow(${-o}px 0 0 rgba(0,200,255,.55))`);
  }
  if (L.glitch) {
    const fr = Math.floor(t * 15);
    if (rnd(fr) < 0.35 + 0.4 * L.glitch.amount) {
      tr = `translate(${(rnd(fr + 7) - 0.5) * 40 * L.glitch.amount}px, ${(rnd(fr + 3) - 0.5) * 8}px)`;
      f.push(`hue-rotate(${(rnd(fr + 11) - 0.5) * 90 * L.glitch.amount}deg)`);
    }
  }
  if (L.camcorder) f.push(`saturate(${1 - 0.15 * L.camcorder.amount}) contrast(1.05)`);
  return { filter: f.length ? f.join(" ") : undefined, transform: tr };
}

/** Overlays drawn on top of the canvas in project pixels: camcorder HUD, glitch bars, film dust. */
export function LookOverlays({ project, t }: { project: Project; t: number }) {
  const L = activeLooks(project, t);
  const W = project.width, H = project.height, u = Math.min(W, H) / 1080;
  const out: React.ReactElement[] = [];
  if (L.camcorder) {
    const a = L.camcorder.amount, pad = 70 * u, fs = 44 * u;
    const tc = (() => { const f = Math.floor(t * 30) % 30, s = Math.floor(t) % 60, m = Math.floor(t / 60); return `00:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`; })();
    const corner = (x: number, y: number, rx: number, ry: number) => (
      <div key={`c${x}${y}`} style={{ position: "absolute", left: x, top: y, width: 90 * u, height: 90 * u, borderLeft: rx ? undefined : `${5 * u}px solid #fff`, borderRight: rx ? `${5 * u}px solid #fff` : undefined, borderTop: ry ? undefined : `${5 * u}px solid #fff`, borderBottom: ry ? `${5 * u}px solid #fff` : undefined }} />
    );
    out.push(
      <div key="cam" className="lookov" style={{ opacity: Math.min(1, a * 1.4), fontFamily: "var(--mono)", color: "#fff", textShadow: "0 0 6px rgba(0,0,0,.6)" }}>
        {corner(pad, pad, 0, 0)}{corner(W - pad - 90 * u, pad, 1, 0)}{corner(pad, H - pad - 90 * u, 0, 1)}{corner(W - pad - 90 * u, H - pad - 90 * u, 1, 1)}
        <div style={{ position: "absolute", left: pad + 40 * u, top: pad + 30 * u, fontSize: fs, fontWeight: 600, display: "flex", alignItems: "center", gap: 14 * u }}>
          <span style={{ width: 26 * u, height: 26 * u, borderRadius: "50%", background: "#ff2d2d", opacity: Math.floor(t * 2) % 2 ? 0.25 : 1 }} />REC
        </div>
        <div style={{ position: "absolute", right: pad + 40 * u, top: pad + 30 * u, fontSize: fs * 0.8 }}>▮▮▮▯</div>
        <div style={{ position: "absolute", left: pad + 40 * u, bottom: pad + 30 * u, fontSize: fs * 0.8 }}>SP ▶</div>
        <div style={{ position: "absolute", right: pad + 40 * u, bottom: pad + 30 * u, fontSize: fs }}>{tc}</div>
      </div>,
    );
  }
  if (L.glitch) {
    const fr = Math.floor(t * 15), a = L.glitch.amount;
    if (rnd(fr + 5) < 0.3 + 0.5 * a) {
      const bars = Array.from({ length: 2 + Math.floor(rnd(fr + 9) * 4 * a) }, (_, i) => (
        <div key={i} style={{
          position: "absolute", left: 0, right: 0, top: `${rnd(fr * 3 + i) * 100}%`, height: `${1 + rnd(fr * 5 + i) * 6 * a}%`,
          background: ["rgba(255,0,80,.55)", "rgba(0,220,255,.55)", "rgba(255,255,255,.5)"][i % 3], mixBlendMode: "difference",
          transform: `translateX(${(rnd(fr + i * 13) - 0.5) * 30}%)`,
        }} />
      ));
      out.push(<div key="gl" className="lookov">{bars}</div>);
    }
  }
  if (L.film) {
    const fr = Math.floor(t * 24), a = L.film.amount;
    const specks = Array.from({ length: Math.round(6 * a) + 2 }, (_, i) => (
      <i key={i} style={{ position: "absolute", left: `${rnd(fr * 7 + i) * 100}%`, top: `${rnd(fr * 11 + i) * 100}%`, width: (2 + rnd(fr + i) * 6) * u, height: (2 + rnd(fr * 2 + i) * 6) * u, borderRadius: "50%", background: "rgba(20,15,10,.6)" }} />
    ));
    const scratch = rnd(fr + 1) < 0.4 * a ? <i style={{ position: "absolute", top: 0, bottom: 0, left: `${rnd(fr + 4) * 100}%`, width: 2 * u, background: "rgba(255,255,255,.35)" }} /> : null;
    out.push(<div key="film" className="lookov" style={{ background: `radial-gradient(ellipse at center, transparent 55%, rgba(40,25,10,${0.45 * a}) 100%)` }}>{specks}{scratch}</div>);
  }
  return <>{out}</>;
}
