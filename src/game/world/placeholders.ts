/**
 * Procedural placeholders for the roadside scenery.
 *
 * Every prop is built in GREYSCALE with internal contrast (bright walls, dark roof, darker door).
 * The environment instances them and supplies the hue per instance through `instanceColor`, taken
 * from the biome's palette, so one crate of geometry dresses eight regions: the same house is warm
 * ochre in the village and cold grey against the castle wall. Parts that must keep their own colour
 * whatever the region (a torch flame) are built as a separate emissive mesh, which `mergeStatic`
 * leaves alone and the environment renders untinted.
 *
 * Sizes are metres at scale 1, pivot on the ground, facing -Z, matching each manifest `spec`.
 */
import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, type Material, type Object3D } from "three";
import { registerMeshPlaceholder } from "../../assets/placeholders";

/** Greyscale material: `v` is the relative brightness the biome tint gets multiplied into. */
function tone(v: number): MeshLambertMaterial {
  const c = new Color(v, v, v);
  return new MeshLambertMaterial({ color: c });
}

/** Warm self-lit material for flames and windows, left untinted by the environment. */
function glow(color: string, strength = 0.9): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ color });
  m.emissive = new Color(color).multiplyScalar(strength);
  return m;
}

function box(parent: Object3D, w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, name = ""): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function cyl(parent: Object3D, rTop: number, rBottom: number, h: number, seg: number, mat: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, h, seg), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function cone(parent: Object3D, r: number, h: number, seg: number, mat: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new ConeGeometry(r, h, seg), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Village house: timbered walls, steep shingle roof, one lit window. */
registerMeshPlaceholder("prop-house", () => {
  const g = new Group();
  const wall = tone(0.95);
  const beam = tone(0.55);
  const roof = tone(0.42);
  const dark = tone(0.25);
  box(g, 5, 3.2, 6, wall, 0, 1.6, 0);
  // corner timbers
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(g, 0.28, 3.2, 0.28, beam, sx * 2.4, 1.6, sz * 2.85);
  }
  box(g, 5.1, 0.3, 6.1, beam, 0, 3.2, 0);
  // roof: two slabs meeting at a ridge
  for (const side of [-1, 1]) {
    const slab = box(g, 3.4, 0.35, 6.6, roof, side * 1.32, 3.95, 0);
    // negative: rotating by +z lifts the outer edge and would make a valley instead of a gable
    slab.rotation.z = -side * 0.62;
  }
  box(g, 0.6, 0.32, 6.7, roof, 0, 4.72, 0); // ridge
  box(g, 0.8, 1.6, 0.8, beam, 1.4, 5, -1.6); // chimney
  box(g, 1.1, 1.9, 0.14, dark, 0, 0.95, 3.02); // door
  box(g, 0.9, 0.9, 0.12, glow("#ffce7a", 0.55), -1.5, 2, 3.02, "window");
  return g;
});

/** Pine: a bare trunk under two stacked crowns. */
registerMeshPlaceholder("prop-pine", () => {
  const g = new Group();
  cyl(g, 0.16, 0.24, 2.2, 6, tone(0.38), 0, 1.1, 0);
  cone(g, 1.25, 2.8, 7, tone(0.95), 0, 3.1, 0);
  cone(g, 0.95, 2.2, 7, tone(0.78), 0, 4.5, 0);
  return g;
});

/** Dead tree: split trunk and three broken limbs. */
registerMeshPlaceholder("prop-dead-tree", () => {
  const g = new Group();
  const bark = tone(0.85);
  cyl(g, 0.18, 0.34, 3.4, 6, bark, 0, 1.7, 0);
  const limbs: Array<[number, number, number, number]> = [
    [0.9, 2.6, 0.5, -0.9],
    [-0.8, 3, -0.4, 0.8],
    [0.4, 3.5, -0.8, -0.5],
  ];
  for (const [x, y, z, rot] of limbs) {
    const limb = box(g, 0.16, 1.5, 0.16, bark, x, y, z);
    limb.rotation.z = rot;
    limb.rotation.x = z * 0.4;
  }
  return g;
});

/** Boulder: three faceted blocks, never quite the same twice once yaw-jittered. */
registerMeshPlaceholder("prop-rock", () => {
  const g = new Group();
  const a = box(g, 1.6, 1.2, 1.5, tone(0.95), 0, 0.55, 0);
  a.rotation.set(0.15, 0.4, 0.1);
  const b = box(g, 1, 0.8, 1.1, tone(0.78), 0.55, 0.35, 0.4);
  b.rotation.set(-0.2, 0.9, 0.25);
  const c = box(g, 0.7, 0.6, 0.8, tone(0.62), -0.5, 0.3, -0.35);
  c.rotation.set(0.3, 0.2, -0.15);
  return g;
});

/** Curtain wall segment with crenellations, 8 m along the road. */
registerMeshPlaceholder("prop-wall", () => {
  const g = new Group();
  const stone = tone(0.95);
  const shade = tone(0.7);
  box(g, 1.2, 4.2, 8, stone, 0, 2.1, 0);
  box(g, 1.5, 0.35, 8, shade, 0, 4.3, 0);
  for (let i = -3; i <= 3; i++) box(g, 1.5, 0.7, 0.9, stone, 0, 4.8, i * 1.15);
  box(g, 1.35, 0.5, 8, shade, 0, 0.25, 0); // plinth
  return g;
});

/** Round tower with a conical cap. */
registerMeshPlaceholder("prop-tower", () => {
  const g = new Group();
  const stone = tone(0.95);
  cyl(g, 1.7, 1.9, 8.5, 10, stone, 0, 4.25, 0);
  cyl(g, 2.1, 2.1, 0.5, 10, tone(0.72), 0, 8.5, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    box(g, 0.6, 0.7, 0.6, stone, Math.cos(a) * 1.85, 9.05, Math.sin(a) * 1.85);
  }
  cone(g, 2.3, 2.6, 10, tone(0.45), 0, 10.6, 0);
  box(g, 0.7, 1.1, 0.2, glow("#ffce7a", 0.5), 0, 5.6, 1.85, "window");
  return g;
});

/** Leaning headstone. */
registerMeshPlaceholder("prop-tombstone", () => {
  const g = new Group();
  const stone = tone(0.95);
  const slab = box(g, 0.85, 1.2, 0.2, stone, 0, 0.6, 0);
  slab.rotation.z = 0.06;
  box(g, 1.05, 0.18, 0.4, tone(0.7), 0, 0.09, 0);
  box(g, 0.5, 0.16, 0.22, stone, 0, 1.05, 0.01); // cross arm
  return g;
});

/** Roadside torch post: the flame is a separate emissive part, never tinted by the region. */
registerMeshPlaceholder("prop-torch", () => {
  const g = new Group();
  cyl(g, 0.08, 0.11, 3, 6, tone(0.7), 0, 1.5, 0);
  box(g, 0.36, 0.14, 0.36, tone(0.5), 0, 3.05, 0);
  const flame = new Mesh(new ConeGeometry(0.22, 0.55, 6), glow("#ffb648", 1.1));
  flame.position.set(0, 3.42, 0);
  flame.name = "flame";
  g.add(flame);
  return g;
});

/** Banner on a pole; the cloth is the bright part so the region's colour reads on it. */
registerMeshPlaceholder("prop-banner", () => {
  const g = new Group();
  cyl(g, 0.07, 0.09, 4.4, 6, tone(0.32), 0, 2.2, 0);
  box(g, 0.1, 0.1, 1.5, tone(0.32), 0, 4.3, 0);
  box(g, 0.06, 2.1, 1.35, tone(1), 0.02, 3.25, 0, "cloth");
  const tailA = box(g, 0.06, 0.5, 0.62, tone(1), 0.02, 2.05, -0.35);
  tailA.rotation.x = 0.25;
  const tailB = box(g, 0.06, 0.5, 0.62, tone(1), 0.02, 2.05, 0.35);
  tailB.rotation.x = -0.25;
  return g;
});

/** Campaign tent. */
registerMeshPlaceholder("prop-tent", () => {
  const g = new Group();
  const canvas = tone(0.95);
  for (const side of [-1, 1]) {
    const slab = box(g, 2.8, 0.2, 4, canvas, side * 1, 1.3, 0);
    slab.rotation.z = -side * 0.62;
  }
  box(g, 0.16, 2.7, 0.16, tone(0.45), 0, 1.35, -1.9);
  box(g, 0.16, 2.7, 0.16, tone(0.45), 0, 1.35, 1.9);
  box(g, 0.35, 0.35, 4.2, tone(0.6), 0, 2.65, 0);
  box(g, 0.05, 0.7, 0.5, tone(0.8), 0, 3.2, -1.9); // pennant
  return g;
});

/** Broken column with a toppled drum at its foot. */
registerMeshPlaceholder("prop-column", () => {
  const g = new Group();
  const stone = tone(0.95);
  box(g, 1.5, 0.4, 1.5, tone(0.75), 0, 0.2, 0);
  cyl(g, 0.52, 0.6, 4.2, 10, stone, 0, 2.5, 0);
  const broken = cyl(g, 0.5, 0.52, 0.7, 10, tone(0.85), 0.15, 4.85, 0.1);
  broken.rotation.z = 0.22;
  const fallen = cyl(g, 0.5, 0.5, 1.4, 10, tone(0.8), 1.5, 0.55, 0.6);
  fallen.rotation.z = Math.PI / 2;
  fallen.rotation.y = 0.3;
  return g;
});

/** Clump of marsh reeds. */
registerMeshPlaceholder("prop-reed", () => {
  const g = new Group();
  const stalk = tone(0.95);
  const angles = [-0.18, -0.06, 0.05, 0.16, 0.24];
  for (let i = 0; i < angles.length; i++) {
    const h = 1.2 + (i % 3) * 0.35;
    const s = box(g, 0.07, h, 0.07, i % 2 ? stalk : tone(0.72), (i - 2) * 0.16, h / 2, (i % 2) * 0.18 - 0.09);
    s.rotation.z = angles[i];
  }
  return g;
});

/** Mine support: two posts and a lintel, framing the road like a rib cage. */
registerMeshPlaceholder("prop-minebeam", () => {
  const g = new Group();
  const wood = tone(0.95);
  const dark = tone(0.6);
  box(g, 0.32, 4, 0.32, wood, 0, 2, 0);
  box(g, 0.28, 0.28, 0.9, dark, 0, 3.8, 0.45);
  box(g, 0.5, 0.3, 0.5, dark, 0, 0.15, 0);
  return g;
});

/** Low paling fence. */
registerMeshPlaceholder("prop-fence", () => {
  const g = new Group();
  const wood = tone(0.95);
  const rail = tone(0.75);
  for (const z of [-0.9, 0.9]) box(g, 0.14, 1.1, 0.14, wood, 0, 0.55, z);
  box(g, 0.08, 0.14, 2, rail, 0, 0.85, 0);
  box(g, 0.08, 0.14, 2, rail, 0, 0.45, 0);
  return g;
});

/** Kerb stone along the verge: what keeps the eye on the edge of the road. */
registerMeshPlaceholder("road-stone", () => {
  const g = new Group();
  // mid grey, not white: the road tints these per region and a bright kerb reads as ballast
  const stone = box(g, 0.42, 0.2, 1.05, tone(0.78), 0, 0.1, 0);
  stone.rotation.y = 0.05;
  return g;
});

/** A worn cart rut: a shallow dark groove, tiled down the middle of each lane pair. */
registerMeshPlaceholder("road-rut", () => {
  const g = new Group();
  // A rut is a worn HOLLOW: it must sit darker than the road, never brighter, or it reads as rail.
  box(g, 0.34, 0.03, 1, tone(0.42), 0, 0.015, 0);
  return g;
});
