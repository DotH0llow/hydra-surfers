/**
 * Biome definitions — the regions one run travels through.
 *
 * A biome is pure data: a palette, fog and light, which decorations line the road, which spawn
 * patterns it favours, and which obstacle skins it uses. Adding a region is a new entry here plus
 * its placeholder art; no system learns about it. That is the point — eight regions recombine with
 * weather, events and mutators instead of each needing bespoke gameplay.
 *
 * Which biome is where is a pure function of (seed, distance), so two players on the same daily
 * seed cross the same regions at the same metre, and a ghost recorded yesterday still lines up.
 */
import { hash32 } from "../../core/rng";

/** One row of scenery the environment repeats along the road. */
export interface PropLayer {
  /** Manifest id of the model (instanced). */
  asset: string;
  /** Where it sits: both verges, one side, or scattered across the far field. */
  side: "both" | "left" | "right" | "field";
  /** Metres between placements. */
  spacing: number;
  /** Chance a slot is actually filled (0..1) — gaps keep a row from reading as a fence. */
  density: number;
  /** Metres from the road edge to the near face. */
  offset: number;
  /** Extra metres of random lateral spread (field layers use more). */
  spread?: number;
  /** Uniform scale range. */
  scale: [number, number];
  /** Random yaw in radians applied around Y. */
  yaw?: number;
  /** Per-instance lightness jitter applied to `color`. */
  tint?: [number, number];
  /** Base colour for this layer. */
  color: string;
}

export interface BiomeDef {
  id: string;
  /** Shown when the runner crosses into it. */
  name: string;
  sky: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  /** The field either side of the road, and the road surface itself. */
  ground: string;
  road: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  props: PropLayer[];
  /** Multiplies the spawn weight of these pattern ids while in this biome. */
  patternWeights?: Record<string, number>;
  /** Multiplies coin density while in this biome. */
  coinMul?: number;
  /** Obstacle type id -> manifest asset id, when this region dresses an obstacle differently. */
  skins?: Record<string, string>;
}

const VILLAGE: BiomeDef = {
  id: "village",
  name: "Estrada da Vila",
  sky: "#9fc6e8",
  fog: "#cfe0ee",
  fogNear: 60,
  fogFar: 210,
  ground: "#7c8a52",
  road: "#9a8b73",
  hemiSky: "#dfefff",
  hemiGround: "#6b6350",
  hemiIntensity: 1.7,
  sunColor: "#fff1dc",
  sunIntensity: 2.2,
  props: [
    { asset: "env.house", side: "both", spacing: 16, density: 0.7, offset: 3.2, scale: [0.9, 1.35], yaw: 0.25, tint: [-0.06, 0.08], color: "#c9ab84" },
    { asset: "env.fence", side: "both", spacing: 4, density: 0.55, offset: 1.6, scale: [0.95, 1.05], tint: [-0.05, 0.05], color: "#8a6b47" },
    { asset: "env.torch", side: "both", spacing: 26, density: 1, offset: 1.2, scale: [1, 1], color: "#5a4632" },
    { asset: "env.tree.pine", side: "field", spacing: 22, density: 0.5, offset: 14, spread: 22, scale: [0.9, 1.4], yaw: 3.14, tint: [-0.08, 0.05], color: "#4b6b3a" },
  ],
  patternWeights: { barricadeSingle: 1.3, coinRun: 1.2, wagonRamp: 0.8 },
  coinMul: 1.1,
};

const FOREST: BiomeDef = {
  id: "forest",
  name: "Floresta Sombria",
  sky: "#7fa38c",
  fog: "#8fae97",
  fogNear: 34,
  fogFar: 140,
  ground: "#4f5e38",
  road: "#7d7358",
  hemiSky: "#bfe0c8",
  hemiGround: "#3a4030",
  hemiIntensity: 1.25,
  sunColor: "#e8f2cf",
  sunIntensity: 1.5,
  props: [
    { asset: "env.tree.pine", side: "both", spacing: 5.5, density: 0.92, offset: 1.4, spread: 3, scale: [1, 1.9], yaw: 3.14, tint: [-0.1, 0.06], color: "#3f6030" },
    { asset: "env.tree.pine", side: "field", spacing: 7, density: 0.8, offset: 10, spread: 26, scale: [1.1, 2.2], yaw: 3.14, tint: [-0.12, 0.04], color: "#35522a" },
    { asset: "env.rock", side: "both", spacing: 19, density: 0.5, offset: 2.2, scale: [0.6, 1.2], yaw: 3.14, tint: [-0.06, 0.06], color: "#6f7268" },
  ],
  patternWeights: { beamSingle: 1.6, barricadeMixed: 1.3, gatehouse: 0.5, runawayCart: 0.6 },
};

const CASTLE: BiomeDef = {
  id: "castle",
  name: "Muralhas do Castelo",
  sky: "#93a9c4",
  fog: "#b3c0d2",
  fogNear: 55,
  fogFar: 190,
  ground: "#77786a",
  road: "#9e9a90",
  hemiSky: "#d6e3f5",
  hemiGround: "#5d5c55",
  hemiIntensity: 1.5,
  sunColor: "#ffeccd",
  sunIntensity: 2,
  props: [
    { asset: "env.wall.stone", side: "both", spacing: 7.8, density: 0.96, offset: 2.4, scale: [1, 1.25], tint: [-0.05, 0.05], color: "#9b9a92" },
    { asset: "env.tower", side: "both", spacing: 46, density: 0.85, offset: 2.6, scale: [1, 1.3], tint: [-0.04, 0.04], color: "#8f8e86" },
    { asset: "env.banner", side: "both", spacing: 13, density: 0.7, offset: 1.5, scale: [0.9, 1.1], color: "#a8323a" },
    { asset: "env.torch", side: "both", spacing: 18, density: 1, offset: 1.2, scale: [1, 1], color: "#4a4a44" },
  ],
  patternWeights: { gatehouse: 2, barricadeRow: 1.4, wagonDouble: 1.2 },
};

const MINES: BiomeDef = {
  id: "mines",
  name: "Minas Profundas",
  sky: "#2b2a33",
  fog: "#33303a",
  fogNear: 20,
  fogFar: 95,
  ground: "#3a342f",
  road: "#584c41",
  hemiSky: "#6a6072",
  hemiGround: "#241f1c",
  hemiIntensity: 0.9,
  sunColor: "#ffbf7a",
  sunIntensity: 0.8,
  props: [
    { asset: "env.minebeam", side: "both", spacing: 6.5, density: 0.95, offset: 1.1, scale: [1, 1.1], color: "#6b5236" },
    { asset: "env.rock", side: "both", spacing: 4.5, density: 0.85, offset: 2.6, spread: 4, scale: [0.8, 1.8], yaw: 3.14, tint: [-0.1, 0.05], color: "#5a5248" },
    { asset: "env.torch", side: "both", spacing: 12, density: 1, offset: 1, scale: [1, 1], color: "#4b3b2a" },
  ],
  patternWeights: { gatehouse: 2.2, runawayCart: 1.8, beamSingle: 1.2, coinRun: 0.7 },
  coinMul: 1.2,
};

const CEMETERY: BiomeDef = {
  id: "cemetery",
  name: "Cemitério Antigo",
  sky: "#5b6272",
  fog: "#79808c",
  fogNear: 28,
  fogFar: 120,
  ground: "#565c4a",
  road: "#7e7a72",
  hemiSky: "#aab6c8",
  hemiGround: "#40453c",
  hemiIntensity: 1.1,
  sunColor: "#cdd6e8",
  sunIntensity: 1,
  props: [
    { asset: "env.tombstone", side: "both", spacing: 3.4, density: 0.8, offset: 1.5, spread: 6, scale: [0.8, 1.3], yaw: 0.5, tint: [-0.08, 0.06], color: "#9a9a92" },
    { asset: "env.tree.dead", side: "both", spacing: 17, density: 0.7, offset: 4.5, scale: [1, 1.6], yaw: 3.14, tint: [-0.1, 0.04], color: "#4a4038" },
    { asset: "env.fence", side: "both", spacing: 4, density: 0.9, offset: 1.1, scale: [1, 1.1], color: "#4c4a46" },
  ],
  patternWeights: { barricadeSingle: 1.5, barricadeDouble: 1.3, beamSingle: 1.2, wagonRamp: 0.5 },
};

const BATTLEFIELD: BiomeDef = {
  id: "battlefield",
  name: "Campo de Batalha",
  sky: "#a08b76",
  fog: "#b9a48c",
  fogNear: 38,
  fogFar: 150,
  ground: "#6d6248",
  road: "#8a7d66",
  hemiSky: "#e0cdb4",
  hemiGround: "#584f3c",
  hemiIntensity: 1.4,
  sunColor: "#ffdcae",
  sunIntensity: 1.8,
  props: [
    { asset: "env.tent", side: "both", spacing: 15, density: 0.65, offset: 3, scale: [0.9, 1.25], yaw: 0.4, tint: [-0.07, 0.07], color: "#b0553f" },
    { asset: "env.banner", side: "both", spacing: 9, density: 0.8, offset: 1.6, scale: [0.85, 1.15], color: "#8d3b46" },
    { asset: "env.rock", side: "field", spacing: 11, density: 0.6, offset: 9, spread: 18, scale: [0.5, 1.1], yaw: 3.14, tint: [-0.06, 0.06], color: "#7a7164" },
  ],
  patternWeights: { runawayCart: 1.8, barricadeRow: 1.5, wagonDouble: 1.4 },
};

const RUINS: BiomeDef = {
  id: "ruins",
  name: "Ruínas Esquecidas",
  sky: "#8f9aa6",
  fog: "#a9b3bd",
  fogNear: 42,
  fogFar: 165,
  ground: "#6b6f5c",
  road: "#8f8b80",
  hemiSky: "#ccd8e4",
  hemiGround: "#53564a",
  hemiIntensity: 1.35,
  sunColor: "#f4ecd8",
  sunIntensity: 1.7,
  props: [
    { asset: "env.column", side: "both", spacing: 8.5, density: 0.75, offset: 2, scale: [0.8, 1.5], tint: [-0.08, 0.06], color: "#b0aa9c" },
    { asset: "env.rock", side: "both", spacing: 5, density: 0.7, offset: 1.6, spread: 5, scale: [0.5, 1.3], yaw: 3.14, tint: [-0.07, 0.05], color: "#8b8578" },
    { asset: "env.tree.dead", side: "field", spacing: 21, density: 0.5, offset: 12, spread: 16, scale: [0.9, 1.4], yaw: 3.14, color: "#514639" },
  ],
  patternWeights: { barricadeMixed: 1.5, gatehouse: 1.3, beamSingle: 1.3 },
};

const SWAMP: BiomeDef = {
  id: "swamp",
  name: "Pântano Podre",
  sky: "#6d7a63",
  fog: "#7f8c71",
  fogNear: 22,
  fogFar: 100,
  ground: "#45503a",
  road: "#6c6a4f",
  hemiSky: "#a9bd9a",
  hemiGround: "#333c2c",
  hemiIntensity: 1.05,
  sunColor: "#d9e3b8",
  sunIntensity: 1.1,
  props: [
    { asset: "env.reed", side: "both", spacing: 2.6, density: 0.9, offset: 1.2, spread: 5, scale: [0.7, 1.4], yaw: 3.14, tint: [-0.08, 0.08], color: "#6b7a45" },
    { asset: "env.tree.dead", side: "both", spacing: 9, density: 0.8, offset: 3.4, spread: 6, scale: [1, 1.8], yaw: 3.14, tint: [-0.1, 0.05], color: "#463f33" },
    { asset: "env.rock", side: "field", spacing: 16, density: 0.4, offset: 10, spread: 14, scale: [0.4, 0.9], yaw: 3.14, color: "#5c6152" },
  ],
  patternWeights: { beamSingle: 1.4, wagonSingle: 0.7, coinRun: 1.2 },
};

/** The rotation, in the order a fresh run meets them (the first entry always opens a run). */
export const BIOMES: readonly BiomeDef[] = [VILLAGE, FOREST, CASTLE, MINES, CEMETERY, BATTLEFIELD, RUINS, SWAMP];

const BY_ID = new Map(BIOMES.map((b) => [b.id, b]));

export function getBiome(id: string): BiomeDef | undefined {
  return BY_ID.get(id);
}

/** Resolves an allow-list (from a challenge) to real biomes, falling back to the full rotation. */
export function allowedBiomes(ids?: readonly string[]): BiomeDef[] {
  if (!ids || ids.length === 0) return [...BIOMES];
  const out = ids.map((id) => BY_ID.get(id)).filter((b): b is BiomeDef => !!b);
  return out.length ? out : [...BIOMES];
}

/**
 * Walks the biome order for a run, caching as it goes (segments are visited in order).
 *
 * Segment 0 is always the first allowed biome so every run opens somewhere familiar; after that a
 * region never repeats back to back.
 */
export class BiomeSequence {
  private readonly cache: number[] = [0];

  constructor(
    private readonly seed: number,
    private readonly list: BiomeDef[],
  ) {}

  get biomes(): readonly BiomeDef[] {
    return this.list;
  }

  /** Biome for a segment index (0-based). */
  at(index: number): BiomeDef {
    const i = index <= 0 ? 0 : Math.floor(index);
    const count = this.list.length;
    while (this.cache.length <= i) {
      const n = this.cache.length;
      const prev = this.cache[n - 1];
      if (count <= 1) this.cache.push(0);
      else {
        const r = hash32(this.seed ^ Math.imul(n, 0x9e3779b1)) % (count - 1);
        this.cache.push(r >= prev ? r + 1 : r);
      }
    }
    return this.list[this.cache[i]];
  }
}
