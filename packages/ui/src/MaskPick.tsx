import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useStore } from "./store";

/**
 * Picking a mask by pointing at it: tap an item on the canvas (hidden masks too) or a clip / group bar on the
 * tracks. "with": the picked one masks this item. "for": this item masks the picked one (an item or a group).
 * Onion skin is on while picking, so hidden masks and masked items show; it goes back to how it was after.
 */
export function startMaskPick(itemId: string, mode: "with" | "for") {
  const s = useStore.getState();
  s.setUI({ pickMask: { itemId, mode, onion: s.ui.onion }, onion: true, ctx: null, panel: null });
}

/** What's under a point: a group bar or clip on the tracks, else the front-most item on the canvas there. */
function pickAt(x: number, y: number): { kind: "item" | "group"; id: string } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const c = el.closest<HTMLElement>(".clip[data-item], .clip[data-group]");
    if (c) return c.dataset.group ? { kind: "group", id: c.dataset.group } : { kind: "item", id: c.dataset.item! };
    if (el.closest(".timeline")) return null;
  }
  // the canvas: by where the items are (hidden masks can't be pointed at otherwise), front-most first
  const objs = [...document.querySelectorAll<HTMLElement>(".world .obj[data-id]")].filter((o) => !o.dataset.id!.includes("~"));
  for (let i = objs.length - 1; i >= 0; i--) {
    const r = objs[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { kind: "item", id: objs[i].dataset.id! };
  }
  return null;
}

export function MaskPicker() {
  const pick = useStore((s) => s.ui.pickMask);
  useEffect(() => {
    if (!pick) return;
    const end = (msg?: string) => {
      const s = useStore.getState();
      s.setUI({ pickMask: null, onion: pick.onion });
      if (msg) s.toast(msg);
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".maskpickbar")) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (e.button === 2) { end(); return; }
      const hit = pickAt(e.clientX, e.clientY);
      if (!hit || hit.id === pick.itemId) return;
      const s = useStore.getState(), p = s.project;
      const me = p.items.find((i) => i.id === pick.itemId);
      if (!me) { end(); return; }
      const name = hit.kind === "group" ? p.tracks.find((t) => t.id === hit.id)?.name : p.items.find((i) => i.id === hit.id)?.name;
      s.edit((d) => {
        if (pick.mode === "with") {
          const it = d.items.find((i) => i.id === pick.itemId); if (!it) return;
          const by = d.items.find((i) => i.id === hit.id);
          it.mask = { by: hit.id, inside: hit.kind === "group" ? true : by?.kind === "text" ? undefined : true };
        } else if (hit.kind === "group") {
          const g = d.tracks.find((t) => t.id === hit.id); if (g) g.mask = { by: pick.itemId, inside: true };
        } else {
          const it = d.items.find((i) => i.id === hit.id); if (it) it.mask = { by: pick.itemId, inside: me.kind === "text" ? undefined : true };
        }
      });
      end(pick.mode === "with" ? `Masked by ${name}` : `${me.name} masks ${name}`);
    };
    const swallow = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".maskpickbar")) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); end(); } };
    addEventListener("pointerdown", down, true);
    addEventListener("click", swallow, true);
    addEventListener("contextmenu", swallow, true);
    addEventListener("keydown", key, true);
    document.body.classList.add("maskpicking");
    return () => {
      removeEventListener("pointerdown", down, true); removeEventListener("click", swallow, true);
      removeEventListener("contextmenu", swallow, true); removeEventListener("keydown", key, true);
      document.body.classList.remove("maskpicking");
    };
  }, [pick?.itemId, pick?.mode]);
  const top = document.querySelector<HTMLElement>(".mo");
  if (!pick || !top) return null;
  return createPortal(
    <div className="linehint maskpickbar"><b>{pick.mode === "with" ? "Pick the mask" : "Pick what it masks"}</b><span>tap an item or clip</span>
      <button onClick={() => { const s = useStore.getState(); s.setUI({ pickMask: null, onion: pick.onion }); }}>Cancel</button>
    </div>, top);
}
