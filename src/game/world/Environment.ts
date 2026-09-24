/**
 * Roadside scenery, composed per region.
 *
 * Chunk c covers s in [c*L, (c+1)*L); its contents are a pure function of (run seed, c, biome), so
 * scenery scrolls in deterministically with no stored state and no allocation. Each frame the
 * visible chunk range is recomposed into one InstancedMesh per prop part.
 *
 * Colour comes from the region, not the model: props are authored in greyscale and tinted through
 * `instanceColor`, which is why eight regions share fourteen models. Parts with an emissive
 * material (a torch flame, a lit window) are left untinted so they stay warm everywhere.
 */
import { Color, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type Material } from "three";
import { defineTuning } from "../../core/tuning";
import { Rng, hash32 } from "../../core/rng";
import { LANES, renderZ } from "./coords";
import { TRACK } from "./Track";
import { curveObject } from "./curve";
import { BIOMES, type BiomeDef, type PropLayer } from "./biomes";
import type { BiomeSystem } from "./BiomeSystem";
import type { RunContext, RunSystem } from "../types";
import "./placeholders";

export const ENV = defineTuning("env", "Environment", {
  chunkLength: { default: 40, min: 10, max: 200, step: 1, label: "Chunk length", unit: "m" },
  density: { default: 1, min: 0, max: 1.5, step: 0.05, label: "Scenery density", help: "Scales every layer; lower it on weak devices" },
});

/** Instances kept per prop. Enough for the densest layer (forest pines) over the visible road. */
const PROP_CAP = 200;

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpC = new Color();
const UP = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);
const rng = new Rng(1);

interface PropPart {
  mesh: InstancedMesh;
  /** False for emissive parts (flames, lit windows): they keep their own colour in every region. */
  tinted: boolean;
}

interface Prop {
  parts: PropPart[];
  count: number;
}

export class Environment implements RunSystem {
  readonly id = "environment";
  readonly order = 101;
  private readonly props = new Map<string, Prop>();
  private biomes: BiomeSystem | undefined;

  init(ctx: RunContext): void {
    this.biomes = ctx.getSystem<BiomeSystem>("biomes");
    const assets = new Set<string>();
    for (const biome of BIOMES) for (const layer of biome.props) assets.add(layer.asset);
    for (const id of assets) this.createProp(ctx, id);
  }

  render(ctx: RunContext): void {
    for (const prop of this.props.values()) prop.count = 0;

    const d = ctx.renderDistance;
    const seed = ctx.state.seed;
    const L = ENV.chunkLength;
    const from = d - TRACK.behind;
    const to = d + TRACK.ahead;
    const trackHalf = LANES.spacing * 1.5 + TRACK.roadMargin;
    const c0 = Math.floor(from / L);
    const c1 = Math.floor(to / L);

    for (let c = c0; c <= c1; c++) {
      const chunkStart = c * L;
      const biome = this.biomeFor(chunkStart + L * 0.5);
      const layers = biome.props;
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const prop = this.props.get(layer.asset);
        if (!prop) continue;
        if (layer.side === "both" || layer.side === "left") this.placeRow(prop, layer, seed, c, li, -1, chunkStart, L, trackHalf, d);
        if (layer.side === "both" || layer.side === "right") this.placeRow(prop, layer, seed, c, li, 1, chunkStart, L, trackHalf, d);
        if (layer.side === "field") {
          this.placeRow(prop, layer, seed, c, li, -1, chunkStart, L, trackHalf, d);
          this.placeRow(prop, layer, seed, c, li, 1, chunkStart, L, trackHalf, d);
        }
      }
    }

    for (const prop of this.props.values()) {
      for (const part of prop.parts) {
        part.mesh.count = prop.count;
        part.mesh.visible = prop.count > 0;
        part.mesh.instanceMatrix.needsUpdate = true;
        if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** One side of one layer inside one chunk. */
  private placeRow(prop: Prop, layer: PropLayer, seed: number, chunk: number, layerIndex: number, side: number, chunkStart: number, length: number, trackHalf: number, d: number): void {
    const spacing = Math.max(0.5, layer.spacing);
    // Seeded per (chunk, layer, side) and walked in order, so a chunk always composes the same way.
    rng.reseed(hash32(seed ^ Math.imul(chunk, 0x27d4eb2d) ^ Math.imul(layerIndex * 2 + (side > 0 ? 1 : 0), 0x9e3779b1)));
    const density = layer.density * ENV.density;
    const spread = layer.spread ?? 0;
    const tintRange = layer.tint;
    const base = layer.color;
    const end = chunkStart + length;
    for (let s = chunkStart; s < end; s += spacing) {
      const roll = rng.next();
      const jitterS = rng.range(-spacing * 0.3, spacing * 0.3);
      const lateral = rng.range(0, spread);
      const scale = rng.range(layer.scale[0], layer.scale[1]);
      const yaw = layer.yaw ? rng.range(-layer.yaw, layer.yaw) : 0;
      const tint = tintRange ? rng.range(tintRange[0], tintRange[1]) : 0;
      if (roll >= density) continue;
      if (prop.count >= PROP_CAP) return;

      const x = side * (trackHalf + layer.offset + lateral);
      tmpP.set(x, TRACK.groundY, renderZ(s + jitterS, d));
      tmpQ.setFromAxisAngle(UP, yaw);
      tmpS.set(scale, scale, scale);
      tmpM.compose(tmpP, tmpQ, tmpS);
      tmpC.set(base);
      if (tint !== 0) tmpC.offsetHSL(0, 0, tint);
      const i = prop.count++;
      for (const part of prop.parts) {
        part.mesh.setMatrixAt(i, tmpM);
        part.mesh.setColorAt(i, part.tinted ? tmpC : WHITE);
      }
    }
  }

  private biomeFor(s: number): BiomeDef {
    return this.biomes ? this.biomes.at(s) : BIOMES[0];
  }

  private createProp(ctx: RunContext, assetId: string): void {
    const parts: PropPart[] = [];
    for (const part of ctx.assets.getMeshPartList(assetId)) {
      const mesh = new InstancedMesh(part.geometry, part.material, PROP_CAP);
      mesh.name = `prop:${assetId}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.visible = false;
      // make sure the instance colour attribute exists before the first frame writes to it
      mesh.setColorAt(0, WHITE);
      curveObject(mesh);
      ctx.scene.add(mesh);
      parts.push({ mesh, tinted: isTintable(part.material) });
    }
    this.props.set(assetId, { parts, count: 0 });
  }
}

/** Emissive parts keep their own colour; everything else takes the region tint. */
function isTintable(material: Material): boolean {
  const lambert = material as MeshLambertMaterial;
  return !(lambert.emissive && lambert.emissive.getHex() !== 0);
}
