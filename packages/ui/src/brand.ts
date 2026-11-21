import { useEffect, useState } from "react";

/*
 * Brand kit: your colours, fonts and logos, kept for every project. Saved in this browser and,
 * on the dev server, in the shared project folder (so every browser on the computer has them).
 */
export interface Brand { colors: string[]; fonts: string[]; logos: { id: string; name: string; url: string }[] }
const KEY = "moshion.brand.v1";
let brand: Brand = (() => { try { return { colors: [], fonts: [], logos: [], ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as Brand; } catch { return { colors: [], fonts: [], logos: [] }; } })();
const subs = new Set<(b: Brand) => void>();

export function setBrand(fn: (b: Brand) => void, push = true) {
  const next: Brand = JSON.parse(JSON.stringify(brand));
  fn(next);
  brand = next;
  try { localStorage.setItem(KEY, JSON.stringify(brand)); } catch { /* full */ }
  subs.forEach((f) => f(brand));
  if (push) fetch("/__moshion/project/brand", { method: "PUT", body: JSON.stringify({ brand }) }).catch(() => {});
}
/** Pull the brand kit saved by another browser (dev server folder). */
export async function syncBrand() {
  try {
    const r = await fetch("/__moshion/project/brand", { cache: "no-store" });
    if (!r.ok) return;
    const remote = ((await r.json()) as { brand?: Brand }).brand;
    if (!remote) return;
    setBrand((b) => {
      for (const c of remote.colors ?? []) if (!b.colors.includes(c)) b.colors.push(c);
      for (const f of remote.fonts ?? []) if (!b.fonts.includes(f)) b.fonts.push(f);
      for (const l of remote.logos ?? []) if (!b.logos.some((q) => q.id === l.id)) b.logos.push(l);
    }, false);
  } catch { /* not on the dev server */ }
}
export function useBrand(): Brand {
  const [b, set] = useState(brand);
  useEffect(() => { subs.add(set); set(brand); return () => { subs.delete(set); }; }, []);
  return b;
}
export const getBrand = () => brand;
