/**
 * Runner vs obstacle collision (sim space AABBs, swept along s).
 *
 * Resolution (greybox, provisional):
 *  - head-on / top / bottom overlap with any obstacle → crash (run ends)
 *  - side contact with a SOLID obstacle (runner was beside it last tick and already alongside it
 *    along s, i.e. switched lanes into a train) → light stumble + bounce back (`ctx.stumble`)
 *  - swiping outward into the side wall → light stumble (no bounce)
 * The chaser turns a second stumble while he is near into "caught" (see chaser/Chaser.ts).
 */
import { defineTuning } from "../../core/tuning";
import { PLAYER_HITBOX } from "../player/PlayerController";
import { aabbOverlap, makeAabb, type RunContext, type RunSystem } from "../types";

export const COLLISION = defineTuning("collision", "Collision", {
  sideLeniency: { default: 0.12, min: 0, max: 1, step: 0.01, label: "Obstacle side leniency (shrink each side)", unit: "m" },
  topLeniency: { default: 0.05, min: 0, max: 1, step: 0.01, label: "Obstacle top leniency", unit: "m" },
  sideHitStumbles: { default: 1, min: 0, max: 1, step: 1, label: "Side contact with trains stumbles instead of crashing (0/1)" },
  edgeBumpStumbles: { default: 1, min: 0, max: 1, step: 1, label: "Swiping into the outer wall stumbles (0/1)" },
});

declare module "../../core/events" {
  interface EventMap {
    "collision:hit": { typeId: string; lane: number; s: number; side: boolean };
  }
}

const pBox = makeAabb();
const oBox = makeAabb();
const evHit = { typeId: "", lane: 0, s: 0, side: false };

export class CollisionSystem implements RunSystem {
  readonly id = "collision";
  readonly order = 60;

  init(ctx: RunContext): void {
    ctx.bus.on("player:edgeBump", () => {
      if (COLLISION.edgeBumpStumbles >= 0.5) ctx.stumble("wall", false);
    });
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    const mode = st.mode;
    if (mode !== "running" && mode !== "intro") return;
    const p = ctx.player;
    p.getHitbox(pBox);
    const hw = PLAYER_HITBOX.width / 2;
    const hd = PLAYER_HITBOX.depth / 2;
    const list = ctx.obstacles.active;
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      if (inst.s > pBox.maxS + 1 || inst.s + inst.length < pBox.minS - 1) continue;
      inst.type.collider(inst, oBox);
      oBox.minX += COLLISION.sideLeniency;
      oBox.maxX -= COLLISION.sideLeniency;
      oBox.maxY -= COLLISION.topLeniency;
      if (!aabbOverlap(pBox, oBox)) continue;

      // Where were we last tick relative to this obstacle?
      const prevMinS = oBox.minS + (inst.prevS - inst.s);
      const alongside = st.prevDistance + hd > prevMinS;
      const wasBesideX = p.prevX + hw <= oBox.minX || p.prevX - hw >= oBox.maxX;
      const side = inst.type.rules.solid && COLLISION.sideHitStumbles >= 0.5 && alongside && (wasBesideX || p.stumbleCooldown > 0);

      if (side && p.stumbleCooldown > 0) continue; // still bouncing off the same contact
      evHit.typeId = inst.type.id;
      evHit.lane = inst.lane;
      evHit.s = inst.s;
      evHit.side = side;
      ctx.bus.emit("collision:hit", evHit);
      if (side) ctx.stumble(inst.type.id, true);
      else ctx.crash(inst.type.id);
      if (st.mode === "crashed") return;
    }
  }
}
