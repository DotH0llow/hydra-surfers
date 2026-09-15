/**
 * Lane-switch feel: pure, allocation-free curves shared by the PlayerController (state captured at
 * every retarget), the PlayerAnimator (body lean, hop) and the RunCamera (lateral follow ease).
 *
 * All curve times are "feel seconds": the owners advance their clocks by `dt / switchTimeScale(speed)`
 * so the whole switch gets snappier as the run speeds up, without discontinuities when speed changes.
 *
 * Shape of one switch (at the reference speed):
 *   lateral move      eased, ~3 frames at 30 fps (PlayerController.laneSwitchSeconds)
 *   lean              tilts into the travel direction almost at once (legs trailing), holds while
 *                     airborne in the hop, swings through to a counter-tilt as it lands, then recovers
 *   hop               a short visual lift (does not touch the sim y / hitbox)
 *   camera            translates to the new lane with a C1 cubic ease (no overshoot, no roll)
 */
import { defineTuning } from "../../core/tuning";

export const SWITCH_FEEL = defineTuning("switchFeel", "Lane-switch feel", {
  leanInSeconds: { default: 0.04, min: 0.005, max: 0.4, step: 0.005, label: "Lean: time to full tilt", unit: "s" },
  leanHoldSeconds: { default: 0.12, min: 0, max: 0.6, step: 0.005, label: "Lean: hold at full tilt", unit: "s" },
  counterSeconds: { default: 0.1, min: 0.01, max: 0.6, step: 0.005, label: "Lean: swing to counter-tilt", unit: "s" },
  counterLean: { default: 0.6, min: 0, max: 1.5, step: 0.01, label: "Counter-tilt on landing", help: "fraction of the full lean, opposite side" },
  recoverSeconds: { default: 0.14, min: 0.01, max: 0.8, step: 0.005, label: "Lean: recover to upright", unit: "s" },
  hopHeight: { default: 0.34, min: 0, max: 1.5, step: 0.01, label: "Switch hop height (visual)", unit: "m" },
  hopSeconds: { default: 0.19, min: 0.02, max: 0.8, step: 0.005, label: "Switch hop duration", unit: "s" },
  bounceLean: { default: 0.6, min: 0, max: 1.5, step: 0.01, label: "Bounce-back lean", help: "fraction of the full lean" },
  refSpeed: { default: 12, min: 1, max: 60, step: 0.5, label: "Timing reference speed", unit: "m/s" },
  speedExponent: { default: 0.8, min: 0, max: 2, step: 0.05, label: "Timing speed exponent", help: "feel timings × (refSpeed/speed)^k; 0 = fixed" },
  minTimeScale: { default: 0.55, min: 0.1, max: 1, step: 0.01, label: "Fastest timing scale" },
});

/** Multiplier (≤ 1) applied to switch feel durations at `speed`; never slower than at the reference speed. */
export function switchTimeScale(speed: number): number {
  const F = SWITCH_FEEL;
  if (F.speedExponent <= 0 || speed <= F.refSpeed) return 1;
  const s = Math.pow(F.refSpeed / speed, F.speedExponent);
  return s < F.minTimeScale ? F.minTimeScale : s;
}

const cosEase = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * k);

/** Feel seconds until the lean curve is back to upright. */
export function switchLeanSeconds(): number {
  const F = SWITCH_FEEL;
  return F.leanInSeconds + F.leanHoldSeconds + F.counterSeconds + F.recoverSeconds;
}

/**
 * Signed body lean (-1..1, + = toward +x / right) `t` feel seconds after a switch toward `dir`
 * with peak `amp`, starting from the lean `from` the body had when the switch began (continuity).
 */
export function switchLean(t: number, dir: number, amp: number, from: number): number {
  const F = SWITCH_FEEL;
  const peak = dir * amp;
  if (t < F.leanInSeconds) return from + (peak - from) * Math.sin((t / F.leanInSeconds) * Math.PI * 0.5);
  let u = t - F.leanInSeconds;
  if (u < F.leanHoldSeconds) return peak;
  u -= F.leanHoldSeconds;
  const counter = -peak * F.counterLean;
  if (u < F.counterSeconds) return peak + (counter - peak) * cosEase(u / F.counterSeconds);
  u -= F.counterSeconds;
  if (u < F.recoverSeconds) return counter * (1 - cosEase(u / F.recoverSeconds));
  return 0;
}

/** Normalised hop lift (0..~1) `t` feel seconds after a switch, blending out a hop already in progress (`from`). */
export function switchHop(t: number, from: number): number {
  const T = SWITCH_FEEL.hopSeconds;
  if (t >= T) return 0;
  const k = t / T;
  const v = from * (1 - k) + Math.sin(Math.PI * k);
  return v > 1 ? 1 : v;
}

/**
 * Retargetable C1 cubic ease: position after progress `s` (0..1) of a move from `x0` with initial
 * velocity `v0` (units per duration) to `x1` arriving with zero velocity. With v0 = 0 it is smoothstep.
 */
export function easeHermite(x0: number, v0: number, x1: number, s: number): number {
  if (s >= 1) return x1;
  if (s <= 0) return x0;
  const s2 = s * s;
  const s3 = s2 * s;
  return x0 * (2 * s3 - 3 * s2 + 1) + v0 * (s3 - 2 * s2 + s) + x1 * (3 * s2 - 2 * s3);
}

/** d/ds of `easeHermite` (units per duration). */
export function easeHermiteVel(x0: number, v0: number, x1: number, s: number): number {
  if (s >= 1) return 0;
  const c = s <= 0 ? 0 : s;
  const c2 = c * c;
  return (x1 - x0) * (6 * c - 6 * c2) + v0 * (3 * c2 - 4 * c + 1);
}
