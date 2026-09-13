/**
 * Registry for additional run systems (power-ups, hoverboard, missions tracking …).
 * Register at module import time, before the App constructs its Run:
 *
 * ```ts
 * registerRunSystem(() => new MagnetSystem());
 * ```
 * and make sure the module is imported from src/main.ts (or a module it imports).
 */
import type { RunSystem } from "./types";

export type RunSystemFactory = () => RunSystem;

const factories: RunSystemFactory[] = [];

export function registerRunSystem(factory: RunSystemFactory): void {
  factories.push(factory);
}

export function createRegisteredSystems(): RunSystem[] {
  return factories.map((f) => f());
}
