import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Background, InOutKind, Item, ItemAnim, LoopKind, Prop, SceneEffectKind, TextAnimKind, TextLoopKind, TextUnit } from "@moshion/engine";
import { itemsInGroup, baseColorAt, bgStateAt, setBaseColor, setBgState, itemState, amountAt, fxAmountAt, onKeyframe, setCanvasFxAmount, setFxAmount, setLookAmount } from "@moshion/engine";
import { askConfirm } from "./Confirm";
import { ITEM_FX, colorAt, itemFxOpt, numAt, rangeColorAt, setColor, setNum, setRangeColor } from "@moshion/engine";
import type { ItemFx } from "@moshion/engine";
import { motionTimes, rowBelow } from "@moshion/engine";
import { SHAPES_LIST, motionBlocks, setShape, shapeAt, strokeFor } from "@moshion/engine";
import type { LineSpec, ShapeSpec } from "@moshion/engine";
import { ShapeIcon } from "./Shapes";
import { savePreset } from "./presets";
import { FX_OPTS, fxOpt, lookAt, setLook, setText, textAt, keyLookAndText } from "@moshion/engine";
import { TEXT_MORPHS, clearPin, isPinned, morphChars, parentState, pinAt, setPinCorner } from "@moshion/engine";
import type { TextMorphKind } from "@moshion/engine";
import { PINNABLE } from "./Viewer";
import { BLEND_GROUPS, TEXT_ANIM_LABEL, TEXT_LOOP_LABEL, loopLabel, stepLabel, keyTimes, keyAt,
  BG_PRESETS, IN_OUT_LABEL, LOOP_LABEL, NO_LOOK, SCENE_EFFECTS, activeBackground, backgroundCSS, fmtClock, splitBackground, addKey, addTrack, groupOf, hasKeyAt, ownValue, removeKey, sampleKeys, ungroupTrack, uid,
} from "@moshion/engine";
import type { PanelSection } from "./store";
import { deleteSelection, useStore } from "./store";
import { deleteGroupKey, deleteItemKey } from "./Timeline";
import { prop } from "./EditTools";
import { duplicate, layer } from "./CanvasMenu";
import { pickImageFile } from "./persist";
import { canCarryText, canRide, pathTiltOf, RESHAPABLE } from "./extras";
import { startMaskPick } from "./MaskPick";
import { atPickedKeys, toggleLock } from "./editing";
import { scrub } from "./scrub";
import { importFiles } from "./media";
import { useBrand } from "./brand";
import { RotationGimbal } from "./Gizmo";
import { groupValues } from "@moshion/engine";
import { PARTICLE_DEFAULTS } from "@moshion/engine";
import type { ParticleSpec } from "@moshion/engine";
import { findBeats } from "./waveform";
import { CONTAINER_KINDS, moveInside, placeImageInside, placeNewInside, placeVideoInside, takeOut } from "./inside";
import { Icon } from "./Icon";
import { TrackBody } from "./TrackPanel";
import { Fader } from "./Fader";
import { useStacked } from "./layout";

const st = () => useStore.getState();
export const FONTS = [
  "Geist", "Inter", "Manrope", "Sora", "Poppins", "Montserrat", "Space Grotesk", "Unbounded", "Syne",
  "Archivo Black", "Anton", "Bebas Neue", "Oswald", "Righteous",
  "Playfair Display", "DM Serif Display", "Instrument Serif", "Fraunces", "Lora",
  "JetBrains Mono", "Space Mono", "Caveat", "Pacifico", "Permanent Marker",
];
const FONT_KINDS: [string, string[]][] = [
  ["Sans", ["Geist", "Inter", "Manrope", "Sora", "Poppins", "Montserrat", "Space Grotesk"]],
  ["Display", ["Unbounded", "Syne", "Archivo Black", "Anton", "Bebas Neue", "Oswald", "Righteous"]],
  ["Serif", ["Playfair Display", "DM Serif Display", "Instrument Serif", "Fraunces", "Lora"]],
  ["Mono", ["JetBrains Mono", "Space Mono"]],
  ["Hand", ["Caveat", "Pacifico", "Permanent Marker"]],
];
/** The font picker: the current font up top; open it to search or browse by kind, each font shown in itself. */
function FontPicker({ value, sample, onChange }: { value: string; sample: string; onChange: (f: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const words = (sample.trim().split(/\s+/).slice(0, 2).join(" ") || "Aa").slice(0, 14);
  const brandFonts = useBrand().fonts;
  const kinds: [string, string[]][] = brandFonts.length ? [["Brand", brandFonts], ...FONT_KINDS] : FONT_KINDS;
  const list = FONTS.filter((f) => (!q || f.toLowerCase().includes(q.toLowerCase())) && (!kind || kinds.find((k) => k[0] === kind)?.[1].includes(f)));
  return (
    <div className="fpick">
      <button className="fcur" onClick={() => setOpen(!open)} title="Choose a font">
        <span className="fsample" style={{ fontFamily: `"${value}"` }}>{words}</span>
        <span className="fname">{value}</span>
        <Icon name="chev" size={12} className={open ? "up" : ""} />
      </button>
      {open && <>
        <div className="fbar2">
          <input placeholder="Search fonts" value={q} autoFocus onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="fkinds">
          <button className={!kind ? "on" : ""} onClick={() => setKind(null)}>All</button>
          {kinds.map(([k]) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(kind === k ? null : k)}>{k}</button>)}
        </div>
        <div className="fontlist">
          {list.map((f) => (
            <button key={f} className={value === f ? "on" : ""} style={{ fontFamily: `"${f}"` }} onClick={() => onChange(f)} title={f}>
              <span className="fa">{words}</span><span className="fn">{f}</span>
            </button>
          ))}
          {!list.length && <span className="hint" style={{ padding: 8 }}>No font matches</span>}
        </div>
      </>}
    </div>
  );
}
const SW = ["#111111", "#FFFFFF", "#E0571A", "#F4C400", "#3A5BFF", "#7B4DFF", "#1F9D63", "#D9338A"];

/* ======================= floating bar above the selected item ======================= */

const SECTIONS: { id: PanelSection; label: string; icon: string; when?: (it: Item, grouped: boolean) => boolean }[] = [
  { id: "animate", label: "Animate: in, out & throughout", icon: "anim" },
  { id: "text", label: "Text", icon: "type", when: (it) => it.kind === "text" || !!it.text },
  { id: "shape", label: "Shape", icon: "shapes", when: (it) => ["shape", "rect", "ellipse", "star"].includes(it.kind) },
  { id: "line", label: "Line", icon: "line", when: (it) => it.kind === "line" },
  { id: "fill", label: "Fill & border", icon: "frame", when: (it) => !["text", "line", "chart", "particles"].includes(it.kind) },
  { id: "transform", label: "Position, size & 3D", icon: "cube" },
  { id: "effects", label: "Effects, opacity & blend", icon: "sparkle" },
  { id: "layer", label: "Layer", icon: "layers" },
  { id: "mask", label: "Mask & path", icon: "mask", when: (it) => !["audio", "motion", "camera"].includes(it.kind) },
  { id: "group", label: "Group", icon: "group", when: (_it, g) => g },
  { id: "motion", label: "Motion path", icon: "motion", when: () => false },
  { id: "media", label: "Sound & speed", icon: "music", when: (it) => it.kind === "audio" || it.kind === "video" },
  { id: "track", label: "Motion tracking: follow a spot through the video", icon: "target", when: (it) => it.kind === "video" },
  { id: "chart", label: "Chart", icon: "grid", when: (it) => it.kind === "chart" },
  { id: "particles", label: "Particles", icon: "sparkle", when: (it) => it.kind === "particles" },
];
/** A motion clip only has its path and keyframes. */
const MOTION_SECTIONS: PanelSection[] = ["motion", "transform"];

/** The settings cards an item has (for the floating bar and the canvas right-click menu). */
export function sectionsFor(item: Item, grouped: boolean) {
  if (item.kind === "audio") return SECTIONS.filter((x) => x.id === "media");
  if (item.kind === "camera") return SECTIONS.filter((x) => x.id === "transform");
  return SECTIONS.filter((x) => (item.kind === "motion" ? MOTION_SECTIONS.includes(x.id) : !x.when || x.when(item, grouped)));
}

/** The floating edit bar, attached to the selected item's clip on the timeline. */
export function TrackBar() {
  const selected = useStore((x) => x.selected);
  const selGroup = useStore((x) => x.ui.selGroup);
  const panel = useStore((x) => x.ui.panel);
  const project = useStore((x) => x.project);
  useStore((x) => x.ui.pps); useStore((x) => x.ui.viewStart); useStore((x) => x.ui.graph); useStore((x) => x.ui.hdrW);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean; w?: number; h?: number } | null>(null);
  // phones: the bar sits in the tracks, under the canvas row (scrolls sideways if it doesn't fit)
  const phoneBar = useStacked();
  const item = project.items.find((i) => i.id === selected);
  const grouped = item ? !!groupOf(project, item) : false;
  const group = !item && selGroup ? project.tracks.find((t) => t.id === selGroup && t.kind === "group") : undefined;
  const secs = item ? sectionsFor(item, grouped) : group ? [{ id: "transform" as PanelSection, label: "Animate the whole group", icon: "move" }, { id: "mask" as PanelSection, label: "Mask the whole group", icon: "mask" }] : [];
  const W = secs.length * 25 + 8 + 4 * 25;
  // the keyframe the playhead is touching (same rule as the yellow highlight on the timeline)
  const t = useStore((x) => x.t);
  const groupTimes = (g: { keys?: Partial<Record<Prop, { t: number }[]>> }) => [...new Set(Object.values(g.keys ?? {}).flatMap((ks) => ks?.map((k) => k.t) ?? []))];
  const onKey = item ? keyAt(keyTimes(item), t - item.start) : group ? keyAt(groupTimes(group), t) : null;
  const KEY_DEFAULT: Prop[] = ["x", "y", "scale", "rz", "opacity"];
  const addKeyHere = () => {
    if (item) {
      st().edit((d) => {
        const it = d.items.find((q) => q.id === item.id)!;
        const animated = (Object.keys(it.keys) as Prop[]).filter((p) => it.keys[p]?.length);
        const local = onKey ?? Math.min(Math.max(t - it.start, 0), it.end - it.start);
        for (const p of animated.length ? animated : KEY_DEFAULT) addKey(it, p, local);
        keyLookAndText(it, local);
      });
      st().toast(onKey != null ? "Already a keyframe here · it was refreshed" : "Keyframe added · move or change the item at other times to animate it");
    } else if (group) {
      st().edit((d) => {
        const g = d.tracks.find((q) => q.id === group.id)!;
        const keys = (g.keys ??= {});
        const animated = (Object.keys(keys) as Prop[]).filter((p) => keys[p]?.length);
        const at = onKey ?? t;
        for (const p of animated.length ? animated : KEY_DEFAULT) {
          const def = g.base?.[p] ?? (p === "scale" || p === "opacity" ? 1 : 0);
          const ks = (keys[p] ??= []);
          const v = sampleKeys(ks, at, def);
          const hit = ks.find((k) => Math.abs(k.t - at) < 1e-3);
          if (hit) hit.v = v; else { ks.push({ t: at, v, ease: "ease" }); ks.sort((a, b) => a.t - b.t); }
        }
      });
      st().toast("Group keyframe added");
    }
  };
  const delKeyHere = () => {
    if (onKey == null) return;
    if (item) deleteItemKey(item.id, onKey); else if (group) deleteGroupKey(group.id, onKey);
  };

  // make sure the selected item's clip can be seen: unfold its group and scroll it into view
  useEffect(() => {
    if (!item) return;
    const g = groupOf(st().project, item);
    if (g && !g.open) st().edit((d) => { const gg = d.tracks.find((x) => x.id === g.id); if (gg) gg.open = true; }, false);
    requestAnimationFrame(() => document.querySelector(`.clip[data-item="${item.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [item?.id]);

  useLayoutEffect(() => {
    const place = () => {
      if (phoneBar) {
        // phones: in the tracks, in the canvas row's place (that row steps aside while an item is selected)
        const v = document.querySelector<HTMLElement>(".ws .timeline")?.getBoundingClientRect();
        const cv = document.querySelector<HTMLElement>(".ws .cvdock")?.getBoundingClientRect();
        if (!v || (!item && !group)) { setPos(null); return; }
        const hh = Math.round(cv?.height || 32), x = Math.round(v.left), y = Math.round(cv ? cv.top : v.bottom - hh), w = Math.round(v.width);
        setPos((p) => (p && p.x === x && p.y === y && p.w === w && p.h === hh ? p : { x, y, below: false, w, h: hh }));
        return;
      }
      const clip = item ? document.querySelector<HTMLElement>(`.clip[data-item="${item.id}"]`) : group ? document.querySelector<HTMLElement>(`.gclip[data-group="${group.id}"]`) : null;
      const lanes = document.querySelector<HTMLElement>(".lanes");
      if (!clip || !lanes) { setPos(null); return; }
      const c = clip.getBoundingClientRect(), l = lanes.getBoundingClientRect();
      if (c.bottom < l.top + 30 || c.top > l.bottom) { setPos(null); return; }
      const cx = Math.min(Math.max(c.left + c.width / 2, l.left + W / 2 + 4), l.right - W / 2 - 4);
      const below = c.top - 34 < 4; // always above the clip unless it would leave the window
      const y = Math.round(below ? c.bottom + 4 : c.top - 30), x = Math.round(cx);
      // only update when it actually moved, or this effect would re-render forever
      setPos((p) => (p && p.x === x && p.y === y && p.below === below ? p : { x, y, below }));
    };
    place();
    const rows = document.querySelector(".lrows");
    rows?.addEventListener("scroll", place);
    addEventListener("resize", place);
    return () => { rows?.removeEventListener("scroll", place); removeEventListener("resize", place); };
  });

  if ((!item && !group) || !pos) return null;
  const tid = item?.id ?? group!.id;
  return (
    <motion.div
      key={tid} className={"fbar" + (phoneBar ? " under" : "")} style={{ left: pos.x, top: pos.y, position: "fixed", ...(pos.w ? { width: pos.w } : {}), ...(pos.h ? { height: pos.h } : {}) }}
      initial={{ opacity: 0, y: pos.below ? -4 : 4, x: phoneBar ? 0 : "-50%" }} animate={{ opacity: 1, y: 0, x: phoneBar ? 0 : "-50%" }} transition={{ duration: 0.14 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {secs.map((sec) => (
        <button
          key={sec.id} className={"ib" + (panel?.section === sec.id && (panel.itemId ?? panel.trackId) === tid ? " on" : "")} title={sec.label}
          onClick={(e) => {
            const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const open = panel?.section === sec.id && (panel.itemId ?? panel.trackId) === tid;
            const anchor = { top: r.top, bottom: r.bottom };
            const y = r.top;
            st().setUI({ panel: open ? null : item ? { section: sec.id, itemId: item.id, x: r.left + r.width / 2, y, anchor } : { section: sec.id, itemId: null, trackId: group!.id, x: r.left + r.width / 2, y, anchor } });
          }}
        ><Icon name={sec.icon} /></button>
      ))}
      {item?.kind === "motion" && <button className={"ib" + (st().ui.pathDraw?.motionId === item.id ? " on" : "")} title="Draw the path, block by block" onClick={() => startPathDraw(item.id)}><Icon name="pen" /></button>}
      <span className="fsep" />
      <button className="ib" title="Add a keyframe at the playhead (K)" onClick={addKeyHere}><Icon name="keyadd" /></button>
      <button className="ib" disabled={onKey == null} title={onKey == null ? "Move the playhead onto a keyframe to delete it" : "Delete the keyframe at the playhead"} onClick={delKeyHere}><Icon name="keydel" /></button>
      {item && (<>
        <span className="fsep" />
        <button className={"ib" + (item.locked ? " on" : "")} title={item.locked ? "Locked · click to unlock (Ctrl+Shift+L)" : "Lock: can't be clicked or moved on the canvas (Ctrl+Shift+L)"} onClick={() => toggleLock([item.id])}><Icon name={item.locked ? "lock" : "unlock"} /></button>
        <button className="ib danger" title="Delete item (Del)" onClick={() => deleteSelection()}><Icon name="trash" /></button>
      </>)}
      {group && (
        <button className="ib" title="Ungroup (Ctrl+Shift+G)" onClick={() => { st().edit((d) => ungroupTrack(d, group.id)); st().setUI({ selGroup: null, panel: null }); }}><Icon name="group" /></button>
      )}
    </motion.div>
  );
}

/** Item effects: tap to add, then tune each one; they stack top to bottom. */
function ItemFxSection({ item, canvas }: { item?: Item; canvas?: boolean }) {
  const { edit } = st();
  const project = useStore((x) => x.project);
  const list = (canvas ? project.canvasFx : item?.fx) ?? [];
  const setFx = (fn: (fx: ItemFx[]) => void, commit = true) => edit((d) => {
    if (canvas) { d.canvasFx = JSON.parse(JSON.stringify(d.canvasFx ?? [])); fn(d.canvasFx!); if (!d.canvasFx!.length) delete d.canvasFx; return; }
    const it = d.items.find((q) => q.id === item?.id); if (!it) return; it.fx = JSON.parse(JSON.stringify(it.fx ?? [])); fn(it.fx!); if (!it.fx!.length) delete it.fx;
  }, commit);
  return (
    <>
      {item && !canvas && <>
        <div className="psub" style={{ marginTop: 0 }}>Motion blur</div>
        <Row label="Amount"><Slider value={item.motionBlur ?? 0} min={0} max={1} step={0.05} fmt={(v) => (v ? `${Math.round(v * 100)}%` : "off")} onChange={(v) => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (it) it.motionBlur = v || undefined; }, false)} /></Row>
      </>}
      <div className="psub">{canvas ? "Effects on the whole frame" : "Item effects"}</div>
      <div className="fxgrid">
        {ITEM_FX.map((x) => {
          const on = list.some((f) => f.kind === x.kind);
          return (
            <button key={x.kind} className={on ? "on" : ""} title={x.hint}
              onClick={(e) => {
                if (on) { setFx((fx) => { const i = fx.findIndex((f) => f.kind === x.kind); fx.splice(i, 1); }); return; }
                const add = () => {
                  const it = st().project.items.find((q) => q.id === item?.id);
                  const times = it && !canvas ? keyTimes(it) : [];
                  const local = it ? st().t - it.start : 0;
                  const here = times.find((k) => Math.abs(k - local) <= 0.02);
                  // with keyframes, the effect belongs to the keyframe under the playhead and fades in/out to its neighbours
                  setFx((fx) => fx.push({ id: uid("fx"), kind: x.kind, amount: 0.8, ...(here != null ? { keys: times.map((k) => ({ t: k, v: Math.abs(k - here) < 1e-3 ? 0.8 : 0 })) } : {}) }));
                };
                const it = item && st().project.items.find((q) => q.id === item.id);
                if (!canvas && it && keyTimes(it).length && !onKeyframe(it, st().t)) {
                  askConfirm(e, "This item has keyframes. Effects go on a keyframe — add one at the playhead?", () => {
                    edit((d) => { const x2 = d.items.find((q) => q.id === it.id); if (x2) keyLookAndText(x2, st().t - x2.start); if (x2) for (const pr of Object.keys(x2.keys) as Prop[]) addKey(x2, pr, st().t - x2.start); });
                    add();
                  }, "Add keyframe", false);
                  return;
                }
                add();
              }}>
              {x.label}
            </button>
          );
        })}
      </div>
      {list.map((f, i) => {
        const info = ITEM_FX.find((x) => x.kind === f.kind)!;
        const upd = (fn: (g: ItemFx) => void, commit = false) => setFx((fx) => { const g = fx.find((q) => q.id === f.id); if (g) fn(g); }, commit);
        return (
          <div key={f.id} className={"fxcard" + (f.off ? " off" : "")}>
            <div className="fxhead">
              <b>{info.label}</b>
              <span className="sp" />
              {i > 0 && <button title="Apply earlier" onClick={() => setFx((fx) => { const [g] = fx.splice(i, 1); fx.splice(i - 1, 0, g); })}>↑</button>}
              <button title={f.off ? "Turn on" : "Turn off"} onClick={() => upd((g) => { g.off = !g.off; }, true)}>{f.off ? "Off" : "On"}</button>
              <button title="Remove" onClick={() => setFx((fx) => { fx.splice(i, 1); })}>×</button>
            </div>
            <Row label={f.keys?.length ? "Amount here" : "Amount"}><Slider value={item && !canvas ? fxAmountAt(f, st().t - item.start) : canvas ? amountAt(f, st().t) : f.amount} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => { if (canvas) { edit((d) => setCanvasFxAmount(d, f.id, st().t, v), false); return; } if (!item) { upd((g) => { g.amount = v; }); return; } edit((d) => { const it = d.items.find((q) => q.id === item.id); if (it) setFxAmount(it, f.id, st().t, v); }, false); }} /></Row>
            {info.opts.map((o) => (
              <Row key={o.key} label={o.label}>
                {o.color
                  ? <Color value={itemFxOpt<string>(f, o.key)} onChange={(c) => c && upd((g) => { g.opts = { ...g.opts, [o.key]: c }; })} />
                  : <Slider value={itemFxOpt<number>(f, o.key)} min={o.min!} max={o.max!} step={o.step} fmt={(v) => (o.unit ? `${Math.round(v * 100) / 100}${o.unit}` : `${Math.round(v * 1000) / 1000}`)} onChange={(v) => upd((g) => { g.opts = { ...g.opts, [o.key]: v }; })} />}
              </Row>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Letters with their own colour: select letters in the text box, pick a colour. Colours follow keyframes. */
function LetterColors({ item, local }: { item: Item; local: number }) {
  const { edit, toast } = st();
  const ranges = item.textRanges ?? [];
  const text = item.text ?? "";
  const addFromSelection = (color: string) => {
    const ta = document.querySelector<HTMLTextAreaElement>(".epanel textarea.ptext");
    const a = ta?.selectionStart ?? 0, b = ta?.selectionEnd ?? 0;
    if (b <= a) { toast("Select some letters in the text box first"); return; }
    edit((d) => { const it = d.items.find((q) => q.id === item.id); if (!it) return; (it.textRanges ??= []).push({ id: uid("rg"), start: a, end: b, color }); });
  };
  return (
    <>
      <div className="psub">Letter colours</div>
      <div className="lcrow">
        <span className="hint" style={{ margin: 0 }}>Select letters above, then pick:</span>
        <Color value={undefined} onChange={(c) => c && addFromSelection(c)} />
      </div>
      {ranges.map((rg) => (
        <div key={rg.id} className="lcrow">
          <span className="lcpreview" style={{ color: rangeColorAt(rg, local) }}>“{text.slice(rg.start, rg.end) || "…"}”</span>
          <span className="sp" />
          <Color value={rangeColorAt(rg, local)} onChange={(c) => c && edit((d) => { const it = d.items.find((q) => q.id === item.id); if (it) setRangeColor(it, rg.id, st().t, c); }, false)} />
          <button className="chip" title="Remove" onClick={() => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (!it?.textRanges) return; it.textRanges = it.textRanges.filter((q) => q.id !== rg.id); if (!it.textRanges.length) delete it.textRanges; })}>×</button>
        </div>
      ))}
    </>
  );
}

/** From the masking object: pick the groups and items this object masks. */
function UseAsMask({ item }: { item: Item }) {
  const project = useStore((x) => x.project);
  const groups = project.tracks.filter((t) => t.kind === "group" && !itemsInGroup(project, t.id).some((i) => i.id === item.id));
  const items = project.items.filter((i) => i.id !== item.id && !["audio", "motion", "camera"].includes(i.kind));
  const masking = [...groups.filter((g) => g.mask?.by === item.id).map((g) => ({ id: g.id, name: `Group: ${g.name}`, group: true })), ...items.filter((i) => i.mask?.by === item.id).map((i) => ({ id: i.id, name: i.name, group: false }))];
  const use = (id: string) => st().edit((d) => {
    const g = d.tracks.find((t) => t.id === id && t.kind === "group");
    if (g) { g.mask = { by: item.id, inside: true }; return; }
    const it = d.items.find((i) => i.id === id); if (it) it.mask = { by: item.id, inside: item.kind === "text" ? undefined : true };
  });
  const stop = (id: string) => st().edit((d) => {
    const g = d.tracks.find((t) => t.id === id); if (g?.mask?.by === item.id) delete g.mask;
    const it = d.items.find((i) => i.id === id); if (it?.mask?.by === item.id) delete it.mask;
  });
  return (
    <>
      <Row label="Masks"><div className="f2w pickw">
        <select className="psel" value="" onChange={(e) => { if (e.target.value) { use(e.target.value); st().toast(`${item.name} masks it now`); } }}>
          <option value="">Pick a group or item…</option>
          {groups.length > 0 && <optgroup label="Groups">{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup>}
          <optgroup label="Items">{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>
        </select>
        <button className="chip" title="Pick it on the canvas or the tracks" onClick={() => startMaskPick(item.id, "for")}>Pick</button>
      </div></Row>
      {masking.map((m) => <div key={m.id} className="pinrow"><span>Masks {m.name}</span><button className="chip" onClick={() => stop(m.id)}>Stop</button></div>)}
    </>
  );
}

/** Mask a whole group with an item (or another group): every item in it is cut the same way. */
function GroupMask({ groupId }: { groupId: string }) {
  const project = useStore((x) => x.project);
  const g = project.tracks.find((t) => t.id === groupId);
  if (!g) return null;
  const mine = new Set(itemsInGroup(project, groupId).map((i) => i.id));
  const set = (fn: (m: NonNullable<Item["mask"]> | undefined, tr: NonNullable<typeof g>) => void) => st().edit((d) => { const tr = d.tracks.find((t) => t.id === groupId); if (tr) fn(tr.mask, tr); });
  const m = g.mask;
  return (
    <>
      <div className="psub">Mask the group</div>
      <Row label="Mask with">
        <select className="psel" value={m?.by ?? ""} onChange={(e) => set((_, tr) => { if (e.target.value) tr.mask = { by: e.target.value, invert: tr.mask?.invert, inside: tr.mask ? tr.mask.inside : true, edge: tr.mask?.edge }; else delete tr.mask; })}>
          <option value="">Nothing (no mask)</option>
          {project.items.filter((i) => !mine.has(i.id) && ["shape", "rect", "ellipse", "star", "image", "video", "text", "chart", "particles"].includes(i.kind)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          {project.tracks.filter((t) => t.kind === "group" && t.id !== groupId).map((t) => <option key={t.id} value={t.id}>{`Group: ${t.name}`}</option>)}
        </select>
      </Row>
      {m && <>
        <Row label="Clip to">
          <select className="psel" value={m.edge ?? "shape"} onChange={(e) => set((_, tr) => { tr.mask = { ...tr.mask!, edge: e.target.value === "shape" ? undefined : e.target.value as NonNullable<Item["mask"]>["edge"] }; })}>
            <option value="shape">Its shape</option><option value="right">Its right edge</option><option value="left">Its left edge</option>
            <option value="top">Its top edge</option><option value="bottom">Its bottom edge</option>
          </select>
        </Row>
        <Row label="Keep"><Seg value={m.invert ? "out" : "in"} options={[["in", "Inside"], ["out", "Outside"]]} onChange={(v) => set((_, tr) => { tr.mask = { ...tr.mask!, invert: v === "out" }; })} /></Row>
        <Row label="Moving the mask"><Seg value={m.free ? "free" : "along"} options={[["along", "Takes the group along", "Drag the mask on the canvas and the group's items move with it"], ["free", "Leaves it put", "The mask moves over the group, revealing other parts of it"]]} onChange={(v) => set((_, tr) => { tr.mask = { ...tr.mask!, free: v === "free" || undefined }; })} /></Row>
        <Row label="The mask"><Seg value={m.inside ? "show" : "hide"} options={[["show", "Shown"], ["hide", "Hidden"]]} onChange={(v) => set((_, tr) => { tr.mask = { ...tr.mask!, inside: v === "show" || undefined }; })} /></Row>
      </>}
    </>
  );
}

/** Follow a parent item, and properties driven by other properties. */
function ParentAndLinks({ item }: { item: Item }) {
  const project = useStore((x) => x.project);
  const t = useStore((x) => x.t);
  const { edit } = st();
  const setI = (fn: (it: Item) => void, commit = true) => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (it) fn(it); }, commit);
  // items that wouldn't make a loop
  const chainHas = (id: string, target: string): boolean => { let cur = project.items.find((i) => i.id === id); for (let n = 0; cur && n < 20; n++) { if (cur.id === target) return true; cur = project.items.find((i) => i.id === cur!.parentLink?.id); } return false; };
  const parents = project.items.filter((i) => i.id !== item.id && i.kind !== "audio" && !chainHas(i.id, item.id));
  const PR: [Prop, string][] = [["x", "Left/right"], ["y", "Up/down"], ["rz", "Turn"], ["scale", "Size"], ["opacity", "Opacity"]];
  return (
    <>
      <div className="psub">Follow</div>
      <Row label="Parent">
        <select className="psel" value={item.parentLink?.id ?? ""} onChange={(e) => setI((it) => {
          if (!e.target.value) { delete it.parentLink; return; }
          const par = project.items.find((i) => i.id === e.target.value)!, P = parentState(project, par, t, it);
          it.parentLink = { id: par.id, x0: P.x, y0: P.y, rz0: P.rz, s0: P.scale };
        })}>
          <option value="">Nothing</option>
          {parents.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Row>
      <div className="psub">Links</div>
      {(item.links ?? []).map((L, i) => (
        <div key={i} className="plink">
          <select className="psel" value={L.prop} onChange={(e) => setI((it) => { it.links![i].prop = e.target.value as Prop; })}>{PR.map(([p, l]) => <option key={p} value={p}>{l}</option>)}</select>
          <span>follows</span>
          <select className="psel" value={L.src} onChange={(e) => setI((it) => { it.links![i].src = e.target.value; })}>
            <option value="self">its own</option>
            {project.items.filter((q) => q.id !== item.id && q.kind !== "audio").map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <select className="psel" value={L.srcProp} onChange={(e) => setI((it) => { it.links![i].srcProp = e.target.value as Prop; })}>{PR.map(([p, l]) => <option key={p} value={p}>{l}</option>)}</select>
          <Num label="×" value={L.amount} step={0.05} onChange={(v) => setI((it) => { it.links![i].amount = v; })} />
          <button className="ib" title="Remove this link" onClick={() => setI((it) => { it.links!.splice(i, 1); if (!it.links!.length) delete it.links; })}><Icon name="x" size={12} /></button>
        </div>
      ))}
      <button className="chip" onClick={() => setI((it) => { (it.links ??= []).push({ prop: "rz", src: "self", srcProp: "x", amount: 0.5 }); })}>+ Link a property</button>
    </>
  );
}

/** The look sliders, each with its own settings once it's on (colour, offset, softness, direction…). */
function LookOptions({ item, L }: { item: Item; L: (k: keyof typeof NO_LOOK, label: string, max: number) => React.ReactNode }) {
  const t = useStore((x) => x.t);
  const { edit } = st();
  const lk = lookAt(item, t - item.start), o = item.lookOpts ?? {};
  const setO = (fn: (q: NonNullable<Item["lookOpts"]>) => void, commit = false) => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (!it) return; const q = { ...(it.lookOpts ?? {}) }; fn(q); it.lookOpts = q; }, commit);
  return (
    <>
      {L("extrude", "3D depth", 60)}
      {lk.extrude > 0 && <div className="lookopts">
        <Row label="Colour"><Color allowNone value={o.depthColor} onChange={(c) => setO((q) => { q.depthColor = c ?? undefined; }, true)} /></Row>
        <Row label="Direction"><Slider value={o.depthAngle ?? 45} min={0} max={360} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => setO((q) => { q.depthAngle = v; })} /></Row>
      </div>}
      {L("shadow", "Shadow", 80)}
      {lk.shadow > 0 && <div className="lookopts">
        <Row label="Colour"><Color value={o.shadowColor ?? "#000000"} onChange={(c) => setO((q) => { q.shadowColor = c ?? "#000000"; }, true)} /></Row>
        <Row label="Strength"><Slider value={o.shadowOpacity ?? 0.35} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setO((q) => { q.shadowOpacity = v; })} /></Row>
        <Row label="Offset"><div className="f2e">
          <Num label="X" value={o.shadowX ?? 0} onChange={(v) => setO((q) => { q.shadowX = v; })} />
          <Num label="Y" value={o.shadowY ?? lk.shadow} onChange={(v) => setO((q) => { q.shadowY = v; })} />
        </div></Row>
        <Row label="Softness"><Slider value={o.shadowSoft ?? 1.6} min={0} max={4} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => setO((q) => { q.shadowSoft = v; })} /></Row>
      </div>}
      {L("blur", "Blur", 40)}
      {L("glow", "Glow", 80)}
      {lk.glow > 0 && <div className="lookopts">
        <Row label="Colour"><Color allowNone value={o.glowColor} onChange={(c) => setO((q) => { q.glowColor = c ?? undefined; }, true)} /></Row>
        <Row label="Intensity"><Slider value={o.glowPower ?? 1} min={1} max={4} step={1} fmt={(v) => `${Math.round(v)}×`} onChange={(v) => setO((q) => { q.glowPower = v; })} /></Row>
      </div>}
    </>
  );
}

/** A text item's own shadow (sharp or soft, any colour, any offset). */
function TextShadowOpts({ item }: { item: Item }) {
  const { edit } = st();
  const sh = item.textShadow;
  const setF = (fn: (it: Item) => void, commit = true) => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (it) fn(it); }, commit);
  return (
    <>
      <div className="psub">Text shadow</div>
      <Row label="Shadow"><Seg value={sh ? "on" : "off"} options={[["off", "Off"], ["on", "On"]]} onChange={(v) => setF((it) => { it.textShadow = v === "on" ? { x: 0, y: 12, blur: 24, color: "#000000" } : undefined; })} /></Row>
      {sh && <>
        <Row label="Offset"><div className="f2e">
          <Num label="X" value={sh.x} onChange={(v) => setF((it) => { it.textShadow = { ...it.textShadow!, x: v }; }, false)} />
          <Num label="Y" value={sh.y} onChange={(v) => setF((it) => { it.textShadow = { ...it.textShadow!, y: v }; }, false)} />
        </div></Row>
        <Row label="Blur"><Slider value={sh.blur} min={0} max={120} onChange={(v) => setF((it) => { it.textShadow = { ...it.textShadow!, blur: v }; }, false)} /></Row>
        <Row label="Colour"><Color value={sh.color} onChange={(c) => setF((it) => { it.textShadow = { ...it.textShadow!, color: c ?? "#000000" }; }, false)} /></Row>
      </>}
    </>
  );
}

/**
 * Text running along a line, a motion path or another item's outline. Picking a shape or line also makes it
 * the text's parent, so the text moves, turns and grows with it. Where along it and the gap are keyframed.
 */
function RunAlong({ item }: { item: Item }) {
  const project = useStore((x) => x.project);
  const t = useStore((x) => x.t);
  const { edit } = st();
  const setF = (fn: (it: Item) => void, commit = true) => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (it) fn(it); }, commit);
  const target = project.items.find((i) => i.id === item.onPath);
  const closed = !!target && target.kind !== "line" && target.kind !== "motion";
  const pt = item.pathText ?? {};
  const setP = (fn: (p: NonNullable<Item["pathText"]>) => void) => setF((it) => { const p = { ...(it.pathText ?? {}) }; fn(p); it.pathText = p; });
  const tilted = !!target && (() => { const ts = itemState(project, target, Math.min(Math.max(t, target.start), target.end - 1e-3)); return Math.abs(ts.rx % 360) > 0.5 || Math.abs(ts.ry % 360) > 0.5; })();
  const local = t - item.start;
  const choose = (id: string) => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (!it) return; ((it: Item) => {
    const old = it.onPath;
    if (!id) { delete it.onPath; if (old && it.parentLink?.id === old) delete it.parentLink; return; }
    it.onPath = id;
    const tg = project.items.find((i) => i.id === id);
    if (tg?.kind === "motion") {
      // ride the motion: same time as its clip, right under it, and no leftover offset
      if (old && it.parentLink?.id === old) delete it.parentLink;
      it.start = tg.start; it.end = tg.end;
      it.trackId = rowBelow(d, tg.trackId, tg.start, tg.end, it.id);
      inheritKeys(it, tg);
      return;
    }
    if (!tg) { if (old && it.parentLink?.id === old) delete it.parentLink; return; }
    // the shape (or line) becomes its parent; the text's box sits on it so it's easy to find
    const P = parentState(project, tg, t, it);
    if (!it.keys.x?.length) it.base.x = P.x;
    if (!it.keys.y?.length) it.base.y = P.y;
    it.parentLink = { id: tg.id, x0: P.x, y0: P.y, rz0: P.rz, s0: P.scale };
    inheritKeys(it, tg);
  })(it); });
  /**
   * Running along something takes on its keyframes: the text gets an Along keyframe at each moment the thing
   * it runs along has one (holding where it is now), so it can be set node by node, keyframe by keyframe.
   */
  function inheritKeys(it: Item, tg: Item) {
    const times = keyTimes(tg).map((k) => tg.start + k - it.start).filter((k) => k >= -1e-3 && k <= it.end - it.start + 1e-3);
    if (!times.length) return;
    const ks = ((it.numKeys ??= {}).pathOffset ??= []);
    for (const k of times) if (!ks.some((q) => Math.abs(q.t - k) < 1e-3)) ks.push({ t: Math.max(0, k), v: numAt(it, "pathOffset", k), ease: ks[0]?.ease ?? "ease" });
    ks.sort((a, b) => a.t - b.t);
  }
  return (
    <>
      <Row label="Run along">
        <select className="psel" value={item.onPath ?? ""} onChange={(e) => choose(e.target.value)}>
          <option value="">Nothing (normal text)</option>
          {project.items.filter((i) => i.id !== item.id && canCarryText(i)).map((i) => <option key={i.id} value={i.id}>{i.name}{i.kind === "line" ? " · line" : i.kind === "motion" ? " · motion path" : " · outline"}</option>)}
        </select>
      </Row>
      {(item.onPath || (item.follow && item.follow.letters !== false)) && <>
        <Row label="Along"><Slider value={numAt(item, "pathOffset", local)} min={closed ? -100 : -50} max={100} step={0.5} fmt={(v) => `${Math.round(v)}%`} onChange={(v) => setF((it) => { setNum(it, "pathOffset", st().t, v); }, false)} /></Row>
        {item.onPath && <Row label="Turn"><Slider value={pathTiltOf(item, local)} min={-180} max={180} step={1} fmt={(v) => `${Math.round(v)}°`}
          onChange={(v) => setF((it) => {
            // older "stand up" text: it carries on from standing (90°)
            if (it.pathText?.stand) { if (it.pathTilt == null && !it.numKeys?.pathTilt?.length) it.pathTilt = 90; it.pathText = { ...it.pathText, stand: undefined }; }
            setNum(it, "pathTilt", st().t, Math.round(v));
          }, false)} /></Row>}
        <div className="chips" style={{ margin: "0 0 6px" }}>
          <button className="chip" title="Keyframe Along here and open its curve" onClick={() => {
            setF((it) => { const ks = ((it.numKeys ??= {}).pathOffset ??= []); const at = st().t - it.start; if (!ks.some((k) => Math.abs(k.t - at) < 1e-3)) { ks.push({ t: at, v: numAt(it, "pathOffset", at), ease: ks[0]?.ease ?? "ease" }); ks.sort((q1, q2) => q1.t - q2.t); } });
            st().setUI({ graph: true, graphProp: "along" });
          }}>◆ Keyframe Along here</button>
        </div>
        {item.onPath && <>
          <Row label="Gap"><Slider value={numAt(item, "pathGap", local)} min={-200} max={400} step={1} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => setF((it) => { setNum(it, "pathGap", st().t, v); }, false)} /></Row>
          {closed && target && numAt(target, "hollow", Math.min(Math.max(t, target.start), target.end) - target.start) > 0.5 && (
            <Row label="Edge"><Seg value={pt.edge ?? "outer"} options={[["outer", "Outer"], ["inner", "Inner (the hole)"]]} onChange={(v) => setP((p) => { p.edge = v as "outer" | "inner"; })} /></Row>
          )}
          <Row label="Sits"><Seg value={pt.side ?? "top"} options={closed ? [["top", "Outside"], ["middle", "On the line"], ["under", "Inside"]] : [["top", "On top"], ["middle", "Centred"], ["under", "Under"]]} onChange={(v) => setP((p) => { p.side = v as "top"; })} /></Row>
          <Row label="Runs"><Seg value={pt.flip ? "back" : "fwd"} options={closed ? [["fwd", "Clockwise"], ["back", "Anticlockwise"]] : [["fwd", "Start → end"], ["back", "End → start"]]} onChange={(v) => setP((p) => { p.flip = v === "back"; })} /></Row>
          {item.kind === "text" && (tilted || Math.abs(pathTiltOf(item, local)) > 1) && (
            <Row label="Far side"><Seg value={pt.far ?? "show"} options={[["show", "Show"], ["fade", "Fade"], ["hide", "Hide"]]} onChange={(v) => setP((p) => { p.far = v as "show"; })} /></Row>
          )}
        </>}
      </>}
    </>
  );
}

/** Mask (show only inside/outside another item) and repeater (extra copies). */
function MaskTabs({ start, mask, path }: { start: "mask" | "path"; mask: React.ReactNode; path: React.ReactNode }) {
  const [tab, setTab] = useState(start);
  return (
    <>
      <div className="atabs2" role="tablist">
        {([["mask", "Mask"], ["path", "Path"]] as const).map(([k, l]) => <button key={k} role="tab" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "mask" ? mask : path}
    </>
  );
}

function MaskAndRepeat({ item, only }: { item: Item; only?: "mask" }) {
  const { edit } = st();
  const project = useStore((x) => x.project);
  const setI = (fn: (it: Item) => void, commit = true) => edit((d) => { const it = d.items.find((q) => q.id === item.id); if (it) fn(it); }, commit);
  const r = item.repeat;
  const rs = (k: keyof NonNullable<Item["repeat"]>, label: string, min: number, max: number, step: number, unit: string) =>
    <Row label={label}><Slider value={r![k]} min={min} max={max} step={step} fmt={(v) => `${Math.round(v * 100) / 100}${unit}`} onChange={(v) => setI((it) => { it.repeat = { ...it.repeat!, [k]: k === "count" ? Math.round(v) : v }; }, false)} /></Row>;
  return (
    <>
      {!only && <ParentAndLinks item={item} />}
      {only && <>
      <Row label="Mask with"><div className="f2w pickw">
        <select className="psel" value={item.mask?.by ?? ""} onChange={(e) => setI((it) => {
          if (!e.target.value) { delete it.mask; return; }
          // a text mask shows this item in its letters, so the text itself is hidden to begin with
          const isText = project.items.some((q) => q.id === e.target.value && q.kind === "text");
          it.mask = { by: e.target.value, invert: it.mask?.invert, inside: isText ? undefined : it.mask ? it.mask.inside : true };
        })}>
          <option value="">Nothing (no mask)</option>
          {project.items.filter((i) => i.id !== item.id && ["shape", "rect", "ellipse", "star", "image", "video", "text", "chart", "particles"].includes(i.kind)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          {project.tracks.filter((g) => g.kind === "group" && !itemsInGroup(project, g.id).some((x) => x.id === item.id)).map((g) => <option key={g.id} value={g.id}>{`Group: ${g.name}`}</option>)}
        </select>
        <button className="chip" title="Pick it on the canvas or the tracks" onClick={() => startMaskPick(item.id, "with")}>Pick</button>
      </div></Row>
      {item.mask && <Row label="Clip to">
        <select className="psel" value={item.mask.edge ?? "shape"} onChange={(e) => setI((it) => { it.mask = { ...it.mask!, edge: e.target.value === "shape" ? undefined : e.target.value as NonNullable<Item["mask"]>["edge"] }; })}>
          <option value="shape">Its shape</option>
          <option value="right">Its right edge</option>
          <option value="left">Its left edge</option>
          <option value="top">Its top edge</option>
          <option value="bottom">Its bottom edge</option>
        </select>
      </Row>}
      {/* a hollow shape: which of its edges does the cutting */}
      {item.mask && (() => { const by = project.items.find((q) => q.id === item.mask!.by); return by && numAt(by, "hollow", Math.max(0, st().t - by.start)) > 0.5; })() && (
        item.mask.edge && item.mask.edge !== "shape"
          ? <Row label="Which edge"><Seg value={item.mask.inner ? "inner" : "outer"} options={[["outer", "Outer edge"], ["inner", "Inner edge", "The edge of the hole: it goes into the hole and comes out of it"]]} onChange={(v) => setI((it) => { it.mask = { ...it.mask!, inner: v === "inner" || undefined, whole: undefined }; })} /></Row>
          : <Row label="Cut with"><Seg value={item.mask.inner ? "hole" : item.mask.whole ? "whole" : "rim"} options={[["rim", "The rim"], ["hole", "The hole"], ["whole", "Whole shape"]]} onChange={(v) => setI((it) => { it.mask = { ...it.mask!, inner: v === "hole" || undefined, whole: v === "whole" || undefined }; })} /></Row>
      )}
      {item.mask && <Row label="Keep"><Seg value={item.mask.through && item.mask.edge && item.mask.edge !== "shape" ? "through" : item.mask.invert ? "out" : "in"}
        options={item.mask.edge && item.mask.edge !== "shape" ? [["in", "Inside"], ["out", "Outside"], ["through", "Through", "It goes in at the edge and comes out the other side"]] : [["in", "Inside"], ["out", "Outside"]]}
        onChange={(v) => setI((it) => { it.mask = { ...it.mask!, invert: v === "out", through: v === "through" || undefined }; })} /></Row>}
      {item.mask && <Row label="Moving the mask"><Seg value={item.mask.free ? "free" : "along"} options={[["along", "Takes this along", "Drag the mask on the canvas and this item moves with it, keeping its place inside"], ["free", "Leaves this put", "The mask moves over this item, revealing other parts of it"]]} onChange={(v) => setI((it) => { it.mask = { ...it.mask!, free: v === "free" || undefined }; })} /></Row>}
      {item.mask && <Row label="The shape"><Seg value={item.mask.inside ? "show" : "hide"} options={[["show", "Shown"], ["hide", "Hidden"]]} onChange={(v) => setI((it) => { it.mask = { ...it.mask!, inside: v === "show" || undefined }; })} /></Row>}
      <UseAsMask item={item} />
      </>}
      {!only && <>
      <div className="psub">Repeater</div>
      <Row label="Copies"><Seg value={r ? "on" : "off"} options={[["off", "Off"], ["on", "On"]]} onChange={(v) => setI((it) => { if (v === "on") it.repeat = { count: 4, dx: 60, dy: 0, rotate: 0, scale: 0, fade: 0.2, delay: 0 }; else delete it.repeat; })} /></Row>
      {r && <>
        {rs("count", "How many", 2, 40, 1, "")}
        {rs("dx", "Step across", -600, 600, 1, "px")}
        {rs("dy", "Step down", -600, 600, 1, "px")}
        {rs("rotate", "Turn each", -180, 180, 1, "°")}
        {rs("scale", "Grow each", -0.3, 0.3, 0.01, "")}
        {rs("fade", "Fade each", 0, 0.5, 0.01, "")}
        {rs("delay", "Delay each", 0, 1, 0.01, "s")}
      </>}
      </>}
    </>
  );
}

/** Start drawing a motion clip's path at the block under the playhead. */
function startPathDraw(motionId: string) {
  const s = st();
  const m = s.project.items.find((i) => i.id === motionId);
  if (!m) return;
  const blocks = motionBlocks(m), local = s.t - m.start;
  let i = blocks.findIndex(([a, b]) => local >= a - 1e-3 && local < b);
  if (i < 0) i = 0;
  s.setUI({ pathDraw: { motionId, block: i } });
  if (blocks[i]) s.setT(m.start + blocks[i][0]);
}

/** Text animations reuse the preset pictures, plus a few of their own. */
const TGLYPH: Record<string, string> = {
  rise: "slideUp", drop: "slideDown", slide: "slideLeft", wave: "float", jitter: "wiggle", swing: "sway",
  elastic: "pop", bouncein: "slideDown", swirl: "rotate", stretch: "scale", squash: "scale", unfold: "flip", skew: "slideLeft", rain: "slideDown",
  random: "fade", shuffle: "wiggle", neon: "fade", crash: "slideDown", spiral: "rotate", slot: "slideUp", focus: "blur", glitch: "wiggle", grow: "scale", whip: "slideLeft",
  shake: "wiggle", orbit: "drift", zigzag: "sway", rubber: "pulse", drunk: "sway", typing: "fade", sparkle: "fade",
};

/** Tiny picture of each animation preset. */
const GLYPH: Record<string, string> = {
  none: "M8 12h8", fade: "M5 12h3M10 12h3M15 12h4", slideUp: "M12 19V6M7 11l5-5 5 5", slideDown: "M12 5v13M7 13l5 5 5-5",
  slideLeft: "M19 12H6M11 7l-5 5 5 5", slideRight: "M5 12h13M13 7l5 5-5 5", scale: "M8 8h8v8H8zM4 4h16v16H4z", pop: "M12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12zM12 2v2M12 20v2M2 12h2M20 12h2",
  blur: "M6 9h12M4 12h16M6 15h12", rotate: "M19 12a7 7 0 1 1-2-5M19 4v4h-4", flip: "M12 3v18M6 7l-3 5 3 5M18 7l3 5-3 5", zoom: "M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14zM21 21l-4.3-4.3M8 11h6M11 8v6",
  typewriter: "M4 18h3M9 18h3M14 18h2M17 6v12", float: "M4 14c3-4 5-4 8 0s5 4 8 0", pulse: "M3 12h4l2-5 3 10 2-5h7", spin: "M20 12a8 8 0 1 1-3-6.2M20 4v4h-4",
  sway: "M12 4v10M8 18l4-4 4 4M6 8l6-4 6 4",
  scramble: "M4 8h4M10 8h2M14 8h6M4 16h6M12 16h2M16 16h4", tracking: "M4 12h4M16 12h4M8 9l-3 3 3 3M16 9l3 3-3 3",
  bounce: "M4 18h16M7 14c1-8 4-8 5 0M13 14c1-5 3-5 4 0", flicker: "M12 3l-4 9h5l-2 9 7-12h-5l2-6z", rainbow: "M3 17a9 9 0 0 1 18 0M6 17a6 6 0 0 1 12 0M9 17a3 3 0 0 1 6 0", wiggle: "M3 12l3-4 3 8 3-8 3 8 3-8 3 4", breathe: "M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10zM12 3a9 9 0 1 0 0 18", drift: "M4 16c4-8 8 4 16-6", kenburns: "M4 6h12v9H4zM8 9h12v9H8z",
};
function AnimGlyph({ k, out }: { k: string; out?: boolean }) {
  return <svg className="aglyph" viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" style={out ? { transform: "scaleX(-1)" } : undefined}><path d={GLYPH[k] ?? GLYPH.none} /></svg>;
}

/* ======================= small controls ======================= */

function Num({ label, value, onChange, step = 1, fmt, parse }: {
  label?: string; value: number; onChange: (v: number) => void; step?: number; fmt?: (v: number) => string; parse?: (n: number) => number;
}) {
  const [text, setText] = useState<string | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  return (
    <label className="num" title="Drag left or right to change · click to type" onPointerDown={(e) => scrub(e, { value, step, onStart: () => st().checkpoint(), onChange, onClick: () => inp.current?.focus() })}>
      {label && <em>{label}</em>}
      <input ref={inp}
        value={text ?? (fmt ? fmt(value) : String(Math.round(value * 100) / 100))}
        onFocus={(e) => { setText(e.target.value); e.target.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { const raw = e.currentTarget.value, n = parseFloat(raw); if (raw !== (fmt ? fmt(value) : String(Math.round(value * 100) / 100)) && !isNaN(n)) { st().checkpoint(); onChange(parse ? parse(n) : n); } setText(null); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

/** How the shown number relates to the real one (e.g. 41% shows 0.41 as 41). */
function shownRatio(fmt: ((v: number) => string) | undefined, value: number, max: number): number {
  if (!fmt) return 1;
  for (const v of [value, max, max / 2]) {
    const n = parseFloat(fmt(v).replace(/[^\d.+-]/g, ""));
    if (v && isFinite(n) && n) return n / v;
  }
  return 1;
}
/** A fader with its value next to it; click the value to type an exact number. */
function Slider({ value, min, max, step = 1, onChange, fmt }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  const [txt, setTxt] = useState<string | null>(null);
  const shown = fmt ? fmt(value) : String(Math.round(value));
  const ratio = shownRatio(fmt, value, max);
  const commit = (raw: string) => {
    const n = parseFloat(raw.replace(",", ".").replace(/[^\d.+-]/g, ""));
    if (isFinite(n)) {
      const v = Math.min(max, Math.max(min, n / ratio));
      if (Math.abs(v - value) > 1e-9) { st().checkpoint(); onChange(v); }
    }
    setTxt(null);
  };
  return (
    <div className="slider">
      <Fader value={value} min={min} max={max} step={step} onStart={() => st().checkpoint()} onChange={onChange} />
      {shown !== "" && (txt != null
        ? <input className="num numin" autoFocus value={txt} aria-label="Type a value"
            onFocus={(e) => e.currentTarget.select()} onChange={(e) => setTxt(e.target.value)}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setTxt(null); }} />
        : <span className="num numed" title="Drag left or right to change · click to type"
            onPointerDown={(e) => scrub(e, {
              value, min, max, step: Math.max(step, (max - min) / 240), onStart: () => st().checkpoint(), onChange,
              onClick: () => { const n = parseFloat(shown.replace(/[^\d.+-]/g, "")); setTxt(isFinite(n) ? String(Math.round(n * 1000) / 1000) : String(Math.round(value * ratio * 1000) / 1000)); },
            })}>{shown}</span>)}
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <div className="seg sm pseg">
      {options.map(([v, label, tip]) => <button key={String(v)} className={v === value ? "on" : ""} title={tip} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

function Color({ value, onChange, allowNone }: { value: string | undefined; onChange: (v: string | undefined) => void; allowNone?: boolean }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#888888";
  const brand = useBrand().colors;
  return (
    <div className="pcolor">
      {allowNone && <button className={"sw none" + (!value ? " on" : "")} title="None" onClick={() => onChange(undefined)} />}
      {brand.map((c) => <button key={"b" + c} className={"sw brand" + (value?.toLowerCase() === c.toLowerCase() ? " on" : "")} style={{ background: c }} title={`${c} · brand colour`} onClick={() => onChange(c)} />)}
      {SW.filter((c) => !brand.some((b) => b.toLowerCase() === c.toLowerCase())).map((c) => <button key={c} className={"sw" + (value?.toLowerCase() === c.toLowerCase() ? " on" : "")} style={{ background: c }} title={c} onClick={() => onChange(c)} />)}
      <label className="sw pick" title="Pick any colour"><input type="color" value={hex} onFocus={() => st().checkpoint()} onChange={(e) => onChange(e.target.value)} /></label>
    </div>
  );
}

function Row({ label, children, kf }: { label: string; children: React.ReactNode; kf?: React.ReactNode }) {
  return <div className="row"><span>{label}</span><div className="rowc">{children}</div>{kf ?? <span />}</div>;
}

const deg = (v: number) => `${Math.round(v)}°`;
const pct = (v: number) => `${Math.round(v * 100)}`;

/* ======================= the edit panel ======================= */

export function EditPanel() {
  const panel = useStore((x) => x.ui.panel);
  const project = useStore((x) => x.project);
  const t = useStore((x) => x.t);
  const graph = useStore((x) => x.ui.graph);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [animTab, setAnimTab] = useState<"in" | "out" | "loop" | "change">("in");
  const [textTab, setTextTab] = useState<"type" | "colour" | "box" | "tricks">("type");
  // Position card: position & size | 3D · Effects card: effects | opacity & blend
  const [posTab, setPosTab] = useState<"pos" | "3d" | "pin">("pos");
  const [fxTab, setFxTab] = useState<"fx" | "blend">("fx");
  // opened straight on the part asked for (the old Rotate and Opacity cards open their tab)
  useEffect(() => {
    if (panel?.section === "rotate") setPosTab("3d"); else if (panel?.section === "transform") setPosTab("pos");
    if (panel?.section === "opacity") setFxTab("blend"); else if (panel?.section === "effects") setFxTab("fx");
  }, [panel?.section, panel?.itemId]);
  const { setUI, edit, toast, select } = st();

  useEffect(() => { setDrag(null); }, [panel?.section, panel?.itemId, panel?.trackId]);
  // the canvas preview only runs while the Animate card is open for that item
  useEffect(() => {
    const p = st().ui.animPreview;
    if (p && (panel?.section !== "animate" || panel?.itemId !== p.itemId)) setUI({ animPreview: null });
  }, [panel?.section, panel?.itemId]);
  useEffect(() => {
    if (!panel) return;
    const off = (e: PointerEvent) => {
      const el = e.target as Element;
      if (ref.current?.contains(el) || el.closest?.(".fbar")) return;
      setUI({ panel: null });
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setUI({ panel: null }); };
    const id = setTimeout(() => addEventListener("pointerdown", off, true), 0);
    addEventListener("keydown", esc);
    return () => { clearTimeout(id); removeEventListener("pointerdown", off, true); removeEventListener("keydown", esc); };
  }, [panel]);

  const item = panel?.itemId ? project.items.find((i) => i.id === panel.itemId) : undefined;
  const group = panel?.trackId ? project.tracks.find((x) => x.id === panel.trackId) : undefined;
  const W = panel?.section === "text" ? 380 : 340;
  const [h, setH] = useState(300);
  const stacked = useStacked();
  const frozen = useRef<{ key: string; x: number; top: number; bottom: number; upper: boolean } | null>(null);
  useLayoutEffect(() => { const el = ref.current; if (el && Math.abs(el.scrollHeight - h) > 2) setH(el.scrollHeight); });
  // whatever changes its size (a tab, a section opening, a picture loading): measured again, so it's placed again
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setH((v) => (Math.abs(el.scrollHeight - v) > 2 ? el.scrollHeight : v)));
    ro.observe(el); [...el.children].forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  });
  const fit = (v: number, size: number, max: number) => Math.min(Math.max(8, v), Math.max(8, max - size - 8));
  // an item's card sits beside the item on the canvas (never on top of it) and always fits on screen, scrolling inside if tall
  const objEl = panel?.itemId ? document.querySelector<HTMLElement>(`.world .obj[data-id="${panel.itemId}"]`) : null;
  const objR = objEl?.getBoundingClientRect();
  const besideItem = !!objR && objR.width > 0 && objR.right > 0 && objR.left < innerWidth;
  const anc = panel?.anchor;
  const pkey = panel ? `${panel.section}|${panel.itemId}|${panel.trackId}|${panel.x}|${panel.y}` : "";
  let maxH: number, x: number, y: number, above = true;
  if (drag) {
    maxH = innerHeight - 16; x = fit(drag.x, W, innerWidth); y = fit(drag.y, Math.min(h, maxH), innerHeight);
  } else if (anc) {
    const roomAbove = anc.top - 16;
    above = roomAbove >= Math.min(h, innerHeight - anc.bottom - 16); // whichever side has more room
    maxH = above ? roomAbove : innerHeight - anc.bottom - 16;
    x = fit(panel ? panel.x - W / 2 : 0, W, innerWidth);
    y = above ? anc.top - 8 - Math.min(h, maxH) : anc.bottom + 8;
  } else if (besideItem && objR) {
    // right under the item, or right over it when there's more room there (never on top of it); worked out once
    // when the card opens, so it doesn't follow the item around while it plays
    let f = frozen.current;
    if (!f || f.key !== pkey) {
      const sb = document.querySelector(".selbox")?.getBoundingClientRect();
      const top = Math.min(objR.top, sb && sb.width ? sb.top : Infinity), bottom = Math.max(objR.bottom, sb && sb.width ? sb.bottom : -Infinity);
      const below = innerHeight - bottom - 18, over = top - 18;
      f = frozen.current = { key: pkey, x: objR.left + objR.width / 2, top, bottom, upper: !(below >= Math.min(h, 280) || below >= over) };
    }
    above = f.upper;
    maxH = Math.max(150, above ? f.top - 18 : innerHeight - f.bottom - 18);
    const cw = Math.min(W, innerWidth - 16), shown = Math.min(h, maxH);
    x = fit(f.x - cw / 2, cw, innerWidth);
    y = above ? Math.max(8, f.top - 10 - shown) : Math.min(f.bottom + 10, innerHeight - 8 - shown);
  } else {
    maxH = innerHeight - 16; x = fit(panel ? panel.x - W / 2 : 0, W, innerWidth); y = fit(panel ? panel.y : 0, Math.min(h, maxH), innerHeight);
  }
  // phones: the card is a sheet over the tracks, right under the video, so the item being edited stays in sight
  // a card about a canvas item is placed by the item (above), on phones too
  const byItem = !drag && !anc && besideItem;
  const atMenu = stacked && !drag && !byItem && !!panel?.fromMenu;
  // opened from the floating bar over the item: the card sits right above that bar (below it if there's no room)
  const atBar = stacked && !drag && !atMenu && !!panel?.anchor;
  const sheet = stacked && !drag && !atMenu && !atBar && !byItem;
  let cardW = byItem ? Math.min(W, innerWidth - 16) : W;
  if (atBar && panel?.anchor) {
    const a = panel.anchor, room = a.top - 14;
    cardW = Math.min(W, innerWidth - 16);
    x = fit(panel.x - cardW / 2, cardW, innerWidth);
    if (room >= 180) { above = true; maxH = room; y = a.top - 6 - Math.min(h, maxH); }
    else { above = false; maxH = Math.max(160, innerHeight - a.bottom - 14); y = a.bottom + 6; }
  }
  if (atMenu && panel) {
    // opened from the item's popup menu: the card takes the menu's place
    cardW = Math.min(W, innerWidth - 16); maxH = innerHeight - 16; above = false;
    x = fit(panel.x, cardW, innerWidth); y = fit(panel.y, Math.min(h, maxH), innerHeight);
  }
  if (sheet) {
    const vb = document.querySelector(".ws .viewer")?.getBoundingClientRect().bottom ?? innerHeight * 0.55;
    // inside the app's area (it stops short of the phone's status and navigation bars)
    const mo = document.querySelector(".mo")?.getBoundingClientRect() ?? { left: 0, width: innerWidth, bottom: innerHeight };
    x = mo.left + 4; cardW = mo.width - 8; y = Math.round(vb + 4); maxH = Math.max(160, mo.bottom - y - 4); above = false;
  }
  // phones: a card is full width, as tall as what's in it (up to the top of the app), and its bottom edge rests just
  // above the item's clip in its track (the background's card: on the background clip)
  if (stacked && !drag && !atMenu && panel) {
    const mo = document.querySelector(".mo")?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    // on the item's own clip in its track (the background's card: on the background clip); else on the bar it came from
    const clipTop = (panel.section === "scene" ? document.querySelector(".cvseg") : panel.itemId ? document.querySelector(`.clip[data-item="${panel.itemId}"]`) : null)?.getBoundingClientRect().top;
    const raw = clipTop != null && clipTop > 0 ? clipTop : atBar && panel.anchor ? panel.anchor.top : undefined;
    // a clip scrolled off the bottom of the screen: the card stops at the bottom instead
    const from = raw == null ? undefined : Math.min(raw, mo.top + mo.height - 4);
    if (from != null && from - mo.top > 200) {
      above = true;
      const gap = panel.section === "scene" ? 0 : 6; // the canvas card sits right on the canvas clip
      maxH = Math.round(from - gap - (mo.top + 6));
      const el = ref.current, edge = el ? el.getBoundingClientRect().height - el.clientHeight : 2; // its border
      y = from - gap - Math.min(h + edge, maxH);
      x = mo.left + 4; cardW = mo.width - 8;
    }
  }
  const show = !!panel && (panel.section === "scene" || !!item || !!group);

  // helpers bound to the current target
  const id = item?.id ?? "";
  // with keyframes picked on this item, an edit goes into each of them
  const P = (p: Prop) => {
    const base = prop(panel?.itemId ?? null, panel?.trackId, p);
    return { get: base.get, set: (v: number) => { if (!panel?.itemId || !atPickedKeys(panel.itemId, () => base.set(v), false)) base.set(v); } };
  };
  const setF = (fn: (it: Item) => void, commit = true) => {
    const one = () => edit((d) => { const it = d.items.find((q) => q.id === id); if (it) fn(it); }, false);
    if (id && atPickedKeys(id, one, commit)) return;
    edit((d) => { const it = d.items.find((q) => q.id === id); if (it) fn(it); }, commit);
  };
  const kf = (props: Prop[]) => {
    if (!item) return <span />;
    const local = t - item.start;
    const animated = props.some((p) => item.keys[p]?.length), here = props.some((p) => hasKeyAt(item, p, local));
    return (
      <button className={"kf" + (animated ? " has" : "") + (here ? " on" : "")} title="Add / remove a keyframe at the playhead"
        onClick={() => edit((d) => { const it = d.items.find((q) => q.id === id)!; props.forEach((p) => (hasKeyAt(it, p, local) ? removeKey(it, p, local) : addKey(it, p, local))); })}><i /></button>
    );
  };
  const nums = (ps: [Prop, string][], step: number, fmt?: (v: number) => string, parse?: (n: number) => number) => (
    <div className={ps.length > 1 ? "f3" : ""}>
      {ps.map(([p, l]) => <Num key={p} label={l} value={P(p).get()} step={step} fmt={fmt} parse={parse} onChange={(v) => P(p).set(v)} />)}
    </div>
  );

  const titles: Record<PanelSection, string> = {
    animate: "Animate", text: "Text", fill: "Fill & border", transform: "Position, size & 3D", rotate: "Position, size & 3D", motion: "Motion path", shape: "Shape", line: "Line", opacity: "Opacity & blend",
    effects: "Effects", keys: "Keyframes", layer: "Layer", group: "Group", scene: "Canvas", media: "Sound & speed", chart: "Chart", particles: "Particles", mask: "Mask", track: "Motion tracking",
  };

  function body() {
    if (!panel) return null;
    if (panel.section === "scene") return <SceneBody bgId={panel.bgId} />;
    if (group && !item && panel.section === "mask") return <GroupMask groupId={group.id} />;
    if (group && !item) {
      const G = (p: Prop) => prop(null, group.id, p);
      const gnums = (ps: [Prop, string][], step: number, fmt?: (v: number) => string, parse?: (n: number) => number) =>
        <div className={ps.length > 1 ? "f3" : ""}>{ps.map(([p, l]) => <Num key={p} label={l} value={G(p).get()} step={step} fmt={fmt} parse={parse} onChange={(v) => G(p).set(v)} />)}</div>;
      return (
        <>
          <Row label="Position">{gnums([["x", "X"], ["y", "Y"], ["z", "Z"]], 1)}</Row>
          <Row label="Rotation">{gnums([["rx", "X"], ["ry", "Y"], ["rz", "Z"]], 0.5, deg)}</Row>
          <Row label="Scale">{gnums([["scale", "%"]], 0.005, pct, (n) => n / 100)}</Row>
          <Row label="Opacity">{gnums([["opacity", "%"]], 0.005, pct, (n) => Math.min(Math.max(n / 100, 0), 1))}</Row>
          <GroupMask groupId={group.id} />
          <div className="chips" style={{ marginTop: 6 }}><button className="chip" onClick={() => { edit((d) => ungroupTrack(d, group.id)); setUI({ panel: null }); }}>Ungroup</button></div>
        </>
      );
    }
    if (!item) return null;
    const it0 = item;
    // following a motion clip's path
    const followPath = () => {
      const item = it0;
      const motions = project.items.filter((i) => i.kind === "motion");
      const f = item.follow;
      return (
          <>
            <Row label="Follow">
              <select className="psel" value={f?.motionId ?? ""} onChange={(e) => {
                const mid = e.target.value;
                edit((d) => {
                  const it = d.items.find((q) => q.id === id); if (!it) return;
                  if (!mid) { delete it.follow; return; }
                  it.follow = { mode: it.follow?.mode ?? "exact", orient: it.follow?.orient, motionId: mid };
                  const m = d.items.find((q) => q.id === mid); if (!m) return;
                  // sit right under the motion clip, for the same time, stacking below anything already there
                  it.start = m.start; it.end = m.end;
                  it.trackId = rowBelow(d, m.trackId, m.start, m.end, it.id);
                  // take the motion's keyframes (positions keep following the path)
                  for (const kt of motionTimes(m)) for (const pr of ["x", "y"] as Prop[]) { const ks = (it.keys[pr] ??= []); if (!ks.some((k) => Math.abs(k.t - kt) < 1e-3)) { ks.push({ t: kt, v: it.base[pr], ease: "ease" }); ks.sort((a2, b2) => a2.t - b2.t); } }
                });
                if (mid) toast("Linked to the motion");
              }}>
                <option value="">Nothing</option>
                {motions.map((mm) => <option key={mm.id} value={mm.id}>{mm.name} · {mm.start.toFixed(1)}–{mm.end.toFixed(1)}s</option>)}
              </select>
            </Row>
            {f && <>
              <Row label="Place"><Seg value={f.mode} options={[["exact", "Where drawn"], ["relative", "From the object"]]} onChange={(v) => setF((it) => { it.follow = { ...it.follow!, mode: v as "exact" | "relative" }; })} /></Row>
              {item.kind === "text" && <Row label="Text"><Seg value={f.letters === false ? "block" : "letters"} options={[["letters", "Bends along the path"], ["block", "Moves as one block"]]} onChange={(v) => setF((it) => { it.follow = { ...it.follow!, letters: v === "letters" }; })} /></Row>}
              <Row label="Face direction"><Seg value={f.orient ? "on" : "off"} options={[["off", "No"], ["on", "Turn along path"]]} onChange={(v) => setF((it) => { it.follow = { ...it.follow!, orient: v === "on" }; })} /></Row>
            </>}
          </>
      );
    };
    // Mask: Mask (cut it, or cut others) · Path (follow a motion path, run along a line or shape)
    const maskTabs = (start: "mask" | "path") => (
      <MaskTabs key={item.id + start} start={start}
        mask={<MaskAndRepeat item={item} only="mask" />}
        path={<>{followPath()}{canRide(item) && <RunAlong item={item} />}</>} />
    );
    switch (panel.section) {
      case "animate": {
        const A: ItemAnim = item.anim ?? {};
        const life = item.end - item.start;
        const isText = item.kind === "text";
        const setA = (fn: (a: ItemAnim) => void, commit = true) => setF((it) => { it.anim = JSON.parse(JSON.stringify(it.anim ?? {})); fn(it.anim!); }, commit);
        const kinds = (Object.keys(IN_OUT_LABEL) as InOutKind[]).filter((k) => k !== "typewriter" || isText);
        const tkinds = Object.keys(TEXT_ANIM_LABEL) as TextAnimKind[];
        const show = (slot: "in" | "out" | "loop") => setUI({ animPreview: { itemId: id, slot } });
        /** keep timing when switching preset; text presets remember letters/words/lines and stagger */
        const choose = (slot: "in" | "out", kind: string, text: boolean) => {
          setA((a) => {
            const prev = a[slot];
            a[slot] = {
              kind: kind as InOutKind, dur: prev?.dur ?? Math.min(text ? 1 : 0.6, life / 2), at: prev?.at,
              ...(text ? { unit: prev?.unit ?? "letter", stagger: prev?.stagger ?? 0.6 } : {}),
            };
          });
          show(slot);
        };
        const pick = (slot: "in" | "out") => {
          const cur = A[slot];
          return (
            <>
              <div className="acards">
                <button className={!cur ? "on" : ""} onClick={() => { setA((a) => { delete a[slot]; }); setUI({ animPreview: null }); }}><AnimGlyph k="none" /><span>None</span></button>
                {kinds.map((k) => (
                  <button key={k} className={cur && !cur.unit && cur.kind === k ? "on" : ""} onClick={() => choose(slot, k, false)}
                    onPointerEnter={() => cur && !cur.unit && cur.kind === k && show(slot)}><AnimGlyph k={k} out={slot === "out"} /><span>{IN_OUT_LABEL[k]}</span></button>
                ))}
              </div>
              {isText && <>
                <div className="psub2">Letter by letter</div>
                <div className="acards">
                  <button className={!cur?.unit ? "on" : ""} title="No letter-by-letter animation" onClick={() => { if (cur?.unit) { setA((a) => { delete a[slot]; }); setUI({ animPreview: null }); } }}><AnimGlyph k="none" /><span>None</span></button>
                  {tkinds.map((k) => (
                    <button key={k} className={cur?.unit && cur.kind === k ? "on" : ""} onClick={() => choose(slot, k, true)}
                      onPointerEnter={() => cur?.unit && cur.kind === k && show(slot)}><AnimGlyph k={TGLYPH[k] ?? k} out={slot === "out"} /><span>{TEXT_ANIM_LABEL[k]}</span></button>
                  ))}
                </div>
              </>}
              {cur && <>
                {cur.unit && <>
                  <Row label="Animate by"><Seg value={cur.unit} options={[["letter", "Letters"], ["word", "Words"], ["line", "Lines"]]} onChange={(v) => setA((a) => { a[slot]!.unit = v as TextUnit; })} /></Row>
                  <Row label="Stagger"><Slider value={cur.stagger ?? 0.6} min={0} max={0.95} step={0.05} fmt={(v) => (v < 0.05 ? "together" : `${Math.round(v * 100)}%`)} onChange={(v) => setA((a) => { a[slot]!.stagger = v; }, false)} /></Row>
                </>}
                <Row label={slot === "in" ? "Starts after" : "Ends before end"}>
                  <Slider value={cur.at ?? 0} min={0} max={Math.max(0.01, life - cur.dur)} step={0.05}
                    fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setA((a) => { a[slot]!.at = v; }, false)} />
                </Row>
                <Row label="Length"><Slider value={cur.dur} min={0.05} max={Math.max(0.1, Math.min(8, life - (cur.at ?? 0)))} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setA((a) => { a[slot]!.dur = v; }, false)} /></Row>
              </>}
            </>
          );
        };
        const pct = (v: number) => `${Math.min(100, Math.max(0, (v / life) * 100))}%`;
        return (
          <>
            <div className="atimeline" title="Where In and Out play">
              {A.in && <i className="ain" style={{ left: pct(A.in.at ?? 0), width: pct(A.in.dur) }} />}
              {A.out && <i className="aout" style={{ right: pct(A.out.at ?? 0), width: pct(A.out.dur) }} />}
              <span>{A.in ? `IN ${stepLabel(A.in)}` : ""}</span><span>{A.loop ? `∞ ${loopLabel(A.loop)}` : ""}</span><span>{A.out ? `OUT ${stepLabel(A.out)}` : ""}</span>
            </div>
            <div className="atabs2" role="tablist">
              {([["in", "In", "As it appears", A.in], ["out", "Out", "As it leaves", A.out], ["loop", "Throughout", "Its whole lifetime", A.loop], ...(isText ? [["change", "Change", "When its wording changes at a keyframe", item.textMorph]] : [])] as ["in" | "out" | "loop" | "change", string, string, unknown][]).map(([k, l, tip, on]) => (
                <button key={k} role="tab" className={animTab === k ? "on" : ""} title={tip} onClick={() => setAnimTab(k)}>{l}{on ? <i /> : null}</button>
              ))}
            </div>
            {animTab === "change" && isText && <>
            <div className="mpick" role="radiogroup" aria-label="How the text changes">
              {TEXT_MORPHS.map(([k, l, tip]) => (
                <button key={k} role="radio" aria-checked={(item.textMorph ?? "smooth") === k} className={(item.textMorph ?? "smooth") === k ? "on" : ""} title={tip}
                  onClick={() => { setF((it) => { if (k === "smooth") delete it.textMorph; else it.textMorph = k; }); previewMorph(item.id, k); }}>
                  <MorphSample kind={k} />{l}
                </button>
              ))}
            </div>
            </>}
            {animTab === "in" && pick("in")}
            {animTab === "out" && pick("out")}
            {animTab === "loop" && <>
            <div className="acards">
              <button className={!A.loop ? "on" : ""} onClick={() => { setA((a) => { delete a.loop; }); setUI({ animPreview: null }); }}><AnimGlyph k="none" /><span>None</span></button>
              {(Object.keys(LOOP_LABEL) as LoopKind[]).map((k) => (
                <button key={k} className={A.loop && !A.loop.unit && A.loop.kind === k ? "on" : ""}
                  onClick={() => { setA((a) => { a.loop = { kind: k, speed: a.loop?.speed ?? (k === "spin" ? 0.25 : 1), amount: a.loop?.amount ?? 1 }; }); show("loop"); }}><AnimGlyph k={k} /><span>{LOOP_LABEL[k]}</span></button>
              ))}
            </div>
            {isText && <>
              <div className="psub2">Letter by letter</div>
              <div className="acards">
                <button className={!A.loop?.unit ? "on" : ""} title="No letter-by-letter animation" onClick={() => { if (A.loop?.unit) { setA((a) => { delete a.loop; }); setUI({ animPreview: null }); } }}><AnimGlyph k="none" /><span>None</span></button>
                {(Object.keys(TEXT_LOOP_LABEL) as TextLoopKind[]).map((k) => (
                  <button key={k} className={A.loop?.unit && A.loop.kind === k ? "on" : ""}
                    onClick={() => { setA((a) => { a.loop = { kind: k, speed: a.loop?.speed ?? 1, amount: a.loop?.amount ?? 1, unit: a.loop?.unit ?? "letter" }; }); show("loop"); }}><AnimGlyph k={TGLYPH[k] ?? k} /><span>{TEXT_LOOP_LABEL[k]}</span></button>
                ))}
              </div>
            </>}
            {A.loop && <>
              {A.loop.unit && <Row label="Animate by"><Seg value={A.loop.unit} options={[["letter", "Letters"], ["word", "Words"], ["line", "Lines"]]} onChange={(v) => setA((a) => { a.loop!.unit = v as TextUnit; })} /></Row>}
              <Row label="Speed"><Slider value={A.loop.speed} min={0.05} max={4} step={0.05} fmt={(v) => `${v.toFixed(2)}/s`} onChange={(v) => setA((a) => { a.loop = { ...a.loop!, speed: v }; }, false)} /></Row>
              <Row label="Amount"><Slider value={A.loop.amount} min={0} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setA((a) => { a.loop = { ...a.loop!, amount: v }; }, false)} /></Row>
            </>}
            </>}
          </>
        );
      }
      case "shape": {
        // older rectangles / ellipses / stars become editable shapes the first time you change them
        const spec: ShapeSpec = item.kind === "shape" ? shapeAt(item, t - item.start).spec : item.shape ?? (item.kind === "ellipse" ? { type: "ellipse" } : item.kind === "star" ? { type: "star", count: 5, inner: 0.38, round: 0 } : { type: "rect", round: Math.min(1, (item.radius ?? 0) / (Math.min(item.w, item.h) / 2 || 1)) });
        const setS = (fn: (s: ShapeSpec) => void, commit = true) => setF((it) => {
          const s2: ShapeSpec = JSON.parse(JSON.stringify(spec)); fn(s2);
          if (it.kind !== "shape") { it.kind = "shape"; it.shape = JSON.parse(JSON.stringify(spec)); }
          setShape(it, st().t, s2); // with keyframes, the change goes into the keyframe at the playhead (and morphs)
        }, commit);
        const info = SHAPES_LIST.find((x) => x.type === spec.type)!;
        return (
          <>
            <div className="shgrid">
              {SHAPES_LIST.map((x) => (
                <button key={x.type} className={spec.type === x.type ? "on" : ""} title={x.label}
                  onClick={() => setS((s) => { const keep = { ...s }; Object.assign(s, x.spec); if (keep.round != null && x.params.includes("round")) s.round = keep.round; })}>
                  <ShapeIcon spec={x.spec} />
                </button>
              ))}
            </div>
            <div className="psub">{info.label}</div>
            {info.params.includes("count") && <Row label={spec.type === "polygon" ? "Sides" : spec.type === "blob" ? "Bumps" : "Points"}><Slider value={spec.count ?? 5} min={3} max={spec.type === "burst" ? 40 : 24} step={1} fmt={(v) => `${Math.round(v)}`} onChange={(v) => setS((s) => { s.count = Math.round(v); }, false)} /></Row>}
            {info.params.includes("inner") && <Row label={spec.type === "ring" ? "Hole size" : spec.type === "arrow" ? "Head length" : "Inner size"}><Slider value={spec.inner ?? 0.45} min={0.05} max={0.95} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setS((s) => { s.inner = v; }, false)} /></Row>}
            {info.params.includes("thickness") && <Row label="Thickness"><Slider value={spec.thickness ?? 0.4} min={0.05} max={0.95} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setS((s) => { s.thickness = v; }, false)} /></Row>}
            {info.params.includes("round") && <Row label="Roundness"><Slider value={spec.round ?? 0} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setS((s) => { s.round = v; }, false)} /></Row>}
            {info.params.includes("seed") && <Row label="Variation"><Slider value={spec.seed ?? 1} min={1} max={60} step={1} fmt={(v) => `#${Math.round(v)}`} onChange={(v) => setS((s) => { s.seed = Math.round(v); }, false)} /></Row>}
            <Row label="Hollow"><Slider value={numAt(item, "hollow", t - item.start)} min={0} max={Math.round(Math.min(item.w, item.h) / 2)} fmt={(v) => (v ? `${Math.round(v)}px rim` : "Solid")} onChange={(v) => setF((it) => { setNum(it, "hollow", st().t, Math.round(v)); }, false)} /></Row>
          </>
        );
      }
      case "line": {
        const l = item.line!;
        const setL = (fn: (x: LineSpec) => void, commit = true) => setF((it) => { if (it.line) fn(it.line); }, commit);
        const draw = lookAt(item, t - item.start).draw;
        return (
          <>
            <Row label="Colour"><Color value={l.color} onChange={(c) => c && setL((x) => { x.color = c; }, false)} /></Row>
            <Row label="Width"><Slider value={l.width} min={1} max={80} step={1} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => setL((x) => { x.width = v; }, false)} /></Row>
            <Row label="Style"><Seg value={l.dash} options={[["solid", "—"], ["dash", "- -"], ["dot", "···"], ["dashdot", "-·-"]]} onChange={(v) => setL((x) => { x.dash = v as LineSpec["dash"]; })} /></Row>
            <Row label="Arrows"><Seg value={l.arrow} options={[["none", "None"], ["end", "→"], ["start", "←"], ["both", "↔"]]} onChange={(v) => setL((x) => { x.arrow = v as LineSpec["arrow"]; })} /></Row>
            <Row label="Ends"><Seg value={l.cap} options={[["round", "Round"], ["butt", "Flat"]]} onChange={(v) => setL((x) => { x.cap = v as LineSpec["cap"]; })} /></Row>
            <Row label="Corners"><Slider value={l.round ?? 0} min={0} max={300} step={1} fmt={(v) => (v ? `${Math.round(v)}px` : "Sharp")} onChange={(v) => setL((x) => { x.round = v || undefined; }, false)} /></Row>
            <div className="psub">Draw on</div>
            <Row label="End"><Slider value={draw} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setF((it) => { setLook(it, "draw", st().t, v); }, false)} /></Row>
            <Row label="Start"><Slider value={lookAt(item, t - item.start).drawStart} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setF((it) => { setLook(it, "drawStart", st().t, v); }, false)} /></Row>
          </>
        );
      }
      case "motion": {
        if (item.kind === "motion") {
          const blocks = motionBlocks(item);
          const users = project.items.filter((i) => i.follow?.motionId === item.id);
          const drawn = blocks.filter(([a, b]) => strokeFor(item, a, b)).length;
          return (
            <>
              <Row label="Blocks"><span className="mono">{drawn} of {blocks.length} drawn</span></Row>
              <div className="chips" style={{ marginTop: 4 }}>
                <button className="chip on" onClick={() => { startPathDraw(item.id); setUI({ panel: null }); }}>✎ Draw path</button>
                {drawn > 0 && <button className="chip" onClick={() => setF((it) => { delete it.strokes; })}>Clear lines</button>}
              </div>
              <div className="psub">Used by</div>
              {users.length ? users.map((u) => <div key={u.id} className="muser">{u.name}<span className="sp" /><button className="chip" onClick={() => edit((d) => { delete d.items.find((q) => q.id === u.id)!.follow; })}>Unlink</button></div>)
                : <p className="hint">Nothing yet. Select an object and open its Motion path card to link it.</p>}
            </>
          );
        }
        return maskTabs("path");
      }
      case "text": {
        const sh = item.textShadow;
        const grad = item.textGradient;
        void sh;
        return (
          <>
            <textarea className="ptext" value={textAt(item, t - item.start).text} rows={2} placeholder="Type your text"
              onFocus={() => st().checkpoint()} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setF((it) => { setText(it, st().t, e.target.value); }, false)} />
            <div className="atabs2" role="tablist">
              {([["type", "Type", "Font, size and spacing"], ["colour", "Colour", "Fill, gradient, picture or video, outline"], ["box", "Box", "A coloured box behind the text"], ["tricks", "Tricks", "Count up, scramble, cursor"]] as const).map(([k, l, tip]) => (
                <button key={k} role="tab" className={textTab === k ? "on" : ""} title={tip} onClick={() => setTextTab(k)}>{l}{(k === "box" && item.textBg) || (k === "tricks" && item.textFx) ? <i /> : null}</button>
              ))}
            </div>
            {textTab === "type" && <>
            <FontPicker value={item.fontFamily ?? "Geist"} sample={textAt(item, t - item.start).text} onChange={(f) => setF((it) => { it.fontFamily = f; })} />
            <Row label="Size"><div className="f2w">
              <Slider value={numAt(item, "fontSize", t - item.start)} min={8} max={600} onChange={(v) => setF((it) => { setNum(it, "fontSize", st().t, v); }, false)} fmt={() => ""} />
              <Num label="px" value={numAt(item, "fontSize", t - item.start)} step={0.5} onChange={(v) => setF((it) => { setNum(it, "fontSize", st().t, Math.max(4, Math.round(v))); }, false)} />
            </div></Row>
            <Row label="Weight"><Slider value={item.fontWeight ?? 800} min={100} max={900} step={100} onChange={(v) => setF((it) => { it.fontWeight = v; }, false)} /></Row>
            <Row label="Style">
              <div className="tgl">
                <button className={item.italic ? "on" : ""} title="Italic" style={{ fontStyle: "italic" }} onClick={() => setF((it) => { it.italic = !it.italic; })}>I</button>
                <button className={item.underline ? "on" : ""} title="Underline" style={{ textDecoration: "underline" }} onClick={() => setF((it) => { it.underline = !it.underline; })}>U</button>
                <span className="gap" />
                {([["left", "Align left", "M4 6h16M4 10h10M4 14h16M4 18h10"], ["center", "Centre", "M4 6h16M7 10h10M4 14h16M7 18h10"], ["right", "Align right", "M4 6h16M10 10h10M4 14h16M10 18h10"]] as const).map(([a, tip, dpath]) => (
                  <button key={a} className={(item.align ?? "left") === a ? "on" : ""} title={tip} onClick={() => setF((it) => { it.align = a; })}>
                    <svg className="i" viewBox="0 0 24 24" width={14} height={14}><path d={dpath} /></svg>
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Case"><Seg value={item.textCase ?? "none"} options={[["none", "Aa", "As typed"], ["uppercase", "AA", "UPPERCASE"], ["lowercase", "aa", "lowercase"], ["capitalize", "Ab", "Title Case"]]} onChange={(v) => setF((it) => { it.textCase = v; })} /></Row>
            <Row label="Letters"><Slider value={numAt(item, "letterSpacing", t - item.start)} min={-0.2} max={0.6} step={0.005} fmt={(v) => v.toFixed(2)} onChange={(v) => setF((it) => { setNum(it, "letterSpacing", st().t, v); }, false)} /></Row>
            <Row label="Words"><Slider value={item.wordSpacing ?? 0} min={-0.3} max={2} step={0.01} fmt={(v) => v.toFixed(2)} onChange={(v) => setF((it) => { it.wordSpacing = v; }, false)} /></Row>
            <Row label="Lines"><Slider value={item.lineHeight ?? 0.9} min={0.6} max={2.4} step={0.01} fmt={(v) => v.toFixed(2)} onChange={(v) => setF((it) => { it.lineHeight = v; }, false)} /></Row>
            <Row label="Width"><Seg value={item.wrap ? "wrap" : "auto"} options={[["auto", "Auto", "Grows to fit each line"], ["wrap", "Wrap", "Fixed width, lines wrap"]]} onChange={(v) => setF((it) => { it.wrap = v === "wrap"; })} /></Row>
            {item.wrap && <Row label="Box width"><Slider value={item.w} min={80} max={project.width * 1.5} onChange={(v) => setF((it) => { it.w = v; }, false)} /></Row>}

              <button className="chip" style={{ marginTop: 8 }} onClick={() => setUI({ panel: null, editingText: item.id })}>Type on the canvas</button>
            </>}
            {textTab === "colour" && <>
            <Row label="Type"><Seg value={item.textFill ? item.textFill.kind : grad ? "grad" : "solid"} options={[["solid", "Solid"], ["grad", "Gradient"], ["image", "Image"], ["video", "Video"]]} onChange={(v) => {
              if (v === "image") { pickImageFile().then((f) => { if (f) setF((it) => { it.textFill = { kind: "image", url: f.url }; delete it.textGradient; }); }); return; }
              if (v === "video") { pickTextVideo(item.id); return; }
              setF((it) => { delete it.textFill; it.textGradient = v === "grad" ? { from: it.color ?? "#111111", to: "#E0571A", angle: 90 } : undefined; });
            }} /></Row>
            {item.textFill && <>
              <Row label={item.textFill.kind === "video" ? "Video" : "Picture"}>
                <span className="chips" style={{ margin: 0 }}>
                  <button className="chip" onClick={() => (item.textFill!.kind === "video" ? pickTextVideo(item.id) : pickImageFile().then((f) => { if (f) setF((it) => { it.textFill = { ...it.textFill!, kind: "image", url: f.url }; }); }))}>Replace…</button>
                  {item.textFill.kind === "video" && (project.assets ?? []).filter((a) => a.kind === "video" && a.id !== item.textFill!.src).slice(0, 3).map((a) => (
                    <button key={a.id} className="chip" onClick={() => setF((it) => { it.textFill = { ...it.textFill!, src: a.id }; })}>{a.name.replace(/\.[^.]+$/, "").slice(0, 12)}</button>
                  ))}
                </span>
              </Row>
              <Row label="Zoom"><Slider value={item.textFill.zoom ?? 1} min={1} max={4} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setF((it) => { it.textFill = { ...it.textFill!, zoom: v }; }, false)} /></Row>
            </>}
            {!grad && !item.textFill && <Row label="Colour"><Color value={colorAt(item, "color", t - item.start)} onChange={(c) => setF((it) => { setColor(it, "color", st().t, c ?? "#111111"); }, false)} /></Row>}
            <LetterColors item={item} local={t - item.start} />
            {grad && <>
              <Row label="From"><Color value={grad.from} onChange={(c) => setF((it) => { it.textGradient = { ...it.textGradient!, from: c ?? "#111111" }; }, false)} /></Row>
              <Row label="To"><Color value={grad.to} onChange={(c) => setF((it) => { it.textGradient = { ...it.textGradient!, to: c ?? "#E0571A" }; }, false)} /></Row>
              <Row label="Angle"><Slider value={grad.angle} min={0} max={360} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => setF((it) => { it.textGradient = { ...it.textGradient!, angle: v }; }, false)} /></Row>
            </>}

              <div className="psub">Outline</div>
            <Row label="Width"><Slider value={item.stroke?.width ?? 0} min={0} max={30} step={0.5} onChange={(v) => setF((it) => { it.stroke = { width: v, color: it.stroke?.color ?? "#111111" }; }, false)} /></Row>
            {!!item.stroke?.width && <Row label="Colour"><Color value={item.stroke.color} onChange={(c) => setF((it) => { it.stroke = { width: it.stroke?.width ?? 2, color: c ?? "#111111" }; }, false)} /></Row>}

            </>}
            {textTab === "box" && <>
            <Row label="Colour"><Color allowNone value={item.textBg} onChange={(c) => setF((it) => { it.textBg = c; }, false)} /></Row>
            {item.textBg && <>
              <Row label="Opacity"><Slider value={item.bgOpacity ?? 1} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setF((it) => { it.bgOpacity = v; }, false)} /></Row>
              <Row label="Padding"><Slider value={item.textPad ?? 24} min={0} max={200} onChange={(v) => setF((it) => { it.textPad = v; }, false)} /></Row>
              <Row label="Corners"><Slider value={numAt(item, "radius", t - item.start)} min={0} max={300} onChange={(v) => setF((it) => { setNum(it, "radius", st().t, v); }, false)} /></Row>
            </>}

            </>}
            {textTab === "tricks" && <>
            <Row label="Trick"><Seg value={item.textFx?.kind ?? "none"} options={[["none", "None"], ["count", "Count up"], ["scramble", "Scramble"], ["cursor", "Cursor"]]}
              onChange={(v) => setF((it) => { if (v === "none") delete it.textFx; else it.textFx = { ...it.textFx, kind: v as "count" | "scramble" | "cursor", ...(v === "count" && it.textFx?.kind !== "count" ? { from: 0, to: 100, decimals: 0 } : {}) }; })} /></Row>
            {item.textFx?.kind === "count" && <>
              <Row label="From / to"><span className="hsize" style={{ gap: 4 }}>
                <Num label="from" value={item.textFx.from ?? 0} step={1} onChange={(v) => setF((it) => { it.textFx = { ...it.textFx!, from: v }; })} />
                <Num label="to" value={item.textFx.to ?? 100} step={1} onChange={(v) => setF((it) => { it.textFx = { ...it.textFx!, to: v }; })} />
              </span></Row>
              <Row label="Decimals"><Slider value={item.textFx.decimals ?? 0} min={0} max={3} step={1} onChange={(v) => setF((it) => { it.textFx = { ...it.textFx!, decimals: v }; }, false)} /></Row>
              <Row label="Before / after"><span className="hsize" style={{ gap: 4 }}>
                <input className="pin" placeholder="$" value={item.textFx.prefix ?? ""} onKeyDown={(ev) => ev.stopPropagation()} onChange={(ev) => setF((it) => { it.textFx = { ...it.textFx!, prefix: ev.target.value }; }, false)} />
                <input className="pin" placeholder="%" value={item.textFx.suffix ?? ""} onKeyDown={(ev) => ev.stopPropagation()} onChange={(ev) => setF((it) => { it.textFx = { ...it.textFx!, suffix: ev.target.value }; }, false)} />
              </span></Row>
            </>}
            {(item.textFx?.kind === "count" || item.textFx?.kind === "scramble") && <Row label="Takes"><Slider value={item.textFx.dur ?? (item.textFx.kind === "scramble" ? Math.min(1.2, item.end - item.start) : item.end - item.start)} min={0.1} max={Math.max(0.2, item.end - item.start)} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setF((it) => { it.textFx = { ...it.textFx!, dur: v }; }, false)} /></Row>}
            </>}
          </>
        );
      }
      case "fill":
        return (
          <>
            <Row label="Colour"><Color value={colorAt(item, "fill", t - item.start)} onChange={(c) => setF((it) => { const v = c ?? "#888888"; if (/^#[0-9a-f]{6}$/i.test(v) && /^#[0-9a-f]{6}$/i.test(it.fill)) setColor(it, "fill", st().t, v); else { it.fill = v; delete it.colorKeys?.fill; } }, false)} /></Row>
            {!item.fill.startsWith("url(") && <GradientFill item={item} />}
            {CONTAINER_KINDS.includes(item.kind) && <PlaceInside item={item} />}
            {item.fill.startsWith("url(") && <>
              <Row label="Fit"><Seg value={item.fit ?? "cover"} options={[["cover", "Fill"], ["contain", "Fit"]]} onChange={(v) => setF((it) => { it.fit = v; })} /></Row>
              <div className="psub">Image inside the shape</div>
              <Row label="Zoom"><Slider value={item.imgZoom ?? 1} min={0.2} max={6} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setF((it) => { it.imgZoom = v; }, false)} /></Row>
              <Row label="Left/right"><Slider value={item.imgX ?? 0} min={-100} max={100} step={0.5} fmt={(v) => `${Math.round(v)}%`} onChange={(v) => setF((it) => { it.imgX = v; }, false)} /></Row>
              <Row label="Up/down"><Slider value={item.imgY ?? 0} min={-100} max={100} step={0.5} fmt={(v) => `${Math.round(v)}%`} onChange={(v) => setF((it) => { it.imgY = v; }, false)} /></Row>
              <div className="chips">
                <button className="chip on" onClick={() => { st().checkpoint(); select(id); setUI({ panel: null, cropping: id, mode3d: false }); }}>Adjust on the canvas</button>
                <button className="chip" onClick={() => setF((it) => { it.imgX = 0; it.imgY = 0; it.imgZoom = 1; })}>Reset</button>
              </div>
            </>}
            {/* shapes have it in the Shape card; pictures and videos keep it here */}
            {["image", "video"].includes(item.kind) && <>
              <Row label="Hollow"><Slider value={numAt(item, "hollow", t - item.start)} min={0} max={Math.round(Math.min(item.w, item.h) / 2)} fmt={(v) => (v ? `${Math.round(v)}px rim` : "Solid")} onChange={(v) => setF((it) => { setNum(it, "hollow", st().t, Math.round(v)); }, false)} /></Row>
            </>}
            {(item.kind === "rect" || item.kind === "image") && <Row label="Corners"><Slider value={Math.min(item.radius ?? 0, Math.min(item.w, item.h) / 2)} min={0} max={Math.round(Math.min(item.w, item.h) / 2)} onChange={(v) => setF((it) => { it.radius = v; }, false)} /></Row>}
            <div className="psub">Border</div>
            {!!item.stroke?.width && <Row label="Draw"><Slider value={lookAt(item, t - item.start).draw ?? 1} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setF((it) => { setLook(it, "draw", st().t, v); }, false)} /></Row>}
            <Row label="Width"><Slider value={item.stroke?.width ?? 0} min={0} max={40} onChange={(v) => setF((it) => { it.stroke = { width: v, color: it.stroke?.color ?? "#111111" }; }, false)} /></Row>
            {!!item.stroke?.width && <Row label="Colour"><Color value={item.stroke.color} onChange={(c) => setF((it) => { it.stroke = { width: it.stroke?.width ?? 2, color: c ?? "#111111" }; }, false)} /></Row>}
          </>
        );
      case "rotate":
      case "transform":
        return (
          <>
            <div className="atabs2" role="tablist">
              {([["pos", "Position & size", "Where it is and how big"], ["3d", "3D", "Turn it in 3D: X, Y and Z"], ...(item && PINNABLE(item) ? [["pin", "Corner pin", "Move each corner on its own: it warps in perspective"]] : [])] as ["pos" | "3d" | "pin", string, string][]).map(([k, l, tip]) =>
                <button key={k} role="tab" className={posTab === k ? "on" : ""} title={tip} onClick={() => setPosTab(k)}>{l}{k === "pin" && item && isPinned(item) ? <i /> : null}</button>)}
            </div>
            {posTab === "pos" && <>
            {item?.kind !== "motion" && <Row label="Position" kf={kf(["x", "y", "z"])}>{nums([["x", "X"], ["y", "Y"], ["z", "Z"]], 1)}</Row>}
            <Row label="Scale" kf={kf(["scale"])}>{nums([["scale", "%"]], 0.005, pct, (n) => n / 100)}</Row>
            {item?.kind !== "motion" && <Row label="Size"><div className="f2 wh">
              <Num label="W" value={item.w} onChange={(v) => setF((it) => { const w = Math.max(1, Math.round(v)); if (it.lockRatio) it.h = Math.max(1, Math.round((it.h * w) / it.w)); it.w = w; }, false)} />
              <Num label="H" value={item.h} onChange={(v) => setF((it) => { const h = Math.max(1, Math.round(v)); if (it.lockRatio) it.w = Math.max(1, Math.round((it.w * h) / it.h)); it.h = h; }, false)} />
              <button className={"chip" + (item.lockRatio ? " on" : "")} title={item.lockRatio ? "Width and height stay in proportion" : "Keep width and height in proportion"} onClick={() => setF((it) => { it.lockRatio = !it.lockRatio; })}>{item.lockRatio ? "🔒" : "🔓"}</button>
            </div></Row>}
            {item?.kind !== "motion" && <div className="chips" style={{ marginTop: 4 }}>
              <button className="chip" onClick={() => { st().checkpoint(); P("x").set(project.width / 2); P("y").set(project.height / 2); }}>Center on canvas</button>
            </div>}
            </>}
            {posTab === "pin" && item && PINNABLE(item) && (() => {
              const off = pinAt(item, t - item.start) ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
              const pinned = st().ui.pinning === item.id;
              return <>
                {RESHAPABLE(item) && <Row label="Mode"><Seg value={item.pinMode === "shape" ? "shape" : "persp"} options={[["persp", "Perspective", "Warp it like a card tilted in space"], ["shape", "Reshape", "Bend the outline and border to the corners (border keeps its thickness)"]]} onChange={(v) => setF((it) => { if (v === "shape") it.pinMode = "shape"; else delete it.pinMode; })} /></Row>}
                {(["Top left", "Top right", "Bottom right", "Bottom left"] as const).map((lab, i) => (
                  <Row key={lab} label={lab}><div className="f2 even">
                    <Num label="X" value={Math.round(off[i][0] * 10) / 10} onChange={(v) => setF((it) => { setPinCorner(it, st().t, i, [v, off[i][1]]); }, false)} />
                    <Num label="Y" value={Math.round(off[i][1] * 10) / 10} onChange={(v) => setF((it) => { setPinCorner(it, st().t, i, [off[i][0], v]); }, false)} />
                  </div></Row>
                ))}
                <div className="chips" style={{ marginTop: 6 }}>
                  <button className={"chip" + (pinned ? " on" : "")} onClick={() => setUI(pinned ? { pinning: null } : { pinning: item.id, mode3d: false, panel: null })}>{pinned ? "Done on canvas" : "Drag the corners on the canvas"}</button>
                  {isPinned(item) && <button className="chip" onClick={() => setF((it) => { clearPin(it); })}>Reset</button>}
                </div>
              </>;
            })()}
            {posTab === "3d" && <>
            {/* the same gimbal as on the canvas: drag the ball to tumble, the ring to spin, click an axis to face it */}
            {(item || group) && <RotationGimbal inline itemId={item ? item.id : null} trackId={group?.id} s={item ? itemState(project, item, t) : groupValues(group!, t)} onExit={() => {}} />}
            <Row label="Rotation" kf={kf(["rx", "ry", "rz"])}>{nums([["rx", "X"], ["ry", "Y"], ["rz", "Z"]], 0.5, deg)}</Row>
            <div className="chips">
              <button className="chip" onClick={() => { st().checkpoint(); P("rx").set(0); P("ry").set(0); P("rz").set(0); }}>Reset</button>
              <button className={"chip" + (st().ui.mode3d ? " on" : "")} onClick={() => setUI({ mode3d: !st().ui.mode3d })}>3D gimbal {st().ui.mode3d ? "on" : "off"}</button>
            </div>
            </>}
          </>
        );
      case "opacity":
      case "effects": {
        const L = (k: keyof typeof NO_LOOK, label: string, max: number) => (
          <Row label={label}><Slider value={lookAt(item, t - item.start)[k]} min={0} max={max} step={k === "blur" ? 0.5 : 1} onChange={(v) => setF((it) => { setLook(it, k, st().t, v); }, false)} /></Row>
        );
        return (
          <>
            <div className="atabs2" role="tablist">
              {([["fx", "Effects", "Glow, shadow, blur, depth and more"], ["blend", "Opacity & blend", "How see-through it is, and how it mixes with what's under it"]] as const).map(([k, l, tip]) =>
                <button key={k} role="tab" className={fxTab === k ? "on" : ""} title={tip} onClick={() => setFxTab(k)}>{l}</button>)}
            </div>
            {fxTab === "fx" && <>
            <LookOptions item={item} L={L} />
            {item.kind === "text" && <TextShadowOpts item={item} />}
            <ItemFxSection item={item} />
            </>}
            {fxTab === "blend" && <>
            <Row label="Opacity" kf={kf(["opacity"])}><Slider value={P("opacity").get()} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => P("opacity").set(v)} /></Row>
            <div className="psub">Blend · how it mixes with what's under it</div>
            <div className="blends">
              {BLEND_GROUPS.map(([g, modes]) => (
                <div key={g || "n"} className="bgroup">
                  {g && <span className="bgl">{g}</span>}
                  <div className="bbtns">
                    {modes.map(([m, label]) => (
                      <button key={m} className={(item.blend ?? "normal") === m ? "on" : ""} title={label} onClick={() => setF((it) => { it.blend = m; })}>
                        <i className="bsw"><b style={{ mixBlendMode: m }} /></i>{label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </>}
          </>
        );
      }
      case "keys":
        return (
          <>
            <div className="chips">
              <button className={"chip" + (graph ? " on" : "")} onClick={() => { select(id); setUI({ graph: !graph }); }}>Graph under the track</button>
              <button className="chip" onClick={() => { edit((d) => { const it = d.items.find((q) => q.id === id)!; (["x", "y", "rz", "scale", "opacity"] as Prop[]).forEach((p) => addKey(it, p, st().t - it.start)); }); toast("Keys set at the playhead"); }}>Key all here</button>
              <button className="chip" onClick={() => { edit((d) => { const it = d.items.find((q) => q.id === id)!; for (const p of Object.keys(it.keys) as Prop[]) { it.base[p] = ownValue(it, p, st().t); delete it.keys[p]; } }); toast("Keyframes cleared"); }}>Clear all</button>
            </div>
          </>
        );
      case "chart": {
        const c = item.chart!;
        const rows = c.labels.map((l, i) => `${l}, ${c.values[i] ?? 0}`).join("\n");
        return (
          <>
            <Row label="Type"><Seg value={c.type} options={[["bar", "Bars"], ["line", "Line"], ["pie", "Pie"]]} onChange={(v) => setF((it) => { it.chart = { ...it.chart!, type: v as "bar" | "line" | "pie" }; })} /></Row>
            <div className="psub">Numbers · one "label, value" per line</div>
            <textarea className="ptext" rows={6} defaultValue={rows} key={item.id + c.labels.length} onKeyDown={(ev) => ev.stopPropagation()} onFocus={() => st().checkpoint()}
              onChange={(ev) => {
                const lines = ev.target.value.split("\n").map((ln) => ln.split(",")).filter((p) => p[0].trim() || p[1]);
                setF((it) => { it.chart = { ...it.chart!, labels: lines.map((p) => p[0].trim()), values: lines.map((p) => parseFloat((p[1] ?? "0").replace(/[^\d.-]/g, "")) || 0) }; }, false);
              }} />
            <Row label="Grow in"><Seg value={c.grow ? "on" : "off"} options={[["on", "Over 1s"], ["off", "Off"]]} onChange={(v) => setF((it) => { it.chart = { ...it.chart!, grow: v === "on" }; })} /></Row>
            <Row label="Labels"><Color value={c.labelColor ?? "#555555"} onChange={(col) => setF((it) => { it.chart = { ...it.chart!, labelColor: col ?? "#555555" }; }, false)} /></Row>
          </>
        );
      }
      case "particles": {
        const q = item.particles!;
        const sp = (k: "count" | "speed" | "size" | "gravity", label: string, min: number, max: number, step: number) =>
          <Row label={label}><Slider value={q[k]} min={min} max={max} step={step} fmt={(v) => (k === "count" ? `${Math.round(v)}` : `${v.toFixed(2)}×`)} onChange={(v) => setF((it) => { it.particles = { ...it.particles!, [k]: k === "count" ? Math.round(v) : v }; }, false)} /></Row>;
        return (
          <>
            <Row label="Kind"><Seg value={q.kind} options={[["confetti", "Confetti"], ["sparks", "Sparks"], ["snow", "Snow"], ["dust", "Dust"]]} onChange={(v) => setF((it) => { it.particles = { ...PARTICLE_DEFAULTS[v as ParticleSpec["kind"]], colors: [...PARTICLE_DEFAULTS[v as ParticleSpec["kind"]].colors] }; })} /></Row>
            {sp("count", "How many", 5, 600, 1)}
            {sp("speed", "Speed", 0.1, 3, 0.05)}
            {sp("size", "Size", 0.2, 4, 0.05)}
            {sp("gravity", "Gravity", 0, 3, 0.05)}
            <Row label="Colours">
              <div className="gcols">
                {q.colors.map((col, i) => (
                  <span key={i} className="gcol" style={{ background: col }}>
                    <input type="color" value={/^#[0-9a-f]{6}$/i.test(col) ? col : "#ffffff"} onFocus={() => st().checkpoint()} onChange={(ev) => setF((it) => { const cs = [...it.particles!.colors]; cs[i] = ev.target.value; it.particles = { ...it.particles!, colors: cs }; }, false)} />
                    {q.colors.length > 1 && <button title="Remove" onClick={() => setF((it) => { it.particles = { ...it.particles!, colors: it.particles!.colors.filter((_, j) => j !== i) }; })}><Icon name="x" size={9} /></button>}
                  </span>
                ))}
                {q.colors.length < 8 && <button className="gcol add" onClick={() => setF((it) => { it.particles = { ...it.particles!, colors: [...it.particles!.colors, SW[it.particles!.colors.length % SW.length]] }; })}><Icon name="plus" size={11} /></button>}
              </div>
            </Row>
          </>
        );
      }
      case "track": return <TrackBody item={item} />;
      case "media": {
        const local = t - item.start;
        return (
          <>
            <Row label="Volume"><Slider value={numAt(item, "volume", local)} min={0} max={2} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setF((it) => { setNum(it, "volume", st().t, v); }, false)} /></Row>
            <Row label="Fade in"><Slider value={item.fadeIn ?? 0} min={0} max={Math.min(5, item.end - item.start)} step={0.05} fmt={(v) => (v ? `${v.toFixed(2)}s` : "off")} onChange={(v) => setF((it) => { it.fadeIn = v || undefined; }, false)} /></Row>
            <Row label="Fade out"><Slider value={item.fadeOut ?? 0} min={0} max={Math.min(5, item.end - item.start)} step={0.05} fmt={(v) => (v ? `${v.toFixed(2)}s` : "off")} onChange={(v) => setF((it) => { it.fadeOut = v || undefined; }, false)} /></Row>
            <Row label="Under others"><Seg value={item.duck ? "dip" : "keep"} options={[["keep", "Keep level"], ["dip", "Dip when others play"]]} onChange={(v) => setF((it) => { it.duck = v === "dip" || undefined; })} /></Row>
            <div className="psub">Speed</div>
            <Row label="Speed"><Slider value={item.speed ?? 1} min={0.25} max={4} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => setF((it) => { it.speed = Math.abs(v - 1) < 0.001 ? undefined : v; }, false)} /></Row>
            <div className="chips">
              {[0.25, 0.5, 1, 2, 4].map((v) => <button key={v} className={"chip" + ((item.speed ?? 1) === v ? " on" : "")} onClick={() => setF((it) => { it.speed = v === 1 ? undefined : v; })}>{v}×</button>)}
              <button className={"chip" + (item.reverse ? " on" : "")} onClick={() => setF((it) => { it.reverse = !it.reverse || undefined; })}>Backwards</button>
            </div>
            <div className="psub">Beats</div>
            <div className="chips">
              <button className="chip" onClick={async () => {
                const beats = await findBeats(item.src!);
                const len = item.end - item.start, sp = item.speed ?? 1, off = item.mediaOffset ?? 0;
                const at = beats.map((b) => item.start + (b - off) / sp).filter((x) => x >= item.start && x <= item.start + len);
                if (!at.length) { toast("No clear beats found in this clip"); return; }
                edit((d) => { d.markers = [...(d.markers ?? []).filter((m) => m.label !== "beat"), ...at.map((x) => ({ id: uid("mk"), t: Math.round(x * 1000) / 1000, label: "beat" }))]; });
                toast(`${at.length} beat markers added`);
              }}>Find beats</button>
              <button className="chip" onClick={() => edit((d) => { d.markers = (d.markers ?? []).filter((m) => m.label !== "beat"); })}>Clear beats</button>
            </div>
          </>
        );
      }
      case "mask":
        return maskTabs("mask");
      case "layer":
        return (
          <>
            <MaskAndRepeat item={item} />
            <div className="psub">Order</div>
            <div className="chips">
              <button className="chip" onClick={() => layer(id, "front")}>Bring to front</button>
              <button className="chip" onClick={() => layer(id, "forward")}>Forward</button>
              <button className="chip" onClick={() => layer(id, "backward")}>Backward</button>
              <button className="chip" onClick={() => layer(id, "back")}>Send to back</button>
            </div>
            <div className="chips" style={{ marginTop: 6 }}>
              <button className="chip" onClick={() => duplicate(id)}>Duplicate</button>
              <button className="chip" title="Save as a preset" onClick={() => savePreset(item)}>Save as preset</button>
              <button className="chip danger" onClick={() => { edit((d) => { d.items = d.items.filter((q) => q.id !== id); }); select(null); setUI({ panel: null }); toast(`${item.name} deleted · Ctrl+Z brings it back`); }}>Delete</button>
            </div>
          </>
        );
      case "group": {
        const g = groupOf(project, item);
        if (!g) return <p className="hint">This item isn't in a group.</p>;
        return (
          <>
            <div className="chips">
              <button className="chip" onClick={() => edit((d) => { const tid = addTrack(d, "video"); d.items.find((q) => q.id === id)!.trackId = tid; })}>Take out of group</button>
              <button className="chip" onClick={() => edit((d) => ungroupTrack(d, g.id))}>Ungroup all</button>
            </div>
          </>
        );
      }
    }
    return null;
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          ref={ref} className={"pop epanel" + (sheet ? " sheet" : "")} role="dialog" aria-label={titles[panel!.section]} style={{ left: x, top: y, width: cardW, maxHeight: maxH, overflowY: "auto" }}
          initial={{ opacity: 0, y: above ? 6 : -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ type: "spring", stiffness: 500, damping: 36 }}
        >
          <div className="pophead" onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            const sx = e.clientX - x, sy = e.clientY - y;
            const mv = (ev: PointerEvent) => setDrag({ x: ev.clientX - sx, y: ev.clientY - sy });
            const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
            addEventListener("pointermove", mv); addEventListener("pointerup", up);
          }}>
            <div className="phline">
              <b>{titles[panel!.section]}</b>
              {item ? (
                <input className="pitem" value={item.name} title="Rename this item" aria-label="Item name"
                  onFocus={() => st().checkpoint()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onChange={(e) => setF((it) => { it.name = e.target.value; }, false)} />
              ) : <small>{group ? `${group.name} · whole group` : project.name}</small>}
            </div>
            <button className="ib" title="Close (Esc)" onClick={() => setUI({ panel: null })}><Icon name="x" /></button>
          </div>
          <div className="popbody">{body()}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** How long the video is (Auto = it ends where the last item ends). */
function LengthControl() {
  const project = useStore((s) => s.project);
  const { edit } = useStore.getState();
  const auto = project.autoLength !== false;
  const [txt, setTxt] = useState<string | null>(null);
  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (isFinite(v) && v > 0 && Math.abs(v - project.duration) > 1e-3) edit((p) => { p.autoLength = false; p.duration = Math.round(v * 1000) / 1000; });
    setTxt(null);
  };
  return (
    <span className="lenctl" title="How long the video is">
      <input value={txt ?? project.duration.toFixed(2)} aria-label="Video length in seconds"
        onFocus={(e) => { setTxt(project.duration.toFixed(2)); e.currentTarget.select(); }}
        onChange={(e) => setTxt(e.target.value)} onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setTxt(null); (e.target as HTMLInputElement).blur(); } }} />
      <span className="lbl">s</span>
      <button className={"lenauto" + (auto ? " on" : "")} title={auto ? "Auto: the video ends where the last item ends" : "Make the video end where the last item ends"}
        onClick={() => edit((p) => { p.autoLength = true; })}>Auto</button>
    </span>
  );
}

/** A gradient fill: straight or round, with 2–4 colours. */
const gradCSS = (g: NonNullable<Item["fillGrad"]>) => g.type === "radial" ? `radial-gradient(circle at 50% 50%, ${g.stops.join(", ")})` : `linear-gradient(${Math.round(g.angle)}deg, ${g.stops.join(", ")})`;
function GradientFill({ item }: { item: Item }) {
  const g = item.fillGrad;
  const set = (fn: (gr: NonNullable<Item["fillGrad"]>) => void, commit = true) => st().edit((d) => {
    const it = d.items.find((q) => q.id === item.id); if (!it?.fillGrad) return;
    fn(it.fillGrad); it.fill = gradCSS(it.fillGrad);
  }, commit);
  return (
    <>
      <Row label="Gradient"><Seg value={g ? g.type : "off"} options={[["off", "Off"], ["linear", "Straight"], ["radial", "Round"]]} onChange={(v) => st().edit((d) => {
        const it = d.items.find((q) => q.id === item.id); if (!it) return;
        if (v === "off") { it.fill = it.fillGrad?.stops[0] ?? it.fill; delete it.fillGrad; return; }
        const base = /^#[0-9a-f]{6}$/i.test(it.fill) ? it.fill : "#3A5BFF";
        it.fillGrad = { type: v as "linear" | "radial", angle: it.fillGrad?.angle ?? 135, stops: it.fillGrad?.stops ?? [base, "#E0571A"] };
        it.fill = gradCSS(it.fillGrad);
      })} /></Row>
      {g && <>
        <Row label="Colours">
          <div className="gcols">
            {g.stops.map((c, i) => (
              <span key={i} className="gcol" style={{ background: c }} title={`${c} · click to change`}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#888888"} onFocus={() => st().checkpoint()} onChange={(ev) => set((gr) => { gr.stops[i] = ev.target.value; }, false)} />
                {g.stops.length > 2 && <button title="Remove this colour" onClick={() => set((gr) => { gr.stops.splice(i, 1); })}><Icon name="x" size={9} /></button>}
              </span>
            ))}
            {g.stops.length < 4 && <button className="gcol add" title="Add a colour" onClick={() => set((gr) => { gr.stops.push(SW[gr.stops.length % SW.length]); })}><Icon name="plus" size={11} /></button>}
          </div>
        </Row>
        {g.type === "linear" && <Row label="Angle"><Slider value={g.angle} min={0} max={360} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set((gr) => { gr.angle = v; }, false)} /></Row>}
      </>}
    </>
  );
}

/** Things inside a shape: place a picture, video, text, shape or an item already on the canvas. */
function PlaceInside({ item }: { item: Item }) {
  const project = useStore((x) => x.project);
  const [fill, setFill] = useState(true);
  const inside = project.items.filter((i) => i.mask?.inside && i.mask.by === item.id);
  const others = project.items.filter((i) => i.id !== item.id && i.kind !== "audio" && i.kind !== "motion" && !(i.mask?.inside && i.mask.by === item.id));
  return (
    <>
      <div className="psub">Mask things with this shape</div>
      <div className="pinside">
        <button onClick={() => placeImageInside(item.id, fill)}><Icon name="image" size={14} />Picture</button>
        <button onClick={() => placeVideoInside(item.id, fill)}><Icon name="frame" size={14} />Video</button>
        <button onClick={() => placeNewInside(item.id, "text")}><Icon name="type" size={14} />Text</button>
        <button onClick={() => placeNewInside(item.id, "shape")}><Icon name="shapes" size={14} />Shape</button>
      </div>
      <Row label="Pictures"><Seg value={fill ? "fill" : "keep"} options={[["fill", "Fill the shape"], ["keep", "Keep their size"]]} onChange={(v) => setFill(v === "fill")} /></Row>
      {others.length > 0 && <Row label="Move in">
        <select className="psel" value="" onChange={(e) => e.target.value && moveInside(item.id, e.target.value)}>
          <option value="">An item on the canvas…</option>
          {others.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Row>}
      {inside.map((i) => (
        <div key={i.id} className="pinrow"><span>{i.name}</span><button className="chip" onClick={() => takeOut(i.id)} title="Stop masking it with this shape">Unmask</button></div>
      ))}
    </>
  );
}

/** Fill a text item with a video from the computer (it's added to Media too). */
async function pickTextVideo(itemId: string) {
  const files = await new Promise<File[]>((res) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "video/*"; inp.onchange = () => res([...(inp.files ?? [])]); inp.click(); });
  if (!files.length) return;
  const [a] = await importFiles(files);
  if (!a || a.kind !== "video") return;
  st().edit((d) => { const it = d.items.find((q) => q.id === itemId); if (it) { it.textFill = { kind: "video", src: a.id, zoom: it.textFill?.zoom }; delete it.textGradient; } });
}

/** Pick a video from the computer and make it a canvas part's background (it's added to Media too). */
async function chooseBgVideo(bgId: string) {
  const files = await new Promise<File[]>((res) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "video/*";
    inp.onchange = () => res([...(inp.files ?? [])]);
    inp.click();
  });
  if (!files.length) return;
  const [a] = await importFiles(files);
  if (!a || a.kind !== "video") return;
  st().edit((d) => {
    let b = d.backgrounds?.find((q) => q.id === bgId);
    if (!b) { b = { id: uid("bg"), name: "Canvas", start: 0, end: d.duration, kind: "video", colors: [d.background], angle: 0, speed: 0 }; (d.backgrounds ??= []).push(b); }
    b.kind = "video"; b.src = a.id; b.mediaDur = a.dur; b.name = a.name.replace(/\.[^.]+$/, "");
  });
}

function SceneBody({ bgId }: { bgId?: string }) {
  const project = useStore((x) => x.project);
  const t = useStore((x) => x.t);
  const { edit, checkpoint, toast, setUI } = st();
  const bgs = project.backgrounds ?? [];
  const bg = bgs.find((b) => b.id === bgId) ?? activeBackground(project, t);
  const setBg = (fn: (b: Background) => void, commit = true) => edit((d) => { const b = d.backgrounds?.find((q) => q.id === bg?.id); if (b) fn(b); }, commit);
  // colours, angle and movement change at canvas keyframes (with none, they change everywhere)
  const setLook = (fn: (b: { colors: string[]; angle: number; speed: number }) => void, commit = true) => edit((d) => { if (bg) setBgState(d, bg.id, st().t, fn); }, commit);
  const keyed = !!(project.canvasKeys ?? []).length;
  const bgNow = bg ? { ...bg, ...bgStateAt(bg, t) } : undefined;
  const [tab, setTab] = useState<"bg" | "canvas" | "fx" | "looks">("bg");
  const applyPreset = (pr: (typeof BG_PRESETS)[number]) => edit((d) => {
    const look = { name: pr.name, kind: pr.kind, colors: [...pr.colors], angle: pr.angle ?? 0, speed: pr.speed ?? (pr.kind === "solid" ? 0 : 1) };
    const b = d.backgrounds?.find((q) => q.id === bg?.id);
    if (b) Object.assign(b, look);
    else (d.backgrounds ??= []).push({ id: uid("bg"), start: 0, end: d.duration, ...look });
  });
  return (
    <>
      <div className="atabs2" role="tablist">
        {([["bg", "Background"], ["canvas", "Canvas"], ["fx", "Effects"], ["looks", "Looks"]] as const).map(([k, l]) =>
          <button key={k} role="tab" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "canvas" && <>
      <Row label="Size">
        <span className="hsize" style={{ gap: 4 }}>
          <Num label="W" value={project.width} onChange={(v) => edit((d) => { d.width = Math.max(16, Math.round(v)); }, false)} />
          <Num label="H" value={project.height} onChange={(v) => edit((d) => { d.height = Math.max(16, Math.round(v)); }, false)} />
        </span>
      </Row>
      <div className="chips" style={{ marginBottom: 4 }}>
        {([["9:16", 1080, 1920], ["16:9", 1920, 1080], ["1:1", 1080, 1080], ["4:5", 1080, 1350]] as const).map(([l, w, h]) => (
          <button key={l} className={"chip" + (project.width === w && project.height === h ? " on" : "")} onClick={() => edit((d) => { d.width = w; d.height = h; })}>{l}</button>
        ))}
      </div>
      <Row label="Frame rate"><Seg value={String(project.fps)} options={[["24", "24"], ["30", "30"], ["60", "60"]]} onChange={(v) => edit((d) => { d.fps = +v; })} /></Row>
      <Row label="Length"><LengthControl /></Row>
      <Row label="Base colour"><Color value={baseColorAt(project, t)} onChange={(c) => c && edit((d) => { setBaseColor(d, st().t, c); }, false)} /></Row>
      </>}
      {tab === "fx" && <ItemFxSection canvas />}
      {tab === "bg" && <>
      {bg && bgs.length > 1 && <div className="psub" style={{ marginTop: 0 }}>{fmtClock(bg.start)} – {fmtClock(bg.end)}</div>}
      <div className="bgpresets">
        {BG_PRESETS.map((pr) => {
          const css = backgroundCSS({ id: "", start: 0, end: 1, angle: pr.angle ?? 0, speed: pr.speed ?? 1, ...pr }, 0.8);
          return (
            <button key={pr.name} className={bg?.name === pr.name ? "on" : ""} title={pr.name} onClick={() => applyPreset(pr)}>
              <i style={{ background: css.background }} /><span>{pr.name}</span>
            </button>
          );
        })}
        <button className={bg?.kind === "video" ? "on" : ""} title="A video from your computer" onClick={() => chooseBgVideo(bg?.id ?? "")}>
          <i className="bgvid"><Icon name="next" size={16} /></i><span>Video…</span>
        </button>
      </div>
      {bg && <>
        <div className="bgtype">
          {([["solid", "Solid"], ["linear", "Linear"], ["radial", "Radial"], ["conic", "Conic"], ["mesh", "Mesh"], ["aurora", "Aurora"], ["video", "Video"]] as const).map(([v, l]) => (
            <button key={v} className={bg.kind === v ? "on" : ""} onClick={() => {
              if (v === "video") { if (!bg.src) chooseBgVideo(bg.id); else setBg((b) => { b.kind = "video"; }); return; }
              setBg((b) => { b.kind = v; if (v !== "solid" && b.colors.length < 2) b.colors.push("#7B4DFF"); if (v !== "solid" && !b.speed) b.speed = 1; });
            }}>{l}</button>
          ))}
        </div>
        {bg.kind === "video" && <>
          <Row label="Video">
            <span className="chips" style={{ margin: 0 }}>
              <button className="chip" onClick={() => chooseBgVideo(bg.id)}>{bg.src ? "Replace…" : "From computer…"}</button>
              {(project.assets ?? []).filter((a) => a.kind === "video" && a.id !== bg.src).slice(0, 4).map((a) => (
                <button key={a.id} className="chip" title={`Use ${a.name}`} onClick={() => setBg((b) => { b.kind = "video"; b.src = a.id; b.mediaDur = a.dur; })}>{a.name.replace(/\.[^.]+$/, "").slice(0, 14)}</button>
              ))}
            </span>
          </Row>
          {bg.src && <Row label="Plays"><Seg value={bg.once ? "once" : "loop"} options={[["loop", "On a loop"], ["once", "Once"]]} onChange={(v) => setBg((b) => { b.once = v === "once" || undefined; })} /></Row>}
        </>}
        {bg.kind !== "video" && <Row label={bg.colors.length > 1 ? "Colours" : "Colour"}>
          <div className="gcols">
            {(bg.kind === "solid" ? bgNow!.colors.slice(0, 1) : bgNow!.colors).map((c, i) => (
              <span key={i} className="gcol" style={{ background: c }} title={`${c} · click to change`}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#888888"} onFocus={() => checkpoint()} onChange={(ev) => setLook((b) => { b.colors[i] = ev.target.value; }, false)} />
                {bg.kind !== "solid" && bg.colors.length > 2 && !keyed && <button title="Remove this colour" onClick={() => setBg((b) => { b.colors.splice(i, 1); })}><Icon name="x" size={9} /></button>}
              </span>
            ))}
            {bg.kind !== "solid" && bg.colors.length < 6 && !keyed && <button className="gcol add" title="Add a colour" onClick={() => setBg((b) => { b.colors.push(SW[b.colors.length % SW.length]); })}><Icon name="plus" size={11} /></button>}
          </div>
        </Row>}
        {(bg.kind === "linear" || bg.kind === "conic") && <Row label="Angle"><Slider value={bgNow!.angle} min={0} max={360} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => setLook((b) => { b.angle = v; }, false)} /></Row>}
        {bg.kind !== "solid" && bg.kind !== "video" && <Row label="Movement"><Slider value={bgNow!.speed} min={0} max={3} step={0.05} fmt={(v) => (v ? `${v.toFixed(2)}×` : "still")} onChange={(v) => setLook((b) => { b.speed = v; }, false)} /></Row>}
        <div className="chips" style={{ marginTop: 4 }}>
          <button className="chip on" title="Cut the background here"
            onClick={() => { let ok = false; checkpoint(); edit((d) => { ok = splitBackground(d, st().t, uid("bg")); }, false); toast(ok ? `Background cut at ${fmtClock(st().t)} · pick a new look for the next part` : "Move the playhead inside this background to cut it"); if (ok) setUI({ panel: { ...st().ui.panel!, bgId: undefined } }); }}>
            Cut at playhead
          </button>
          {bgs.length > 1 && <button className="chip danger" onClick={() => { edit((d) => { d.backgrounds = d.backgrounds?.filter((b) => b.id !== bg.id); }); }}>Delete this part</button>}
        </div>
      </>}
      </>}

      {tab === "looks" && (Object.keys(SCENE_EFFECTS) as SceneEffectKind[]).map((k) => {
        const part = bgId ? bgs.find((q) => q.id === bgId) : undefined;
        const f = project.effects.find((e) => e.kind === k && (!part || (e.start < part.end - 0.01 && e.end > part.start + 0.01)));
        return (
          <div key={k}>
            <div className="fxrow">
              <span className="nm">{SCENE_EFFECTS[k]}</span>
              <button className={"tog" + (f ? " on" : "")} aria-label={SCENE_EFFECTS[k]} onClick={() => edit((d) => {
                // a look belongs to the selected canvas part (or the whole canvas)
                const part = bgId ? d.backgrounds?.find((q) => q.id === bgId) : undefined;
                const s0 = part?.start ?? 0, e0 = part?.end ?? d.duration;
                if (f) d.effects = d.effects.filter((e) => !(e.kind === k && e.start < e0 - 0.01 && e.end > s0 + 0.01));
                else d.effects.push({ id: uid("fx"), kind: k, start: s0, end: e0, amount: k === "grain" ? 0.22 : 0.6 });
              })} />
            </div>
            {f && <Row label={f.keys?.length ? "Amount here" : "Amount"}><Slider value={amountAt(f, t)} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((d) => { d.effects.filter((e) => e.kind === k && e.start <= t + 0.01 && e.end >= t - 0.01).forEach((e) => setLookAmount(d, e.id, st().t, v)); }, false)} /></Row>}
            {f && FX_OPTS[k]?.map((o) => (
              <Row key={o.key} label={o.label}>
                {o.color
                  ? <Color value={fxOpt<string>(f, o.key)} onChange={(c) => edit((d) => { d.effects.filter((e) => e.kind === k).forEach((e) => { e.opts = { ...e.opts, [o.key]: c ?? String(o.def) }; }); }, false)} />
                  : <Slider value={fxOpt<number>(f, o.key)} min={o.min!} max={o.max!} step={o.step} fmt={(v) => (o.unit === "×" ? `${v.toFixed(2)}×` : o.unit ? `${Math.round(v * 100) / 100}${o.unit}` : `${Math.round(v * 100)}%`)}
                      onChange={(v) => edit((d) => { d.effects.filter((e) => e.kind === k).forEach((e) => { e.opts = { ...e.opts, [o.key]: v }; }); }, false)} />}
              </Row>
            ))}
          </div>
        );
      })}
    </>
  );
}

export { sampleKeys };

/** A tiny looping sample of a text change ("Ab" → "Cd"), drawn the same way the canvas does it. */
function MorphSample({ kind }: { kind: TextMorphKind }) {
  const [u, setU] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (n: number) => { const x = ((n - t0) / 1000) % 2.4; setU(x < 0.4 ? 0 : x < 1.2 ? (x - 0.4) / 0.8 : x < 1.6 ? 1 : 1 - (x - 1.6) / 0.8); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const chars = u <= 0 ? null : u >= 1 ? null : morphChars("Hi", "Yo", u, kind);
  return (
    <span className="msample" aria-hidden="true">
      {chars ? chars.map((c, i) => {
        if (c.kind === "keep") return c.ch;
        const w = c.w ?? c.f, op = c.op ?? c.f, sc = c.sc ?? 1;
        return <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: op, maxWidth: `${w * 1.2}em`, verticalAlign: "top",
          transform: `translateY(${c.dy ?? 0}em) scale(${sc}, ${sc * (c.sy ?? 1)})`, filter: c.blur ? `blur(${c.blur.toFixed(3)}em)` : undefined }}>{c.ch}</span>;
      }) : u >= 1 ? "Yo" : "Hi"}
    </span>
  );
}
/** After picking a text change: play the item's first change on the canvas once, so it can be seen. */
function previewMorph(itemId: string, _k: TextMorphKind) {
  const s = useStore.getState(), it = s.project.items.find((q) => q.id === itemId);
  const ks = it?.textKeys;
  if (!it || !ks || ks.length < 2 || s.playing) return;
  const i = ks.findIndex((q, j) => j > 0 && q.text !== ks[j - 1].text);
  if (i < 1) return;
  const a = it.start + ks[i - 1].t, b = it.start + ks[i].t, back = s.t, t0 = performance.now(), dur = (b - a) * 1000;
  const tick = (n: number) => {
    const x = (n - t0) / dur;
    if (x >= 1.35) { useStore.getState().setT(back); return; }
    useStore.getState().setT(a + (b - a) * Math.min(1, x));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
