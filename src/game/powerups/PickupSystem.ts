/**
 * Pickups on the track: power-up boxes (jetpack, sneakers, magnet, 2x) and keys. The Spawner drops one
 * into the gap after a pattern by chance (`choosePickup`); running through it activates the power-up
 * (PowerupSystem) or banks a key (`state.keys`, the App saves it to the profile).
 */
import type { Object3D } from "three";
import type { Rng } from "../../core/rng";
import { defineTuning } from "../../core/tuning";
import { registerRunSystem } from "../systems";
import { makeAabb, type RunContext, type RunSystem } from "../types";
import { laneX, renderZ } from "../world/coords";
import { curveObject } from "../world/curve";
import type { PowerupSystem } from "./PowerupSystem";
import "./placeholders";

export const PICKUPS = defineTuning("pickups", "Pickups", {
  chance: { default: 0.16, min: 0, max: 1, step: 0.01, label: "Chance of a pickup in the gap after a pattern" },
  jetpackWeight: { default: 0.8, min: 0, max: 10, step: 0.1, label: "Weight: jetpack" },
  sneakersWeight: { default: 1, min: 0, max: 10, step: 0.1, label: "Weight: super sneakers" },
  magnetWeight: { default: 1.4, min: 0, max: 10, step: 0.1, label: "Weight: coin magnet" },
  multiplierWeight: { default: 1.1, min: 0, max: 10, step: 0.1, label: "Weight: royal blessing (2x)" },
  aegisWeight: { default: 0.9, min: 0, max: 10, step: 0.1, label: "Weight: aegis (absorbs one hit)" },
  hourglassWeight: { default: 0.7, min: 0, max: 10, step: 0.1, label: "Weight: hourglass (slows the road)" },
  keyWeight: { default: 0.3, min: 0, max: 10, step: 0.05, label: "Weight: key" },
  jetpackMinDifficulty: { default: 0.04, min: 0, max: 1, step: 0.01, label: "Jetpack not offered below this difficulty" },
  height: { default: 1, min: 0, max: 3, step: 0.05, label: "Hover height", unit: "m" },
  bob: { default: 0.12, min: 0, max: 1, step: 0.01, label: "Bob amplitude", unit: "m" },
  spin: { default: 2.4, min: 0, max: 10, step: 0.1, label: "Spin speed", unit: "rad/s" },
  halfWidth: { default: 0.9, min: 0.1, max: 3, step: 0.05, label: "Pickup half-width", unit: "m" },
  halfDepth: { default: 0.8, min: 0.1, max: 3, step: 0.05, label: "Pickup half-depth", unit: "m" },
  padY: { default: 0.45, min: 0, max: 2, step: 0.05, label: "Pickup vertical padding", unit: "m" },
  despawnBehind: { default: 12, min: 1, max: 60, step: 1, label: "Despawn distance behind", unit: "m" },
});

export type PickupKind = "jetpack" | "sneakers" | "magnet" | "multiplier" | "aegis" | "hourglass" | "key";
export const PICKUP_KINDS: readonly PickupKind[] = ["jetpack", "sneakers", "magnet", "multiplier", "aegis", "hourglass", "key"];

const ASSET: Record<PickupKind, string> = {
  jetpack: "pickup.griffin",
  sneakers: "pickup.boots",
  magnet: "pickup.amulet",
  multiplier: "pickup.blessing",
  aegis: "pickup.aegis",
  hourglass: "pickup.hourglass",
  key: "pickup.key",
};

const POOL_PER_KIND = 4;

declare module "../../core/events" {
  interface EventMap {
    "pickup:collect": { kind: PickupKind; lane: number; s: number };
  }
}

const weights = new Float64Array(PICKUP_KINDS.length);

/** Weighted pick (tuning) of what the next pickup is. */
export function choosePickup(rng: Rng, difficulty: number): PickupKind {
  const P = PICKUPS;
  weights[0] = difficulty >= P.jetpackMinDifficulty ? P.jetpackWeight : 0;
  weights[1] = P.sneakersWeight;
  weights[2] = P.magnetWeight;
  weights[3] = P.multiplierWeight;
  weights[4] = P.aegisWeight;
  weights[5] = P.hourglassWeight;
  weights[6] = P.keyWeight;
  const i = rng.weighted(weights, PICKUP_KINDS.length);
  return PICKUP_KINDS[i < 0 ? 2 : i];
}

export interface Pickup {
  kind: PickupKind;
  active: boolean;
  lane: number;
  s: number;
  y: number;
  readonly view: Object3D;
}

const box = makeAabb();
const evCollect = { kind: "magnet" as PickupKind, lane: 0, s: 0 };

export class PickupSystem implements RunSystem {
  readonly id = "pickups";
  readonly order = 52;
  readonly items: Pickup[] = [];
  private powerups: PowerupSystem | undefined;

  init(ctx: RunContext): void {
    this.powerups = ctx.getSystem<PowerupSystem>("powerups");
    for (const kind of PICKUP_KINDS) {
      for (let i = 0; i < POOL_PER_KIND; i++) {
        const view = ctx.assets.getModel(ASSET[kind]);
        view.name = `pickup:${kind}`;
        view.visible = false;
        curveObject(view);
        ctx.scene.add(view);
        this.items.push({ kind, active: false, lane: 0, s: 0, y: 0, view });
      }
    }
  }

  reset(): void {
    for (const it of this.items) {
      it.active = false;
      it.view.visible = false;
    }
  }

  /** Places a pickup; false when that kind's pool is exhausted. */
  spawn(kind: PickupKind, lane: number, s: number, y = PICKUPS.height): boolean {
    for (const it of this.items) {
      if (it.active || it.kind !== kind) continue;
      it.active = true;
      it.lane = lane;
      it.s = s;
      it.y = y;
      return true;
    }
    return false;
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    const live = st.mode === "running" || st.mode === "intro";
    if (live) ctx.player.getHitbox(box);
    const limit = st.distance - PICKUPS.despawnBehind;
    const hw = PICKUPS.halfWidth;
    const hd = PICKUPS.halfDepth;
    const pad = PICKUPS.padY;
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.active) continue;
      if (it.s < limit) {
        it.active = false;
        it.view.visible = false;
        continue;
      }
      if (!live) continue;
      const x = laneX(it.lane);
      if (x + hw > box.minX && x - hw < box.maxX && it.s + hd > box.minS && it.s - hd < box.maxS && it.y + pad > box.minY && it.y - pad < box.maxY) {
        it.active = false;
        it.view.visible = false;
        if (it.kind === "key") st.keys++;
        else this.powerups?.activate(it.kind);
        evCollect.kind = it.kind;
        evCollect.lane = it.lane;
        evCollect.s = it.s;
        ctx.bus.emit("pickup:collect", evCollect);
      }
    }
  }

  render(ctx: RunContext): void {
    const d = ctx.renderDistance;
    const t = ctx.state.time;
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.active) continue;
      const v = it.view;
      v.position.set(laneX(it.lane), it.y + Math.sin(t * 3 + it.s) * PICKUPS.bob, renderZ(it.s, d));
      v.rotation.y = t * PICKUPS.spin;
      v.visible = true;
    }
  }
}

registerRunSystem(() => new PickupSystem());
