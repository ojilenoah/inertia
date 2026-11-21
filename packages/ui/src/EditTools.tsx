import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Item, Project, Prop, SceneEffectKind, Track } from "@moshion/engine";
import {
  NO_LOOK, SCENE_EFFECTS, addKey, keyAt, addTrack, groupOf, ownValue, sampleKeys, setValue, uid, ungroupTrack,
} from "@moshion/engine";
import { useStore } from "./store";
import { pickImageFile } from "./persist";
import { Icon, iconPath } from "./Icon";
import { scrub as scrubNum } from "./scrub";
import { maskFollowers } from "./extras";

/* ============================================================================
 * The gimbal: right-click anything. The inner ring picks a kind of edit; the
 * outer ring opens around it with the controls themselves. Press and drag a
 * value cell left/right to scrub it live. No window unless typing is needed.
 * ========================================================================== */

type Sub =
  | { kind: "scrub"; id: string; label: string; step: number; get: () => number; set: (v: number) => void; fmt: (v: number) => string }
  | { kind: "toggle"; id: string; label: string; on: boolean; run: () => void }
  | { kind: "action"; id: string; label: string; run: () => void; close?: boolean }
  | { kind: "swatch"; id: string; label: string; color: string; on: boolean; run: () => void };
type Seg = { id: string; label: string; icon: string; subs: Sub[]; off?: boolean };

const DEF: Record<Prop, number> = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 };
const px = (v: number) => `${Math.round(v)}`;
const deg = (v: number) => `${Math.round(v)}°`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const st = () => useStore.getState();

/** get/set an animatable property of an item (auto-keyed) or of a group track (group keys). */
/**
 * Like prop, for drags and handles. With keyframes picked on the item, each change goes into every picked
 * keyframe by the same amount (keeping their differences) instead of making a keyframe at the playhead.
 * Make one per drag: it remembers the value it last set.
 */
export function pickedProp(itemId: string | null, trackId: string | undefined, p: Prop) {
  const base = prop(itemId, trackId, p);
  let cur = base.get();
  return {
    get: base.get,
    set: (v: number) => {
      const s = st(), it = itemId ? s.project.items.find((i) => i.id === itemId) : undefined;
      const times = it ? s.ui.keySel?.find((q) => q.itemId === it.id)?.times ?? [] : [];
      if (!it || !times.length) { cur = v; base.set(v); return; }
      const d = v - cur; cur = v;
      if (!d) return;
      const t0 = s.t;
      for (const lt of times) { useStore.setState({ t: it.start + lt }); base.set(base.get() + d); }
      useStore.setState({ t: t0 });
    },
  };
}

export function prop(itemId: string | null, trackId: string | undefined, p: Prop) {
  return {
    get: () => {
      const { project, t } = st();
      const it = itemId ? project.items.find((i) => i.id === itemId) : undefined;
      if (it) return ownValue(it, p, t);
      const g = project.tracks.find((x) => x.id === trackId);
      return sampleKeys(g?.keys?.[p], t, g?.base?.[p] ?? DEF[p]);
    },
    set: (v: number) => st().edit((d) => {
      const t = st().t;
      const it = itemId ? d.items.find((i) => i.id === itemId) : undefined;
      if (it) {
        // moving a mask: what it masks moves the same amount
        if (p === "x" || p === "y") {
          const dv = v - ownValue(it, p, t);
          for (const fid of maskFollowers(st().project, [it.id])) { const f = d.items.find((i) => i.id === fid); if (f) setValue(f, p, t, ownValue(f, p, t) + dv); }
        }
        setValue(it, p, t, v); return;
      }
      const g = d.tracks.find((x) => x.id === trackId)!;
      // same rule as items: no keyframes yet → the change applies to the whole group
      const times = [...new Set(Object.values(g.keys ?? {}).flatMap((ks) => ks?.map((k) => Math.round(k.t * 1e4) / 1e4) ?? []))].sort((a, b) => a - b);
      if (!times.length) { (g.base ??= {})[p] = v; return; }
      const at = keyAt(times, t) ?? t;
      const keys = (g.keys ??= {});
      if (!keys[p]?.length) { const old = g.base?.[p] ?? DEF[p]; keys[p] = times.filter((k) => Math.abs(k - at) > 1e-4).map((k) => ({ t: k, v: old, ease: "ease" as const })); }
      const ks = keys[p]!;
      const hit = ks.find((k) => Math.abs(k.t - at) < 1e-4);
      if (hit) hit.v = v; else { ks.push({ t: at, v, ease: "ease" }); ks.sort((a, b) => a.t - b.t); }
    }, false),
  };
}

/** get/set a plain (not animated) field of an item. */
function field(itemId: string, read: (it: Item) => number, write: (it: Item, v: number) => void) {
  return {
    get: () => read(st().project.items.find((i) => i.id === itemId)!),
    set: (v: number) => st().edit((d) => write(d.items.find((i) => i.id === itemId)!, v), false),
  };
}

const scrub = (id: string, label: string, step: number, acc: { get: () => number; set: (v: number) => void }, fmt: (v: number) => string): Sub =>
  ({ kind: "scrub", id, label, step, fmt, ...acc });

function pickImage(onUrl: (url: string, name: string) => void) {
  pickImageFile().then((f) => f && onUrl(f.url, f.name));
}

const SWATCHES = ["#111111", "#FFFFFF", "#E0571A", "#3A5BFF", "#7B4DFF", "#1F9D63"];

function itemSegs(project: Project, it: Item): Seg[] {
  const id = it.id, P = (p: Prop) => prop(id, undefined, p);
  const { edit, setUI, select, toast } = st();
  const group = groupOf(project, it);
  const hasText = it.kind === "text" || !!it.text;
  const look = (k: keyof typeof NO_LOOK, label: string, step: number, max: number) =>
    scrub("look-" + k, label, step, field(id, (x) => x.look?.[k] ?? 0, (x, v) => { x.look = { ...NO_LOOK, ...x.look, [k]: Math.min(Math.max(0, v), max) }; }), px);
  const segs: Seg[] = [
    { id: "move", label: "Move", icon: "move", subs: [
      scrub("x", "X", 2, P("x"), px), scrub("y", "Y", 2, P("y"), px), scrub("z", "Z", 2, P("z"), px),
      { kind: "action", id: "center", label: "Center", run: () => { P("x").set(project.width / 2); P("y").set(project.height / 2); } },
    ] },
    { id: "rotate", label: "Rotate · 3D", icon: "cube", subs: [
      scrub("rx", "X", 0.5, P("rx"), deg), scrub("ry", "Y", 0.5, P("ry"), deg), scrub("rz", "Z", 0.5, P("rz"), deg),
      { kind: "action", id: "rreset", label: "Reset", run: () => { P("rx").set(0); P("ry").set(0); P("rz").set(0); } },
    ] },
    { id: "scale", label: "Scale & size", icon: "rect", subs: [
      scrub("scale", "Scale", 0.005, P("scale"), pct),
      ...(it.kind === "text" ? [] : [
        scrub("w", "W", 2, field(id, (x) => x.w, (x, v) => { x.w = Math.max(4, Math.round(v)); }), px),
        scrub("h", "H", 2, field(id, (x) => x.h, (x, v) => { x.h = Math.max(4, Math.round(v)); }), px),
      ]),
      ...(it.kind === "rect" || it.kind === "image" ? [scrub("radius", "Round", 1, field(id, (x) => Math.min(x.radius ?? 0, Math.min(x.w, x.h) / 2), (x, v) => { x.radius = Math.max(0, Math.round(v)); }), px)] : []),
    ] },
    { id: "opacity", label: "Opacity & blend", icon: "drop", subs: [
      scrub("opacity", "Opac", 0.005, { get: P("opacity").get, set: (v) => P("opacity").set(Math.min(Math.max(v, 0), 1)) }, pct),
      ...(["normal", "screen", "multiply", "overlay"] as const).map((b): Sub => ({
        kind: "toggle", id: "blend-" + b, label: b === "multiply" ? "Mult" : b === "overlay" ? "Over" : b[0].toUpperCase() + b.slice(1, 4),
        on: (it.blend ?? "normal") === b, run: () => edit((d) => { d.items.find((x) => x.id === id)!.blend = b; }),
      })),
    ] },
  ];
  if (hasText) segs.push({ id: "text", label: "Text", icon: "type", subs: [
    { kind: "action", id: "edit", label: "Edit", close: true, run: () => { select(id); setUI({ editingText: it.kind === "text" ? id : null }); if (it.kind !== "text") toast("Double-click text items to type into them"); } },
    scrub("fs", "Size", 0.5, field(id, (x) => x.fontSize ?? 100, (x, v) => {
      const fs0 = x.fontSize ?? 100, fs = Math.max(6, Math.round(v));
      if (x.kind === "text") { x.w = Math.round(x.w * fs / fs0); x.h = Math.round(x.h * fs / fs0); }
      x.fontSize = fs;
    }), px),
    { kind: "action", id: "weight", label: `W ${it.fontWeight ?? 800}`, run: () => edit((d) => { const x = d.items.find((q) => q.id === id)!; const ws = [400, 600, 800]; x.fontWeight = ws[(ws.indexOf(x.fontWeight ?? 800) + 1) % 3]; }) },
    scrub("ls", "Space", 0.002, field(id, (x) => x.letterSpacing ?? -0.04, (x, v) => { x.letterSpacing = Math.min(Math.max(v, -0.2), 0.5); }), (v) => v.toFixed(2)),
    ...["#111111", "#FFFFFF", "#E0571A"].map((c): Sub => ({ kind: "swatch", id: "tc" + c, label: c, color: c, on: (it.color ?? "").toLowerCase() === c.toLowerCase(), run: () => edit((d) => { d.items.find((x) => x.id === id)!.color = c; }) })),
  ] });
  if (it.kind !== "glass" && it.kind !== "text") segs.push({ id: "fill", label: "Fill · frame", icon: "frame", subs: [
    ...SWATCHES.slice(0, 5).map((c): Sub => ({ kind: "swatch", id: "f" + c, label: c, color: c, on: it.fill.toLowerCase() === c.toLowerCase(), run: () => edit((d) => { d.items.find((x) => x.id === id)!.fill = c; }) })),
    { kind: "action", id: "img", label: "Image", close: true, run: () => pickImage((url, name) => { edit((d) => { d.items.find((x) => x.id === id)!.fill = `url("${url}")`; }); toast(`${name} placed inside ${it.name}`); }) },
  ] });
  segs.push({ id: "effects", label: "Effects", icon: "sparkle", subs: it.kind === "glass" ? [
    scrub("gblur", "Blur", 0.05, field(id, (x) => x.effect?.blur ?? 1.5, (x, v) => { x.effect = { kind: "liquid-glass", magnify: x.effect?.magnify ?? 1.35, blur: Math.min(Math.max(v, 0), 20) }; }), (v) => v.toFixed(1)),
    look("shadow", "Shadow", 0.2, 80),
  ] : [
    look("extrude", "Depth", 0.2, 60), look("shadow", "Shadow", 0.2, 80), look("blur", "Blur", 0.05, 40), look("glow", "Glow", 0.2, 80),
  ] });
  segs.push({ id: "keys", label: "Keyframes", icon: "diamond", subs: [
    { kind: "toggle", id: "graph", label: "Graph", on: st().ui.graph, run: () => { select(id); setUI({ graph: !st().ui.graph }); } },
    { kind: "action", id: "keyall", label: "Key all", run: () => { edit((d) => { const x = d.items.find((q) => q.id === id)!; (["x", "y", "rz", "scale", "opacity"] as Prop[]).forEach((p) => addKey(x, p, st().t - x.start)); }); toast("Keys set at the playhead"); } },
    { kind: "action", id: "clear", label: "Clear", run: () => { edit((d) => { const x = d.items.find((q) => q.id === id)!; for (const p of Object.keys(x.keys) as Prop[]) { x.base[p] = ownValue(x, p, st().t); delete x.keys[p]; } }); toast("Keyframes cleared"); } },
  ] });
  segs.push({ id: "group", label: "Group", icon: "group", off: !group, subs: group ? [
    { kind: "action", id: "leave", label: "Leave", run: () => edit((d) => { const tid = addTrack(d, "video"); d.items.find((x) => x.id === id)!.trackId = tid; }) },
    { kind: "action", id: "ungroup", label: "Ungrp", run: () => edit((d) => ungroupTrack(d, group.id)) },
  ] : [] });
  segs.push({ id: "delete", label: "Delete", icon: "trash", subs: [
    { kind: "action", id: "del", label: "Delete", close: true, run: () => { edit((d) => { d.items = d.items.filter((x) => x.id !== id); }); select(null); toast(`${it.name} deleted · Ctrl+Z brings it back`); } },
    { kind: "action", id: "dup", label: "Copy", close: true, run: () => { let nid = ""; edit((d) => { const src = d.items.find((x) => x.id === id)!; const c = JSON.parse(JSON.stringify(src)); c.id = nid = uid("item"); c.name = src.name + " copy"; c.base.x += 40; c.base.y += 40; d.items.push(c); }); select(nid); toast("Duplicated"); } },
  ] });
  segs.push({ id: "exact", label: "Exact values", icon: "plus", subs: [
    { kind: "action", id: "exact", label: "Type", close: true, run: () => {} },
  ] });
  return segs;
}

function groupSegs(g: Track): Seg[] {
  const P = (p: Prop) => prop(null, g.id, p);
  return [
    { id: "move", label: "Move group", icon: "move", subs: [scrub("x", "X", 2, P("x"), px), scrub("y", "Y", 2, P("y"), px), scrub("z", "Z", 2, P("z"), px)] },
    { id: "rotate", label: "Rotate group", icon: "cube", subs: [scrub("rx", "X", 0.5, P("rx"), deg), scrub("ry", "Y", 0.5, P("ry"), deg), scrub("rz", "Z", 0.5, P("rz"), deg)] },
    { id: "scale", label: "Scale group", icon: "rect", subs: [scrub("scale", "Scale", 0.005, P("scale"), pct)] },
    { id: "opacity", label: "Fade group", icon: "drop", subs: [scrub("opacity", "Opac", 0.005, P("opacity"), pct)] },
    { id: "ungroup", label: "Ungroup", icon: "group", subs: [{ kind: "action", id: "ug", label: "Ungrp", close: true, run: () => st().edit((d) => ungroupTrack(d, g.id)) }] },
  ];
}

function sceneSegs(project: Project): Seg[] {
  const { edit } = st();
  const icons: Record<SceneEffectKind, string> = { grain: "sparkle", vhs: "grid", vignette: "ellipse", lensBlur: "drop", camcorder: "image", glitch: "scissors", film: "frame", chroma: "sparkle" };
  const segs: Seg[] = (Object.keys(SCENE_EFFECTS) as SceneEffectKind[]).map((k) => {
    const f = project.effects.find((e) => e.kind === k);
    return {
      id: k, label: SCENE_EFFECTS[k], icon: icons[k],
      subs: [
        { kind: "toggle", id: k + "on", label: f ? "On" : "Off", on: !!f, run: () => edit((d) => {
          const cur = d.effects.find((e) => e.kind === k);
          if (cur) d.effects = d.effects.filter((e) => e !== cur);
          else d.effects.push({ id: uid("fx"), kind: k, start: 0, end: d.duration, amount: k === "grain" ? 0.22 : 0.6 });
        }) },
        ...(f ? [scrub(k + "amt", "Amt", 0.004, {
          get: () => st().project.effects.find((e) => e.kind === k)?.amount ?? 0,
          set: (v: number) => edit((d) => { const e = d.effects.find((x) => x.kind === k); if (e) e.amount = Math.min(Math.max(v, 0), 1); }, false),
        }, pct)] : []),
      ],
    };
  });
  segs.push({ id: "bg", label: "Background", icon: "frame", subs: ["#EDEAE3", "#111111", "#FFFFFF", "#F4C400", "#3A5BFF"].map((c): Sub => ({
    kind: "swatch", id: "bg" + c, label: c, color: c, on: project.background === c, run: () => edit((d) => { d.background = c; }),
  })) });
  return segs;
}

/* ---------------- geometry ---------------- */
const R0 = 30, R1 = 76, O0 = 81, O1 = 124, CELL = 0.5;
function arc(a0: number, a1: number, r0: number, r1: number) {
  const P = (a: number, r: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${P(a0, r1)} A ${r1} ${r1} 0 ${big} 1 ${P(a1, r1)} L ${P(a1, r0)} A ${r0} ${r0} 0 ${big} 0 ${P(a0, r0)} Z`;
}
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

export function Wheel() {
  const wheel = useStore((s) => s.ui.wheel);
  const project = useStore((s) => s.project);
  useStore((s) => s.t);
  useStore((s) => s.ui.graph);
  const { setUI } = useStore.getState();
  const [active, setActive] = useState(-1);
  const [hot, setHot] = useState<{ ring: "in" | "out"; i: number } | null>(null);
  const [scrubbing, setScrubbing] = useState<string | null>(null);
  const holding = useRef(true);

  const item = wheel?.itemId ? project.items.find((i) => i.id === wheel.itemId) : undefined;
  const group = wheel?.trackId ? project.tracks.find((t) => t.id === wheel.trackId) : undefined;
  const segs: Seg[] = !wheel ? [] : wheel.scene ? sceneSegs(project) : item ? itemSegs(project, item) : group ? groupSegs(group) : [];
  const n = segs.length, step = (2 * Math.PI) / Math.max(n, 1);
  const pos = wheel ? { x: Math.min(Math.max(wheel.x, 140), innerWidth - 140), y: Math.min(Math.max(wheel.y, 140), innerHeight - 140) } : { x: 0, y: 0 };
  const subs = active >= 0 ? segs[active]?.subs ?? [] : [];
  const cellAng = (i: number) => active * step + (i - (subs.length - 1) / 2) * CELL;

  // latest values for the window listeners
  const live = useRef({ segs, subs, active, pos, n, step });
  live.current = { segs, subs, active, pos, n, step };

  function hit(e: { clientX: number; clientY: number }) {
    const { pos, n, step, active, subs, segs } = live.current;
    const dx = e.clientX - pos.x, dy = e.clientY - pos.y, d = Math.hypot(dx, dy);
    let a = Math.atan2(dx, -dy); if (a < 0) a += 2 * Math.PI;
    if (d >= R0 && d < O0 - 2) { const i = Math.round(a / step) % n; return segs[i]?.off ? null : { ring: "in" as const, i }; }
    if (d >= O0 - 2 && d <= O1 + 6 && active >= 0) {
      for (let i = 0; i < subs.length; i++) if (Math.abs(angDiff(a, active * step + (i - (subs.length - 1) / 2) * CELL)) < CELL / 2) return { ring: "out" as const, i };
    }
    return null;
  }

  function run(s: Sub) {
    if (s.kind === "scrub") return;
    if (s.id === "exact" && wheel) { setUI({ wheel: null, modal: { section: "exact", itemId: wheel.itemId, trackId: wheel.trackId, x: wheel.x, y: wheel.y } }); return; }
    s.run();
    if (s.kind === "action" && s.close) setUI({ wheel: null });
  }

  useEffect(() => {
    if (!wheel) return;
    holding.current = true;
    setActive(-1); setHot(null); setScrubbing(null);
    const mv = (e: PointerEvent) => {
      const h = hit(e);
      setHot(h);
      if (h?.ring === "in") setActive(h.i);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const h = hit(e);
      const { pos, subs } = live.current;
      if (!h) {
        if (Math.hypot(e.clientX - pos.x, e.clientY - pos.y) > O1 + 8) setUI({ wheel: null }); // click off: close, and let the click through
        else { e.stopPropagation(); e.preventDefault(); }
        return;
      }
      e.stopPropagation(); e.preventDefault();
      if (h.ring === "in") { setActive(h.i); return; }
      const s = subs[h.i];
      if (s.kind !== "scrub") { run(s); return; }
      // press and drag left/right to scrub the value live
      const x0 = e.clientX, v0 = s.get();
      st().checkpoint();
      setScrubbing(s.id);
      const smv = (ev: PointerEvent) => { ev.stopPropagation(); s.set(v0 + (ev.clientX - x0) * s.step * (ev.shiftKey ? 0.2 : 1)); };
      const sup = () => { removeEventListener("pointermove", smv, true); removeEventListener("pointerup", sup, true); setScrubbing(null); };
      addEventListener("pointermove", smv, true); addEventListener("pointerup", sup, true);
    };
    const up = (e: PointerEvent) => {
      if (e.button !== 2 || !holding.current) return;
      holding.current = false;
      const h = hit(e);
      if (h?.ring === "out") run(live.current.subs[h.i]);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setUI({ wheel: null }); return; }
      const k = +e.key;
      if (k >= 1 && k <= live.current.n && !live.current.segs[k - 1].off) setActive(k - 1);
    };
    addEventListener("pointermove", mv); addEventListener("pointerdown", down, true); addEventListener("pointerup", up); addEventListener("keydown", key, true);
    return () => { removeEventListener("pointermove", mv); removeEventListener("pointerdown", down, true); removeEventListener("pointerup", up); removeEventListener("keydown", key, true); };
  }, [wheel?.x, wheel?.y, wheel?.itemId, wheel?.trackId, wheel?.scene]);

  const name = wheel?.scene ? "Canvas" : item?.name ?? group?.name ?? "";
  const scrubSub = subs.find((s) => s.id === scrubbing) as Extract<Sub, { kind: "scrub" }> | undefined;
  const hotSub = hot?.ring === "out" ? subs[hot.i] : undefined;
  const centerLine = scrubSub ? `${scrubSub.label} ${scrubSub.fmt(scrubSub.get())}`
    : hotSub?.kind === "scrub" ? `${hotSub.label} ${hotSub.fmt(hotSub.get())} · drag ↔`
    : hotSub ? (hotSub.kind === "swatch" ? hotSub.color : hotSub.label)
    : hot?.ring === "in" ? segs[hot.i]?.label : active >= 0 ? segs[active]?.label : "right-click edit";

  return (
    <AnimatePresence>
      {wheel && (
        <motion.div
          key={`${wheel.x},${wheel.y},${wheel.itemId ?? wheel.trackId ?? "scene"}`}
          className="wheel" style={{ left: pos.x, top: pos.y }}
          initial={{ scale: 0.55, opacity: 0, rotate: -25 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.7, opacity: 0, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 520, damping: 30 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg width={264} height={264} viewBox="-132 -132 264 264">
            {segs.map((s, i) => {
              const am = i * step, r = (R0 + R1) / 2;
              const cls = "wseg" + (active === i ? " act" : "") + (hot?.ring === "in" && hot.i === i ? " hot" : "") + (s.off ? " off" : "");
              return (
                <g key={s.id} className={cls}>
                  <path className="bg" d={arc(am - step / 2 + 0.025, am + step / 2 - 0.025, R0, R1)} />
                  <g transform={`translate(${Math.sin(am) * r - 8} ${-Math.cos(am) * r - 8}) scale(${16 / 24})`}><path className="ic" d={iconPath(s.icon)} /></g>
                </g>
              );
            })}
            <AnimatePresence mode="popLayout">
              {active >= 0 && (
                <motion.g key={segs[active]?.id} initial={{ opacity: 0, rotate: -8 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.16 }}>
                  {subs.map((s, i) => {
                    const am = cellAng(i), r = (O0 + O1) / 2;
                    const tx = Math.sin(am) * r, ty = -Math.cos(am) * r;
                    const on = (s.kind === "toggle" || s.kind === "swatch") && s.on;
                    const cls = "wsub" + (hot?.ring === "out" && hot.i === i ? " hot" : "") + (on ? " on" : "") + (scrubbing === s.id ? " live" : "") + (s.kind === "scrub" ? " scrub" : "");
                    return (
                      <g key={s.id} className={cls}>
                        <path className="bg" d={arc(am - CELL / 2 + 0.02, am + CELL / 2 - 0.02, O0, O1)} />
                        {s.kind === "swatch"
                          ? <circle cx={tx} cy={ty} r={8} fill={s.color} stroke={on ? "var(--ink)" : "rgba(128,128,128,.5)"} strokeWidth={on ? 2.5 : 1} />
                          : <>
                            <text x={tx} y={s.kind === "scrub" ? ty - 1 : ty + 3.5} textAnchor="middle" className="wlab">{s.label}</text>
                            {s.kind === "scrub" && <text x={tx} y={ty + 10} textAnchor="middle" className="wval">{s.fmt(s.get())}</text>}
                          </>}
                      </g>
                    );
                  })}
                </motion.g>
              )}
            </AnimatePresence>
          </svg>
          <div className="wcenter"><b>{name}</b><span>{centerLine}</span></div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- number field: drag the letter to scrub, or type ---------------- */
function NumField({ label, value, step, onChange, onStart, fmt, fromText }: {
  label: string; value: number; step: number; onChange: (v: number) => void; onStart: () => void; fmt?: (v: number) => string; fromText?: (n: number) => number;
}) {
  const [text, setText] = useState<string | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  return (
    <label className="num" onPointerDown={(e) => scrubNum(e, { value, step, onStart, onChange, onClick: () => inp.current?.focus() })}>
      <em>{label}</em>
      <input ref={inp}
        value={text ?? (fmt ? fmt(value) : String(Math.round(value * 100) / 100))}
        onFocus={(e) => { setText(e.target.value); e.target.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text != null && text.trim() !== "" && !isNaN(parseFloat(text))) { onStart(); onChange(fromText ? fromText(parseFloat(text)) : parseFloat(text)); } setText(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

/* ---------------- the one window: typing exact values ---------------- */
export function EditModal() {
  const modal = useStore((s) => s.ui.modal);
  const project = useStore((s) => s.project);
  useStore((s) => s.t);
  const { checkpoint, setUI } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => { setDrag(null); }, [modal?.x, modal?.y]);
  useEffect(() => {
    if (!modal) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setUI({ modal: null }); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setUI({ modal: null }); };
    const id = setTimeout(() => addEventListener("pointerdown", off, true), 0);
    addEventListener("keydown", esc);
    return () => { clearTimeout(id); removeEventListener("pointerdown", off, true); removeEventListener("keydown", esc); };
  }, [modal]);

  const item = modal?.itemId ? project.items.find((i) => i.id === modal.itemId) : undefined;
  const group = modal?.trackId ? project.tracks.find((t) => t.id === modal.trackId) : undefined;
  const P = (p: Prop) => prop(modal?.itemId ?? null, modal?.trackId, p);
  const row = (label: string, ps: [Prop, string][], step: number, fmt?: (v: number) => string, fromText?: (n: number) => number) => (
    <div className="row" key={label}>
      <span>{label}</span>
      <div className={ps.length > 1 ? "f3" : ""}>
        {ps.map(([p, l]) => <NumField key={p} label={l} value={P(p).get()} step={step} fmt={fmt} fromText={fromText} onStart={checkpoint} onChange={(v) => P(p).set(v)} />)}
      </div>
      <span />
    </div>
  );
  const x = drag?.x ?? (modal ? Math.min(modal.x + 24, innerWidth - 310) : 0);
  const y = drag?.y ?? (modal ? Math.min(Math.max(8, modal.y - 60), innerHeight - 300) : 0);

  return (
    <AnimatePresence>
      {modal && (item || group) && (
        <motion.div
          ref={ref} className="pop" role="dialog" aria-label="Exact values" style={{ left: x, top: y }}
          initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 480, damping: 34 }}
        >
          <div className="pophead" onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            const sx = e.clientX - x, sy = e.clientY - y;
            const mv = (ev: PointerEvent) => setDrag({ x: ev.clientX - sx, y: ev.clientY - sy });
            const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
            addEventListener("pointermove", mv); addEventListener("pointerup", up);
          }}>
            <div style={{ flex: 1, minWidth: 0 }}><b>Exact values</b><small>{item?.name ?? `${group?.name} · whole group`}</small></div>
            <button className="ib" title="Close (Esc)" onClick={() => setUI({ modal: null })}><Icon name="x" /></button>
          </div>
          <div className="popbody">
            {row("Position", [["x", "X"], ["y", "Y"], ["z", "Z"]], 1)}
            {row("Rotation", [["rx", "X"], ["ry", "Y"], ["rz", "Z"]], 0.5, deg)}
            {row("Scale", [["scale", "%"]], 0.005, (v) => String(Math.round(v * 100)), (n) => n / 100)}
            {row("Opacity", [["opacity", "%"]], 0.005, (v) => String(Math.round(v * 100)), (n) => Math.min(Math.max(n / 100, 0), 1))}
            <p className="hint">Values change at the playhead; animated properties get a keyframe there.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
