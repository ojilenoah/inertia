import { useEffect } from "react";

/**
 * No hover tooltips. Elements keep their `title` in the code (it names the control), but the moment the pointer
 * reaches one it's moved to the accessible label, so the browser's own tooltip never shows either.
 */
export function Tooltips() {
  useEffect(() => {
    const over = (e: PointerEvent) => {
      const el = (e.target as Element).closest?.("[title]") as HTMLElement | null;
      if (!el) return;
      const t = el.getAttribute("title");
      el.removeAttribute("title");
      if (t && !el.getAttribute("aria-label")) el.setAttribute("aria-label", t);
    };
    addEventListener("pointerover", over, true);
    return () => removeEventListener("pointerover", over, true);
  }, []);
  return null;
}
