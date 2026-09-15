/** HUD tuning (piece C1). Live-editable from the in-game editor like every other tuning group. */
import { defineTuning } from "../../core/tuning";

export const HUD = defineTuning("hud", "HUD", {
  scoreMinDigits: { default: 6, min: 1, max: 9, step: 1, label: "Score zero-padding (digits)" },
  timerSegments: { default: 10, min: 4, max: 12, step: 1, label: "Power-up timer bar segments" },
  timerMidRatio: { default: 0.5, min: 0, max: 1, step: 0.05, label: "Timer bar turns amber at (fraction left)" },
  timerLowRatio: { default: 0.25, min: 0, max: 1, step: 0.05, label: "Timer bar turns red at (fraction left)" },
  timerBlinkSeconds: { default: 2, min: 0, max: 6, step: 0.1, label: "Timer icon blinks in the last", unit: "s" },
  timerBlinkPeriod: { default: 0.25, min: 0.05, max: 1, step: 0.05, label: "Timer blink half-period", unit: "s" },
  popSeconds: { default: 0.2, min: 0, max: 1, step: 0.01, label: "Counter pop duration", unit: "s" },
  popScale: { default: 1.22, min: 1, max: 1.8, step: 0.01, label: "Counter pop peak scale" },
  toastSeconds: { default: 2.4, min: 0.5, max: 8, step: 0.1, label: "Toast hold time", unit: "s" },
  toastInSeconds: { default: 0.2, min: 0, max: 1, step: 0.02, label: "Toast slide-in", unit: "s" },
  toastOutSeconds: { default: 0.24, min: 0, max: 1, step: 0.02, label: "Toast slide-out", unit: "s" },
  toastQueue: { default: 3, min: 1, max: 8, step: 1, label: "Queued toasts kept (extra are dropped)" },
  boardHintSeconds: { default: 4, min: 0, max: 15, step: 0.5, label: "Board button hint at run start", unit: "s" },
});

/** DOM capacities (structural, not tuning): the HUD pre-builds this many segments / toast slots. */
export const HUD_MAX_TIMER_SEGMENTS = 12;
export const HUD_MAX_TOASTS = 8;
