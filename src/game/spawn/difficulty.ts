/**
 * Forward speed curve and difficulty ramp (functions of run time).
 * Speed shape from the reference measurements: hold the start speed for ~28 s, then a linear ramp to
 * about twice the start speed by ~3.75 min.
 */
import { defineTuning } from "../../core/tuning";

export const SPEED = defineTuning("speed", "Speed curve", {
  start: { default: 12, min: 2, max: 40, step: 0.5, label: "Start speed", unit: "m/s" },
  max: { default: 24, min: 2, max: 60, step: 0.5, label: "Top speed", unit: "m/s" },
  flatSeconds: { default: 28, min: 0, max: 300, step: 1, label: "Hold the start speed for", unit: "s" },
  rampSeconds: { default: 225, min: 5, max: 1200, step: 5, label: "Top speed reached at (run time)", unit: "s" },
  rampExponent: { default: 1, min: 0.2, max: 3, step: 0.05, label: "Ramp curve exponent", help: "1 = linear, <1 front-loads acceleration" },
  introStartFactor: { default: 0.45, min: 0, max: 1, step: 0.05, label: "Intro: starting fraction of start speed" },
});

export const DIFFICULTY = defineTuning("difficulty", "Difficulty", {
  rampSeconds: { default: 180, min: 5, max: 1200, step: 5, label: "Time to full difficulty", unit: "s" },
  exponent: { default: 1, min: 0.2, max: 3, step: 0.05, label: "Difficulty curve exponent" },
});

/**
 * Late game: once top speed is reached the ramp has nothing left to give, so pressure keeps
 * building through the layout instead — tighter gaps and the harder patterns more often (each
 * pattern's `lateWeight`), plus late-only patterns. Speed stays capped.
 */
export const LATE = defineTuning("late", "Late game", {
  startSeconds: { default: 240, min: 0, max: 1200, step: 5, label: "Late-game pressure starts at (run time)", unit: "s" },
  rampSeconds: { default: 180, min: 5, max: 1200, step: 5, label: "Full late-game pressure after", unit: "s" },
  gapMul: { default: 0.85, min: 0.3, max: 1, step: 0.01, label: "Gap between patterns at full pressure (x)", help: "The fairness floor (spawn.minGapSeconds) still applies" },
});

export function speedAt(time: number): number {
  const span = Math.max(1e-6, SPEED.rampSeconds - SPEED.flatSeconds);
  const u = Math.min(1, Math.max(0, (time - SPEED.flatSeconds) / span));
  return SPEED.start + (SPEED.max - SPEED.start) * Math.pow(u, SPEED.rampExponent);
}

/** 0..1 */
export function difficultyAt(time: number): number {
  const u = Math.min(1, Math.max(0, time / DIFFICULTY.rampSeconds));
  return Math.pow(u, DIFFICULTY.exponent);
}

/** 0..1: how far into the late-game ramp a run time is. */
export function lateAt(time: number): number {
  return Math.min(1, Math.max(0, (time - LATE.startSeconds) / Math.max(1e-6, LATE.rampSeconds)));
}

/**
 * Distance a run covers in `time` seconds on the nominal speed curve — the closed-form integral of
 * `speedAt`, so it is exact and cheap enough for the hot path (no stepping).
 *
 * Three pieces: the flat hold, the ramp (∫ u^k du = u^(k+1)/(k+1)), and top speed afterwards.
 */
export function distanceAtTime(time: number): number {
  const t = Math.max(0, time);
  const flat = Math.max(0, SPEED.flatSeconds);
  if (t <= flat) return SPEED.start * t;
  const span = Math.max(1e-6, SPEED.rampSeconds - flat);
  const gain = SPEED.max - SPEED.start;
  const k = SPEED.rampExponent;
  const ramp = Math.min(t - flat, span);
  const u = ramp / span;
  let d = SPEED.start * (flat + ramp) + (gain * span * Math.pow(u, k + 1)) / (k + 1);
  if (t > SPEED.rampSeconds) d += SPEED.max * (t - SPEED.rampSeconds);
  return d;
}

/**
 * Inverse of `distanceAtTime`: the run time at which a nominal run reaches `distance`.
 *
 * The spawner uses this to place content as a pure function of DISTANCE rather than of the
 * player's clock. Two players on the same seed must meet the same layout even when one of them is
 * running slightly faster (heavy armour) or slower (hourglass), otherwise "same seed for everyone"
 * would quietly be false and ghosts would desync.
 *
 * The ramp segment is solved with Newton iterations; the curve is smooth and monotone, so a
 * handful of steps converge far below millimetre precision.
 */
export function timeAtDistance(distance: number): number {
  const d = Math.max(0, distance);
  const flat = Math.max(0, SPEED.flatSeconds);
  const flatDistance = SPEED.start * flat;
  if (d <= flatDistance) return SPEED.start > 0 ? d / SPEED.start : 0;
  const span = Math.max(1e-6, SPEED.rampSeconds - flat);
  const gain = SPEED.max - SPEED.start;
  const k = SPEED.rampExponent;
  const rampDistance = SPEED.start * span + (gain * span) / (k + 1);
  const rest = d - flatDistance;
  if (rest >= rampDistance) return SPEED.rampSeconds + (d - flatDistance - rampDistance) / Math.max(1e-6, SPEED.max);
  // solve  start*T + gain*span/(k+1) * (T/span)^(k+1) = rest   for T in [0, span]
  let T = span * (rest / Math.max(1e-6, rampDistance));
  for (let i = 0; i < 24; i++) {
    const u = T / span;
    const f = SPEED.start * T + ((gain * span) / (k + 1)) * Math.pow(u, k + 1) - rest;
    const df = SPEED.start + gain * Math.pow(u, k);
    if (df <= 0) break;
    const step = f / df;
    T -= step;
    if (T < 0) T = 0;
    else if (T > span) T = span;
    if (Math.abs(step) < 1e-9) break;
  }
  return flat + T;
}
