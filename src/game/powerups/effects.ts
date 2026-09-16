/**
 * Gameplay effects of the timed power-ups: griffin flight with a sky coin trail, giant boots
 * (jumps high enough to reach rooftops), the magnetic amulet and the royal blessing (2x score,
 * read by ScoreSystem).
 *
 * Duration = tuned base + shop upgrade levels, then scaled by the run's rules. Two rule knobs
 * apply: `powerupDurationMul` (everything) and one per power-up (so an amulet-focused build can
 * lengthen the magnet without lengthening flight). Seeded competitive modes switch the shop
 * upgrades off through `rules.upgrades`, so a daily board is not decided by purchases.
 */
import { defineTuning } from "../../core/tuning";
import { upgradeLevel } from "../../meta/upgrades";
import type { RuleKey } from "../rules";
import { COINS } from "../collectibles/CoinSystem";
import { SPEED } from "../spawn/difficulty";
import type { RunContext } from "../types";
import { clampLane } from "../world/coords";
import { POWERUPS, registerPowerup } from "./registry";

export const POWERUP_FX = defineTuning("powerupFx", "Power-up effects", {
  upgradeSecondsPerLevel: { default: 2.5, min: 0, max: 10, step: 0.5, label: "Extra seconds per upgrade level", unit: "s" },
  jetpackHeight: { default: 8, min: 4, max: 20, step: 0.5, label: "Griffin: flight height", unit: "m" },
  jetpackCoinLead: { default: 24, min: 0, max: 100, step: 1, label: "Griffin: first sky coin ahead", unit: "m" },
  jetpackCoinSpacing: { default: 2.6, min: 0.5, max: 10, step: 0.1, label: "Griffin: sky coin spacing", unit: "m" },
  jetpackLaneRun: { default: 34, min: 5, max: 200, step: 1, label: "Griffin: sky trail changes lane every", unit: "m" },
  jetpackEndGap: { default: 18, min: 0, max: 100, step: 1, label: "Griffin: no sky coins in the last", unit: "m" },
  landingGraceSeconds: { default: 1.2, min: 0, max: 5, step: 0.05, label: "Griffin: no collisions after it ends", unit: "s" },
  sneakersHeightScale: { default: 2.6, min: 1, max: 5, step: 0.05, label: "Boots: jump height x" },
  sneakersTimeScale: { default: 1.3, min: 0.5, max: 3, step: 0.05, label: "Boots: airtime x" },
  hourglassSpeedScale: { default: 0.72, min: 0.3, max: 1, step: 0.01, label: "Hourglass: road speed x" },
});

/** Which per-power-up rule stretches each one (ids stay stable; the theme is in the labels). */
const DURATION_RULE: Record<string, RuleKey> = {
  jetpack: "griffinDurationMul",
  sneakers: "bootsDurationMul",
  magnet: "magnetDurationMul",
  multiplier: "blessingDurationMul",
  aegis: "aegisDurationMul",
  hourglass: "hourglassDurationMul",
};

/** Seconds a power-up lasts for this run: base + upgrades, scaled by the run's rules. */
function duration(ctx: RunContext, base: number, id: string): number {
  const levels = ctx.rules.upgrades > 0 ? upgradeLevel(id) : 0;
  const perPowerup = ctx.rules[DURATION_RULE[id]] ?? 1;
  return (base + levels * POWERUP_FX.upgradeSecondsPerLevel) * ctx.rules.powerupDurationMul * perPowerup;
}

const running = (ctx: RunContext): boolean => ctx.state.mode === "running" || ctx.state.mode === "intro";

registerPowerup({
  id: "jetpack",
  label: "Asas do Grifo",
  assetId: "pickup.griffin",
  duration: (ctx) => duration(ctx, POWERUPS.jetpackSeconds, "jetpack"),
  onStart(ctx) {
    const F = POWERUP_FX;
    const p = ctx.player;
    const st = ctx.state;
    p.startFlight(F.jetpackHeight);
    // sky coin trail over the flight, switching lanes now and then
    const end = st.distance + Math.max(st.speed, SPEED.start) * duration(ctx, POWERUPS.jetpackSeconds, "jetpack") - F.jetpackEndGap;
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
  label: "Botas do Gigante",
  assetId: "pickup.boots",
  duration: (ctx) => duration(ctx, POWERUPS.sneakersSeconds, "sneakers"),
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
  label: "Amuleto Magnético",
  assetId: "pickup.amulet",
  duration: (ctx) => duration(ctx, POWERUPS.magnetSeconds, "magnet"),
  onStart(ctx) {
    ctx.coins.magnet = true;
  },
  onEnd(ctx) {
    ctx.coins.magnet = false;
  },
});

registerPowerup({
  id: "multiplier",
  label: "Bênção do Rei",
  assetId: "pickup.blessing",
  duration: (ctx) => duration(ctx, POWERUPS.multiplierSeconds, "multiplier"),
});

/**
 * Aegis: a ward that swallows the next collision outright. It has no tick of its own — the build
 * system asks whether it is active when a crash is being resolved, and clears it if it spends it.
 */
registerPowerup({
  id: "aegis",
  label: "Égide",
  assetId: "pickup.aegis",
  duration: (ctx) => duration(ctx, POWERUPS.aegisSeconds, "aegis"),
});

/**
 * Hourglass: the road slows down but the score does not, so it is a breather that costs nothing.
 * Scoring compensates by dividing the distance travelled by the same factor (see ScoreSystem).
 */
registerPowerup({
  id: "hourglass",
  label: "Ampulheta",
  assetId: "pickup.hourglass",
  duration: (ctx) => duration(ctx, POWERUPS.hourglassSeconds, "hourglass"),
  onStart(ctx) {
    ctx.state.speedScale = POWERUP_FX.hourglassSpeedScale;
  },
  onEnd(ctx) {
    ctx.state.speedScale = 1;
  },
});
