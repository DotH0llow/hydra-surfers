/**
 * Gameplay effects of the timed power-ups (piece B6): jetpack flight with a sky coin trail, super
 * sneakers (jumps high enough to reach train roofs), coin magnet and the 2x score multiplier (read by
 * ScoreSystem). Durations = tuned base + shop upgrade levels (src/meta/upgrades.ts).
 * Replaces the foundation defs by re-registering the same ids.
 */
import { defineTuning } from "../../core/tuning";
import { upgradeLevel } from "../../meta/upgrades";
import { COINS } from "../collectibles/CoinSystem";
import { SPEED } from "../spawn/difficulty";
import type { RunContext } from "../types";
import { clampLane } from "../world/coords";
import { POWERUPS, registerPowerup } from "./registry";

export const POWERUP_FX = defineTuning("powerupFx", "Power-up effects", {
  upgradeSecondsPerLevel: { default: 2.5, min: 0, max: 10, step: 0.5, label: "Extra seconds per upgrade level", unit: "s" },
  jetpackHeight: { default: 8, min: 4, max: 20, step: 0.5, label: "Jetpack: flight height", unit: "m" },
  jetpackCoinLead: { default: 24, min: 0, max: 100, step: 1, label: "Jetpack: first sky coin ahead", unit: "m" },
  jetpackCoinSpacing: { default: 2.6, min: 0.5, max: 10, step: 0.1, label: "Jetpack: sky coin spacing", unit: "m" },
  jetpackLaneRun: { default: 34, min: 5, max: 200, step: 1, label: "Jetpack: sky trail changes lane every", unit: "m" },
  jetpackEndGap: { default: 18, min: 0, max: 100, step: 1, label: "Jetpack: no sky coins in the last", unit: "m" },
  landingGraceSeconds: { default: 1.2, min: 0, max: 5, step: 0.05, label: "Jetpack: no collisions after it ends", unit: "s" },
  sneakersHeightScale: { default: 2.6, min: 1, max: 5, step: 0.05, label: "Sneakers: jump height ×" },
  sneakersTimeScale: { default: 1.3, min: 0.5, max: 3, step: 0.05, label: "Sneakers: airtime ×" },
});

const withUpgrades = (base: number, id: string): number => base + upgradeLevel(id) * POWERUP_FX.upgradeSecondsPerLevel;
const running = (ctx: RunContext): boolean => ctx.state.mode === "running" || ctx.state.mode === "intro";
const jetpackSeconds = (): number => withUpgrades(POWERUPS.jetpackSeconds, "jetpack");

registerPowerup({
  id: "jetpack",
  label: "Jetpack",
  assetId: "pickup.jetpack",
  duration: jetpackSeconds,
  onStart(ctx) {
    const F = POWERUP_FX;
    const p = ctx.player;
    const st = ctx.state;
    p.startFlight(F.jetpackHeight);
    // sky coin trail over the flight, switching lanes now and then
    const end = st.distance + Math.max(st.speed, SPEED.start) * jetpackSeconds() - F.jetpackEndGap;
    let lane = p.lane;
    let run = 0;
    for (let s = st.distance + F.jetpackCoinLead; s < end; s += F.jetpackCoinSpacing) {
      ctx.coins.spawn(lane, s, F.jetpackHeight + COINS.height);
      run += F.jetpackCoinSpacing;
      if (run >= F.jetpackLaneRun) {
        run = 0;
        const dir = lane === -1 ? 1 : lane === 1 ? -1 : ctx.rng.chance(0.5) ? -1 : 1;
        lane = clampLane(lane + dir);
      }
    }
  },
  onEnd(ctx) {
    const p = ctx.player;
    if (!p.flying) return;
    p.endFlight();
    if (running(ctx)) p.graceT = Math.max(p.graceT, POWERUP_FX.landingGraceSeconds);
  },
});

registerPowerup({
  id: "sneakers",
  label: "Super sneakers",
  assetId: "pickup.sneakers",
  duration: () => withUpgrades(POWERUPS.sneakersSeconds, "sneakers"),
  onStart(ctx) {
    ctx.player.jumpHeightScale = POWERUP_FX.sneakersHeightScale;
    ctx.player.jumpTimeScale = POWERUP_FX.sneakersTimeScale;
  },
  onEnd(ctx) {
    ctx.player.jumpHeightScale = 1;
    ctx.player.jumpTimeScale = 1;
  },
});

registerPowerup({
  id: "magnet",
  label: "Coin magnet",
  assetId: "pickup.magnet",
  duration: () => withUpgrades(POWERUPS.magnetSeconds, "magnet"),
  onStart(ctx) {
    ctx.coins.magnet = true;
  },
  onEnd(ctx) {
    ctx.coins.magnet = false;
  },
});

registerPowerup({
  id: "multiplier",
  label: "2x multiplier",
  assetId: "pickup.multiplier",
  duration: () => withUpgrades(POWERUPS.multiplierSeconds, "multiplier"),
});
