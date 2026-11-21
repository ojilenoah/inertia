import type { Seconds } from "./types";

export function fmtClock(t: Seconds, decimals = 3) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(decimals).padStart(decimals + 3, "0")}`;
}

export function fmtTimecode(t: Seconds) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return { head: `${String(m).padStart(2, "0")}:`, tail: s.toFixed(3).padStart(6, "0") };
}

/** Nice tick steps from 1µs to 10min. */
export const NICE_STEPS: number[] = (() => {
  const a: number[] = [];
  for (let e = -6; e <= 2; e++) for (const m of [1, 2, 5]) a.push(m * 10 ** e);
  return a.concat([15, 30, 60, 120, 300, 600]).sort((x, y) => x - y);
})();

export function fmtTick(t: Seconds, step: number) {
  if (step >= 1) { const m = Math.floor(t / 60), s = Math.round(t - m * 60); return `${m}:${String(s).padStart(2, "0")}`; }
  const d = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  if (step < 1e-3) return `${(t * 1000).toFixed(Math.max(0, d - 3))}ms`;
  return `${t.toFixed(d)}s`;
}

export function fmtStep(st: number) {
  return st >= 1 ? `${st}s` : st >= 1e-3 ? `${+(st * 1000).toPrecision(3)}ms` : `${+(st * 1e6).toPrecision(3)}µs`;
}
