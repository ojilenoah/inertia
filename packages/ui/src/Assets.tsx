import { useRef, useState } from "react";
import type { Asset } from "@moshion/engine";
import { TEMPLATES, addTemplate } from "./templates";
import { setBrand, useBrand } from "./brand";
import { FONTS } from "./EditPanel";
import { pickImageFile } from "./persist";
import { placeItem, uid } from "@moshion/engine";
import { useStore } from "./store";
import { Icon } from "./Icon";
import { importFiles, pickMedia, placeAsset, useMediaURL } from "./media";
import { deletePreset, usePreset, usePresets } from "./presets";

const fmtDur = (s?: number) => (s == null ? "" : s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

function Tile({ a }: { a: Asset }) {
  const url = useMediaURL(a.kind === "image" ? undefined : a.id);
  const used = useStore((s) => s.project.items.filter((i) => i.src === a.id || (a.url && i.fill.includes(a.url.slice(0, 64)))).length);
  const vref = useRef<HTMLVideoElement>(null);
  return (
    <div
      className="atile" draggable title={`${a.name} · click or drag to add`}
      onDragStart={(e) => { e.dataTransfer.setData("moshion/asset", a.id); e.dataTransfer.effectAllowed = "copy"; }}
      onClick={() => placeAsset(a)}
      onPointerEnter={() => vref.current?.play().catch(() => {})}
      onPointerLeave={() => { const v = vref.current; if (v) { v.pause(); v.currentTime = 0.1; } }}
    >
      <div className="athumb">
        {a.kind === "image" && <div style={{ backgroundImage: `url("${a.url}")` }} />}
        {a.kind === "video" && url && <video ref={vref} src={url + "#t=0.1"} muted loop playsInline preload="metadata" />}
        {a.kind === "audio" && <span className="awave"><Icon name="music" /></span>}
        {a.dur != null && <em>{fmtDur(a.dur)}</em>}
        {used > 0 && <b title={`Used ${used}× in the scene`}>{used}</b>}
      </div>
      <span className="aname">{a.name}</span>
      <button className="adel" title="Remove from Media (items already placed stay)"
        onClick={(e) => { e.stopPropagation(); useStore.getState().edit((p) => { p.assets = (p.assets ?? []).filter((x) => x.id !== a.id); }); }}>
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}

const NONE: Asset[] = [];

/** Imported pictures, videos and sounds. */
export function Assets() {
  const assets = useStore((s) => s.project.assets) ?? NONE;
  const [tab, setTab] = useState<"all" | Asset["kind"] | "presets" | "scenes" | "brand">("all");
  const presets = usePresets();
  const [over, setOver] = useState(false);
  const list = tab === "all" ? assets : tab === "presets" || tab === "scenes" || tab === "brand" ? [] : assets.filter((a) => a.kind === tab);
  return (
    <aside
      className={"card assets" + (over ? " over" : "")} aria-label="Media"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); }}
    >
      <div className="ahead">
        <b>Media</b>
        <span className="sp" />
        <button className="ib" title="Import pictures, videos or audio" onClick={async () => { const f = await pickMedia(); if (f.length) importFiles(f); }}><Icon name="plus" /></button>
        <button className="ib" title="Hide Media" onClick={() => useStore.getState().setUI({ assets: false })}><Icon name="x" size={13} /></button>
      </div>
      <div className="atabs">
        {(["all", "image", "video", "audio", "presets", "scenes", "brand"] as const).map((k) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{({ all: "All", image: "Pictures", video: "Videos", audio: "Audio", presets: "Presets", scenes: "Scenes", brand: "Brand" } as Record<string, string>)[k]}</button>
        ))}
      </div>
      {tab === "scenes" ? (
        <div className="plist">
          {TEMPLATES.map((x) => (
            <div key={x.id} className="prow" title={`${x.hint} · click to add it at the playhead`} onClick={() => addTemplate(x.id)}>
              <span className="pkind">scene</span><b>{x.label}</b><span className="sp" /><span className="hint" style={{ margin: 0 }}>{x.hint}</span>
            </div>
          ))}
        </div>
      ) : tab === "brand" ? <BrandKit /> : tab === "presets" ? (
        presets.length ? (
          <div className="plist">
            {presets.map((p) => (
              <div key={p.id} className="prow" title="Click to add it at the playhead" onClick={() => usePreset(p)}>
                <span className="pkind">{p.item.kind}</span>
                <b>{p.name}</b>
                <span className="sp" />
                <button className="adel" style={{ position: "static", opacity: 1, background: "transparent", color: "var(--ink-3)" }} title="Delete preset" onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }}><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
        ) : <p className="hint" style={{ padding: "0 12px" }}>No presets yet. Style and animate an item, then use “Save as preset” in its Layer card or right-click menu.</p>
      ) : list.length ? (
        <div className="agrid">{list.map((a) => <Tile key={a.id} a={a} />)}</div>
      ) : (
        <button className="aempty" onClick={async () => { const f = await pickMedia(); if (f.length) importFiles(f); }}>
          <Icon name="plus" />
          <span>Drop files here<br />or click to import</span>
          <small>Pictures, videos and audio</small>
        </button>
      )}
    </aside>
  );
}

/** Your colours, fonts and logos, for every project. */
function BrandKit() {
  const b = useBrand();
  const [pick, setPick] = useState("#3A5BFF");
  return (
    <div className="brand">
      <div className="psub">Colours</div>
      <div className="gcols">
        {b.colors.map((c, i) => (
          <span key={c + i} className="gcol" style={{ background: c }} title={c}>
            <input type="color" value={c} onChange={(e) => setBrand((x) => { x.colors[i] = e.target.value; })} />
            <button title="Remove" onClick={() => setBrand((x) => { x.colors.splice(i, 1); })}><Icon name="x" size={9} /></button>
          </span>
        ))}
        <label className="gcol add" title="Add a colour"><input type="color" value={pick} onChange={(e) => setPick(e.target.value)} onBlur={(e) => setBrand((x) => { if (!x.colors.includes(e.target.value)) x.colors.push(e.target.value); })} /><Icon name="plus" size={11} /></label>
      </div>
      <p className="hint">Brand colours show first in every colour picker. The first two are used by Scenes.</p>
      <div className="psub">Fonts</div>
      <div className="bfonts">
        {FONTS.map((f) => (
          <button key={f} className={b.fonts.includes(f) ? "on" : ""} style={{ fontFamily: `"${f}"` }} onClick={() => setBrand((x) => { x.fonts = x.fonts.includes(f) ? x.fonts.filter((q) => q !== f) : [...x.fonts, f]; })}>{f}</button>
        ))}
      </div>
      <div className="psub">Logos</div>
      <div className="agrid">
        {b.logos.map((l) => (
          <div key={l.id} className="atile" title={`${l.name} · click to add it at the playhead`} onClick={() => placeLogo(l)}>
            <img src={l.url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            <button className="adel" title="Remove" onClick={(e) => { e.stopPropagation(); setBrand((x) => { x.logos = x.logos.filter((q) => q.id !== l.id); }); }}><Icon name="x" size={11} /></button>
          </div>
        ))}
        <button className="atile add" onClick={async () => { const f = await pickImageFile(); if (f) setBrand((x) => { x.logos.push({ id: uid("logo"), name: f.name, url: f.url }); }); }}><Icon name="plus" /></button>
      </div>
    </div>
  );
}
function placeLogo(l: { name: string; url: string }) {
  const { project, t, edit, select } = useStore.getState();
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, (project.width * 0.35) / img.naturalWidth, (project.height * 0.35) / img.naturalHeight);
    const id = uid("item"), start = Math.max(0, Math.min(t, project.duration));
    edit((p) => {
      const { trackId } = placeItem(p, "video", start, start + 3, undefined, () => uid("V"));
      p.items.push({ id, name: l.name.replace(/\.[^.]+$/, ""), kind: "image", trackId, start, end: start + 3, w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s), fill: `url("${l.url}")`, fit: "contain", tint: "--green", keys: {},
        base: { x: project.width / 2, y: project.height / 2, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 } });
    });
    select(id);
  };
  img.src = l.url;
}
