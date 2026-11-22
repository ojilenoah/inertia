import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { anim } from "./anim";
import type { Project } from "@moshion/engine";
import { useStore } from "./store";
import { Icon } from "./Icon";

/* ---------------- saved versions: the last 10 of each project, every few minutes ---------------- */
interface Version { key: string; pid: string; at: number; project: Project }
const DB = "moshion-versions";
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore("v", { keyPath: "key" }); s.createIndex("pid", "pid"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function listVersions(pid: string): Promise<Version[]> {
  try {
    const d = await db();
    const all = await new Promise<Version[]>((res) => { const r = d.transaction("v").objectStore("v").index("pid").getAll(pid); r.onsuccess = () => res(r.result as Version[]); r.onerror = () => res([]); });
    return all.sort((a, b) => b.at - a.at);
  } catch { return []; }
}
const lastSaved = new Map<string, number>();
/** Keep a version of the project when the last one is a few minutes old (only the newest 10 are kept). */
export async function maybeSaveVersion(p: Project) {
  const now = Date.now(), prev = lastSaved.get(p.id) ?? 0;
  if (now - prev < 3 * 60 * 1000) return;
  lastSaved.set(p.id, now);
  try {
    const d = await db();
    const old = await listVersions(p.id);
    if (old[0] && now - old[0].at < 3 * 60 * 1000) return;
    const tx = d.transaction("v", "readwrite"), st = tx.objectStore("v");
    st.put({ key: `${p.id}@${now}`, pid: p.id, at: now, project: JSON.parse(JSON.stringify(p)) });
    for (const v of old.slice(9)) st.delete(v.key);
  } catch { /* storage unavailable */ }
}

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString();
};

/** Header button: every undo step (jump back or forward to any), and the project's saved versions. */
export function HistoryButton() {
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const pastTimes = useStore((s) => s.pastTimes);
  const project = useStore((s) => s.project);
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    listVersions(project.id).then(setVersions);
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("pointerdown", off, true);
    return () => removeEventListener("pointerdown", off, true);
  }, [open, project.id]);
  const s = useStore.getState();
  const goBack = (n: number) => { for (let i = 0; i < n; i++) s.undo(); };
  const goFwd = (n: number) => { for (let i = 0; i < n; i++) s.redo(); };
  return (
    <div className="histwrap" ref={ref}>
      <button className={"ib" + (open ? " on" : "")} title="History: every change, and saved versions" onClick={() => setOpen(!open)}><Icon name="history" /></button>
      <AnimatePresence>{open && (
        <motion.div {...anim.pop} className="histpop">
          <div className="psub" style={{ marginTop: 0 }}>Changes</div>
          <div className="histlist">
            {[...future].map((_, i) => future.length - i).map((n) => (
              <button key={"f" + n} className="hrow fut" onClick={() => goFwd(n)}>Redo step {n}<span>undone</span></button>
            ))}
            <div className="hrow now">Now</div>
            {past.slice(-40).map((_, i, arr) => arr.length - i).map((n) => (
              <button key={"p" + n} className="hrow" onClick={() => goBack(n)}>
                Back {n} step{n > 1 ? "s" : ""}<span>{pastTimes[past.length - n] ? ago(pastTimes[past.length - n]) : ""}</span>
              </button>
            ))}
            {!past.length && !future.length && <p className="hint">No changes yet.</p>}
          </div>
          <div className="psub">Saved versions</div>
          <div className="histlist">
            {versions.length ? versions.map((v) => (
              <button key={v.key} className="hrow" title="Bring back this version (Ctrl+Z undoes it)"
                onClick={() => { s.checkpoint(); useStore.setState({ project: v.project }); s.toast(`Back to the version from ${ago(v.at)}`); setOpen(false); }}>
                {new Date(v.at).toLocaleTimeString()}<span>{ago(v.at)}</span>
              </button>
            )) : <p className="hint">A version is kept every few minutes while you work (the last 10).</p>}
          </div>
        </motion.div>
      )}</AnimatePresence>
    </div>
  );
}

/** Redo the last change you undid (Ctrl+Y / Ctrl+Shift+Z). */
export function RedoButton() {
  const can = useStore((x) => x.future.length > 0);
  return (
    <button className="ib" disabled={!can} title={can ? "Redo (Ctrl+Y)" : "Nothing to redo"} aria-label="Redo" onClick={() => useStore.getState().redo()}>
      <Icon name="redo" />
    </button>
  );
}

/** Undo the last change (Ctrl+Z). */
export function UndoButton() {
  const can = useStore((x) => x.past.length > 0);
  return (
    <button className="ib" disabled={!can} title={can ? "Undo (Ctrl+Z)" : "Nothing to undo"} aria-label="Undo" onClick={() => useStore.getState().undo()}>
      <Icon name="undo" />
    </button>
  );
}
