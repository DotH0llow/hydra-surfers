/**
 * App — renderer, scene, loop, run, UI routing, input and the debug host.
 * Shared file: change additively.
 */
import { PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer } from "three";
import brand from "./brand/brand.json";
import type { AssetLibrary } from "./assets/AssetLibrary";
import { AudioBus } from "./audio/AudioBus";
import { registerCheat } from "./core/cheats";
import type { DebugHost, GameState, StartRunArgs } from "./core/debugApi";
import { bus } from "./core/events";
import { flags } from "./core/flags";
import { Loop, type ClockMode } from "./core/loop";
import type { ProfileStore } from "./core/store";
import { defineTuning, tuning } from "./core/tuning";
import { Run, type RunResult } from "./game/Run";
import { DEFAULT_SCENARIO, getScenario, listScenarios } from "./game/spawn/scenarios";
import { updateCurveUniforms } from "./game/world/curve";
import type { StartRunOptions } from "./game/types";
import { isAction, type Action, type InputSource } from "./input/actions";
import { InputRouter } from "./input/InputRouter";
import { UiRoot } from "./ui/UiRoot";
import type { ScreenHost, ScreenName } from "./ui/screens/registry";

export const DISPLAY = defineTuning("display", "Display", {
  dprCap: { default: 2, min: 0.5, max: 4, step: 0.25, label: "Device pixel ratio cap" },
  maxAspect: { default: 0.625, min: 0.4, max: 2.5, step: 0.005, label: "Widest playfield aspect (w/h) before letterboxing" },
});

export type LastResult = RunResult & { newBest: boolean; best: number };

export class App implements ScreenHost, DebugHost {
  readonly bus = bus;
  readonly brand = brand;
  readonly scene = new Scene();
  readonly camera3 = new PerspectiveCamera(60, 9 / 16, 0.1, 260);
  readonly renderer: WebGLRenderer;
  readonly loop: Loop;
  readonly run: Run;
  readonly ui: UiRoot;
  readonly inputRouter: InputRouter;
  readonly audio: AudioBus;
  lastResult: LastResult | null = null;
  private seedOverride: number | undefined = flags.seed;
  private screen: ScreenName = "home";
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    readonly assets: AssetLibrary,
    readonly store: ProfileStore,
    private readonly playfield: HTMLElement,
    canvas: HTMLCanvasElement,
    uiContainer: HTMLElement,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.info.autoReset = true;
    this.run = new Run({ bus, assets, scene: this.scene, camera3: this.camera3 });
    this.loop = new Loop({
      fixedUpdate: (dt) => this.run.fixedUpdate(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
    this.ui = new UiRoot(uiContainer, this);
    this.inputRouter = new InputRouter(playfield, bus);
    this.audio = new AudioBus(assets, bus, store, flags.mute);
  }

  get runState() {
    return this.run.state;
  }

  init(): void {
    this.run.init();
    this.registerCheats();
    bus.on("input:action", ({ action, source }) => this.onAction(action, source));
    bus.on("run:end", (r) => this.onRunEnd(r));
    tuning.subscribe((path) => {
      if (path.startsWith("display.")) this.layout();
    });
    window.addEventListener("resize", this.layout);
    window.visualViewport?.addEventListener("resize", this.layout);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.layout();
    this.loop.setClock(flags.clock);
    this.ui.show("home");
    this.loop.start();
    this.loop.redraw();
    if (flags.autostart) this.startRun();
  }

  // ------------------------------------------------------------------ routing

  goto(name: ScreenName): void {
    const mode = this.run.state.mode;
    switch (name) {
      case "home":
        if (mode !== "idle") this.run.goIdle();
        this.show("home");
        break;
      case "run":
        if (this.run.active) {
          this.run.resume();
          this.show("run");
        } else {
          this.startRun();
        }
        break;
      case "pause":
        if (!this.run.active) {
          console.warn("[app] pause ignored: no active run");
          return;
        }
        this.run.pause();
        this.show("pause");
        break;
      case "gameover":
        if (this.run.active) this.run.end("forced"); // → run:end → shows gameover
        else this.show("gameover");
        break;
      default:
        if (this.run.active) this.run.pause();
        this.show(name);
        break;
    }
  }

  startRun(opts: StartRunOptions = {}): void {
    const scenarioId = opts.scenario ?? flags.scenario ?? DEFAULT_SCENARIO;
    let scenario = getScenario(scenarioId);
    if (!scenario) {
      console.warn(`[app] unknown scenario "${scenarioId}", using "${DEFAULT_SCENARIO}"`);
      scenario = getScenario(DEFAULT_SCENARIO)!;
    }
    const seed = opts.seed ?? this.seedOverride ?? Math.floor(Math.random() * 0x7fffffff);
    this.run.start({ scenario, seed: seed >>> 0, skipIntro: !!opts.skipIntro });
    this.show("run");
  }

  private show(name: ScreenName): void {
    const previous = this.screen;
    this.screen = name;
    this.ui.show(name);
    if (previous !== name) bus.emit("app:screen", { screen: name, previous });
    if (this.loop.clock === "manual") this.ui.update(0);
  }

  private onAction(action: Action, source: InputSource): void {
    switch (this.screen) {
      case "home":
        if (action === "tap" || (source === "keyboard" && action === "jump")) this.startRun();
        break;
      case "run":
        if (action === "pause") this.goto("pause");
        else this.run.enqueue(action);
        break;
      case "pause":
        if (action === "pause") this.goto("run");
        break;
      case "gameover":
        if (action === "tap" && (source === "keyboard" || source === "debug")) this.startRun();
        break;
      default:
        if (action === "pause") this.goto("home");
        break;
    }
  }

  private onRunEnd(r: RunResult): void {
    const prevBest = this.store.get().stats.bestScore;
    const newBest = r.score > prevBest;
    this.store.update((p) => {
      p.stats.runs++;
      p.stats.totalCoins += r.coins;
      p.stats.totalDistance += r.distance;
      p.stats.bestScore = Math.max(p.stats.bestScore, r.score);
      p.stats.bestDistance = Math.max(p.stats.bestDistance, r.distance);
      p.currencies.coins += r.coins;
    });
    this.lastResult = { ...r, newBest, best: Math.max(prevBest, r.score) };
    this.show("gameover");
  }

  private readonly onVisibility = (): void => {
    const hidden = document.visibilityState === "hidden";
    bus.emit("app:visibility", { hidden });
    if (hidden && this.screen === "run" && this.run.active && this.loop.clock === "realtime") this.goto("pause");
  };

  // ------------------------------------------------------------------ frame

  private render(alpha: number, frameDt: number): void {
    this.run.render(alpha, frameDt);
    updateCurveUniforms();
    this.renderer.render(this.scene, this.camera3);
    this.ui.update(frameDt);
  }

  readonly layout = (): void => {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const w = Math.max(1, Math.round(Math.min(vw, vh * DISPLAY.maxAspect)));
    const h = Math.max(1, Math.round(vh));
    this.playfield.style.width = `${w}px`;
    this.playfield.style.height = `${h}px`;
    this.playfield.style.aspectRatio = "auto";
    const dpr = Math.min(window.devicePixelRatio || 1, DISPLAY.dprCap);
    if (w !== this.width || h !== this.height || dpr !== this.dpr) {
      this.width = w;
      this.height = h;
      this.dpr = dpr;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      this.run.camera.setViewportAspect(w / h);
      this.loop.redraw();
    }
  };

  // ------------------------------------------------------------------ cheats

  private registerCheats(): void {
    const st = this.run.state;
    registerCheat({
      name: "god",
      label: "God mode",
      group: "Run",
      args: [{ name: "on", kind: "boolean" }],
      run: (on) => (st.god = on === undefined ? !st.god : !!on),
    });
    registerCheat({
      name: "setSpeed",
      label: "Set speed (0 = curve)",
      group: "Run",
      args: [{ name: "mps", kind: "number", min: 0, max: 60, step: 0.5, default: 0 }],
      run: (v) => (st.speedOverride = Math.max(0, Number(v) || 0)),
    });
    registerCheat({
      name: "timeScale",
      label: "Time scale",
      group: "Run",
      args: [{ name: "scale", kind: "number", min: 0.1, max: 3, step: 0.1, default: 1 }],
      run: (v) => (this.loop.timeScale = Math.min(3, Math.max(0.1, Number(v) || 1))),
    });
    registerCheat({ name: "crash", label: "Crash now", group: "Run", run: () => this.run.crash("cheat") });
    registerCheat({
      name: "giveCoins",
      label: "Give coins",
      group: "Profile",
      args: [{ name: "amount", kind: "number", default: 1000 }],
      run: (n) => {
        this.store.update((p) => (p.currencies.coins += Math.floor(Number(n) || 0)));
        return this.store.get().currencies.coins;
      },
    });
    registerCheat({
      name: "giveKeys",
      label: "Give keys",
      group: "Profile",
      args: [{ name: "amount", kind: "number", default: 10 }],
      run: (n) => {
        this.store.update((p) => (p.currencies.keys += Math.floor(Number(n) || 0)));
        return this.store.get().currencies.keys;
      },
    });
    registerCheat({ name: "resetProfile", label: "Reset profile", group: "Profile", run: () => this.store.reset() });
  }

  // ------------------------------------------------------------------ DebugHost

  setClock(mode: ClockMode): void {
    this.loop.setClock(mode);
  }

  step(frames: number, fps: number): void {
    this.loop.step(frames, fps);
  }

  setSeed(seed: number | undefined): void {
    this.seedOverride = seed === undefined || seed === null ? undefined : Number(seed) >>> 0;
  }

  input(action: string): void {
    if (!isAction(action)) throw new Error(`[__game] unknown action "${action}"`);
    this.inputRouter.dispatch(action, "debug");
  }

  getState(): GameState {
    const st = this.run.state;
    const p = this.run.player;
    const cam = this.run.camera;
    const info = this.renderer.info.render;
    return {
      t: this.loop.simTime,
      frame: this.loop.frame,
      tick: this.loop.tick,
      clock: this.loop.clock,
      runTime: st.time,
      mode: st.mode,
      paused: st.paused,
      seed: st.seed,
      scenario: st.scenario,
      speed: st.speed,
      distance: st.distance,
      score: st.score,
      multiplier: st.multiplier,
      coins: st.coins,
      player: {
        lane: p.lane,
        x: p.x,
        y: p.y,
        z: 0,
        s: st.distance,
        vy: p.vy,
        state: p.state,
        grounded: p.grounded,
        rolling: p.rolling,
        switching: p.switchT < 1,
      },
      camera: { x: cam.x, y: cam.y, z: cam.z, fov: cam.effectiveFov(), pitch: cam.pitch() },
      chaser: { dist: this.run.chaser.gap },
      activePowerups: [],
      screen: this.screen,
      obstacles: this.run.obstacles.active.length,
      coinsLive: this.run.coins.live,
      render: { calls: info.calls, triangles: info.triangles, width: this.width, height: this.height, dpr: this.dpr },
    };
  }

  screenshot(): string {
    this.loop.redraw();
    return this.renderer.domElement.toDataURL("image/png");
  }

  listScenarios(): Array<{ id: string; description: string }> {
    return listScenarios().map(({ id, description }) => ({ id, description }));
  }

  assetReport(): unknown {
    return this.assets.report();
  }

  profile(): unknown {
    return this.store.export();
  }
}

export type { StartRunArgs };
