/**
 * Scrolling 3-lane track: ground, ballast bed, instanced sleepers and rail pieces.
 * Each layer is laid out once in a group and slid by `distance mod tile`, so the hot path is
 * four position writes per frame. Rebuilds itself when track/lane tuning changes.
 */
import {
  BoxGeometry,
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
import type { RunContext, RunSystem } from "../types";

export const TRACK = defineTuning("track", "Track", {
  sleeperSpacing: { default: 0.9, min: 0.4, max: 3, step: 0.05, label: "Sleeper spacing", unit: "m" },
  railGauge: { default: 1.45, min: 0.6, max: 2.3, step: 0.01, label: "Rail gauge (at 2.5 m lanes)", unit: "m" },
  railPieceLength: { default: 2, min: 0.5, max: 8, step: 0.5, label: "Rail piece length (bend resolution)", unit: "m" },
  ballastTile: { default: 2.5, min: 0.5, max: 10, step: 0.1, label: "Ballast texture tile", unit: "m" },
  groundTile: { default: 5, min: 1, max: 20, step: 0.5, label: "Ground texture tile", unit: "m" },
  ballastMargin: { default: 0.9, min: 0, max: 4, step: 0.05, label: "Ballast beyond outer lanes", unit: "m" },
  ballastY: { default: -0.12, min: -1, max: 0, step: 0.01, label: "Ballast surface height", unit: "m" },
  groundY: { default: -0.45, min: -3, max: 0, step: 0.01, label: "Ground height", unit: "m" },
  groundWidth: { default: 160, min: 20, max: 600, step: 10, label: "Ground width", unit: "m" },
  ahead: { default: 250, min: 60, max: 800, step: 10, label: "Track length ahead", unit: "m" },
  behind: { default: 24, min: 0, max: 80, step: 1, label: "Track length behind", unit: "m" },
});

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();

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
  private readonly ballast = new Group();
  private readonly sleepers = new Group();
  private readonly rails = new Group();
  private dirty = true;
  private ctx!: RunContext;

  init(ctx: RunContext): void {
    this.ctx = ctx;
    this.root.name = "track";
    this.root.add(this.ground, this.ballast, this.sleepers, this.rails);
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
    [this.ground, this.ballast, this.sleepers, this.rails].forEach((g) => this.clearGroup(g));
    const span = TRACK.ahead + TRACK.behind;
    const laneScale = LANES.spacing / 2.5;

    // ground
    {
      const tile = TRACK.groundTile;
      const len = Math.ceil(span / tile) * tile + tile;
      const tex = assets.getTexture("tex.ground.yard").clone();
      tex.repeat.set(TRACK.groundWidth / tile, len / tile);
      tex.needsUpdate = true;
      const mesh = new Mesh(new PlaneGeometry(TRACK.groundWidth, len, 6, Math.ceil(len / 5)), new MeshLambertMaterial({ map: tex }));
      mesh.userData.ownMaterial = true;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, TRACK.groundY, TRACK.behind + tile - len / 2);
      this.ground.add(mesh);
    }
    // ballast bed spanning all lanes
    {
      const tile = TRACK.ballastTile;
      const len = Math.ceil(span / tile) * tile + tile;
      const width = LANES.spacing * 3 + TRACK.ballastMargin * 2;
      const tex = assets.getTexture("tex.track.ballast").clone();
      tex.repeat.set(width / tile, len / tile);
      tex.needsUpdate = true;
      const mesh = new Mesh(new PlaneGeometry(width, len, 3, Math.ceil(len / 2.5)), new MeshLambertMaterial({ map: tex }));
      mesh.userData.ownMaterial = true;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, TRACK.ballastY, TRACK.behind + tile - len / 2);
      this.ballast.add(mesh);
      // raised bed under the ballast surface so the track reads as an embankment
      const h = Math.max(0.01, TRACK.ballastY - TRACK.groundY);
      const bed = new Mesh(new BoxGeometry(width + 0.3, h, len, 1, 1, Math.ceil(len / 5)), new MeshLambertMaterial({ color: 0x6b645a }));
      bed.userData.ownMaterial = true;
      bed.position.set(0, TRACK.ballastY - 0.004 - h / 2, TRACK.behind + tile - len / 2);
      this.ballast.add(bed);
    }
    // sleepers
    {
      const sp = TRACK.sleeperSpacing;
      const n = Math.ceil(span / sp) + 2;
      const parts = assets.getMeshParts("env.track.sleeper");
      const inst = new InstancedMesh(parts.geometry, parts.material, n * 3);
      let k = 0;
      tmpQ.identity();
      tmpS.set(laneScale, 1, 1);
      for (let lane = -1; lane <= 1; lane++) {
        for (let i = 0; i < n; i++) {
          tmpP.set(lane * LANES.spacing, TRACK.ballastY, TRACK.behind + sp - i * sp);
          tmpM.compose(tmpP, tmpQ, tmpS);
          inst.setMatrixAt(k++, tmpM);
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      this.sleepers.add(inst);
    }
    // rails
    {
      const piece = TRACK.railPieceLength;
      const n = Math.ceil(span / piece) + 2;
      const parts = assets.getMeshParts("env.track.rail");
      const inst = new InstancedMesh(parts.geometry, parts.material, n * 6);
      let k = 0;
      tmpQ.identity();
      tmpS.set(1, 1, piece);
      const halfGauge = (TRACK.railGauge * laneScale) / 2;
      for (let lane = -1; lane <= 1; lane++) {
        for (const side of [-1, 1]) {
          for (let i = 0; i < n; i++) {
            tmpP.set(lane * LANES.spacing + side * halfGauge, TRACK.ballastY + 0.12, TRACK.behind + piece - (i + 0.5) * piece);
            tmpM.compose(tmpP, tmpQ, tmpS);
            inst.setMatrixAt(k++, tmpM);
          }
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      this.rails.add(inst);
    }
    curveObject(this.root);
  }

  render(ctx: RunContext): void {
    if (this.dirty) this.build();
    const d = ctx.renderDistance;
    this.ground.position.z = posMod(d, TRACK.groundTile);
    this.ballast.position.z = posMod(d, TRACK.ballastTile);
    this.sleepers.position.z = posMod(d, TRACK.sleeperSpacing);
    this.rails.position.z = posMod(d, TRACK.railPieceLength);
  }
}
