/**
 * BiomeSystem — which region the runner is in, and how far through the crossing.
 *
 * Runs first (order 4) so atmosphere, environment and the spawner all read a settled answer in the
 * same tick. It holds no randomness of its own: the order comes from `BiomeSequence`, a pure
 * function of the run seed, and the boundaries are fixed multiples of `segmentMetres`. That keeps
 * "the same seed gives the same road" true for daily runs and ghosts.
 *
 * Crossings are a blend rather than a cut: `blend` ramps 0 -> 1 over the last `transitionMetres` of
 * a segment, and Atmosphere interpolates palette, fog and light across it so a region arrives as a
 * change in the air before it arrives as a change in the scenery.
 */
import { defineTuning } from "../../core/tuning";
import { hash32 } from "../../core/rng";
import { registerRunSystem } from "../systems";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";
import { BIOMES, BiomeSequence, allowedBiomes, type BiomeDef } from "./biomes";

export const BIOME = defineTuning("biome", "Biomes", {
  segmentMetres: { default: 850, min: 150, max: 4000, step: 25, label: "Length of one region", unit: "m" },
  transitionMetres: { default: 70, min: 0, max: 400, step: 5, label: "Crossing between regions", unit: "m" },
});

/** Salt for the biome stream, so the region order is independent of the track layout. */
const BIOME_SALT = 0xb10e;

declare module "../../core/events" {
  interface EventMap {
    /** The runner crossed into a new region. */
    "biome:enter": { id: string; name: string; index: number };
  }
}

const evEnter = { id: "", name: "", index: 0 };

export class BiomeSystem implements RunSystem {
  readonly id = "biomes";
  readonly order = 4;
  /** Region the runner is in. */
  current: BiomeDef = BIOMES[0];
  /** Region being crossed into (same as `current` outside a crossing). */
  next: BiomeDef = BIOMES[0];
  /** 0 = fully in `current`, 1 = arrived in `next`. */
  blend = 0;
  private seq = new BiomeSequence(1, [...BIOMES]);
  private index = -1;

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    this.seq = new BiomeSequence(hash32(opts.seed ^ BIOME_SALT), allowedBiomes(opts.biomes));
    this.index = -1;
    this.current = this.next = this.seq.at(0);
    this.blend = 0;
    this.apply(ctx, 0, false);
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (st.mode === "ended") return;
    this.apply(ctx, st.distance, true);
  }

  /** The region covering a track position — what the spawner asks when placing a pattern. */
  at(s: number): BiomeDef {
    return this.seq.at(Math.floor(Math.max(0, s) / BIOME.segmentMetres));
  }

  /** Regions this run can visit (a challenge may restrict them). */
  get rotation(): readonly BiomeDef[] {
    return this.seq.biomes;
  }

  private apply(ctx: RunContext, distance: number, emit: boolean): void {
    const seg = BIOME.segmentMetres;
    const s = Math.max(0, distance);
    const index = Math.floor(s / seg);
    this.current = this.seq.at(index);
    const into = s - index * seg;
    const left = seg - into;
    const trans = BIOME.transitionMetres;
    if (trans > 0 && left < trans) {
      this.next = this.seq.at(index + 1);
      this.blend = 1 - left / trans;
    } else {
      this.next = this.current;
      this.blend = 0;
    }
    if (index !== this.index) {
      this.index = index;
      if (emit) {
        evEnter.id = this.current.id;
        evEnter.name = this.current.name;
        evEnter.index = index;
        ctx.bus.emit("biome:enter", evEnter);
      }
    }
  }
}

registerRunSystem(() => new BiomeSystem());
