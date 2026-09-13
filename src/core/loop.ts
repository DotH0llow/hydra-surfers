/**
 * Fixed-timestep simulation (120 Hz) with interpolated rendering.
 *
 * Clock modes:
 * - `realtime`: requestAnimationFrame drives frames; frame dt is clamped to avoid spirals.
 * - `manual`:   nothing advances on its own; `step(frames, fps)` advances the sim by exactly
 *               `frames / fps` seconds and renders once per frame (used by capture tools).
 *
 * The sim accumulates time in integer microseconds so manual stepping at 60/30 fps is exact
 * (1/60 s = 2 ticks, 1/30 s = 4 ticks) and runs are bit-for-bit reproducible.
 */

export type ClockMode = "realtime" | "manual";

export interface LoopHooks {
  /** Advance simulation by exactly `dt` seconds (always the fixed step). */
  fixedUpdate(dt: number): void;
  /** Draw. `alpha` in [0,1) blends previous → current sim state; `frameDt` is scaled wall time. */
  render(alpha: number, frameDt: number): void;
}

export const SIM_HZ = 120;
/** Integer time units per tick (see `advance`). */
const MICROS = 1_000_000;

export class Loop {
  readonly fixedDt = 1 / SIM_HZ;
  /** Sim speed multiplier (time-scale cheat). Applied to accumulated time, not to dt. */
  timeScale = 1;
  /** Max wall-clock seconds consumed per realtime frame. */
  maxFrameDt = 0.1;

  private mode: ClockMode = "realtime";
  private rafId = 0;
  private lastNow = -1;
  /** Accumulated, not-yet-simulated time in µs scaled by SIM_HZ (exact integer arithmetic). */
  private accUnits = 0;
  private _tick = 0;
  private _frame = 0;
  private running = false;

  constructor(private readonly hooks: LoopHooks) {}

  get clock(): ClockMode {
    return this.mode;
  }
  /** Fixed ticks simulated so far. */
  get tick(): number {
    return this._tick;
  }
  /** Frames rendered so far. */
  get frame(): number {
    return this._frame;
  }
  /** Simulated seconds (tick / SIM_HZ). */
  get simTime(): number {
    return this._tick / SIM_HZ;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.mode === "realtime") this.scheduleRaf();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  setClock(mode: ClockMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.lastNow = -1;
    if (mode === "manual") {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    } else if (this.running) {
      this.scheduleRaf();
    }
  }

  /** Advance exactly `frames` frames of `1/fps` seconds each, rendering after every frame. */
  step(frames: number, fps = 60): void {
    const n = Math.max(0, Math.floor(frames));
    const f = fps > 0 ? fps : 60;
    for (let i = 0; i < n; i++) this.advance(1 / f, f);
  }

  /** Render the current state again without advancing the sim (e.g. after a resize). */
  redraw(): void {
    this.hooks.render(this.alpha(), 0);
  }

  private scheduleRaf(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(this.onRaf);
  }

  private readonly onRaf = (now: number): void => {
    this.rafId = 0;
    if (!this.running || this.mode !== "realtime") return;
    const dt = this.lastNow < 0 ? 1 / 60 : Math.min(this.maxFrameDt, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.advance(dt, 0);
    this.scheduleRaf();
  };

  /**
   * Time bookkeeping uses "units" where one tick = MICROS units and one second = MICROS*SIM_HZ
   * units, so both 1/fps (for integer fps dividing SIM_HZ*MICROS) and 1/SIM_HZ are integers.
   */
  private advance(dt: number, fps: number): void {
    const scaled = dt * this.timeScale;
    let units: number;
    if (fps > 0 && this.timeScale === 1) {
      units = Math.round((MICROS * SIM_HZ) / fps);
    } else {
      units = Math.round(scaled * MICROS * SIM_HZ);
    }
    this.accUnits += units;
    let guard = 0;
    while (this.accUnits >= MICROS && guard < 64) {
      this.hooks.fixedUpdate(this.fixedDt);
      this.accUnits -= MICROS;
      this._tick++;
      guard++;
    }
    if (guard >= 64) this.accUnits = 0; // drop backlog rather than spiral
    this._frame++;
    this.hooks.render(this.alpha(), scaled);
  }

  private alpha(): number {
    return this.accUnits / MICROS;
  }
}
