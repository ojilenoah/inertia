import { followOffset } from "./motion";
import { easeFn, smoothValue } from "./easing";
import type { Item, ItemState, Keyframe, Project, Prop, Seconds, Track } from "./types";
import { PROPS } from "./types";

export function sampleKeys(keys: Keyframe[] | undefined, t: Seconds, fallback: number): number {
  if (!keys || keys.length === 0) return fallback;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  if (a.ease === "smooth") return smoothValue(keys, i, t);
  const p = (t - a.t) / (b.t - a.t || 1e-9);
  return a.v + (b.v - a.v) * easeFn(a.ease)(p);
}

const ADDITIVE: Record<Prop, boolean> = { x: true, y: true, z: true, rx: true, ry: true, rz: true, scale: false, opacity: false };

export function groupOf(project: Project, item: Item): Track | undefined {
  const tr = project.tracks.find((t) => t.id === item.trackId);
  return tr?.parent ? project.tracks.find((t) => t.id === tr.parent) : undefined;
}

/** A group's own transform at time t (its keyframes, else its resting values). */
export function groupValues(group: Track, t: Seconds): Record<Prop, number> {
  const out = {} as Record<Prop, number>;
  for (const p of PROPS) out[p] = sampleKeys(group.keys?.[p], t, group.base?.[p] ?? (ADDITIVE[p] ? 0 : 1));
  return out;
}

/** The groups an item sits in, innermost first (groups can be inside groups). */
export function groupChain(project: Project, item: Item): Track[] {
  const out: Track[] = [];
  let tr = project.tracks.find((t) => t.id === item.trackId);
  for (let n = 0; tr?.parent && n < 20; n++) {
    const g = project.tracks.find((t) => t.id === tr!.parent);
    if (!g) break;
    out.push(g); tr = g;
  }
  return out;
}
/** The items of a group, including those in groups inside it. */
export function itemsInGroup(project: Project, groupId: string): Item[] {
  const tracks = new Set<string>(), todo = [groupId];
  while (todo.length) {
    const id = todo.pop()!;
    for (const t of project.tracks) if (t.parent === id && !tracks.has(t.id)) { tracks.add(t.id); if (t.kind === "group") todo.push(t.id); }
  }
  return project.items.filter((i) => tracks.has(i.trackId));
}

const pivotCache = new WeakMap<Project, Map<string, { x: number; y: number }>>();
/** The point a group turns and scales around: the centre of its items (as they'd be without the group). */
export function groupPivot(project: Project, group: Track, t: Seconds): { x: number; y: number } {
  let m = pivotCache.get(project);
  if (!m) { m = new Map(); pivotCache.set(project, m); }
  const key = `${group.id}@${t}`;
  const hit = m.get(key);
  if (hit) return hit;
  const kids = itemsInGroup(project, group.id).filter((i) => i.kind !== "audio");
  const alive = kids.filter((i) => t >= i.start && t < i.end);
  const use = alive.length ? alive : kids;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of use) {
    const lt = Math.min(Math.max(t - it.start, 0), it.end - it.start);
    const x = sampleKeys(it.keys.x, lt, it.base.x), y = sampleKeys(it.keys.y, lt, it.base.y), sc = sampleKeys(it.keys.scale, lt, it.base.scale);
    x0 = Math.min(x0, x - (it.w * sc) / 2); x1 = Math.max(x1, x + (it.w * sc) / 2);
    y0 = Math.min(y0, y - (it.h * sc) / 2); y1 = Math.max(y1, y + (it.h * sc) / 2);
  }
  const pv = use.length ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: project.width / 2, y: project.height / 2 };
  if (m.size > 64) m.clear();
  m.set(key, pv);
  return pv;
}

/**
 * Final state of an item at absolute time `t`. A group acts like one big item: its move, scale
 * and rotation (2D and 3D) carry its items around the group's centre, keeping their places
 * relative to each other.
 */
/* ---- 3D turns: an item faces the way rotateX(rx) rotateY(ry) rotateZ(rz) points it (as the editor and export draw it) ---- */
type Rot = { rx: number; ry: number; rz: number };
type M3 = number[][];
const R2D = Math.PI / 180;
const mul = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
function matOf({ rx, ry, rz }: Rot): M3 {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(rx * R2D), Math.sin(rx * R2D), Math.cos(ry * R2D), Math.sin(ry * R2D), Math.cos(rz * R2D), Math.sin(rz * R2D)];
  const X = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]], Y = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]], Z = [[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]];
  return mul(mul(X, Y), Z);
}
/** The nearest angle to `near` that means the same as `a` (keeps numbers from jumping by 360°). */
const closeTo = (a: number, near: number) => a + Math.round((near - a) / 360) * 360;
/**
 * Turn something (already turned by `inner`) by `outer` as seen on screen, and give the result as
 * rotateX/Y/Z angles again — so a tilted item swings round correctly instead of just spinning in place.
 */
export function composeRotation(outer: Rot, inner: Rot): Rot {
  const flatOuter = Math.abs(outer.rx % 360) < 1e-6 && Math.abs(outer.ry % 360) < 1e-6;
  const flatInner = Math.abs(inner.rx % 360) < 1e-6 && Math.abs(inner.ry % 360) < 1e-6;
  if (flatOuter && flatInner) return { rx: inner.rx + outer.rx, ry: inner.ry + outer.ry, rz: inner.rz + outer.rz };
  const m = mul(matOf(outer), matOf(inner));
  const sb = Math.max(-1, Math.min(1, m[0][2]));
  let rx: number, ry = Math.asin(sb) / R2D, rz: number;
  if (Math.abs(sb) > 0.99999) { rx = Math.atan2(m[2][1], m[1][1]) / R2D; rz = 0; }
  else { rx = Math.atan2(-m[1][2], m[2][2]) / R2D; rz = Math.atan2(-m[0][1], m[0][0]) / R2D; }
  const want = { rx: inner.rx + outer.rx, ry: inner.ry + outer.ry, rz: inner.rz + outer.rz };
  return { rx: closeTo(rx, want.rx), ry: closeTo(ry, want.ry), rz: closeTo(rz, want.rz) };
}

/** The groups around a track, innermost first. */
function tracksUp(project: Project, trackId: string | undefined): Track[] {
  const out: Track[] = [];
  let tr = trackId ? project.tracks.find((t) => t.id === trackId) : undefined;
  for (let n = 0; tr && n < 20; n++) { out.push(tr); tr = tr.parent ? project.tracks.find((t) => t.id === tr!.parent) : undefined; }
  return out;
}
/**
 * Where a parent (or a linked item) is, as its child sees it: without the groups the child is also in. Those groups
 * move the child anyway (after its parent link), so counting them in the parent too would move it twice — e.g. a
 * mask grouped together with the group it masks. `child` is the item, or the group, that follows.
 */
export function parentState(project: Project, par: Item, t: Seconds, child: Item | Track): ItemState {
  const up = "kind" in child && child.kind === "group" ? tracksUp(project, (child as Track).parent) : groupChain(project, child as Item);
  return itemState(project, par, t, up.length ? new Set(up.map((g) => g.id)) : undefined);
}

let depth = 0;
/** `skip`: groups to leave out (see parentState). */
export function itemState(project: Project, item: Item, t: Seconds, skip?: ReadonlySet<string>): ItemState {
  const local = t - item.start;
  const group = groupOf(project, item);
  const out = { visible: t >= item.start && t < item.end } as ItemState;
  for (const p of PROPS) out[p] = sampleKeys(item.keys[p], local, item.base[p]);
  // following a motion path
  const fo = item.follow ? followOffset(project, item, t, out.x, out.y) : null;
  if (fo) { out.x = fo.x; out.y = fo.y; out.rz += fo.rz; }
  // linked properties and a parent (guarded against loops)
  if ((item.links?.length || item.parentLink) && depth < 6) {
    depth++;
    try {
      for (const L of item.links ?? []) {
        const src = L.src === "self" || L.src === item.id ? null : project.items.find((i) => i.id === L.src);
        const now = src ? parentState(project, src, t, item)[L.srcProp] : sampleKeys(item.keys[L.srcProp], local, item.base[L.srcProp]);
        const from = src ? parentState(project, src, src.start, item)[L.srcProp] : sampleKeys(item.keys[L.srcProp], 0, item.base[L.srcProp]);
        out[L.prop] += (now - from) * L.amount;
      }
      const pl = item.parentLink, par = pl && project.items.find((i) => i.id === pl.id);
      if (pl && par) {
        const P = parentState(project, par, t, item), rad = Math.PI / 180, dr = (P.rz - pl.rz0) * rad, k = P.scale / (pl.s0 || 1);
        const dx = (out.x - pl.x0) * k, dy = (out.y - pl.y0) * k;
        out.x = P.x + dx * Math.cos(dr) - dy * Math.sin(dr);
        out.y = P.y + dx * Math.sin(dr) + dy * Math.cos(dr);
        out.rz += P.rz - pl.rz0; out.scale *= k;
        // (its parent's opacity isn't passed on: fading a parent doesn't fade what follows it)
      }
    } finally { depth--; }
  }
  // each group it's in moves it, innermost first, then the groups around that
  for (const grp of group ? groupChain(project, item) : []) {
    if (skip?.has(grp.id)) continue;
    const G = groupValues(grp, t), pv = groupPivot(project, grp, t);
    const rad = Math.PI / 180;
    let dx = (out.x - pv.x) * G.scale, dy = (out.y - pv.y) * G.scale, dz = out.z * G.scale;
    // same order as the item's own CSS rotation: Z, then Y, then X
    let c = Math.cos(G.rz * rad), s = Math.sin(G.rz * rad);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    c = Math.cos(G.ry * rad); s = Math.sin(G.ry * rad);
    [dx, dz] = [dx * c + dz * s, -dx * s + dz * c];
    c = Math.cos(G.rx * rad); s = Math.sin(G.rx * rad);
    [dy, dz] = [dy * c - dz * s, dy * s + dz * c];
    out.x = pv.x + dx + G.x; out.y = pv.y + dy + G.y; out.z = dz + G.z;
    // the group's turn wraps around the item's own (3D-tilted items turn the right way, not just spin in place)
    const R = composeRotation(G, out);
    out.rx = R.rx; out.ry = R.ry; out.rz = R.rz;
    out.scale *= G.scale; out.opacity *= G.opacity;
    // the group's parent (e.g. its mask) carries the whole group
    const gpl = grp.parentLink, gpar = gpl && depth < 6 ? project.items.find((i) => i.id === gpl.id) : undefined;
    if (gpl && gpar) {
      depth++;
      try {
        const P = parentState(project, gpar, t, grp), dr = (P.rz - gpl.rz0) * rad, k = P.scale / (gpl.s0 || 1);
        const ex = (out.x - gpl.x0) * k, ey = (out.y - gpl.y0) * k;
        out.x = P.x + ex * Math.cos(dr) - ey * Math.sin(dr);
        out.y = P.y + ex * Math.sin(dr) + ey * Math.cos(dr);
        out.rz += P.rz - gpl.rz0; out.scale *= k;
      } finally { depth--; }
    }
  }
  applyAnim(item, local, out);
  return out;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const back = easeFn("back");

/** Apply an in/out preset at progress p (0 = fully off, 1 = in place). `dir` is +1 entering, -1 leaving. */
function inOut(kind: string, p: number, dir: 1 | -1, s: ItemState) {
  const e = easeOut(p), off = 1 - e;
  switch (kind) {
    case "fade": s.opacity *= e; break;
    case "slideUp": s.y += dir * off * 220; s.opacity *= e; break;
    case "slideDown": s.y -= dir * off * 220; s.opacity *= e; break;
    case "slideLeft": s.x += dir * off * 320; s.opacity *= e; break;
    case "slideRight": s.x -= dir * off * 320; s.opacity *= e; break;
    case "scale": s.scale *= 0.6 + 0.4 * e; s.opacity *= e; break;
    case "pop": s.scale *= Math.max(0, back(p)); break;
    case "blur": s.blur = (s.blur ?? 0) + off * 30; s.opacity *= e; break;
    case "rotate": s.rz += dir * off * -90; s.opacity *= e; break;
    case "flip": s.ry += dir * off * 90; s.opacity *= Math.min(1, e * 1.5); break;
    case "zoom": s.scale *= 1 + off * 0.5; s.blur = (s.blur ?? 0) + off * 12; s.opacity *= e; break;
    case "typewriter": s.reveal = Math.min(s.reveal ?? 1, p); break;
  }
}

function applyAnim(item: Item, local: Seconds, s: ItemState) {
  const a = item.anim;
  if (!a) return;
  const life = item.end - item.start;
  // whole-item In/Out (text-by-letter ones are applied per piece in textanim.ts)
  if (a.in && !a.in.unit && a.in.dur > 0) {
    const t0 = a.in.at ?? 0;
    if (local < t0 + a.in.dur) inOut(a.in.kind, Math.min(1, Math.max(0, (local - t0) / a.in.dur)), 1, s);
  }
  if (a.out && !a.out.unit && a.out.dur > 0) {
    const t1 = life - (a.out.at ?? 0);
    if (local > t1 - a.out.dur) inOut(a.out.kind, Math.min(1, Math.max(0, (t1 - local) / a.out.dur)), -1, s);
  }
  if (a.loop && !a.loop.unit) {
    const { kind, speed, amount: k } = a.loop, w = 2 * Math.PI * speed * local;
    switch (kind) {
      case "float": s.y += Math.sin(w) * 24 * k; break;
      case "pulse": s.scale *= 1 + Math.sin(w) * 0.06 * k; break;
      case "spin": s.rz += 360 * speed * local * k; break;
      case "sway": s.rz += Math.sin(w) * 8 * k; break;
      case "wiggle": s.x += (Math.sin(w * 1.7) + Math.sin(w * 3.1)) * 6 * k; s.y += (Math.cos(w * 2.3) + Math.sin(w * 1.3)) * 6 * k; s.rz += Math.sin(w * 2.9) * 3 * k; break;
      case "breathe": s.opacity *= 1 - (0.5 - 0.5 * Math.cos(w)) * 0.35 * Math.min(k, 1.5); break;
      case "drift": s.x += Math.sin(w * 0.5) * 40 * k; s.y += Math.cos(w * 0.37) * 24 * k; break;
      case "kenburns": s.scale *= 1 + 0.15 * k * (life > 0 ? local / life : 0); s.x += 30 * k * (life > 0 ? local / life : 0); break;
    }
  }
}

/** Value an item's own track (no group offset) has at absolute time t. */
export function ownValue(item: Item, prop: Prop, t: Seconds): number {
  return sampleKeys(item.keys[prop], t - item.start, item.base[prop]);
}

/** Motion blur: softer copies of an item where it was a moment ago (only while it actually moves). */
export function blurTrail(project: Project, item: Item, t: Seconds): { i: number; t: Seconds; s: ItemState; a: number }[] {
  const amt = Math.min(1, Math.max(0, item.motionBlur ?? 0));
  if (!amt) return [];
  const now = itemState(project, item, t), N = 5, span = 0.07 * amt, out: { i: number; t: Seconds; s: ItemState; a: number }[] = [];
  for (let i = N; i >= 1; i--) {
    const tt = Math.max(item.start, t - (span * i) / N);
    const s = itemState(project, item, tt);
    const moved = Math.hypot(s.x - now.x, s.y - now.y) + Math.abs(s.rz - now.rz) * 2 + Math.abs(s.scale - now.scale) * 200;
    if (moved < 1) continue;
    out.push({ i, t: tt, s, a: 0.42 * (1 - (i - 1) / N) });
  }
  return out;
}

/** The camera at time t: the top visible camera item (its frame is what the video shows), or null. */
export function cameraAt(project: Project, t: Seconds): { id: string; x: number; y: number; rz: number; scale: number } | null {
  const rank = (it: Item) => project.tracks.findIndex((tr) => tr.id === it.trackId);
  const cams = project.items.filter((i) => i.kind === "camera" && t >= i.start && t < i.end && !project.tracks.find((tr) => tr.id === i.trackId)?.muted).sort((a, b) => rank(a) - rank(b));
  if (!cams.length) return null;
  const s = itemState(project, cams[0], t);
  return { id: cams[0].id, x: s.x, y: s.y, rz: s.rz, scale: Math.max(0.05, s.scale) };
}
