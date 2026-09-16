/**
 * Walkable surfaces: sets the runner's ground height from train roofs and ramps under it.
 *
 * Runs before the player (order 15). A roof counts as ground when the runner's centre is over it
 * and its top is no higher than feet + stepUp (so a train side stays a wall and gaps between cars
 * are bridged); ramps (`snapSurface`) are climbed from any height. When the support drops away
 * (end of a train, lane switch off a roof) a grounded runner starts falling.
 */
import { defineTuning } from "../../core/tuning";
import { PLAYER_HITBOX } from "../player/PlayerController";
import { laneX } from "../world/coords";
import type { RunContext, RunSystem } from "../types";
import type { ObstacleInstance } from "./ObstacleSystem";

export const SURFACE = defineTuning("surface", "Walkable surfaces", {
  stepUp: { default: 0.4, min: 0, max: 2, step: 0.01, label: "Step-up onto a roof (bridges car gaps)", unit: "m" },
  halfWidth: { default: 1.0, min: 0.1, max: 2, step: 0.01, label: "Roof half-width under the runner's centre", unit: "m" },
});

/**
 * Highest walkable surface under a runner at lateral `x` whose hitbox spans [minS, maxS] along the
 * track, with feet at `feetY`. 0 = the ballast.
 */
export function supportHeight(list: readonly ObstacleInstance[], x: number, minS: number, maxS: number, feetY: number): number {
  let best = 0;
  for (let i = 0; i < list.length; i++) {
    const inst = list[i];
    if (inst.retired) continue;
    const t = inst.type;
    if (!t.surface) continue;
    const end = inst.s + inst.length;
    if (inst.s > maxS || end < minS) continue;
    const dx = x - laneX(inst.lane);
    if (dx > SURFACE.halfWidth || dx < -SURFACE.halfWidth) continue;
    const s = maxS > end ? end : maxS < inst.s ? inst.s : maxS;
    const h = t.surface(inst, s);
    if (h <= best) continue;
    if (!t.snapSurface && h > feetY + SURFACE.stepUp) continue;
    best = h;
  }
  return best;
}

export class SurfaceSystem implements RunSystem {
  readonly id = "surfaces";
  readonly order = 15;

  reset(ctx: RunContext): void {
    ctx.player.groundY = 0;
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (st.mode !== "running" && st.mode !== "intro") return;
    const p = ctx.player;
    if (p.state === "crash") return;
    const hd = PLAYER_HITBOX.depth / 2;
    const h = supportHeight(ctx.obstacles.active, p.x, st.distance - hd, st.distance + hd, p.y);
    p.groundY = h;
    if (p.grounded && p.y > h + 1e-4) {
      p.grounded = false;
      if (p.vy > 0) p.vy = 0;
      p.airTime = 0;
    }
  }
}
