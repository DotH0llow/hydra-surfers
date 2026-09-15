/** Procedural placeholders for pickups and the hoverboard (see manifest specs in track.json). */
import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshLambertMaterial, TorusGeometry, type BufferGeometry, type Object3D } from "three";
import { registerMeshPlaceholder } from "../../assets/placeholders";

const mat = (color: string, glow = 0.35): MeshLambertMaterial => {
  const m = new MeshLambertMaterial({ color });
  m.emissive = new Color(color).multiplyScalar(glow);
  return m;
};

function add(parent: Object3D, geo: BufferGeometry, color: string, x: number, y: number, z: number, glow?: number): Mesh {
  const m = new Mesh(geo, mat(color, glow));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Glowing ring every pickup sits in, so they read as "collect me" at a glance. */
function ring(g: Group, color: string): void {
  const r = add(g, new TorusGeometry(0.48, 0.05, 8, 28), color, 0, 0, 0, 0.8);
  r.name = "ring";
}

registerMeshPlaceholder("pickup-jetpack", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#9aa5b1";
  ring(g, "#7fd1ff");
  for (const side of [-1, 1]) {
    add(g, new CylinderGeometry(0.11, 0.11, 0.46, 12), c, side * 0.13, 0.02, 0);
    add(g, new CylinderGeometry(0.07, 0.11, 0.12, 12), "#ff7a1a", side * 0.13, -0.27, 0, 0.9);
  }
  add(g, new BoxGeometry(0.2, 0.3, 0.12), "#2b3a55", 0, 0.02, -0.08);
  return g;
});

registerMeshPlaceholder("pickup-sneakers", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#57e389";
  ring(g, "#b7ff8a");
  add(g, new BoxGeometry(0.2, 0.14, 0.46), c, 0, -0.08, 0);
  add(g, new BoxGeometry(0.2, 0.18, 0.2), c, 0, 0.06, 0.12);
  add(g, new BoxGeometry(0.22, 0.05, 0.5), "#f4f4f4", 0, -0.17, 0);
  return g;
});

registerMeshPlaceholder("pickup-magnet", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#e5484d";
  ring(g, "#ff9a9a");
  add(g, new BoxGeometry(0.46, 0.13, 0.13), c, 0, -0.2, 0);
  for (const side of [-1, 1]) {
    add(g, new BoxGeometry(0.13, 0.34, 0.13), c, side * 0.17, 0.03, 0);
    add(g, new BoxGeometry(0.13, 0.1, 0.13), "#dfe5ec", side * 0.17, 0.25, 0, 0.6);
  }
  return g;
});

registerMeshPlaceholder("pickup-multiplier", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#b57bff";
  ring(g, "#d9b8ff");
  const disc = add(g, new CylinderGeometry(0.3, 0.3, 0.08, 20), c, 0, 0, 0, 0.5);
  disc.rotation.x = Math.PI / 2;
  // a bold "x2" mark made of bars
  const w = "#ffffff";
  const bar = (x: number, y: number, rot: number, len = 0.26) => {
    const b = add(g, new BoxGeometry(0.05, len, 0.04), w, x, y, 0.06, 0.8);
    b.rotation.z = rot;
  };
  bar(-0.1, 0, 0.7);
  bar(-0.1, 0, -0.7);
  bar(0.12, 0.07, Math.PI / 2, 0.14);
  bar(0.18, 0.02, 0, 0.1);
  bar(0.12, -0.03, Math.PI / 2, 0.14);
  bar(0.06, -0.08, 0, 0.1);
  bar(0.12, -0.12, Math.PI / 2, 0.14);
  return g;
});

registerMeshPlaceholder("pickup-key", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#2fc4b2";
  ring(g, "#9ff5ea");
  const bow = add(g, new TorusGeometry(0.11, 0.04, 8, 18), c, 0, 0.16, 0, 0.6);
  bow.rotation.y = 0;
  add(g, new BoxGeometry(0.06, 0.36, 0.06), c, 0, -0.1, 0, 0.6);
  add(g, new BoxGeometry(0.12, 0.05, 0.06), c, 0.06, -0.22, 0, 0.6);
  add(g, new BoxGeometry(0.1, 0.05, 0.06), c, 0.05, -0.12, 0, 0.6);
  return g;
});

registerMeshPlaceholder("hoverboard", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#2fc4b2";
  add(g, new BoxGeometry(0.62, 0.07, 1.5), c, 0, 0.035, 0, 0.2);
  add(g, new BoxGeometry(0.64, 0.02, 0.3), "#ffc83d", 0, 0.075, 0.45, 0.4);
  add(g, new BoxGeometry(0.64, 0.02, 0.3), "#ffc83d", 0, 0.075, -0.45, 0.4);
  for (const z of [-0.5, 0.5]) add(g, new BoxGeometry(0.4, 0.04, 0.12), "#7fd1ff", 0, -0.01, z, 1.2);
  return g;
});
