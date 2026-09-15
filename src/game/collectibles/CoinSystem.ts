/**
 * Coins: struct-of-arrays pool + one InstancedMesh. Pickup is tested in the fixed step against
 * the runner's swept hitbox; a short render-only pop plays after collection.
 */
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { defineTuning } from "../../core/tuning";
import { LANES, laneX, renderZ } from "../world/coords";
import { curveObject } from "../world/curve";
import { makeAabb, type RunContext, type RunSystem } from "../types";

export const COINS = defineTuning("coins", "Coins", {
  height: { default: 0.75, min: 0, max: 3, step: 0.01, label: "Coin centre height", unit: "m" },
  spacing: { default: 2, min: 0.5, max: 6, step: 0.05, label: "Default line spacing", unit: "m" },
  pickupHalfWidth: { default: 0.8, min: 0.1, max: 3, step: 0.01, label: "Pickup half-width", unit: "m" },
  pickupHalfDepth: { default: 0.55, min: 0.1, max: 3, step: 0.01, label: "Pickup half-depth", unit: "m" },
  pickupPadY: { default: 0.35, min: 0, max: 2, step: 0.01, label: "Pickup vertical padding", unit: "m" },
  spinSpeed: { default: 3.2, min: 0, max: 20, step: 0.1, label: "Spin speed", unit: "rad/s" },
  popSeconds: { default: 0.15, min: 0, max: 1, step: 0.01, label: "Pickup pop duration", unit: "s" },
  popScale: { default: 1.6, min: 1, max: 4, step: 0.05, label: "Pickup pop scale" },
  popRise: { default: 0.6, min: 0, max: 3, step: 0.05, label: "Pickup pop rise", unit: "m" },
  despawnBehind: { default: 10, min: 1, max: 60, step: 1, label: "Despawn distance behind", unit: "m" },
  magnetReach: { default: 7, min: 0, max: 40, step: 0.5, label: "Magnet: pulls coins this far ahead", unit: "m" },
  magnetPadY: { default: 3, min: 0, max: 10, step: 0.1, label: "Magnet: vertical reach", unit: "m" },
});

declare module "../../core/events" {
  interface EventMap {
    "coin:collect": { total: number; lane: number; s: number; y: number; value: number };
  }
}

export const COIN_CAPACITY = 512;

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const UP = new Vector3(0, 1, 0);
const box = makeAabb();
const evCollect = { total: 0, lane: 0, s: 0, y: 0, value: 1 };

export class CoinSystem implements RunSystem {
  readonly id = "coins";
  readonly order = 50;
  readonly s = new Float64Array(COIN_CAPACITY);
  readonly y = new Float32Array(COIN_CAPACITY);
  readonly lane = new Int8Array(COIN_CAPACITY);
  /** 0 free, 1 live, 2 collected (popping) */
  readonly status = new Uint8Array(COIN_CAPACITY);
  /** Run time when collected. */
  readonly collectedAt = new Float32Array(COIN_CAPACITY);
  private readonly freeStack = new Int32Array(COIN_CAPACITY);
  private freeTop = 0;
  private mesh!: InstancedMesh;
  private liveCount = 0;
  private dropped = 0;
  /** Coin magnet power-up: collects every lane within `magnetReach` ahead. */
  magnet = false;

  constructor() {
    this.clear();
  }

  get live(): number {
    return this.liveCount;
  }

  init(ctx: RunContext): void {
    const parts = ctx.assets.getMeshParts("collect.coin");
    this.mesh = new InstancedMesh(parts.geometry, parts.material, COIN_CAPACITY);
    this.mesh.name = "coins";
    this.mesh.count = 0;
    curveObject(this.mesh);
    ctx.scene.add(this.mesh);
  }

  reset(): void {
    this.clear();
    this.magnet = false;
  }

  clear(): void {
    this.status.fill(0);
    this.freeTop = 0;
    for (let i = COIN_CAPACITY - 1; i >= 0; i--) this.freeStack[this.freeTop++] = i;
    this.liveCount = 0;
  }

  spawn(lane: number, s: number, y: number): number {
    if (this.freeTop === 0) {
      if (this.dropped++ === 0) console.warn("[coins] pool exhausted; coin dropped");
      return -1;
    }
    const i = this.freeStack[--this.freeTop];
    this.s[i] = s;
    this.y[i] = y;
    this.lane[i] = lane;
    this.status[i] = 1;
    this.liveCount++;
    return i;
  }

  private release(i: number): void {
    if (this.status[i] === 1) this.liveCount--;
    this.status[i] = 0;
    this.freeStack[this.freeTop++] = i;
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    const live = st.mode === "running" || st.mode === "intro";
    const limit = st.distance - COINS.despawnBehind;
    if (live) ctx.player.getHitbox(box);
    const magnet = this.magnet;
    const hw = magnet ? Math.max(COINS.pickupHalfWidth, LANES.spacing * 2 + 0.5) : COINS.pickupHalfWidth;
    const hd = COINS.pickupHalfDepth;
    const pad = magnet ? Math.max(COINS.pickupPadY, COINS.magnetPadY) : COINS.pickupPadY;
    const reach = magnet ? COINS.magnetReach : 0;
    for (let i = 0; i < COIN_CAPACITY; i++) {
      const stt = this.status[i];
      if (stt === 0) continue;
      if (stt === 2) {
        if (st.time - this.collectedAt[i] > COINS.popSeconds || st.mode === "idle") this.release(i);
        continue;
      }
      const s = this.s[i];
      if (s < limit) {
        this.release(i);
        continue;
      }
      if (!live) continue;
      const x = laneX(this.lane[i]);
      const cy = this.y[i];
      if (x + hw > box.minX && x - hw < box.maxX && s + hd > box.minS && s - hd < box.maxS + reach && cy + pad > box.minY && cy - pad < box.maxY) {
        this.status[i] = 2;
        this.liveCount--;
        this.collectedAt[i] = st.time;
        st.coins++;
        evCollect.total = st.coins;
        evCollect.lane = this.lane[i];
        evCollect.s = s;
        evCollect.y = cy;
        ctx.bus.emit("coin:collect", evCollect);
      }
    }
  }

  render(ctx: RunContext): void {
    const d = ctx.renderDistance;
    const t = ctx.state.time;
    tmpQ.setFromAxisAngle(UP, t * COINS.spinSpeed);
    let k = 0;
    for (let i = 0; i < COIN_CAPACITY; i++) {
      const stt = this.status[i];
      if (stt === 0) continue;
      const z = renderZ(this.s[i], d);
      if (stt === 1) {
        tmpP.set(laneX(this.lane[i]), this.y[i], z);
        tmpS.set(1, 1, 1);
      } else {
        const u = COINS.popSeconds > 0 ? Math.min(1, (t - this.collectedAt[i]) / COINS.popSeconds) : 1;
        const sc = (1 + (COINS.popScale - 1) * u) * (1 - u);
        // fly into the runner while popping so it reads as "absorbed" (magnet pulls from other lanes)
        const lx = laneX(this.lane[i]);
        const cy = this.y[i];
        tmpP.set(lx + (ctx.player.x - lx) * u, cy + (ctx.player.y + 1 - cy) * u + COINS.popRise * u, z * (1 - u));
        tmpS.set(sc, sc, sc);
      }
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(k++, tmpM);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
