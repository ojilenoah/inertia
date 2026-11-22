import { useEffect, useState } from "react";
import { useStore } from "./store";

/** The popups that dim and blur what's behind them on phones (the ☰ menu has its own backdrop). */
const POPUPS = ".mo :is(.epanel, .cmenu, .rmenu, .histpop, .gridpop, .shpop, .trpick, .mkpop, .cbubble)";

/**
 * Phones: while a card, menu or popup is open, everything behind it is softly blurred, except what it is about:
 * the selected item on the canvas, its clip on the tracks, and whatever the popup was opened from (a transition's
 * seam, a marker). Those stay sharp, through holes cut in the blur.
 */
export function PhoneDim() {
  const [shape, setShape] = useState<string | null>(null);
  useEffect(() => {
    let last = "";
    const rect = (r: { left: number; top: number; right: number; bottom: number }, p = 5) =>
      `M${Math.round(r.left - p)} ${Math.round(r.top - p)}V${Math.round(r.bottom + p)}H${Math.round(r.right + p)}V${Math.round(r.top - p)}Z`;
    const tick = () => {
      let d = "";
      if (document.querySelector(POPUPS)) {
        const s = useStore.getState();
        const ids = [...new Set([s.selected, ...s.ui.multi].filter(Boolean) as string[])];
        const holes: string[] = [];
        // the item on the canvas: one window around it (and its handles)
        const boxes = [...document.querySelectorAll(".selbox"), ...ids.flatMap((id) => [...document.querySelectorAll(`.world .obj[data-id="${CSS.escape(id)}"]`)])]
          .map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height);
        if (boxes.length) holes.push(rect({ left: Math.min(...boxes.map((r) => r.left)), top: Math.min(...boxes.map((r) => r.top)), right: Math.max(...boxes.map((r) => r.right)), bottom: Math.max(...boxes.map((r) => r.bottom)) }, 8));
        // its clips on the tracks
        for (const id of ids) for (const c of document.querySelectorAll(`.lrows .clip[data-item="${CSS.escape(id)}"]`)) holes.push(rect(c.getBoundingClientRect(), 2));
        // what the popup was opened from (a transition's seam: its canvas row)
        for (const f of document.querySelectorAll(".mo-focus")) holes.push(rect((f.closest(".lrow.canvas") ?? f).getBoundingClientRect(), 2));
        // the outer edge runs one way and every hole the other way, so each hole stays clear
        d = `M0 0H${innerWidth}V${innerHeight}H0Z` + holes.join("");
      }
      if (d !== last) { last = d; setShape(d || null); }
    };
    const timer = setInterval(tick, 90);
    tick();
    return () => clearInterval(timer);
  }, []);
  return shape ? <div className="pdim" style={{ clipPath: `path(nonzero, "${shape}")` }} /> : null;
}
