/**
 * Pure helpers for the jump cheats (unit-tested in tests/unit/devtools.test.ts).
 * A jump puts the run where a natural run would be: run time, speed and difficulty all match the
 * target distance (or difficulty) on the tuned speed/difficulty curves. The short intro is ignored.
 */
import { DIFFICULTY, difficultyAt, speedAt } from "../game/spawn/difficulty";

/** Integration step (s). Trapezoid rule on a smooth monotone curve: error well under 1 mm per km. */
const H = 0.02;
/** Upper bound for jumps (4 h of running, ~370 km at the default top speed). */
export const MAX_JUMP_SECONDS = 4 * 3600;

/** Distance covered along the speed curve after `time` seconds of running. */
export function distanceAtTime(time: number): number {
  const T = Math.min(MAX_JUMP_SECONDS, Math.max(0, time));
  let d = 0;
  let t = 0;
  while (t + H <= T) {
    d += (speedAt(t) + speedAt(t + H)) * 0.5 * H;
    t += H;
  }
  if (T > t) d += (speedAt(t) + speedAt(T)) * 0.5 * (T - t);
  return d;
}

/** Inverse of distanceAtTime: the run time at which a natural run reaches `distance`. */
export function timeForDistance(distance: number): number {
  const D = Math.max(0, distance);
  let d = 0;
  let t = 0;
  while (t < MAX_JUMP_SECONDS) {
    const step = (speedAt(t) + speedAt(t + H)) * 0.5 * H;
    if (d + step >= D) return t + (step > 0 ? ((D - d) / step) * H : 0);
    d += step;
    t += H;
  }
  return MAX_JUMP_SECONDS;
}

/** Run time at which the difficulty curve reaches `difficulty` (0..1, clamped). */
export function timeForDifficulty(difficulty: number): number {
  const x = Math.min(1, Math.max(0, Number(difficulty) || 0));
  if (x <= 0) return 0;
  return DIFFICULTY.rampSeconds * Math.pow(x, 1 / DIFFICULTY.exponent);
}

export { difficultyAt, speedAt };
