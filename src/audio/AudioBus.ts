/**
 * Minimal WebAudio bus: unlocks on the first gesture, plays manifest sfx (placeholders are
 * synthesized) in response to game events. Lane D owns the full audio system (music, settings).
 */
import type { EventBus } from "../core/events";
import type { ProfileStore } from "../core/store";
import type { AssetLibrary } from "../assets/AssetLibrary";

export class AudioBus {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private coinStreak = 0;
  private lastCoinAt = -1;

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
    bus.on("run:crash", () => this.play("sfx.crash"));
    bus.on("ui:click", () => this.play("sfx.ui.tap"));
    bus.on("coin:collect", () => {
      const now = this.ac?.currentTime ?? 0;
      this.coinStreak = now - this.lastCoinAt < 0.6 ? Math.min(this.coinStreak + 1, 12) : 0;
      this.lastCoinAt = now;
      this.play("sfx.coin", Math.pow(2, this.coinStreak / 24));
    });
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
    } catch (err) {
      console.warn("[audio] WebAudio unavailable", err);
    }
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
