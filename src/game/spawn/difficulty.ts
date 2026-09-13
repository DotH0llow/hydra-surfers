/** Forward speed curve and difficulty ramp (functions of run time). */
import { defineTuning } from "../../core/tuning";

export const SPEED = defineTuning("speed", "Speed curve", {
  start: { default: 12, min: 2, max: 40, step: 0.5, label: "Start speed", unit: "m/s" },
  max: { default: 26, min: 2, max: 60, step: 0.5, label: "Top speed", unit: "m/s" },
  rampSeconds: { default: 240, min: 5, max: 1200, step: 5, label: "Time to top speed", unit: "s" },
  rampExponent: { default: 0.85, min: 0.2, max: 3, step: 0.05, label: "Ramp curve exponent", help: "<1 front-loads acceleration" },
  introStartFactor: { default: 0.45, min: 0, max: 1, step: 0.05, label: "Intro: starting fraction of start speed" },
});

export const DIFFICULTY = defineTuning("difficulty", "Difficulty", {
  rampSeconds: { default: 180, min: 5, max: 1200, step: 5, label: "Time to full difficulty", unit: "s" },
  exponent: { default: 1, min: 0.2, max: 3, step: 0.05, label: "Difficulty curve exponent" },
});

export function speedAt(time: number): number {
  const u = Math.min(1, Math.max(0, time / SPEED.rampSeconds));
  return SPEED.start + (SPEED.max - SPEED.start) * Math.pow(u, SPEED.rampExponent);
}

/** 0..1 */
export function difficultyAt(time: number): number {
  const u = Math.min(1, Math.max(0, time / DIFFICULTY.rampSeconds));
  return Math.pow(u, DIFFICULTY.exponent);
}
