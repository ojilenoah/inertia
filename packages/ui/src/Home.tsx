import { useEffect, useState } from "react";
import type { Project } from "@moshion/engine";
import { activeBackground, backgroundCSS, newProject, sampleProject } from "@moshion/engine";
import { useStore } from "./store";
import { Icon } from "./Icon";
import { pickExportFolder, shouldAskExportFolder, skipExportFolder } from "./exportfolder";
import { LibEntry, backupAll, bringInOldProjects, listProjects, openInEditor, putProject, removeProject, syncWithDisk } from "./library";
import { chooseFolder, defaultAppFolder, isDesktopApp, oldFolderProjects, pickAppFolder, reconnect, setAppFolder, useDisk } from "./disk";
import { AnimatePresence, motion } from "motion/react";
import { anim } from "./anim";
import { openProject } from "./persist";

const RATIOS = [
  { id: "9:16", label: "Vertical", hint: "Reels · TikTok · Shorts", w: 1080, h: 1920 },
  { id: "16:9", label: "Widescreen", hint: "YouTube · presentations", w: 1920, h: 1080 },
  { id: "1:1", label: "Square", hint: "Feed posts", w: 1080, h: 1080 },
  { id: "4:5", label: "Portrait", hint: "Instagram feed", w: 1080, h: 1350 },
  { id: "21:9", label: "Cinema", hint: "Ultra-wide", w: 2560, h: 1080 },
  { id: "custom", label: "Custom", hint: "Any size", w: 1280, h: 720 },
] as const;
const BGS = ["#FFFFFF", "#EDEAE3", "#111111", "#1B2550", "#FF7A59", "#7B4DFF"];

const ago = (ms: number) => {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};
const newId = () => "proj_" + Math.random().toString(36).slice(2, 10);

/** The Inertia mark: a keyframe sliding past the one before it. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="28 22 64 76" aria-hidden="true" className="hmark">
      <g strokeLinejoin="round">
        <path d="M47 33 L59 60 L47 87 L35 60 Z" fill="currentColor" stroke="currentColor" strokeWidth="5" />
        <path d="M70 27 L85 60 L70 93 L55 60 Z" fill="var(--panel)" stroke="var(--panel)" strokeWidth="11" />
        <path d="M70 27 L85 60 L70 93 L55 60 Z" fill="#E0571A" stroke="#E0571A" strokeWidth="6" />
      </g>
    </svg>
  );
}

/** A tiny drawing of the project: background plus each item's box at the start. */
function Thumb({ p, max = 120 }: { p: Project; max?: number }) {
  const k = Math.min(max / p.width, max / p.height);
  const bg = activeBackground(p, 0.5);
  return (
    <div className="hthumb" style={{ width: p.width * k, height: p.height * k, background: bg ? backgroundCSS(bg, 0.5).background : p.background }}>
      {p.items.filter((i) => i.kind !== "audio").slice(0, 12).map((i) => (
        <i key={i.id} style={{
          left: (i.base.x - i.w / 2) * k, top: (i.base.y - i.h / 2) * k, width: i.w * k, height: i.h * k,
          background: i.kind === "text" ? "transparent" : i.fill.startsWith("url(") ? `${i.fill} center/cover` : i.fill === "transparent" ? "rgba(255,255,255,.4)" : i.fill,
          borderRadius: i.kind === "ellipse" ? "50%" : (i.radius ?? 0) * k,
          color: i.color, fontSize: Math.max(4, (i.fontSize ?? 0) * k), fontWeight: 800,
        }}>{i.kind === "text" ? i.text : null}</i>
      ))}
    </div>
  );
}

/**
 * Desktop app, first start: where projects are kept. Documents/Inertia Projects is offered first; any folder can be
 * picked; projects from the old "Moshion Projects" folder can be brought in.
 */
function FolderSetup({ onDone }: { onDone: () => void }) {
  const [def, setDef] = useState("");
  const [old, setOld] = useState(0);
  const [bring, setBring] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    defaultAppFolder().then(setDef).catch(() => {});
    oldFolderProjects().then((l) => setOld(l.length)).catch(() => {});
  }, []);
  const go = async (path: string | null) => {
    if (!path) return;
    setBusy(true);
    const toast = (m: string) => useStore.getState().toast(m);
    try {
      await setAppFolder(path);
      const n = bring && old ? await bringInOldProjects() : 0;
      await syncWithDisk();
      toast(n ? `Saving to ${path} · ${n} project${n === 1 ? "" : "s"} brought in` : `Projects save to ${path}`);
      onDone();
    } catch (e) { toast(`Couldn't use that folder (${(e as Error)?.message ?? e}) — pick another`); }
    setBusy(false);
  };
  return (
    <motion.div className="xback" {...anim.fade}>
      <motion.div className="xbox fsetup" {...anim.sheet} role="dialog" aria-label="Where to keep projects">
        <div className="xhead"><b>Where should Inertia keep your projects?</b></div>
        <p className="fsnote">Each project is saved there as a file, so it stays safe even if the app is reset or reinstalled. You can change this later on the start screen.</p>
        <button className="fsopt rec" disabled={busy || !def} onClick={() => go(def)}>
          <Icon name="folder" /><span><b>Documents › Inertia Projects</b><small>Recommended</small></span>
        </button>
        <button className="fsopt" disabled={busy} onClick={async () => go(await pickAppFolder().catch(() => null))}>
          <Icon name="folder" /><span><b>Choose another folder…</b><small>Any folder, for example one that's backed up</small></span>
        </button>
        {old > 0 && (
          <label className="fsbring">
            <input type="checkbox" checked={bring} onChange={(e) => setBring(e.target.checked)} />
            Bring in my {old} project{old === 1 ? "" : "s"} from the old “Moshion Projects” folder
          </label>
        )}
      </motion.div>
    </motion.div>
  );
}

/** The Android app, first start: where exported videos go (Android's own folder picker; asked once). */
function ExportFolderAsk({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    setBusy(true);
    const f = await pickExportFolder();
    setBusy(false);
    if (f) { useStore.getState().toast(`Exports will be saved to ${f}`); onDone(); }
  };
  return (
    <motion.div className="xback" {...anim.fade}>
      <motion.div className="xbox fsetup" {...anim.sheet} role="dialog" aria-label="Where to save exports">
        <div className="xhead"><b>Where should your exported videos go?</b></div>
        <button className="fsopt rec" disabled={busy} onClick={pick}>
          <Icon name="folder" /><span><b>Choose a folder</b><small>For example Movies or DCIM</small></span>
        </button>
        <button className="hlink" style={{ alignSelf: "center" }} onClick={() => { skipExportFolder(); onDone(); }}>Later</button>
      </motion.div>
    </motion.div>
  );
}

export function Home() {
  const current = useStore((s) => s.project);
  const [list, setList] = useState<LibEntry[] | null>(null);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]["id"]>("9:16");
  const [cw, setCw] = useState(1280), [ch, setCh] = useState(720);
  const [name, setName] = useState("");
  const [fps, setFps] = useState(30);
  const [dur, setDur] = useState(10);
  const [bg, setBg] = useState(BGS[0]);
  const refresh = () => listProjects().then(setList);
  useEffect(() => { refresh(); const t = setTimeout(refresh, 700); return () => clearTimeout(t); }, []);
  const disk = useDisk();
  const [askExport, setAskExport] = useState(() => shouldAskExportFolder());
  // whenever the project folder becomes available, pull in its projects
  useEffect(() => { if (disk.kind === "app" || disk.kind === "folder") syncWithDisk().then(refresh).catch(() => {}); }, [disk.kind]);

  const r = RATIOS.find((x) => x.id === ratio)!;
  const W = ratio === "custom" ? cw : r.w, H = ratio === "custom" ? ch : r.h;
  const create = () => openInEditor(newProject({ name: name.trim() || "Untitled", width: W, height: H, fps, duration: dur, background: bg }));
  const recent = list ?? [];
  const openFile = () => openProject().then((r) => {
    if (r === "backup") { refresh(); return; }
    if (r !== "project") return;
    const p = useStore.getState().project; putProject(p); useStore.getState().setUI({ view: "edit" });
  });
  const toast = (m: string) => useStore.getState().toast(m);
  // desktop app: move saving to another folder (the projects are written there too)
  const changeFolder = async () => {
    const path = await pickAppFolder().catch(() => null);
    if (!path) return;
    try { await setAppFolder(path); await syncWithDisk(); refresh(); toast(`Projects now save to ${path} — they were copied there`); }
    catch (e) { toast(`Couldn't use that folder (${(e as Error)?.message ?? e})`); }
  };
  const backup = async () => { const n = await backupAll(); toast(n ? `Backed up ${n} project${n === 1 ? "" : "s"} — keep the file somewhere safe; open it with Open file to restore` : "No projects to back up yet"); };

  // the chosen frame, drawn to scale in the preview
  const fk = Math.min(168 / W, 168 / H);
  const folder = (disk.kind === "app" || disk.kind === "server") ? disk.where.split(/[\\/]/).filter(Boolean).pop() : "";

  return (
    <div className="home">
      <AnimatePresence>{disk.kind === "choose" && <FolderSetup onDone={refresh} />}</AnimatePresence>
      <AnimatePresence>{askExport && disk.kind !== "choose" && <ExportFolderAsk onDone={() => setAskExport(false)} />}</AnimatePresence>
      <div className="hwrap">
        <header className="htop">
          <span className="hbrand"><Mark /><b className="hlogo">inertia</b></span>
          <span className="sp" />
          <span className="hdisk">
            {(disk.kind === "app" || disk.kind === "server") && <span className="hsaved" title={`Every project is also saved as a file in ${disk.where}`}><i />Saving to {folder}{disk.kind === "app" && isDesktopApp() && <button className="hlink" onClick={changeFolder}>Change</button>}</span>}
            {disk.kind === "choose" && <span>Not saving to a folder yet</span>}
            {disk.kind === "folder" && <span className="hsaved"><i />Saving to “{disk.name}” <button className="hlink" onClick={() => chooseFolder()}>Change</button></span>}
            {disk.kind === "needs-permission" && <button className="hwarn" onClick={() => reconnect()}>Allow saving to “{disk.name}”</button>}
            {disk.kind === "none" && <button className="hwarn" onClick={() => chooseFolder()} title="Projects are only in this browser's storage until you pick a folder">Save projects to a folder…</button>}
            {disk.kind === "unsupported" && <span title="This browser can't save to a folder; use Chrome/Edge or the desktop app">Browser storage only</span>}
          </span>
          <button className="hghost" onClick={backup} title="Every project in one file, to keep somewhere safe (open it with Open file to restore)">Back up</button>
          <button className="hghost" onClick={openFile}>Open file</button>
        </header>

        <section className="hnew">
          <div className="hstage">
            <div className="hframe" style={{ width: W * fk, height: H * fk, background: bg }} />
            <small>{W} × {H}</small>
          </div>
          <div className="hsetup">
            <input className="hname" value={name} placeholder="Untitled project" aria-label="Project name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <div className="hratios">
              {RATIOS.map((x) => {
                const k = 18 / Math.max(x.w, x.h);
                return (
                  <button key={x.id} className={ratio === x.id ? "on" : ""} onClick={() => setRatio(x.id)} title={x.hint}>
                    <span className="hshape"><i style={{ width: x.id === "custom" ? 15 : x.w * k, height: x.id === "custom" ? 11 : x.h * k, borderStyle: x.id === "custom" ? "dashed" : undefined }} /></span>
                    <span>{x.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="hfields">
              {ratio === "custom" && (
                <div className="hfield"><em>Size</em>
                  <span className="hsize">
                    <input type="number" min={16} max={8192} value={cw} aria-label="Width" onChange={(e) => setCw(Math.max(16, +e.target.value || 16))} />×
                    <input type="number" min={16} max={8192} value={ch} aria-label="Height" onChange={(e) => setCh(Math.max(16, +e.target.value || 16))} />
                  </span>
                </div>
              )}
              <div className="hfield"><em>Frame rate</em>
                <span className="hopts">{[24, 30, 60].map((f) => <button key={f} className={fps === f ? "on" : ""} onClick={() => setFps(f)} title={`${f} frames per second`}>{f}</button>)}</span>
              </div>
              <div className="hfield"><em>Length</em>
                <span className="hsize" title="Length in seconds"><input type="number" min={1} max={3600} value={dur} aria-label="Length in seconds" onChange={(e) => setDur(Math.max(1, +e.target.value || 1))} />sec</span>
              </div>
              <div className="hfield"><em>Background</em>
                <span className="hbgs">{BGS.map((c) => <button key={c} className={bg === c ? "on" : ""} style={{ background: c }} onClick={() => setBg(c)} title={`Background ${c}`} />)}</span>
              </div>
            </div>
            <button className="hcreate" onClick={create}>Create project</button>
          </div>
        </section>

        <section>
          <div className="hsechead"><h2>Recent</h2>{list !== null && <span>{recent.length}</span>}</div>
          {list !== null && (
            <div className="hgrid">
              {recent.map((e) => (
                <div key={e.id} className={"hcard" + (e.id === current.id ? " last" : "")} onClick={() => openInEditor(e.project)} title={e.id === current.id ? `Continue ${e.name}` : `Open ${e.name}`}>
                  <div className="hcardimg"><Thumb p={e.project} /></div>
                  <div className="hcardtxt">
                    <b>{e.name}</b>
                    <small>{e.width}×{e.height} · {ago(e.updated)}</small>
                  </div>
                  <span className="hacts">
                    <button title="Duplicate" onClick={(ev) => { ev.stopPropagation(); const p = JSON.parse(JSON.stringify(e.project)) as Project; p.id = newId(); p.name += " copy"; putProject(p).then(refresh); }}><Icon name="plus" size={12} /></button>
                    <button title="Delete project" onClick={(ev) => { ev.stopPropagation(); if (confirm(`Delete “${e.name}”? This can't be undone.`)) removeProject(e.id).then(refresh); }}><Icon name="trash" size={12} /></button>
                  </span>
                </div>
              ))}
              <div className="hcard demo" onClick={() => { const p = sampleProject(); p.id = newId(); p.name = "Demo — Launch Reel"; openInEditor(p); }} title="A sample project to explore">
                <div className="hcardimg"><Thumb p={sampleProject()} /></div>
                <div className="hcardtxt">
                  <b>Demo</b>
                  <small>Sample project</small>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
