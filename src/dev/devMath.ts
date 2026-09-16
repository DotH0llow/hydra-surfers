/**
 * Pure helpers for the jump cheats.
 * A jump puts the run where a natural run would be: run time, speed and difficulty all match the
 * target distance (or difficulty) on the tuned speed/difficulty curves. The short intro is ignored.
 *
 * The distance/time mapping itself lives with the curve it integrates
 * (`src/game/spawn/difficulty.ts`), where the spawner also uses it; these are thin clamped wrappers
 * so there is only ever one implementation of the curve.
 */
import { DIFFICULTY, difficultyAt, distanceAtTime as curveDistance, speedAt, timeAtDistance } from "../game/spawn/difficulty";

/** Upper bound for jumps (4 h of running, ~370 km at the default top speed). */
export const MAX_JUMP_SECONDS = 4 * 3600;

/** Distance covered along the speed curve after `time` seconds of running. */
export function distanceAtTime(time: number): number {
  return curveDistance(Math.min(MAX_JUMP_SECONDS, Math.max(0, time)));
}

/** Inverse of distanceAtTime: the run time at which a natural run reaches `distance`. */
export function timeForDistance(distance: number): number {
  return Math.min(MAX_JUMP_SECONDS, timeAtDistance(distance));
}

/** Run time at which the difficulty curve reaches `difficulty` (0..1, clamped). */
export function timeForDifficulty(difficulty: number): number {
  const x = Math.min(1, Math.max(0, Number(difficulty) || 0));
  if (x <= 0) return 0;
  return DIFFICULTY.rampSeconds * Math.pow(x, 1 / DIFFICULTY.exponent);
}

export { difficultyAt, speedAt };
