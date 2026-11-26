/* the phone's status and navigation bars (Android app): the app draws under them, and the native side reports
   their sizes so the layout keeps clear of them (CSS --sa-t/r/b/l, see styles.css). In a browser this does nothing
   and the browser's own safe-area insets apply. */
type Insets = { t: number; r: number; b: number; l: number };
type Bars = { insets(): string; setDark(dark: boolean): void };

const bars = (): Bars | undefined => (window as unknown as { InertiaBars?: Bars }).InertiaBars;

let last: Insets | null = null, shown = "";
// the native sizes are in dp; a smaller interface (Settings → interface size scales the page) means more CSS pixels
const apply = (o: Insets | null) => {
  if (!o) return;
  last = o;
  const k = window.visualViewport?.scale || 1, px = (v: number) => `${Math.round((v / k) * 10) / 10}px`;
  const next = [o.t, o.r, o.b, o.l].map(px);
  if (next.join() === shown) return;
  shown = next.join();
  const s = document.documentElement.style;
  ["--sa-t", "--sa-r", "--sa-b", "--sa-l"].forEach((n, i) => s.setProperty(n, next[i]));
  dispatchEvent(new Event("resize")); // popups placed from the app's area re-measure
};

export function installSystemBars() {
  const w = window as unknown as { __inertiaInsets?: (o: Insets) => void };
  w.__inertiaInsets = apply; // the native side calls this whenever the bars change
  const b = bars();
  if (!b) return;
  try { apply(JSON.parse(b.insets())); } catch { /* not ready yet: the native side pushes it */ }
  const rescale = () => apply(last);
  window.visualViewport?.addEventListener("resize", rescale);
  return () => window.visualViewport?.removeEventListener("resize", rescale);
}

/** light or dark icons in the status and navigation bars, to match the app's theme */
export const setBarsDark = (dark: boolean) => { try { bars()?.setDark(dark); } catch { /* browser */ } };
