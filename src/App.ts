/**
 * App — renderer, scene, loop, run, UI routing, input and the debug host.
 * Shared file: change additively.
 */
import { PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer } from "three";
import brand from "./brand/brand.json";
import type { AssetLibrary } from "./assets/AssetLibrary";
import { AudioBus } from "./audio/AudioBus";
import { registerCheat } from "./core/cheats";
import type { DebugHost, EntitiesDump, GameState, StartRunArgs } from "./core/debugApi";
import { bus } from "./core/events";
import { flags } from "./core/flags";
import { Loop, type ClockMode } from "./core/loop";
import type { Profile, ProfileStore, StorageLike } from "./core/store";
import { defineTuning, tuning } from "./core/tuning";
import { Run, type RunResult } from "./game/Run";
import type { HoverboardSystem, HoverboardView } from "./game/hoverboard/Hoverboard";
import { equippedId } from "./meta/catalog";
import type { PlayerAnimator } from "./game/player/PlayerAnimator";
import type { PowerupSystem } from "./game/powerups/PowerupSystem";
import { activeMissions, applyRunMissions, liveProgress, multiplierBonus, type ActiveMission } from "./meta/missions";
import { applyRun, attemptsUsed, recordBoardAttempt, recordBoardResult, type RunReport } from "./meta/progression";
import { emptyRunStats, type RunStat, type RunStats, type RunSummary } from "./meta/stats";
import { SLOTS, buildEffects, equippedItem } from "./meta/equipment";
import { dailyMode, modeById, seedForMode, type RunMode, type RunModeId } from "./meta/modes";
import { accountLevel, recordDailyWin } from "./meta/progression";
import { formatInt } from "./ui/dom";
import type { CommunityState } from "./online";
import { resolveRules } from "./game/rules";
import type { SkillSystem } from "./game/skill/SkillSystem";
import type { PickupSystem } from "./game/powerups/PickupSystem";
import { MAX_REVIVES, reviveCost as keysForRevive, syncUpgrades } from "./meta/upgrades";
import { createLeaderboardService, type LeaderboardService, type SubmitResult } from "./online";
import { DEFAULT_SCENARIO, getScenario, listScenarios } from "./game/spawn/scenarios";
import { updateCurveUniforms } from "./game/world/curve";
import type { RunState, StartRunOptions } from "./game/types";
import { isAction, type Action, type InputSource } from "./input/actions";
import { InputRouter } from "./input/InputRouter";
import { UiRoot } from "./ui/UiRoot";
import type { ResultView, ScreenHost, ScreenName } from "./ui/screens/registry";
import type { GhostRecorder, GhostRunner } from "./game/ghost/Ghost";
import { decodeGhost, encodeGhost } from "./shared/ghost";

export const DISPLAY = defineTuning("display", "Display", {
  dprCap: { default: 2, min: 0.5, max: 4, step: 0.25, label: "Device pixel ratio cap" },
  maxAspect: { default: 0.625, min: 0.4, max: 2.5, step: 0.005, label: "Widest playfield aspect (w/h) before letterboxing" },
});

export const FLOW = defineTuning("flow", "Screen flow", {
  resumeCountdownSeconds: { default: 3, min: 0, max: 5, step: 0.5, label: "Resume countdown after pause", unit: "s" },
  reviveOfferSeconds: { default: 5, min: 1, max: 15, step: 0.5, label: "Revive offer stays open", unit: "s" },
  missionCheckSeconds: { default: 0.5, min: 0.1, max: 5, step: 0.1, label: "Distance/score mission check interval", unit: "s" },
});

export type LastResult = ResultView;

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: "release", fn: () => void): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

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
  readonly online: LeaderboardService;
  lastResult: LastResult | null = null;
  lastSubmit: Promise<SubmitResult | null> | null = null;
  resumeCountdown = 0;
  private seedOverride: number | undefined = flags.seed;
  private screen: ScreenName = "home";
  private width = 0;
  private height = 0;
  private dpr = 1;
  private runStats: RunStats = emptyRunStats();
  /** Mode the current (or last) run was started in. */
  currentMode: RunMode = modeById("normal", Date.now());
  /** Bumped per run start so a late ghost download never lands in the wrong run. */
  private ghostRequest = 0;
  /** Whether the current run counts for its board (seeded modes have limited ranked attempts). */
  ranked = true;
  private runBiomes: string[] = [];
  private runPowerups: string[] = [];
  private missions: ActiveMission[] = [];
  private readonly notified = new Set<string>();
  private missionTimer = 0;
  private quitting = false;
  private wakeLock: WakeLockSentinelLike | null = null;

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
    this.online = createLeaderboardService(browserStorage());
    this.ui = new UiRoot(uiContainer, this);
    this.inputRouter = new InputRouter(playfield, bus);
    this.audio = new AudioBus(assets, bus, store, flags.mute);
  }

  get runState(): Readonly<RunState> {
    return this.run.state;
  }

  get powerups(): PowerupSystem | undefined {
    return this.run.ctx.getSystem<PowerupSystem>("powerups");
  }

  get hoverboard(): HoverboardSystem | undefined {
    return this.run.ctx.getSystem<HoverboardSystem>("hoverboard");
  }

  get reviveOfferSeconds(): number {
    return FLOW.reviveOfferSeconds;
  }

  // ------------------------------------------------------------------ identity & social

  get playerName(): string {
    return this.online.identity().playerName;
  }

  get nameChosen(): boolean {
    return this.online.identity().named === true;
  }

  renamePlayer(name: string): Promise<{ ok: boolean; error?: "invalid" | "taken" | "offline" }> {
    return this.online.rename(name);
  }

  recoveryCode(): string | null {
    return this.online.identity().token ?? null;
  }

  recover(code: string): Promise<boolean> {
    return this.online.recover(code);
  }

  /** Nearest power-up ahead, when the build reveals them (the mage's eye). */
  upcomingPickup(): { lane: number; dist: number } | null {
    if (!this.run.ctx.rules.revealPickups || !this.run.active) return null;
    const pickups = this.run.ctx.getSystem<PickupSystem>("pickups");
    if (!pickups) return null;
    const d = this.run.state.distance;
    let best: { lane: number; dist: number } | null = null;
    for (const it of pickups.items) {
      if (!it.active || it.kind === "key") continue;
      const ahead = it.s - d;
      if (ahead > 0 && ahead < 180 && (!best || ahead < best.dist)) best = { lane: it.lane, dist: ahead };
    }
    return best;
  }

  ghostLead(): { name: string; lead: number } | null {
    const g = this.run.ctx.getSystem<GhostRunner>("ghost");
    return g && g.name && Number.isFinite(g.lead) ? { name: g.name, lead: g.lead } : null;
  }

  communityProgress(): Promise<CommunityState | null> {
    return this.online.community();
  }

  /**
   * One line about the nearest rival: today's daily board if the player has run it, otherwise
   * the season. In a group of ~40 people this line does more for "one more run" than any reward.
   */
  async rivalLine(): Promise<string | null> {
    try {
      const daily = dailyMode(Date.now());
      let board = await this.online.getBoard("daily", daily.period);
      let where = "na Corrida do Dia";
      if (!board.me) {
        board = await this.online.getBoard("season");
        where = "na temporada";
      }
      const me = board.me;
      if (!me) return null;
      if (me.rank === 1) return `Você lidera ${where}. Todos estão atrás de você.`;
      const above = board.entries.find((e) => e.rank === me.rank - 1);
      if (!above) return `Você é #${me.rank} ${where}.`;
      return `#${me.rank} ${where} · ${formatInt(above.score - me.score)} pontos atrás de ${above.name}`;
    } catch {
      return null;
    }
  }

  init(): void {
    this.run.init();
    this.run.reviveOffer = (st) => this.offerRevive(st);
    this.applyProfile(this.store.get());
    this.store.subscribe((p) => this.applyProfile(p));
    this.registerCheats();
    this.trackRunStats();
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
    switch (name) {
      case "home":
        this.resumeCountdown = 0;
        if (this.run.active) {
          // quitting mid-run still banks the coins and mission progress
          this.quitting = true;
          this.run.end("quit");
          this.quitting = false;
        }
        if (this.run.state.mode !== "idle") this.run.goIdle();
        this.releaseWakeLock();
        this.show("home");
        break;
      case "run":
        if (this.run.active) {
          if (this.run.awaitingRevive) {
            this.show("revive");
            break;
          }
          const countdown = this.loop.clock === "realtime" && this.run.state.paused ? FLOW.resumeCountdownSeconds : 0;
          if (countdown > 0) this.resumeCountdown = countdown;
          else this.run.resume();
          this.requestWakeLock();
          this.show("run");
        } else {
          this.startRun();
        }
        break;
      case "pause":
        if (!this.run.active || this.run.awaitingRevive) {
          console.warn("[app] pause ignored: no active run");
          return;
        }
        this.resumeCountdown = 0;
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
    const now = Date.now();
    const mode = modeById((opts.mode as RunModeId | undefined) ?? "normal", now);
    this.currentMode = mode;
    // Seeded boards allow a few ranked attempts per period. The attempt is spent at the START, so
    // quitting a bad run cannot be used to retry for free; runs after that are practice.
    if (mode.attempts > 0) {
      this.ranked = attemptsUsed(this.store.get(), mode.board, mode.period) < mode.attempts;
      if (this.ranked) this.store.update((p) => recordBoardAttempt(p, mode.board, mode.period));
    } else {
      this.ranked = true;
    }
    const seed = opts.seed ?? this.seedOverride ?? seedForMode(mode);
    const profile = this.store.get();
    this.run.state.multiplierBonus = multiplierBonus(profile);
    // mode mutators first, then the equipped build: both are just effect lists over RunRules
    const rules = resolveRules(mode.effects, buildEffects(profile));
    this.run.start({
      scenario,
      seed: seed >>> 0,
      skipIntro: !!opts.skipIntro,
      rules,
      layoutSpeedMul: resolveRules(mode.effects).speedMul,
      biomes: mode.biomes,
      weather: mode.weather,
    });
    this.loadGhost(mode);
    const hb = this.hoverboard;
    if (hb) hb.charges = profile.currencies.mounts;
    this.runStats = emptyRunStats();
    this.runStats.runs = 1;
    this.runBiomes = [];
    this.runPowerups = [];
    this.missions = activeMissions(profile);
    this.notified.clear();
    this.missionTimer = 0;
    this.resumeCountdown = 0;
    this.lastSubmit = null;
    this.requestWakeLock();
    this.show("run");
  }

  action(action: Action): void {
    this.inputRouter.dispatch(action, "touch");
  }

  revive(): void {
    if (!this.run.awaitingRevive) return;
    const cost = keysForRevive(this.run.state.revives);
    if (this.store.get().currencies.keys < cost) return;
    this.store.update((p) => (p.currencies.keys -= cost));
    this.run.revive();
    this.show("run");
  }

  skipRevive(): void {
    this.run.declineRevive();
  }

  reviveCost(): number {
    return keysForRevive(this.run.state.revives);
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
        else if (this.resumeCountdown <= 0) this.run.enqueue(action);
        break;
      case "pause":
        if (action === "pause") this.goto("run");
        break;
      case "revive":
        break;
      case "gameover":
        if (action === "tap" && (source === "keyboard" || source === "debug")) this.startRun();
        break;
      default:
        if (action === "pause") this.goto("home");
        break;
    }
  }

  private offerRevive(st: Readonly<RunState>): boolean {
    const allowed = Math.min(MAX_REVIVES, this.run.ctx.rules.revivesAllowed);
    if (st.revives >= allowed || st.crashCause === "cheat") return false;
    if (this.store.get().currencies.keys < keysForRevive(st.revives)) return false;
    this.show("revive");
    return true;
  }

  /**
   * The daily run races a ghost on the same road (settings can turn it off). It arrives
   * asynchronously; ghosts run on run time, so a late arrival still lines up.
   */
  private loadGhost(mode: RunMode): void {
    const ghost = this.run.ctx.getSystem<GhostRunner>("ghost");
    const request = ++this.ghostRequest;
    if (!ghost || mode.board !== "daily" || !this.store.get().settings.ghosts) return;
    this.online
      .getGhost(mode.board, mode.period)
      .then((g) => {
        if (request !== this.ghostRequest || !g || !this.run.active) return;
        const track = decodeGhost(g.data);
        if (track) ghost.setTrack(track, g.playerId === this.online.identity().playerId ? "Seu melhor" : g.name);
      })
      .catch(() => {});
  }

  /** The run's ghost track when it beats the player's best on the daily board, else undefined. */
  private ghostToUpload(mode: RunMode, score: number, previousBest: number): string | undefined {
    if (mode.board !== "daily" || !this.ranked || score <= previousBest) return undefined;
    const rec = this.run.ctx.getSystem<GhostRecorder>("ghostRecorder");
    return rec && rec.count > 1 ? encodeGhost(rec.dist, rec.x, rec.y, rec.count) : undefined;
  }

  private onRunEnd(r: RunResult): void {
    this.resumeCountdown = 0;
    this.releaseWakeLock();
    const mode = this.currentMode;
    const summary = this.buildSummary(r);
    const prevBest = this.store.get().stats.bestScore;
    const board = this.store.get().modes[mode.board];
    const prevBoardBest = board?.period === mode.period ? board.best : 0;
    const holder: { report: RunReport | null } = { report: null };
    this.store.update((p) => {
      holder.report = applyRun(p, summary, Date.now());
      if (this.ranked && mode.attempts > 0) recordBoardResult(p, mode.board, mode.period, r.score, r.distance);
    });
    const report = holder.report!;
    this.lastResult = {
      ...r,
      newBest: r.score > prevBest,
      best: this.store.get().stats.bestScore,
      missions: report.missions,
      report,
      stats: summary.stats,
      modeName: mode.name,
      board: mode.board,
      ranked: this.ranked,
    };
    if (report.missions?.setAdvanced) this.toast(`Multiplicador da guilda x${1 + report.missions.multiplierBonus}!`, "mission");
    if (r.score > 0 && r.reason !== "forced") {
      this.lastSubmit = this.online
        .submitScore({
          score: r.score,
          coins: r.coins,
          distance: r.distance,
          seed: r.seed,
          board: mode.board,
          period: mode.period,
          ranked: this.ranked,
          duration: r.time,
          maxCombo: summary.stats.maxCombo,
          cleanDistance: summary.stats.cleanDistance,
          contracts: report.contracts.completed.length,
          // balance metrics are opt-out (settings)
          cause: this.store.get().settings.analytics ? r.cause : "",
          house: this.store.get().social.faction,
          ghost: this.ghostToUpload(mode, r.score, prevBoardBest),
        })
        .then((res) => {
          // a fresh first place on today's board is the Campeão achievement's trigger
          if (res.ranked && mode.board === "daily" && res.rank === 1 && res.previousRank !== 1) this.store.update(recordDailyWin);
          const p = this.store.get();
          const c = p.equipped.crest;
          void this.online.updateProfile({ crest: `${c.bg}.${c.symbol}.${c.frame}.${c.color}`, title: p.equipped.title, level: accountLevel(p.progress.xp) });
          return res;
        })
        .catch((err) => {
          console.warn("[online] score submit failed", err);
          return null;
        });
    }
    if (this.quitting) return;
    bus.emit("app:runReport", {
      records: report.records.length,
      newBest: this.lastResult.newBest,
      levelUp: report.levelAfter > report.levelBefore || report.seasonLevelAfter > report.seasonLevelBefore,
    });
    this.show("gameover");
  }

  private readonly onVisibility = (): void => {
    const hidden = document.visibilityState === "hidden";
    bus.emit("app:visibility", { hidden });
    if (hidden && this.screen === "run" && this.run.active && this.loop.clock === "realtime") this.goto("pause");
  };

  // ------------------------------------------------------------------ meta: missions, profile, wake lock

  private trackRunStats(): void {
    bus.on("coin:collect", () => this.bumpStat("coins"));
    bus.on("player:jump", () => this.bumpStat("jumps"));
    bus.on("player:roll", () => this.bumpStat("rolls"));
    bus.on("player:laneChange", () => this.bumpStat("laneChanges"));
    bus.on("hoverboard:start", () => {
      this.bumpStat("mounts");
      this.store.update((p) => (p.currencies.mounts = Math.max(0, p.currencies.mounts - 1)));
    });
    bus.on("pickup:collect", ({ kind }) => {
      if (kind === "key") {
        this.store.update((p) => (p.currencies.keys += 1));
        this.bumpStat("keys");
        this.toast("+1 chave", "key");
      } else {
        if (this.run.active && !this.runPowerups.includes(kind)) this.runPowerups.push(kind);
        this.bumpStat("powerups");
      }
    });
    bus.on("run:crash", () => this.bumpStat("crashes"));
    bus.on("run:stumble", () => this.bumpStat("stumbles"));
    bus.on("event:start", ({ name }) => this.toast(name, "event"));
    bus.on("biome:enter", ({ id, name, index }) => {
      if (!this.run.active) return;
      if (!this.runBiomes.includes(id)) this.runBiomes.push(id);
      if (index > 0) this.toast(name, "biome");
    });
  }

  /** Everything the meta layer needs about the run that just ended. */
  private buildSummary(r: RunResult): RunSummary {
    const s = this.runStats;
    s.distance = r.distance;
    s.score = r.score;
    s.coins = r.coins;
    s.revives = r.revives;
    s.time = r.time;
    s.biomes = this.runBiomes.length;
    const skill = this.run.ctx.getSystem<SkillSystem>("skill")?.snapshot();
    if (skill) {
      s.obstacles = skill.dodges;
      s.nearMisses = skill.near;
      s.perfectDodges = skill.perfect;
      s.maxCombo = skill.best;
      s.cleanDistance = skill.clean;
    }
    const p = this.store.get();
    const equipment: string[] = [];
    for (const slot of SLOTS) {
      const item = equippedItem(p, slot);
      if (item) equipment.push(item.id);
    }
    return {
      stats: s,
      biomes: this.runBiomes.slice(),
      equipment,
      board: this.currentMode.board,
      period: this.currentMode.period,
      seed: r.seed,
      reason: r.reason,
      cause: r.cause,
      noPowerups: this.runPowerups.length === 0,
      coinsBanked: Math.round(r.coins * this.run.ctx.rules.coinValue),
      powerupKinds: this.runPowerups.slice(),
    };
  }

  private bumpStat(stat: RunStat): void {
    if (!this.run.active) return;
    this.runStats[stat] += 1;
    this.checkMissions();
  }

  private checkMissions(): void {
    const st = this.run.state;
    this.runStats.distance = Math.floor(st.distance);
    this.runStats.score = st.score;
    for (let i = 0; i < this.missions.length; i++) {
      const m = this.missions[i];
      if (m.done || this.notified.has(m.key)) continue;
      if (liveProgress(m, this.runStats) >= m.goal) {
        this.notified.add(m.key);
        bus.emit("mission:complete", { key: m.key, label: m.label });
        this.toast(`Mission complete: ${m.label}`, "mission");
      }
    }
  }

  private toast(text: string, kind: string): void {
    bus.emit("ui:toast", { text, kind });
  }

  private applyProfile(p: Readonly<Profile>): void {
    syncUpgrades(p);
    this.run.ctx.getSystem<PlayerAnimator>("playerView")?.setModel(equippedId(p, "character"));
    this.run.ctx.getSystem<HoverboardView>("hoverboardView")?.setBoard(equippedId(p, "mount"));
    const reduced = !!p.settings.reducedMotion;
    document.documentElement.classList.toggle("reduced-motion", reduced);
    for (const path of ["camera.shakeAmplitude", "camera.speedFov"]) {
      if (reduced && tuning.get(path) !== 0) tuning.set(path, 0);
      else if (!reduced && tuning.get(path) === 0) tuning.reset(path);
    }
  }

  private requestWakeLock(): void {
    const nav = navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock || this.wakeLock || this.loop.clock === "manual") return;
    nav.wakeLock
      .request("screen")
      .then((lock) => {
        this.wakeLock = lock;
        lock.addEventListener?.("release", () => (this.wakeLock = null));
      })
      .catch(() => {});
  }

  private releaseWakeLock(): void {
    const lock = this.wakeLock;
    this.wakeLock = null;
    lock?.release().catch(() => {});
  }

  // ------------------------------------------------------------------ frame

  private render(alpha: number, frameDt: number): void {
    if (this.resumeCountdown > 0) {
      this.resumeCountdown -= frameDt;
      if (this.resumeCountdown <= 0) {
        this.resumeCountdown = 0;
        if (this.screen === "run") this.run.resume();
      }
    }
    if (this.run.state.mode === "running") {
      if (this.run.state.speed > this.runStats.topSpeed) this.runStats.topSpeed = this.run.state.speed;
      this.missionTimer += frameDt;
      if (this.missionTimer >= FLOW.missionCheckSeconds) {
        this.missionTimer = 0;
        this.checkMissions();
      }
    }
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
    registerCheat({
      name: "giveBoards",
      label: "Give hoverboards",
      group: "Profile",
      args: [{ name: "amount", kind: "number", default: 5 }],
      run: (n) => {
        this.store.update((p) => (p.currencies.mounts += Math.floor(Number(n) || 0)));
        const hb = this.hoverboard;
        if (hb && this.run.active) hb.charges = this.store.get().currencies.mounts;
        return this.store.get().currencies.mounts;
      },
    });
    registerCheat({
      name: "completeMissions",
      label: "Complete current missions",
      group: "Profile",
      run: () => {
        this.store.update((p) => {
          for (const m of activeMissions(p)) p.missions.progress[m.key] = m.goal;
          applyRunMissions(p, emptyRunStats());
        });
        return this.store.get().missions.set;
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
        head: this.run.ctx.getSystem<PlayerAnimator>("playerView")?.headScreen(this.camera3) ?? null,
      },
      camera: { x: cam.x, y: cam.y, z: cam.z, fov: cam.effectiveFov(), pitch: cam.pitch() },
      chaser: { dist: this.run.chaser.gap, near: this.run.chaser.near },
      activePowerups: this.powerups?.snapshot() ?? [],
      hoverboard: this.hoverboard?.snapshot() ?? null,
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

  entities(): EntitiesDump {
    const coins = this.run.coins;
    const out: EntitiesDump = {
      distance: this.run.state.distance,
      obstacles: this.run.obstacles.active
        .map((o) => ({ uid: o.uid, type: o.type.id, lane: o.lane, s: o.s, length: o.length, speed: o.speed }))
        .sort((a, b) => a.s - b.s),
      coins: [],
    };
    for (let i = 0; i < coins.status.length; i++) {
      if (coins.status[i] === 1) out.coins.push({ lane: coins.lane[i], s: coins.s[i], y: coins.y[i] });
    }
    out.coins.sort((a, b) => a.s - b.s);
    return out;
  }
}

export type { StartRunArgs };
