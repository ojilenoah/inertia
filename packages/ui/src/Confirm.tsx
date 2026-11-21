import { useEffect, useState } from "react";

/* A small "are you sure?" bubble next to the pointer (e.g. before deleting a keyframe). */
type Extra = { label: string; run: () => void; disabled?: boolean; hint?: string };
type Ask = { x: number; y: number; text: string; run: () => void; ok?: string; danger?: boolean; extras?: Extra[] } | null;
let current: Ask = null;
const subs = new Set<(a: Ask) => void>();
const set = (a: Ask) => { current = a; subs.forEach((f) => f(a)); };

export function askConfirm(e: { clientX: number; clientY: number }, text: string, run: () => void, ok = "Delete", danger = true, extras?: Extra[]) {
  set({ x: e.clientX, y: e.clientY, text, run, ok, danger, extras });
}

export function ConfirmBubble() {
  const [a, setA] = useState<Ask>(current);
  useEffect(() => { subs.add(setA); return () => { subs.delete(setA); }; }, []);
  useEffect(() => {
    if (!a) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") set(null); if (e.key === "Enter") { a.run(); set(null); } };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [a]);
  if (!a) return null;
  return (
    <div className="cbubble-back" onPointerDown={(e) => { if (e.target === e.currentTarget) set(null); }}>
      <div className="cbubble" style={{ left: Math.min(a.x, innerWidth - 220), top: Math.min(a.y + 8, innerHeight - (a.extras?.length ? 150 : 80)) }}>
        <span>{a.text}</span>
        {a.extras?.length ? (
          <div className="cbextras">
            {a.extras.map((x) => <button key={x.label} disabled={x.disabled} title={x.hint} onClick={() => { x.run(); set(null); }}>{x.label}</button>)}
          </div>
        ) : null}
        <div>
          <button onClick={() => set(null)}>Cancel</button>
          <button className={a.danger === false ? "ok" : "danger"} autoFocus onClick={() => { a.run(); set(null); }}>{a.ok ?? "Delete"}</button>
        </div>
      </div>
    </div>
  );
}
