/**
 * The obstacle kit (sizes in metres; the runner is 1.7 m tall, lanes 2.5 m apart):
 *  - barricade  crates, barrels and low fencing: jump it, or roll through the gap. Breakable.
 *  - beam       a trunk slung from a gallows frame: roll only, never jumpable. Breakable.
 *  - wagon      a parked cargo wagon: dodge it, or run along its plank roof
 *  - runaway    a horse cart bolting toward the runner (the harness is hidden on trailing carts)
 *  - ramp       hay and planks up onto the near end of a wagon
 *  - gate       a stone gatehouse spanning all lanes (scenery, no collider)
 *  - lantern    a roadside lantern post between lanes (scenery, warning or calm flame)
 *
 * Behaviour is unchanged from the kit this replaced: same colliders, same roof surfaces, same
 * spawn rules. The medieval pass is a change of dress, not of difficulty.
 */
import type { Object3D } from "three";
import { defineTuning } from "../../core/tuning";
import { LANES, laneX } from "../world/coords";
import { registerRunSystem } from "../systems";
import type { Aabb } from "../types";
import type { ObstacleInstance } from "./ObstacleSystem";
import { noCollider, registerObstacleType } from "./registry";
import { SurfaceSystem } from "./SurfaceSystem";
import "./placeholders";

export const BARRICADE = defineTuning("obsBarricade", "Obstacle: barricade", {
  width: { default: 2.1, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  bottom: { default: 0.55, min: 0, max: 2, step: 0.01, label: "Collider bottom (roll clearance)", unit: "m" },
  height: { default: 0.5, min: 0.1, max: 3, step: 0.01, label: "Collider height", unit: "m" },
  length: { default: 0.3, min: 0.05, max: 3, step: 0.01, label: "Collider depth", unit: "m" },
});

export const HOLE = defineTuning("obsHole", "Obstacle: hole in a broken bridge (jump only)", {
  width: { default: 2.1, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  length: { default: 2.4, min: 0.5, max: 8, step: 0.1, label: "Gap length", unit: "m" },
  top: { default: 0.3, min: 0.05, max: 1, step: 0.01, label: "Collider top (feet below this fall in)", unit: "m" },
});

export const BEAM = defineTuning("obsBeam", "Obstacle: hanging beam (roll only)", {
  width: { default: 2.1, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  bottom: { default: 0.8, min: 0, max: 2, step: 0.01, label: "Collider bottom (roll clearance)", unit: "m" },
  top: { default: 3.3, min: 1, max: 6, step: 0.05, label: "Collider top", unit: "m" },
  length: { default: 0.3, min: 0.05, max: 3, step: 0.01, label: "Collider depth", unit: "m" },
});

export const WAGON = defineTuning("obsWagon", "Obstacle: cargo wagon", {
  width: { default: 2.2, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  height: { default: 3.6, min: 1, max: 6, step: 0.05, label: "Collider height (= roof walking height)", unit: "m" },
  carLength: { default: 13, min: 4, max: 30, step: 0.5, label: "Wagon length", unit: "m" },
  carGap: { default: 0.8, min: 0, max: 5, step: 0.05, label: "Gap between wagons", unit: "m" },
});

export const RUNAWAY = defineTuning("obsRunaway", "Obstacle: runaway cart", {
  speed: { default: 9, min: 0, max: 30, step: 0.5, label: "Speed toward the runner", unit: "m/s" },
  spawnAhead: { default: 120, min: 20, max: 400, step: 5, label: "Starts moving this far ahead of the runner", unit: "m" },
  maxCars: { default: 3, min: 1, max: 6, step: 1, label: "Max carts in a bolt" },
});

export const KNIGHT = defineTuning("obsKnight", "Obstacle: charging knight", {
  width: { default: 1.9, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  height: { default: 3, min: 1, max: 6, step: 0.05, label: "Collider height", unit: "m" },
  length: { default: 3.6, min: 1, max: 12, step: 0.1, label: "Horse and rider length", unit: "m" },
  gap: { default: 5, min: 0, max: 30, step: 0.5, label: "Gap between knights in a charge", unit: "m" },
  speed: { default: 13, min: 1, max: 40, step: 0.5, label: "Speed toward the runner", unit: "m/s" },
  spawnAhead: { default: 140, min: 20, max: 400, step: 5, label: "Starts riding this far ahead of the runner", unit: "m" },
});

export const PORTCULLIS = defineTuning("obsPortcullis", "Obstacle: closing gate", {
  width: { default: 2.3, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  height: { default: 4, min: 1, max: 8, step: 0.1, label: "Collider height", unit: "m" },
  length: { default: 0.6, min: 0.1, max: 4, step: 0.05, label: "Collider depth", unit: "m" },
  dropFrom: { default: 55, min: 5, max: 200, step: 1, label: "Bars start dropping this far ahead", unit: "m" },
  dropTo: { default: 22, min: 1, max: 100, step: 1, label: "Bars fully down this far ahead", unit: "m" },
  restingOpen: { default: 0.45, min: 0, max: 1, step: 0.01, label: "How far up the bars sit while far away", help: "Kept low so a closed lane always reads as closed" },
});

export const FIRE = defineTuning("obsFire", "Obstacle: dragon fire", {
  width: { default: 2.3, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  height: { default: 2.6, min: 0.5, max: 6, step: 0.05, label: "Collider height (too tall to jump)", unit: "m" },
  minLength: { default: 10, min: 2, max: 40, step: 0.5, label: "Shortest burning stretch", unit: "m" },
  maxLength: { default: 18, min: 2, max: 60, step: 0.5, label: "Longest burning stretch", unit: "m" },
});

export const RAMP = defineTuning("obsRamp", "Obstacle: ramp", {
  length: { default: 6.5, min: 2, max: 20, step: 0.1, label: "Ramp length (ground to roof)", unit: "m" },
});

export const GATE = defineTuning("obsGate", "Structure: gatehouse", {
  length: { default: 30, min: 4, max: 200, step: 1, label: "Default passage length", unit: "m" },
});

export const LANTERN = defineTuning("obsLantern", "Structure: lantern post", {
  edgeOffset: { default: 0.55, min: 0, max: 3, step: 0.05, label: "Outer lantern offset beyond the outer lane half-spacing", unit: "m" },
});

/** Model lengths baked into the placeholder/asset specs (views scale along Z by length / modelLength). */
export const MODEL_LENGTH = { wagon: 13, ramp: 6.5, gate: 30 } as const;

/** lantern `variant` bits */
export const LANTERN_WARN = 1;
export const LANTERN_OUTER = 2;

registerRunSystem(() => new SurfaceSystem());

const laneBox = (inst: ObstacleInstance, out: Aabb, halfWidth: number, minY: number, maxY: number): void => {
  const x = laneX(inst.lane);
  out.minX = x - halfWidth;
  out.maxX = x + halfWidth;
  out.minY = minY;
  out.maxY = maxY;
  out.minS = inst.s;
  out.maxS = inst.s + inst.length;
};

registerObstacleType({
  id: "barricade",
  label: "Barricada",
  assetId: "obstacle.barricade",
  rules: { jumpable: true, rollable: true, solid: false, breakable: true },
  poolSize: 16,
  modelLength: 0,
  defaultLength: () => BARRICADE.length,
  collider(inst, out) {
    laneBox(inst, out, BARRICADE.width / 2, BARRICADE.bottom, BARRICADE.bottom + BARRICADE.height);
  },
});

registerObstacleType({
  id: "beam",
  label: "Viga suspensa",
  assetId: "obstacle.beam",
  rules: { jumpable: false, rollable: true, solid: false, breakable: true },
  poolSize: 12,
  modelLength: 0,
  defaultLength: () => BEAM.length,
  collider(inst, out) {
    laneBox(inst, out, BEAM.width / 2, BEAM.bottom, BEAM.top);
  },
});

/** A knight riding the other way: the lane is his until he has passed. */
registerObstacleType({
  id: "knight",
  label: "Cavaleiro",
  assetId: "obstacle.knight",
  rules: { jumpable: false, rollable: false, solid: true },
  poolSize: 8,
  modelLength: 3.6,
  defaultLength: () => KNIGHT.length,
  collider(inst, out) {
    laneBox(inst, out, KNIGHT.width / 2, 0, KNIGHT.height);
  },
  moveWithin: () => KNIGHT.spawnAhead,
});

/**
 * A gate of the wall coming down over one lane. The bars sit low from far away — a closed lane
 * must read as closed — and finish dropping as the runner arrives; the collider never changes.
 */
registerObstacleType({
  id: "portcullis",
  label: "Portão que fecha",
  assetId: "struct.portcullis",
  rules: { jumpable: false, rollable: false, solid: true },
  poolSize: 8,
  modelLength: 0,
  defaultLength: () => PORTCULLIS.length,
  collider(inst, out) {
    laneBox(inst, out, PORTCULLIS.width / 2, 0, PORTCULLIS.height);
  },
  renderView(_inst, view) {
    const bars = (view.userData.bars as Object3D | undefined) ?? (view.userData.bars = view.getObjectByName("bars") ?? null);
    if (!bars) return;
    // the caller has already placed the view: -z is how far ahead of the runner it is
    const ahead = -view.position.z;
    const span = Math.max(1, PORTCULLIS.dropFrom - PORTCULLIS.dropTo);
    const t = Math.min(1, Math.max(0, (PORTCULLIS.dropFrom - ahead) / span));
    bars.position.y = PORTCULLIS.height * PORTCULLIS.restingOpen * (1 - t);
  },
});

/** Dragon fire: a burning stretch of a lane. Too tall to jump, too long to outrun: go around. */
registerObstacleType({
  id: "fire",
  label: "Fogo de dragão",
  assetId: "fx.dragonfire",
  rules: { jumpable: false, rollable: false, solid: false },
  poolSize: 6,
  modelLength: 10,
  defaultLength: () => FIRE.minLength,
  collider(inst, out) {
    laneBox(inst, out, FIRE.width / 2, 0, FIRE.height);
  },
});

/** A gap in the planks: only a jump clears it (rolling keeps the feet on the road). */
registerObstacleType({
  id: "hole",
  label: "Buraco na ponte",
  assetId: "obstacle.hole",
  rules: { jumpable: true, rollable: false, solid: false },
  poolSize: 12,
  modelLength: 0,
  defaultLength: () => HOLE.length,
  collider(inst, out) {
    laneBox(inst, out, HOLE.width / 2, -2, HOLE.top);
  },
});

const wagonCollider = (inst: ObstacleInstance, out: Aabb): void => laneBox(inst, out, WAGON.width / 2, 0, WAGON.height);
const roof = (): number => WAGON.height;

registerObstacleType({
  id: "wagon",
  label: "Carroça de carga",
  assetId: "obstacle.wagon",
  rules: { jumpable: false, rollable: false, solid: true },
  poolSize: 24,
  modelLength: MODEL_LENGTH.wagon,
  defaultLength: () => WAGON.carLength,
  collider: wagonCollider,
  surface: roof,
});

registerObstacleType({
  id: "runaway",
  label: "Carroça desgovernada",
  assetId: "obstacle.cart.runaway",
  rules: { jumpable: false, rollable: false, solid: true },
  poolSize: 9,
  modelLength: MODEL_LENGTH.wagon,
  defaultLength: () => WAGON.carLength,
  collider: wagonCollider,
  surface: roof,
  moveWithin: () => RUNAWAY.spawnAhead,
  renderView(inst, view) {
    // Only the leading cart is pulled by horses; the ones behind it are just carts (variant 1).
    const harness = (view.userData.harness as Object3D | undefined) ?? (view.userData.harness = view.getObjectByName("harness") ?? null);
    if (harness) harness.visible = inst.variant === 0;
  },
});

/** Ramp height at track position s (0 at the near end, roof height at the far end). */
export function rampHeight(inst: ObstacleInstance, s: number): number {
  const u = (s - inst.s) / (inst.length > 0 ? inst.length : 1);
  return WAGON.height * (u < 0 ? 0 : u > 1 ? 1 : u);
}

registerObstacleType({
  id: "ramp",
  label: "Rampa de feno",
  assetId: "obstacle.ramp",
  rules: { jumpable: false, rollable: false, solid: false },
  poolSize: 8,
  modelLength: MODEL_LENGTH.ramp,
  defaultLength: () => RAMP.length,
  collider: noCollider,
  surface: rampHeight,
  snapSurface: true,
});

registerObstacleType({
  id: "gate",
  label: "Portal da muralha",
  assetId: "struct.gate",
  rules: { jumpable: false, rollable: false, solid: false },
  poolSize: 3,
  modelLength: MODEL_LENGTH.gate,
  defaultLength: () => GATE.length,
  collider: noCollider,
  renderView(_inst, view) {
    view.position.x = 0;
  },
});

/** Lateral position of a lantern: between lane `lane` (outer lanes only) and the centre, or beyond it. */
export function lanternX(lane: number, variant: number): number {
  const side = lane < 0 ? -1 : 1;
  return variant & LANTERN_OUTER ? side * (LANES.spacing * 1.5 + LANTERN.edgeOffset) : side * LANES.spacing * 0.5;
}

registerObstacleType({
  id: "lantern",
  label: "Poste de lanterna",
  assetId: "struct.lantern",
  rules: { jumpable: false, rollable: false, solid: false },
  poolSize: 8,
  modelLength: 0,
  defaultLength: () => 0.3,
  collider: noCollider,
  renderView(inst, view) {
    view.position.x = lanternX(inst.lane, inst.variant);
    const ud = view.userData;
    if (ud.warn === undefined) {
      ud.warn = view.getObjectByName("lampWarn") ?? null;
      ud.calm = view.getObjectByName("lampCalm") ?? null;
    }
    const warn = (inst.variant & LANTERN_WARN) !== 0;
    if (ud.warn) (ud.warn as Object3D).visible = warn;
    if (ud.calm) (ud.calm as Object3D).visible = !warn;
  },
});
