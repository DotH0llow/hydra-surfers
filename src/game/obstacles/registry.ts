/**
 * Obstacle type registry. Each type = {id, assetId, collider, rules}. Register new types from
 * their own module (imported by Run.ts or main.ts); ObstacleSystem pools views per type.
 */
import type { Aabb } from "../types";
import type { ObstacleInstance } from "./ObstacleSystem";

export interface ObstacleRules {
  /** Can be cleared by jumping over it. */
  jumpable: boolean;
  /** Can be cleared by rolling under it. */
  rollable: boolean;
  /** Blocks the whole lane for its full length (trains). */
  solid: boolean;
}

export interface ObstacleType {
  id: string;
  label: string;
  /** Manifest id of the visual. */
  assetId: string;
  rules: ObstacleRules;
  /** Views pre-created at init (avoids hitches on first spawn). */
  poolSize: number;
  /** Default length along s when spawn() gets none (read live from tuning). */
  defaultLength(): number;
  /** If > 0, the view is scaled along Z by length / modelLength. */
  modelLength: number;
  /** Writes the sim-space collider for an instance. */
  collider(inst: ObstacleInstance, out: Aabb): void;
}

const types = new Map<string, ObstacleType>();

export function registerObstacleType(t: ObstacleType): void {
  if (types.has(t.id)) console.warn(`[obstacles] type "${t.id}" re-registered; replacing`);
  types.set(t.id, t);
}

export function getObstacleType(id: string): ObstacleType | undefined {
  return types.get(id);
}

export function listObstacleTypes(): ObstacleType[] {
  return [...types.values()];
}
