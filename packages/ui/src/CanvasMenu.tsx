import type { AlignHow } from "./editing";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { LayerMove } from "@moshion/engine";
import { rowBelow, keyTimes, moveLayer, ownValue, uid, addKey, fmtClock, itemHidden, keyLookAndText, layerAt, setLayerKey, stackCompare } from "@moshion/engine";
import type { Item, Prop } from "@moshion/engine";
import { deleteSelection, useStore } from "./store";
import { sectionsFor } from "./EditPanel";
import { groupOf, itemsInGroup } from "@moshion/engine";
import { isPinned } from "@moshion/engine";
import { PINNABLE } from "./Viewer";
import { startMaskPick } from "./MaskPick";
import { Icon } from "./Icon";
import { savePreset } from "./presets";
import { align, copyKeyframe, copyStyle, pasteKeyframe, pasteStyle, toggleLock, groupSelection, ungroupSelection } from "./editing";

export function layer(itemId: string, dir: LayerMove) {
  const s = useStore.getState();
  const it = s.project.items.find((i) => i.id === itemId);
  if (!it) return;
  // an item with keyframes changes layer from the keyframe at the playhead (one is added there if needed)
  if (keyTimes(it).length) { layerAtKeyframe(it, dir); return; }
  if (!moveLayer(structuredClone(s.project), itemId, dir)) {
    s.toast(dir === "front" || dir === "forward" ? `${it.name} is already in front` : `${it.name} is already at the back`);
    return;
  }
  s.edit((p) => { moveLayer(p, itemId, dir); });
  s.toast({ front: "Brought to front", forward: "Brought forward", backward: "Sent backward", back: "Sent to back" }[dir]);
}

/** Kinds of item that can mask another (anything with an outline). */
const MASKABLE = ["shape", "rect", "ellipse", "star", "image", "video", "text", "chart", "particles"];

/** Right-click menu on the video canvas: stacking order and quick item actions. */
export function CanvasMenu() {
  const ctx = useStore((s) => s.ui.ctx);
  const project = useStore((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);
  const { setUI } = useStore.getState();
  const close = () => setUI({ ctx: null });
  const [maskOpen, setMaskOpen] = useState<"with" | "for" | null>(null);
  useEffect(() => setMaskOpen(null), [ctx?.itemId]);

  useEffect(() => {
    if (!ctx) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const id = setTimeout(() => addEventListener("pointerdown", off, true), 0);
    addEventListener("keydown", key);
    return () => { clearTimeout(id); removeEventListener("pointerdown", off, true); removeEventListener("keydown", key); };
  }, [ctx]);

  const it = ctx ? project.items.find((i) => i.id === ctx.itemId) : undefined;
  // where it goes: right under the item on the canvas, or right over it when there's more room there; at the
  // pointer when neither side has room. Whole pixels, so text and lines stay crisp.
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!ctx || !el) { setAt(null); return; }
    const mw = el.offsetWidth, mh = el.offsetHeight;
    const clampX = (v: number) => Math.round(Math.max(8, Math.min(v, innerWidth - mw - 8)));
    const clampY = (v: number) => Math.round(Math.max(8, Math.min(v, innerHeight - mh - 8)));
    const o = document.querySelector(`.world .obj[data-id="${CSS.escape(ctx.itemId)}"]`)?.getBoundingClientRect();
    const sb = document.querySelector(".selbox")?.getBoundingClientRect();
    if (o && o.width && o.bottom > 0 && o.top < innerHeight) {
      const top = Math.min(o.top, sb && sb.width ? sb.top : Infinity), bottom = Math.max(o.bottom, sb && sb.width ? sb.bottom : -Infinity);
      const below = innerHeight - bottom - 18, over = top - 18, cx = o.left + o.width / 2 - mw / 2;
      if (below >= mh || (below >= over && below >= 160)) { setAt({ x: clampX(cx), y: clampY(bottom + 10) }); return; }
      if (over >= mh || over >= 160) { setAt({ x: clampX(cx), y: clampY(top - 10 - Math.min(mh, over)) }); return; }
    }
    setAt({ x: clampX(ctx.x), y: clampY(ctx.y) });
  }, [ctx?.itemId, ctx?.x, ctx?.y, maskOpen]);
  const x = at?.x ?? (ctx ? Math.round(Math.max(8, Math.min(ctx.x, innerWidth - 240))) : 0), y = at?.y ?? (ctx ? Math.round(Math.max(8, Math.min(ctx.y, innerHeight - 330))) : 0);
  const multiN = useStore.getState().ui.multi.length;
  // groups this item could cut (not ones it's inside)
  const maskGroups = it ? project.tracks.filter((g) => g.kind === "group" && !itemsInGroup(project, g.id).some((q) => q.id === it.id)) : [];
  const row = (label: string, keys: string, run: () => void, danger = false) => (
    <button className={"cm-row" + (danger ? " danger" : "")} onClick={() => { run(); close(); }}>
      <span>{label}</span><kbd>{keys}</kbd>
    </button>
  );
  return (
    <AnimatePresence>
      {ctx && it && (
        <motion.div
          ref={ref} className="cmenu" role="menu" style={{ left: x, top: y, visibility: at ? undefined : "hidden" }}
          initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.12 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="cm-head">{it.name}</div>
          <div className="cm-secs">
            {sectionsFor(it, !!groupOf(project, it)).map((sec) => (
              <button key={sec.id} title={sec.label} onClick={() => { useStore.getState().select(it.id); setUI({ ctx: null, panel: { section: sec.id, itemId: it.id, x, y, fromMenu: true } }); }}>
                <Icon name={sec.icon} />
              </button>
            ))}
            {/* lock: this item, or all the selected ones when it's one of them */}
            {(() => {
              const multi = useStore.getState().ui.multi, ids = multi.includes(it.id) && multi.length > 1 ? multi : [it.id];
              const allLocked = ids.every((id) => project.items.find((q) => q.id === id)?.locked);
              return (
                <button className="cm-lock" title={`${allLocked ? "Unlock" : "Lock"}${ids.length > 1 ? ` ${ids.length} selected` : ""} · Ctrl+Shift+L`} onClick={() => { toggleLock(ids); close(); }}>
                  <Icon name={allLocked ? "unlock" : "lock"} />
                </button>
              );
            })()}
          </div>
          {/* stacking, then the everyday actions: one row of buttons */}
          <div className="cm-tools">
            {([["front", "tofront", "Bring to front", "Ctrl+Shift+]"], ["forward", "forward", "Bring forward", "Ctrl+]"], ["backward", "backward", "Send backward", "Ctrl+["], ["back", "toback", "Send to back", "Ctrl+Shift+["]] as const).map(([dir, ic, tip, keys]) => (
              <button key={dir} title={`${tip} · ${keys}`} aria-label={tip} onClick={() => { layer(it.id, dir); close(); }}><Icon name={ic} /></button>
            ))}
            <i className="cm-vsep" />
            <button title="Duplicate · Ctrl+D" aria-label="Duplicate" onClick={() => { duplicate(it.id); close(); }}><Icon name="dup" /></button>
            {it.kind === "text" && <button title="Edit text · double-click" aria-label="Edit text" onClick={() => { setUI({ editingText: it.id }); close(); }}><Icon name="type" /></button>}
            {PINNABLE(it) && <button className={isPinned(it) ? "on" : ""} title="Corner pin: drag each corner on its own" aria-label="Corner pin" onClick={() => { useStore.getState().select(it.id); setUI({ pinning: it.id, mode3d: false, ctx: null }); }}><Icon name="pin" /></button>}
            <button className="danger" title={`${multiN > 1 ? `Delete ${multiN} items` : "Delete"} · Del`} aria-label="Delete" onClick={() => { deleteSelection(); close(); }}><Icon name="trash" /></button>
          </div>
          <div className="cm-align" title={it.mask?.inside ? "Line up with the item it's inside" : "Line up (one item: with the canvas)"}>
            {(["left", "hcenter", "right", "top", "vcenter", "bottom", "hspread", "vspread"] as const).map((k) => <AlignBtn key={k} k={k} close={close} />)}
          </div>
          <div className="cm-sep" />
          <div className="cm-pair">
            <button title="Copy style · Ctrl+Alt+C" onClick={() => { copyStyle(); close(); }}>Copy style</button>
            <button title="Paste style · Ctrl+Alt+V" onClick={() => { pasteStyle(); close(); }}>Paste style</button>
            <button title="Copy keyframe · Alt+C" onClick={() => { copyKeyframe(); close(); }}>Copy key</button>
            <button title="Paste keyframe · Alt+V" onClick={() => { pasteKeyframe(); close(); }}>Paste key</button>
          </div>
          <div className="cm-sep" />
          {multiN > 1 && useStore.getState().ui.multi.includes(it.id) && row(`Group ${multiN} items`, "Ctrl+G", () => groupSelection())}
          {groupOf(project, it) && row(`Ungroup ${groupOf(project, it)!.name}`, "Ctrl+Shift+G", () => ungroupSelection())}
          {/* masks: this item cut by another, or this item cutting a group */}
          {it.mask
            ? row(`Unmask (by ${project.items.find((i) => i.id === it.mask!.by)?.name ?? project.tracks.find((g) => g.id === it.mask!.by)?.name ?? "a shape"})`, "", () => useStore.getState().edit((p) => { const q = p.items.find((i) => i.id === it.id); if (q) delete q.mask; }))
            : <button className="cm-row" onClick={() => setMaskOpen(maskOpen === "with" ? null : "with")}><span>Mask with…</span><kbd className="cm-keep">{maskOpen === "with" ? "▴" : "▾"}</kbd></button>}
          {!it.mask && maskOpen === "with" && (
            <div className="cm-masks">
              <button className="cm-row cm-pick" onClick={() => startMaskPick(it.id, "with")}><span>Pick on the canvas or tracks</span><kbd className="cm-keep">◎</kbd></button>
              {project.items.filter((i) => i.id !== it.id && MASKABLE.includes(i.kind)).map((m) => (
                <button key={m.id} className="cm-row" onClick={() => {
                  useStore.getState().edit((p) => { const q = p.items.find((i) => i.id === it.id); if (q) q.mask = { by: m.id, inside: m.kind === "text" ? undefined : true }; });
                  useStore.getState().toast(`Masked by ${m.name}`);
                  close();
                }}><span>{m.name}</span><kbd className="cm-keep">{m.kind === "shape" ? m.shape?.type ?? "shape" : m.kind}</kbd></button>
              ))}
              {maskGroups.map((g) => (
                <button key={g.id} className="cm-row" onClick={() => {
                  useStore.getState().edit((p) => { const q = p.items.find((i) => i.id === it.id); if (q) q.mask = { by: g.id, inside: true }; });
                  useStore.getState().toast(`Masked by ${g.name}`);
                  close();
                }}><span>{g.name}</span><kbd className="cm-keep">group</kbd></button>
              ))}
              {!project.items.some((i) => i.id !== it.id && MASKABLE.includes(i.kind)) && <span className="cm-empty">Add a shape, image or video first</span>}
            </div>
          )}
          <button className="cm-row" onClick={() => setMaskOpen(maskOpen === "for" ? null : "for")}><span>Use as mask for…</span><kbd className="cm-keep">{maskOpen === "for" ? "▴" : "▾"}</kbd></button>
          {maskOpen === "for" && (
            <div className="cm-masks">
              <button className="cm-row cm-pick" onClick={() => startMaskPick(it.id, "for")}><span>Pick on the canvas or tracks</span><kbd className="cm-keep">◎</kbd></button>
              {maskGroups.map((g) => (
                <button key={g.id} className="cm-row" onClick={() => {
                  useStore.getState().edit((p) => { const tr = p.tracks.find((t) => t.id === g.id); if (tr) tr.mask = { by: it.id, inside: true }; });
                  useStore.getState().toast(`${it.name} now masks the group ${g.name}`);
                  close();
                }}><span>{g.name}</span><kbd className="cm-keep">group</kbd></button>
              ))}
            </div>
          )}
          {groupOf(project, it) && row(`Mask the whole group…`, "", () => setUI({ ctx: null, panel: { section: "transform", itemId: null, trackId: groupOf(project, it)!.id, x: ctx!.x, y: ctx!.y } }))}
          {row("Save as preset", "", () => savePreset(it))}
          {keyTimes(it).length > 0 && row("Clear all keyframes", "", () => {
            const s = useStore.getState();
            s.edit((p) => { const x = p.items.find((q) => q.id === it.id); if (!x) return; for (const k of Object.keys(x.keys) as (keyof typeof x.keys)[]) { x.base[k] = ownValue(x, k, s.t); delete x.keys[k]; } delete x.lookKeys; delete x.textKeys; delete x.numKeys; delete x.colorKeys; delete x.shapeKeys; x.fx?.forEach((f) => delete f.keys); });
            s.toast("Keyframes cleared · Ctrl+Z brings them back");
          }, true)}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function duplicate(itemId: string) {
  const s = useStore.getState();
  let nid = "";
  s.edit((p) => {
    const src = p.items.find((x) => x.id === itemId);
    if (!src) return;
    const c = JSON.parse(JSON.stringify(src));
    c.id = nid = uid("item"); c.name = src.name + " copy";
    c.trackId = rowBelow(p, src.trackId, src.start, src.end);
    p.items.push(c);
    moveLayer(p, c.id, "forward");
  });
  if (nid) { s.select(nid); s.toast("Duplicated on top"); }
}

/* align buttons: a guide line and the bars that line up against it */
const AL: Record<AlignHow, [string, string, string]> = {
  left: ["Align left edges", "M4 3v18", "M7 6h11v4H7zM7 14h7v4H7z"],
  hcenter: ["Centre across", "M12 3v18", "M5 6h14v4H5zM8 14h8v4H8z"],
  right: ["Align right edges", "M20 3v18", "M6 6h11v4H6zM10 14h7v4h-7z"],
  top: ["Align top edges", "M3 4h18", "M6 7h4v11H6zM14 7h4v7h-4z"],
  vcenter: ["Centre up and down", "M3 12h18", "M6 5h4v14H6zM14 8h4v8h-4z"],
  bottom: ["Align bottom edges", "M3 20h18", "M6 6h4v11H6zM14 10h4v7h-4z"],
  hspread: ["Spread out evenly across", "M3 4v16M21 4v16", "M7 8h3v8H7zM14 8h3v8h-3z"],
  vspread: ["Spread out evenly up and down", "M4 3h16M4 21h16", "M8 7h8v3H8zM8 14h8v3H8z"],
};
function AlignBtn({ k, close }: { k: AlignHow; close: () => void }) {
  const [tip, line, bars] = AL[k];
  return (
    <button title={tip} onClick={() => { align(k); close(); }}>
      <svg viewBox="0 0 24 24" width={15} height={15}><path d={line} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" fill="none" /><path d={bars} fill="currentColor" opacity={0.85} /></svg>
    </button>
  );
}

/** Change an animated item's layer from the playhead on, as a keyframe. */
function layerAtKeyframe(it: Item, dir: LayerMove) {
  const s = useStore.getState(), t = s.t, p = s.project;
  const here = p.items.filter((o) => o.kind !== "audio" && o.kind !== "motion" && !itemHidden(p, o) && t >= o.start && t < o.end).sort(stackCompare(p, t));
  const i = here.findIndex((o) => o.id === it.id);
  // every item's place in the stack as one number (its layer, then its track), so the item can land
  // exactly one step up or down: between its new neighbours, never jumping past anything else
  const N = p.tracks.length + 1;
  const rank = (o: Item) => p.tracks.length - p.tracks.findIndex((tr) => tr.id === o.trackId);
  const z = (o: Item) => layerAt(o, t - o.start) + rank(o) / N;
  const rest = here.filter((o) => o.id !== it.id); // the stack without this item, back to front
  let target: number | null = null;
  if (dir === "front") target = i === here.length - 1 ? null : z(rest[rest.length - 1]) + 1;
  else if (dir === "back") target = i === 0 ? null : z(rest[0]) - 1;
  else if (dir === "forward") { const a = here[i + 1], a2 = here[i + 2]; target = a ? (a2 ? (z(a) + z(a2)) / 2 : z(a) + 1) : null; }
  else { const b = here[i - 1], c2 = here[i - 2]; target = b ? (c2 ? (z(b) + z(c2)) / 2 : z(b) - 1) : null; }
  const v = target == null ? null : target - rank(it) / N;
  if (v == null || i < 0) { s.toast(dir === "front" || dir === "forward" ? `${it.name} is already in front here` : `${it.name} is already at the back here`); return; }
  const local = t - it.start;
  const at = keyTimes(it).find((k) => Math.abs(k - local) <= 0.02) ?? local;
  const added = Math.abs(at - local) < 1e-9 && !keyTimes(it).some((k) => Math.abs(k - local) <= 0.02);
  s.edit((d) => {
    const q = d.items.find((o) => o.id === it.id)!;
    if (added) {
      const animated = (Object.keys(q.keys) as Prop[]).filter((pp) => q.keys[pp]?.length);
      for (const pp of animated) addKey(q, pp, at);
      keyLookAndText(q, at);
    }
    setLayerKey(q, at, v!);
  });
  s.toast(`${{ front: "Brought to front", forward: "Brought forward", backward: "Sent backward", back: "Sent to back" }[dir]} from ${fmtClock(it.start + at)}${added ? " · keyframe added" : ""}`);
}
