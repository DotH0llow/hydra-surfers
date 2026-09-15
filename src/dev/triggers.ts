/**
 * Panel toggle gestures as pure state machines (no DOM), so they are unit-testable:
 * - LongPressDetector: one finger (or mouse/pen) held still in a screen corner for `holdMs`.
 * - MultiFingerTap: `fingers` simultaneous touches (fires once per gesture, when the last finger lands).
 * src/dev/index.ts feeds them real pointer/touch events.
 */

export type Corner = "tl" | "tr" | "bl" | "br";

/** Which corner square of side `size` px contains (x, y) in a w×h viewport, if any. */
export function cornerAt(x: number, y: number, w: number, h: number, size: number): Corner | null {
  const left = x <= size;
  const right = x >= w - size;
  const top = y <= size;
  const bottom = y >= h - size;
  if (top && left) return "tl";
  if (top && right) return "tr";
  if (bottom && left) return "bl";
  if (bottom && right) return "br";
  return null;
}

export interface LongPressOptions {
  holdMs: number;
  moveTolerancePx: number;
  cornerPx: number;
}

export const LONG_PRESS_DEFAULTS: LongPressOptions = { holdMs: 600, moveTolerancePx: 12, cornerPx: 56 };

interface Press {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  corner: Corner;
  fired: boolean;
}

export class LongPressDetector {
  readonly opts: LongPressOptions;
  private press: Press | null = null;
  private readonly down_ = new Set<number>();

  constructor(opts: Partial<LongPressOptions> = {}) {
    this.opts = { ...LONG_PRESS_DEFAULTS, ...opts };
  }

  /** Pointer down. Returns the corner when a press was armed (caller schedules `poll` at +holdMs). */
  down(id: number, x: number, y: number, t: number, w: number, h: number): Corner | null {
    this.down_.add(id);
    if (this.down_.size > 1) {
      this.press = null; // multi-touch is never a corner long-press
      return null;
    }
    const corner = cornerAt(x, y, w, h, this.opts.cornerPx);
    this.press = corner ? { id, x0: x, y0: y, t0: t, corner, fired: false } : null;
    return corner;
  }

  move(id: number, x: number, y: number): void {
    const p = this.press;
    if (!p || p.id !== id) return;
    if (Math.hypot(x - p.x0, y - p.y0) > this.opts.moveTolerancePx) this.press = null;
  }

  up(id: number): void {
    this.down_.delete(id);
    if (this.press?.id === id) this.press = null;
  }

  /** True exactly once when the armed press has been held for holdMs. */
  poll(t: number): Corner | null {
    const p = this.press;
    if (!p || p.fired || t - p.t0 < this.opts.holdMs) return null;
    p.fired = true;
    return p.corner;
  }

  get armed(): boolean {
    return !!this.press && !this.press.fired;
  }
}

export class MultiFingerTap {
  private fired = false;

  constructor(readonly fingers = 3) {}

  /** Feed the current number of touches after every touchstart/touchend/touchcancel. */
  touches(count: number): boolean {
    if (count === 0) {
      this.fired = false;
      return false;
    }
    if (!this.fired && count >= this.fingers) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
