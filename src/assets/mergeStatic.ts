/**
 * Draw-call reduction for procedural placeholder models: the static meshes of a model are merged into
 * one mesh per material bucket, and every plain-coloured Lambert part shares a single vertex-coloured
 * material. Named groups (rigs, toggled parts) and the named meshes the engine looks up (KEEP) are
 * left untouched, so animation and `getObjectByName` keep working.
 */
import { BufferAttribute, Matrix4, Mesh, MeshLambertMaterial, type BufferGeometry, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Mesh names referenced by engine code; never merged. */
const KEEP = new Set(["ball", "head", "lampRed", "lampGreen", "cabFront"]);

interface Bucket {
  plain: boolean;
  material: Material;
  meshes: Mesh[];
}

function isPlainLambert(m: Material): m is MeshLambertMaterial {
  const l = m as MeshLambertMaterial;
  return l.isMeshLambertMaterial === true && !l.map && !l.alphaMap && !l.transparent && !l.vertexColors && l.emissive.getHex() === 0;
}

function bucketKey(m: Material): string {
  if (isPlainLambert(m)) return "plain";
  const l = m as MeshLambertMaterial;
  if (l.isMeshLambertMaterial) {
    return `lambert|${l.color.getHex()}|${l.emissive.getHex()}|${l.map?.uuid ?? ""}|${l.alphaMap?.uuid ?? ""}|${l.transparent}|${l.opacity}|${l.vertexColors}`;
  }
  return `uuid|${m.uuid}`;
}

/**
 * Merges static child meshes of `root` in place. Returns how many draw calls were saved.
 * Only meshes reached through unnamed container groups are considered.
 */
export function mergeStaticMeshes(root: Object3D): number {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, Bucket>();

  const visit = (node: Object3D) => {
    for (const child of node.children) {
      const mesh = child as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
      if (mesh.isMesh) {
        if (KEEP.has(mesh.name) || mesh.children.length > 0 || mesh.isInstancedMesh || mesh.isSkinnedMesh || Array.isArray(mesh.material)) continue;
        const key = bucketKey(mesh.material as Material);
        let b = buckets.get(key);
        if (!b) {
          b = { plain: key === "plain", material: mesh.material as Material, meshes: [] };
          buckets.set(key, b);
        }
        b.meshes.push(mesh);
      } else if (!child.name && child.children.length > 0) {
        visit(child);
      }
    }
  };
  visit(root);

  let saved = 0;
  const m = new Matrix4();
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const geos: BufferGeometry[] = b.meshes.map((mesh) => {
      const g = mesh.geometry.clone();
      g.applyMatrix4(m.multiplyMatrices(toRoot, mesh.matrixWorld));
      return g;
    });
    const indexed = geos.every((g) => g.index !== null);
    for (let i = 0; i < geos.length; i++) {
      if (!indexed && geos[i].index) geos[i] = geos[i].toNonIndexed();
      if (b.plain) {
        const c = (b.meshes[i].material as MeshLambertMaterial).color;
        const n = geos[i].getAttribute("position").count;
        const colors = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) {
          colors[v * 3] = c.r;
          colors[v * 3 + 1] = c.g;
          colors[v * 3 + 2] = c.b;
        }
        geos[i].setAttribute("color", new BufferAttribute(colors, 3));
      }
    }
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const material = b.plain ? new MeshLambertMaterial({ vertexColors: true }) : b.material;
    const out = new Mesh(merged, material);
    out.name = b.plain ? "merged:plain" : "merged";
    root.add(out);
    for (const mesh of b.meshes) mesh.parent?.remove(mesh);
    saved += b.meshes.length - 1;
  }
  return saved;
}
