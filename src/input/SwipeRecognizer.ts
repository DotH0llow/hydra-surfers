/**
 * Pointer/touch swipe recognizer. A swipe FIRES DURING THE MOVE, the moment the pointer crosses
 * `swipeThresholdPx` from its origin within `swipeAngleTolerance` of an axis — not on release.
 * A press that barely moves and releases quickly is a `tap`.
 */
import { defineTuning } from "../core/tuning";
import type { Action, InputSource } from "./actions";

export const INPUT = defineTuning("input", "Input", {
  swipeThresholdPx: { default: 26, min: 4, max: 160, step: 1, label: "Swipe distance threshold", unit: "px" },
  swipeAngleTolerance: { default: 38, min: 5, max: 45, step: 1, label: "Swipe angle tolerance from axis", unit: "°" },
  // 0 by default: a slow or janky (late pointermove) gesture must never lose the action.
  swipeMaxSeconds: { default: 0, min: 0, max: 3, step: 0.05, label: "Swipe max duration (0 = unlimited)", unit: "s" },
  swipeRearm: { default: 1, min: 0, max: 1, step: 1, label: "Allow chained swipes in one touch (0/1)" },
  tapMaxMovePx: { default: 14, min: 0, max: 80, step: 1, label: "Tap max movement", unit: "px" },
  tapMaxSeconds: { default: 0.3, min: 0.05, max: 2, step: 0.01, label: "Tap max duration", unit: "s" },
  doubleTapSeconds: { default: 0.32, min: 0.05, max: 1, step: 0.01, label: "Double-tap window (hoverboard)", unit: "s" },
});

const SLOTS = 4;
const INTERACTIVE = "button, a, input, select, textarea, [data-interactive], .interactive";

interface Slot {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  tSeg: number;
  maxMove: number;
  fired: boolean;
  source: InputSource;
}

export type ActionSink = (action: Action, source: InputSource) => void;

export class SwipeRecognizer {
  private readonly slots: Slot[] = [];
  private readonly listeners: Array<[string, EventListener]> = [];

  constructor(
    private readonly el: HTMLElement,
    private readonly sink: ActionSink,
  ) {
    for (let i = 0; i < SLOTS; i++) this.slots.push({ id: -1, x0: 0, y0: 0, t0: 0, tSeg: 0, maxMove: 0, fired: false, source: "touch" });
    this.listen("pointerdown", this.onDown as EventListener);
    this.listen("pointermove", this.onMove as EventListener);
    this.listen("pointerup", this.onUp as EventListener);
    this.listen("pointercancel", this.onCancel as EventListener);
    this.listen("lostpointercapture", this.onCancel as EventListener);
  }

  dispose(): void {
    for (const [type, fn] of this.listeners) this.el.removeEventListener(type, fn);
    this.listeners.length = 0;
  }

  private listen(type: string, fn: EventListener): void {
    this.el.addEventListener(type, fn, { passive: false });
    this.listeners.push([type, fn]);
  }

  private slotFor(id: number): Slot | null {
    for (let i = 0; i < SLOTS; i++) if (this.slots[i].id === id) return this.slots[i];
    return null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button > 0) return;
    const target = e.target as Element | null;
    if (target && target.closest?.(INTERACTIVE)) return;
    const slot = this.slotFor(-1);
    if (!slot) return;
    slot.id = e.pointerId;
    slot.x0 = e.clientX;
    slot.y0 = e.clientY;
    slot.t0 = slot.tSeg = e.timeStamp;
    slot.maxMove = 0;
    slot.fired = false;
    slot.source = e.pointerType === "mouse" ? "mouse" : e.pointerType === "pen" ? "pen" : "touch";
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (e.cancelable) e.preventDefault();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const slot = this.slotFor(e.pointerId);
    if (!slot) return;
    const dx = e.clientX - slot.x0;
    const dy = e.clientY - slot.y0;
    const dist = Math.hypot(dx, dy);
    if (dist > slot.maxMove) slot.maxMove = dist;
    if (slot.fired || dist < INPUT.swipeThresholdPx) return;
    if (INPUT.swipeMaxSeconds > 0 && (e.timeStamp - slot.tSeg) / 1000 > INPUT.swipeMaxSeconds) {
      // too slow: restart the segment from here so a later flick still registers
      slot.x0 = e.clientX;
      slot.y0 = e.clientY;
      slot.tSeg = e.timeStamp;
      return;
    }
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const angle = (Math.atan2(Math.min(adx, ady), Math.max(adx, ady)) * 180) / Math.PI;
    if (angle > INPUT.swipeAngleTolerance) return;
    let action: Action;
    if (adx >= ady) action = dx < 0 ? "left" : "right";
    else action = dy < 0 ? "jump" : "roll";
    if (INPUT.swipeRearm >= 0.5) {
      slot.x0 = e.clientX;
      slot.y0 = e.clientY;
      slot.tSeg = e.timeStamp;
      slot.fired = false;
      slot.maxMove = Math.max(slot.maxMove, INPUT.tapMaxMovePx + 1);
    } else {
      slot.fired = true;
    }
    this.sink(action, slot.source);
    if (e.cancelable) e.preventDefault();
  };

  private readonly onUp = (e: PointerEvent): void => {
    const slot = this.slotFor(e.pointerId);
    if (!slot) return;
    const isTap = !slot.fired && slot.maxMove <= INPUT.tapMaxMovePx && (e.timeStamp - slot.t0) / 1000 <= INPUT.tapMaxSeconds;
    const source = slot.source;
    slot.id = -1;
    if (isTap) this.sink("tap", source);
  };

  private readonly onCancel = (e: Event): void => {
    const slot = this.slotFor((e as PointerEvent).pointerId);
    if (slot) slot.id = -1;
  };
}
