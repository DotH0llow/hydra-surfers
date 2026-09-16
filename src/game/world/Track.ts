/**
 * The road: field either side, a cobbled bed spanning the three lanes, kerb stones along the
 * verges and worn cart ruts down each lane.
 *
 * Each layer is laid out once in a group and slid by `distance mod tile`, so the hot path is four
 * position writes plus a colour lerp per frame. The ruts are what make the three lanes readable at
 * speed — the eye follows them the way it used to follow rails.
 *
 * Rebuilds itself when track or lane tuning changes; region colour is applied per frame without a
 * rebuild, because it changes continuously across a biome crossing.
 */
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from "three";
import { defineTuning, tuning } from "../../core/tuning";
import { LANES } from "./coords";
import { curveObject } from "./curve";
import { BIOMES } from "./biomes";
import type { BiomeSystem } from "./BiomeSystem";
import type { RunContext, RunSystem } from "../types";

export const TRACK = defineTuning("track", "Road", {
  stoneSpacing: { default: 1.8, min: 0.4, max: 6, step: 0.05, label: "Kerb stone spacing", unit: "m" },
  rutGauge: { default: 1.45, min: 0.6, max: 2.3, step: 0.01, label: "Cart rut gauge (at 2.5 m lanes)", unit: "m" },
  rutPieceLength: { default: 2, min: 0.5, max: 8, step: 0.5, label: "Rut piece length (bend resolution)", unit: "m" },
  roadTile: { default: 2.5, min: 0.5, max: 10, step: 0.1, label: "Cobble texture tile", unit: "m" },
  groundTile: { default: 5, min: 1, max: 20, step: 0.5, label: "Field texture tile", unit: "m" },
  roadMargin: { default: 0.9, min: 0, max: 4, step: 0.05, label: "Road beyond the outer lanes", unit: "m" },
  roadY: { default: -0.12, min: -1, max: 0, step: 0.01, label: "Road surface height", unit: "m" },
  groundY: { default: -0.45, min: -3, max: 0, step: 0.01, label: "Field height", unit: "m" },
  groundWidth: { default: 160, min: 20, max: 600, step: 10, label: "Field width", unit: "m" },
  ahead: { default: 250, min: 60, max: 800, step: 10, label: "Road length ahead", unit: "m" },
  behind: { default: 24, min: 0, max: 80, step: 1, label: "Road length behind", unit: "m" },
});

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpC = new Color();

export const posMod = (a: number, m: number): number => (m > 0 ? ((a % m) + m) % m : 0);

function disposeOwned(o: Object3D): void {
  o.traverse((c) => {
    const mesh = c as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (c.userData.ownMaterial && mesh.material && !Array.isArray(mesh.material)) {
      const m = mesh.material as MeshLambertMaterial;
      m.map?.dispose();
      m.dispose();
    }
  });
}

export class Track implements RunSystem {
  readonly id = "track";
  readonly order = 100;
  private readonly root = new Group();
  private readonly ground = new Group();
  private readonly road = new Group();
  private readonly stones = new Group();
  private readonly ruts = new Group();
  private dirty = true;
  private ctx!: RunContext;
  private biomes: BiomeSystem | undefined;
  /** Materials tinted per region each frame. */
  private groundMat: MeshLambertMaterial | null = null;
  private roadMat: MeshLambertMaterial | null = null;
  private bedMat: MeshLambertMaterial | null = null;
  private stoneMat: MeshLambertMaterial | null = null;
  private rutMat: MeshLambertMaterial | null = null;

  init(ctx: RunContext): void {
    this.ctx = ctx;
    this.biomes = ctx.getSystem<BiomeSystem>("biomes");
    this.root.name = "road";
    this.root.add(this.ground, this.road, this.stones, this.ruts);
    ctx.scene.add(this.root);
    tuning.subscribe((path) => {
      if (path.startsWith("track.") || path === "lanes.spacing") this.dirty = true;
    });
    this.build();
  }

  private clearGroup(g: Group): void {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i];
      g.remove(c);
      disposeOwned(c);
    }
  }

  private build(): void {
    this.dirty = false;
    const { assets } = this.ctx;
    [this.ground, this.road, this.stones, this.ruts].forEach((g) => this.clearGroup(g));
    const span = TRACK.ahead + TRACK.behind;
    const laneScale = LANES.spacing / 2.5;

    // field either side
    {
      const tile = TRACK.groundTile;
      const len = Math.ceil(span / tile) * tile + tile;
      const tex = assets.getTexture("tex.ground.field").clone();
      tex.repeat.set(TRACK.groundWidth / tile, len / tile);
      tex.needsUpdate = true;
      this.groundMat = new MeshLambertMaterial({ map: tex });
      const mesh = new Mesh(new PlaneGeometry(TRACK.groundWidth, len, 6, Math.ceil(len / 5)), this.groundMat);
      mesh.userData.ownMaterial = true;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, TRACK.groundY, TRACK.behind + tile - len / 2);
      this.ground.add(mesh);
    }
    // cobbled road across all three lanes
    {
      const tile = TRACK.roadTile;
      const len = Math.ceil(span / tile) * tile + tile;
      const width = LANES.spacing * 3 + TRACK.roadMargin * 2;
      const tex = assets.getTexture("tex.road.cobble").clone();
      tex.repeat.set(width / tile, len / tile);
      tex.needsUpdate = true;
      this.roadMat = new MeshLambertMaterial({ map: tex });
      const mesh = new Mesh(new PlaneGeometry(width, len, 3, Math.ceil(len / 2.5)), this.roadMat);
      mesh.userData.ownMaterial = true;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, TRACK.roadY, TRACK.behind + tile - len / 2);
      this.road.add(mesh);
      // raised bed so the road reads as a causeway above the field
      const h = Math.max(0.01, TRACK.roadY - TRACK.groundY);
      this.bedMat = new MeshLambertMaterial({ color: 0x6b645a });
      const bed = new Mesh(new BoxGeometry(width + 0.3, h, len, 1, 1, Math.ceil(len / 5)), this.bedMat);
      bed.userData.ownMaterial = true;
      bed.position.set(0, TRACK.roadY - 0.004 - h / 2, TRACK.behind + tile - len / 2);
      this.road.add(bed);
    }
    // kerb stones along both verges
    {
      const sp = TRACK.stoneSpacing;
      const n = Math.ceil(span / sp) + 2;
      const parts = assets.getMeshParts("env.road.stone");
      this.stoneMat = parts.material as MeshLambertMaterial;
      const inst = new InstancedMesh(parts.geometry, parts.material, n * 2);
      let k = 0;
      tmpQ.identity();
      tmpS.set(1, 1, 1);
      const edge = LANES.spacing * 1.5 + TRACK.roadMargin * 0.5;
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          tmpP.set(side * edge, TRACK.roadY, TRACK.behind + sp - i * sp);
          tmpM.compose(tmpP, tmpQ, tmpS);
          inst.setMatrixAt(k++, tmpM);
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      this.stones.add(inst);
    }
    // cart ruts: two worn grooves down each lane, the cue that makes lanes readable at speed
    {
      const piece = TRACK.rutPieceLength;
      const n = Math.ceil(span / piece) + 2;
      const parts = assets.getMeshParts("env.road.rut");
      this.rutMat = parts.material as MeshLambertMaterial;
      const inst = new InstancedMesh(parts.geometry, parts.material, n * 6);
      let k = 0;
      tmpQ.identity();
      tmpS.set(1, 1, piece);
      const halfGauge = (TRACK.rutGauge * laneScale) / 2;
      for (let lane = -1; lane <= 1; lane++) {
        for (const side of [-1, 1]) {
          for (let i = 0; i < n; i++) {
            tmpP.set(lane * LANES.spacing + side * halfGauge, TRACK.roadY + 0.02, TRACK.behind + piece - (i + 0.5) * piece);
            tmpM.compose(tmpP, tmpQ, tmpS);
            inst.setMatrixAt(k++, tmpM);
          }
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      this.ruts.add(inst);
    }
    curveObject(this.root);
  }

  render(ctx: RunContext): void {
    if (this.dirty) this.build();
    const d = ctx.renderDistance;
    this.ground.position.z = posMod(d, TRACK.groundTile);
    this.road.position.z = posMod(d, TRACK.roadTile);
    this.stones.position.z = posMod(d, TRACK.stoneSpacing);
    this.ruts.position.z = posMod(d, TRACK.rutPieceLength);

    // region colour, blended across a crossing
    const bs = this.biomes;
    const from = bs?.current ?? BIOMES[0];
    const to = bs?.next ?? from;
    const t = bs?.blend ?? 0;
    if (this.groundMat) this.groundMat.color.set(from.ground).lerp(tmpC.set(to.ground), t);
    if (this.roadMat) this.roadMat.color.set(from.road).lerp(tmpC.set(to.road), t);
    if (this.bedMat) this.bedMat.color.set(from.road).lerp(tmpC.set(to.road), t).multiplyScalar(0.72);
    // kerbs sit a little lighter than the road, ruts distinctly darker (they are hollows)
    if (this.stoneMat) this.stoneMat.color.set(from.road).lerp(tmpC.set(to.road), t).multiplyScalar(0.95);
    if (this.rutMat) this.rutMat.color.set(from.road).lerp(tmpC.set(to.road), t).multiplyScalar(0.4);
  }
}
