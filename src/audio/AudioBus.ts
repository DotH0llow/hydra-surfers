/**
 * WebAudio bus: unlocks on the first gesture and plays manifest sfx (placeholders are synthesized)
 * in response to game events. Respects the profile's mute and effects volume; suspends while hidden.
 */
import type { EventBus } from "../core/events";
import type { ProfileStore } from "../core/store";
import type { AssetLibrary } from "../assets/AssetLibrary";

/** A combo sound plays each time the combo crosses a multiple of this. */
const COMBO_SOUND_STEP = 5;

export class AudioBus {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private coinStreak = 0;
  private lastCoinAt = -1;
  private music: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private wantMusic = false;
  private ducked = false;
  private comboStep = 0;

  constructor(
    private readonly assets: AssetLibrary,
    bus: EventBus,
    private readonly store: ProfileStore,
    private readonly muted = false,
  ) {
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    bus.on("player:jump", () => this.play("sfx.jump"));
    bus.on("player:roll", () => this.play("sfx.roll"));
    bus.on("player:land", () => this.play("sfx.land"));
    bus.on("player:laneChange", () => this.play("sfx.swipe"));
    bus.on("player:stumble", () => this.play("sfx.stumble"));
    bus.on("run:crash", () => this.play("sfx.crash"));
    bus.on("run:revive", () => this.play("sfx.powerup", 0.8));
    bus.on("powerup:start", (e) => this.play("sfx.powerup", e.refreshed ? 1.25 : 1));
    bus.on("hoverboard:start", () => this.play("sfx.board"));
    bus.on("hoverboard:end", (e) => {
      if (e.reason === "break") this.play("sfx.crash", 1.5);
    });
    bus.on("pickup:collect", (e) => {
      if (e.kind === "key") this.play("sfx.key");
    });
    bus.on("mission:complete", () => this.play("sfx.mission"));
    // skill feedback: pitch climbs along a perfect streak and per combo milestone
    bus.on("skill:nearMiss", () => this.play("sfx.nearmiss"));
    bus.on("skill:perfect", (e) => this.play("sfx.perfect", Math.pow(2, Math.min(e.streak - 1, 7) / 12)));
    bus.on("combo:change", (e) => {
      const step = Math.floor(e.combo / COMBO_SOUND_STEP);
      if (step > this.comboStep) this.play("sfx.combo", Math.pow(2, Math.min(step - 1, 7) / 12));
      this.comboStep = step;
    });
    bus.on("build:absorb", (e) => (e.kind === "smash" ? this.play("sfx.crash", 1.6) : this.play("sfx.block")));
    bus.on("event:start", () => this.play("sfx.horn"));
    bus.on("app:rank", (e) => {
      if (e.improved || e.passed > 0) this.play("sfx.rankup");
    });
    bus.on("app:runReport", (e) => {
      if (e.records > 0 || e.newBest || e.levelUp) this.play("sfx.fanfare");
    });
    bus.on("ui:click", () => this.play("sfx.ui.tap"));
    bus.on("coin:collect", () => {
      const now = this.ac?.currentTime ?? 0;
      this.coinStreak = now - this.lastCoinAt < 0.6 ? Math.min(this.coinStreak + 1, 12) : 0;
      this.lastCoinAt = now;
      this.play("sfx.coin", Math.pow(2, this.coinStreak / 24));
    });
    bus.on("run:start", () => this.startMusic());
    bus.on("run:revive", () => this.duck(false));
    bus.on("run:crash", () => this.duck(true));
    bus.on("run:pause", () => this.duck(true));
    bus.on("run:resume", () => this.duck(false));
    bus.on("run:end", () => this.stopMusic());
    bus.on("run:idle", () => this.stopMusic());
    store.subscribe(() => this.applyMusicVolume());
    bus.on("app:visibility", ({ hidden }) => {
      if (!this.ac) return;
      if (hidden) void this.ac.suspend();
      else void this.ac.resume();
    });
  }

  unlock(): void {
    if (this.ac) {
      if (this.ac.state === "suspended") void this.ac.resume();
      return;
    }
    try {
      this.ac = new AudioContext();
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
      if (this.wantMusic) this.startMusic();
    } catch (err) {
      console.warn("[audio] WebAudio unavailable", err);
    }
  }

  /** Starts the looping run music (from the top). */
  startMusic(): void {
    this.wantMusic = true;
    this.ducked = false;
    const ac = this.ac;
    if (!ac || !this.master) return;
    this.stopSource();
    const buf = this.assets.getAudioBuffer("music.run", ac);
    if (!buf) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ac.createGain();
    src.connect(g).connect(this.master);
    this.music = src;
    this.musicGain = g;
    this.applyMusicVolume();
    src.start();
  }

  stopMusic(): void {
    this.wantMusic = false;
    this.stopSource();
  }

  private duck(on: boolean): void {
    this.ducked = on;
    this.applyMusicVolume();
  }

  private stopSource(): void {
    try {
      this.music?.stop();
    } catch {
      /* already stopped */
    }
    this.music?.disconnect();
    this.musicGain?.disconnect();
    this.music = null;
    this.musicGain = null;
  }

  private applyMusicVolume(): void {
    const g = this.musicGain;
    if (!g || !this.ac) return;
    const s = this.store.get().settings;
    const v = this.muted || s.muted ? 0 : (this.assets.entry("music.run")?.volume ?? 1) * s.music * (this.ducked ? 0.35 : 1);
    g.gain.setTargetAtTime(v, this.ac.currentTime, 0.08);
  }

  play(id: string, rate = 1): void {
    const ac = this.ac;
    if (!ac || !this.master || this.muted) return;
    const settings = this.store.get().settings;
    if (settings.muted || settings.sfx <= 0) return;
    const buf = this.assets.getAudioBuffer(id, ac);
    if (!buf) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = (this.assets.entry(id)?.volume ?? 1) * settings.sfx;
    src.connect(g).connect(this.master);
    src.start();
  }
}
