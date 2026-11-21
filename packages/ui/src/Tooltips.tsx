import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * One tooltip for the whole app: any element with a `title` (or `data-tip`) shows
 * its name on hover, fast and styled, instead of the slow native tooltip.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  useEffect(() => {
    let cur: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => { clearTimeout(timer); cur = null; setTip(null); };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element).closest?.("[title],[data-tip]") as HTMLElement | null;
      if (!el || el === cur) return;
      if (el instanceof SVGElement && !el.closest("button")) return;
      cur = el;
      const t = el.getAttribute("title");
      if (t) { el.dataset.tip = t; el.removeAttribute("title"); }
      const text = el.dataset.tip;
      clearTimeout(timer);
      if (!text) return;
      timer = setTimeout(() => {
        if (cur !== el) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 44 > innerHeight;
        setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 120), innerWidth - 120), y: above ? r.top - 8 : r.bottom + 8, above });
      }, 220);
    };
    const out = (e: PointerEvent) => { if (cur && !cur.contains(e.relatedTarget as Node)) hide(); };
    addEventListener("pointerover", over);
    addEventListener("pointerout", out);
    addEventListener("pointerdown", hide, true);
    addEventListener("wheel", hide, { passive: true });
    return () => { removeEventListener("pointerover", over); removeEventListener("pointerout", out); removeEventListener("pointerdown", hide, true); removeEventListener("wheel", hide); };
  }, []);
  return (
    <AnimatePresence>
      {tip && (
        <motion.div
          key={tip.text + tip.x}
          className="tip"
          style={{ left: tip.x, top: tip.y }}
          initial={{ opacity: 0, x: "-50%", y: tip.above ? "-90%" : -4 }}
          animate={{ opacity: 1, x: "-50%", y: tip.above ? "-100%" : 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.12 }}
        >
          {tip.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
