/**
 * Runner vs obstacle collision (sim space AABBs, swept along s). Greybox rule: any overlap
 * crashes the run. Stumble/side-bump resolution plugs in here later (lane B).
 */
import { defineTuning } from "../../core/tuning";
import { aabbOverlap, makeAabb, type RunContext, type RunSystem } from "../types";

export const COLLISION = defineTuning("collision", "Collision", {
  sideLeniency: { default: 0.12, min: 0, max: 1, step: 0.01, label: "Obstacle side leniency (shrink each side)", unit: "m" },
  topLeniency: { default: 0.05, min: 0, max: 1, step: 0.01, label: "Obstacle top leniency", unit: "m" },
});

declare module "../../core/events" {
  interface EventMap {
    "collision:hit": { typeId: string; lane: number; s: number };
  }
}

const pBox = makeAabb();
const oBox = makeAabb();
const evHit = { typeId: "", lane: 0, s: 0 };

export class CollisionSystem implements RunSystem {
  readonly id = "collision";
  readonly order = 60;

  fixedUpdate(ctx: RunContext): void {
    const mode = ctx.state.mode;
    if (mode !== "running" && mode !== "intro") return;
    ctx.player.getHitbox(pBox);
    const list = ctx.obstacles.active;
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      if (inst.s > pBox.maxS + 1 || inst.s + inst.length < pBox.minS - 1) continue;
      inst.type.collider(inst, oBox);
      oBox.minX += COLLISION.sideLeniency;
      oBox.maxX -= COLLISION.sideLeniency;
      oBox.maxY -= COLLISION.topLeniency;
      if (!aabbOverlap(pBox, oBox)) continue;
      evHit.typeId = inst.type.id;
      evHit.lane = inst.lane;
      evHit.s = inst.s;
      ctx.bus.emit("collision:hit", evHit);
      ctx.crash(inst.type.id);
      if (ctx.state.mode === "crashed") return;
    }
  }
}
