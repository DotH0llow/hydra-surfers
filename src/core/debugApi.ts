/**
 * window.__game — the contract used by capture tools and critics (PLAN.md §4).
 * Installed early (so tools can `await __game.ready`); methods throw until the app is ready.
 *
 * getState() coordinates: player/camera x,y,z are RENDER space (runner at z = 0, camera z > 0 is
 * behind the runner); `player.s` / `distance` are sim distance along the track. Angles in degrees.
 */
import type { ClockMode } from "./loop";
import { listCheats, runCheat } from "./cheats";
import { bus } from "./events";
import { tuning, type TuningEntry } from "./tuning";

export interface GameState {
  t: number;
  frame: number;
  tick: number;
  clock: ClockMode;
  runTime: number;
  mode: string;
  paused: boolean;
  seed: number;
  scenario: string;
  speed: number;
  distance: number;
  score: number;
  multiplier: number;
  coins: number;
  player: {
    lane: number;
    x: number;
    y: number;
    z: number;
    s: number;
    vy: number;
    state: string;
    grounded: boolean;
    rolling: boolean;
    switching: boolean;
  };
  camera: { x: number; y: number; z: number; fov: number; pitch: number };
  chaser: { dist: number; near: boolean };
  activePowerups: Array<{ id: string; remaining: number }>;
  screen: string;
  obstacles: number;
  coinsLive: number;
  render: { calls: number; triangles: number; width: number; height: number; dpr: number };
}

export interface StartRunArgs {
  scenario?: string;
  seed?: number;
  skipIntro?: boolean;
}

/** Implemented by App. */
export interface DebugHost {
  setClock(mode: ClockMode): void;
  step(frames: number, fps: number): void;
  setSeed(seed: number | undefined): void;
  startRun(opts?: StartRunArgs): void;
  goto(screen: string): void;
  input(action: string): void;
  getState(): GameState;
  screenshot(): string;
  listScenarios(): Array<{ id: string; description: string }>;
  assetReport(): unknown;
  profile(): unknown;
  entities(): EntitiesDump;
}

/** Sim-space snapshot of live track content (debug/tests; allocates, not for per-frame use). */
export interface EntitiesDump {
  distance: number;
  obstacles: Array<{ uid: number; type: string; lane: number; s: number; length: number; speed: number }>;
  coins: Array<{ lane: number; s: number; y: number }>;
}

export interface GameDebugApi {
  ready: Promise<void>;
  setClock(mode: ClockMode): void;
  step(frames: number, fps?: number): void;
  setSeed(n: number): void;
  startRun(opts?: StartRunArgs): void;
  goto(screen: string): void;
  input(action: string): void;
  getState(): GameState;
  setTuning(path: string, value: number): boolean;
  getTuning(): Record<string, number>;
  cheat(name: string, ...args: unknown[]): unknown;
  // ---- extras (additive)
  /** PNG data URL of the WebGL canvas (DOM UI not included; use a page screenshot for that). */
  screenshot(): string;
  tuningSchema(): TuningEntry[];
  cheats(): Array<{ name: string; label: string; group: string }>;
  scenarios(): Array<{ id: string; description: string }>;
  assets(): unknown;
  profile(): unknown;
  /** Live obstacles and coins in sim space. */
  entities(): EntitiesDump;
  /**
   * Abstract input actions emitted (any source: touch, mouse, keyboard, debug), oldest first, with
   * a monotonically increasing `seq`. Pass the last seen `seq` to get only newer entries. Keeps 500.
   */
  inputLog(since?: number): InputLogEntry[];
  isReady(): boolean;
}

export interface InputLogEntry {
  seq: number;
  action: string;
  source: string;
  /** Sim tick / rendered frame when the action was emitted (-1 before the app is ready). */
  tick: number;
  frame: number;
}

declare global {
  interface Window {
    __game?: GameDebugApi;
  }
}

export function installDebugApi(): { api: GameDebugApi; attach(host: DebugHost): void; fail(err: unknown): void } {
  let host: DebugHost | null = null;
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const need = (): DebugHost => {
    if (!host) throw new Error("[__game] not ready yet — await window.__game.ready");
    return host;
  };
  // Debug-only input log (allocates per input event; never installed without ?debug=1 / dev).
  const inputLog: InputLogEntry[] = [];
  let seq = 0;
  bus.on("input:action", ({ action, source }) => {
    const st = host ? host.getState() : null;
    inputLog.push({ seq: ++seq, action, source, tick: st ? st.tick : -1, frame: st ? st.frame : -1 });
    if (inputLog.length > 500) inputLog.splice(0, inputLog.length - 500);
  });
  const api: GameDebugApi = {
    ready,
    setClock: (mode) => need().setClock(mode === "manual" ? "manual" : "realtime"),
    step: (frames, fps = 60) => need().step(frames, fps),
    setSeed: (n) => need().setSeed(n),
    startRun: (opts) => need().startRun(opts),
    goto: (screen) => need().goto(screen),
    input: (action) => need().input(action),
    getState: () => need().getState(),
    setTuning: (path, value) => {
      const ok = tuning.set(path, Number(value));
      if (!ok) console.warn(`[__game] setTuning: unknown path "${path}"`);
      return ok;
    },
    getTuning: () => tuning.snapshot(),
    cheat: (name, ...args) => runCheat(name, ...args),
    screenshot: () => need().screenshot(),
    tuningSchema: () => tuning.list(),
    cheats: () => listCheats().map(({ name, label, group }) => ({ name, label, group })),
    scenarios: () => need().listScenarios(),
    assets: () => need().assetReport(),
    profile: () => need().profile(),
    entities: () => need().entities(),
    inputLog: (since = 0) => inputLog.filter((e) => e.seq > since).map((e) => ({ ...e })),
    isReady: () => host !== null,
  };
  window.__game = api;
  return {
    api,
    attach(h) {
      host = h;
      resolve();
    },
    fail(err) {
      reject(err);
    },
  };
}
