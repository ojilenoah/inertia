import type { Item, Project, Seconds } from "./types";
import { numAt } from "./morph";

/*
 * Sound and video clips: playback speed, reverse, volume (can be keyframed), fades,
 * and ducking (music that dips while another sound plays).
 */

/** Where in the media file we are, at the clip's local time. */
export function mediaTime(it: Item, local: Seconds, dur?: number): Seconds {
  const m = (it.mediaOffset ?? 0) + Math.max(0, local) * (it.speed ?? 1);
  return it.reverse && dur ? Math.max(0, dur - m) : m;
}

const DUCK = 0.3, RAMP = 0.25;
/** Is any other sound (not itself ducking) playing at time t? Returns how fully (0..1, ramped at the edges). */
function othersPlaying(project: Project, it: Item, t: Seconds): number {
  let best = 0;
  for (const o of project.items) {
    if (o.id === it.id || o.duck || !(o.kind === "audio" || o.kind === "video") || !o.src) continue;
    if (project.tracks.find((tr) => tr.id === o.trackId)?.muted) continue;
    const inside = Math.min(t - o.start, o.end - t);
    if (inside <= -RAMP) continue;
    best = Math.max(best, Math.min(1, (inside + RAMP) / RAMP));
  }
  return best;
}

/** The clip's loudness at time t (1 = as recorded): its volume, fades and ducking. */
export function volumeAt(project: Project, it: Item, t: Seconds): number {
  const local = t - it.start;
  let v = numAt(it, "volume", local);
  if (it.fadeIn) v *= Math.min(1, Math.max(0, local / it.fadeIn));
  if (it.fadeOut) v *= Math.min(1, Math.max(0, (it.end - t) / it.fadeOut));
  if (it.duck) v *= 1 - (1 - DUCK) * othersPlaying(project, it, t);
  return Math.max(0, v);
}
