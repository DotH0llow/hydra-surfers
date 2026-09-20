/**
 * Procedural placeholders for the pickups and the mounts.
 *
 * Pickups keep a constant, saturated palette in every region: a player has a fraction of a second
 * to tell a magnet amulet from a royal blessing, so readability beats scenery-matching. Each one
 * sits inside a glowing ring for the same reason.
 *
 * Mounts are what the runner rides to shrug off one crash. They sit under the feet, so they must
 * stay low and wide enough to read from behind without hiding the runner.
 */
import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry, TorusGeometry, type BufferGeometry, type Object3D } from "three";
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

/** Griffin wings: the flight power-up. */
registerMeshPlaceholder("pickup-griffin", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#e8dcc0";
  ring(g, "#bfe0ff");
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const feather = add(g, new BoxGeometry(0.1, 0.04, 0.34 - i * 0.07), c, side * (0.12 + i * 0.1), 0.06 - i * 0.05, 0, 0.5);
      feather.rotation.z = side * (0.5 + i * 0.18);
      feather.rotation.y = side * 0.2;
    }
  }
  add(g, new SphereGeometry(0.1, 10, 8), "#c9a227", 0, 0, 0, 0.6);
  return g;
});

/** Giant boots: the high-jump power-up. */
registerMeshPlaceholder("pickup-boots", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#7a4a2a";
  ring(g, "#b7ff8a");
  for (const side of [-1, 1]) {
    add(g, new BoxGeometry(0.22, 0.3, 0.2), c, side * 0.14, 0.04, -0.02, 0.35);
    add(g, new BoxGeometry(0.22, 0.14, 0.34), c, side * 0.14, -0.14, 0.06, 0.35);
    add(g, new BoxGeometry(0.24, 0.06, 0.36), "#3f2a1a", side * 0.14, -0.21, 0.06, 0.3);
    add(g, new BoxGeometry(0.24, 0.05, 0.22), "#c9a227", side * 0.14, 0.06, -0.02, 0.5);
  }
  return g;
});

/** Magnetic amulet: the coin-pull power-up. */
registerMeshPlaceholder("pickup-amulet", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#e5484d";
  ring(g, "#ff9a9a");
  const chain = add(g, new TorusGeometry(0.2, 0.025, 6, 20), "#c9a227", 0, 0.14, 0, 0.5);
  chain.rotation.x = Math.PI / 2;
  const gem = add(g, new SphereGeometry(0.17, 12, 10), c, 0, -0.1, 0, 0.75);
  gem.scale.set(1, 1.15, 0.6);
  add(g, new TorusGeometry(0.19, 0.035, 8, 20), "#c9a227", 0, -0.1, 0, 0.55).rotation.y = 0;
  return g;
});

/** Royal blessing: the score-doubling power-up, a crown. */
registerMeshPlaceholder("pickup-blessing", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#e8c25a";
  ring(g, "#ffe9a8");
  const band = add(g, new CylinderGeometry(0.22, 0.24, 0.14, 12, 1, true), c, 0, -0.06, 0, 0.6);
  band.name = "band";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = add(g, new ConeGeometry(0.06, 0.2, 5), c, Math.cos(a) * 0.22, 0.09, Math.sin(a) * 0.22, 0.6);
    add(g, new SphereGeometry(0.04, 8, 6), "#e5484d", Math.cos(a) * 0.22, 0.2, Math.sin(a) * 0.22, 0.7);
    void spike;
  }
  return g;
});

/** Iron key: buys a second chance after a fall. */
registerMeshPlaceholder("pickup-key", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#d8c07a";
  ring(g, "#9ff5ea");
  const bow = add(g, new TorusGeometry(0.12, 0.035, 8, 18), c, 0, 0.16, 0, 0.6);
  bow.rotation.y = 0;
  add(g, new BoxGeometry(0.055, 0.36, 0.055), c, 0, -0.1, 0, 0.6);
  add(g, new BoxGeometry(0.13, 0.05, 0.055), c, 0.06, -0.24, 0, 0.6);
  add(g, new BoxGeometry(0.1, 0.05, 0.055), c, 0.05, -0.14, 0, 0.6);
  return g;
});

/** Aegis: a warding shield that eats the next collision outright. */
registerMeshPlaceholder("pickup-aegis", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#7fd1ff";
  ring(g, "#cbe9ff");
  const face = add(g, new CylinderGeometry(0.28, 0.24, 0.07, 6), c, 0, 0, 0, 0.55);
  face.rotation.x = Math.PI / 2;
  add(g, new BoxGeometry(0.08, 0.34, 0.03), "#ffffff", 0, 0, 0.06, 0.8);
  add(g, new BoxGeometry(0.3, 0.08, 0.03), "#ffffff", 0, 0.04, 0.06, 0.8);
  return g;
});

/** Hourglass: slows the road without slowing the score. */
registerMeshPlaceholder("pickup-hourglass", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#c9a227";
  ring(g, "#ffe9a8");
  const top = add(g, new ConeGeometry(0.17, 0.2, 10), "#dfe9f5", 0, 0.11, 0, 0.5);
  top.rotation.x = Math.PI;
  add(g, new ConeGeometry(0.17, 0.2, 10), "#dfe9f5", 0, -0.11, 0, 0.5);
  add(g, new CylinderGeometry(0.2, 0.2, 0.05, 10), c, 0, 0.22, 0, 0.6);
  add(g, new CylinderGeometry(0.2, 0.2, 0.05, 10), c, 0, -0.22, 0, 0.6);
  add(g, new CylinderGeometry(0.03, 0.03, 0.44, 6), c, 0.17, 0, 0, 0.5);
  add(g, new CylinderGeometry(0.03, 0.03, 0.44, 6), c, -0.17, 0, 0, 0.5);
  return g;
});

// ---------------------------------------------------------------------------- mounts

/** Runic shield ridden like a sled: the starting mount. */
registerMeshPlaceholder("mount-shield", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#6b7a8f";
  add(g, new CylinderGeometry(0.42, 0.36, 0.1, 8), c, 0, 0.05, 0, 0.15).rotation.x = Math.PI / 2;
  add(g, new BoxGeometry(0.1, 0.9, 0.04), "#d8c07a", 0, 0.11, 0, 0.35);
  add(g, new BoxGeometry(0.7, 0.1, 0.04), "#d8c07a", 0, 0.11, 0, 0.35);
  add(g, new SphereGeometry(0.09, 10, 8), "#c9a227", 0, 0.13, 0, 0.5);
  return g;
});

/** A barrel on its side, which is exactly as controllable as it sounds. */
registerMeshPlaceholder("mount-barrel", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#8a5a30";
  const body = add(g, new CylinderGeometry(0.32, 0.32, 1.3, 12), c, 0, 0.3, 0, 0.12);
  body.rotation.z = Math.PI / 2;
  for (const z of [-0.4, 0.4]) {
    const hoop = add(g, new TorusGeometry(0.33, 0.035, 6, 14), "#4a4a52", 0, 0.3, z, 0.15);
    hoop.rotation.y = Math.PI / 2;
  }
  return g;
});

/** Woven carpet, stiff with old magic. */
registerMeshPlaceholder("mount-carpet", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#8a3a5a";
  add(g, new BoxGeometry(0.72, 0.06, 1.6), c, 0, 0.05, 0, 0.2);
  add(g, new BoxGeometry(0.76, 0.03, 0.16), "#d8c07a", 0, 0.07, 0.72, 0.4);
  add(g, new BoxGeometry(0.76, 0.03, 0.16), "#d8c07a", 0, 0.07, -0.72, 0.4);
  add(g, new BoxGeometry(0.4, 0.03, 1.1), "#d8c07a", 0, 0.085, 0, 0.3);
  return g;
});

/** Mine cart, rescued from the tunnels. */
registerMeshPlaceholder("mount-minecart", ({ entry }) => {
  const g = new Group();
  const c = entry.color ?? "#6b5236";
  add(g, new BoxGeometry(0.66, 0.34, 1.3), c, 0, 0.3, 0, 0.12);
  add(g, new BoxGeometry(0.7, 0.06, 1.34), "#4a4a52", 0, 0.48, 0, 0.15);
  for (const z of [-0.42, 0.42]) {
    for (const side of [-1, 1]) {
      const w = add(g, new CylinderGeometry(0.15, 0.15, 0.06, 10), "#3d3a36", side * 0.34, 0.15, z, 0.1);
      w.rotation.z = Math.PI / 2;
    }
  }
  return g;
});

/** Low beasts the runner rides: wolf, boar, ghost horse and a very small dragon. */
function beast(bodyColor: string, accent: string, opts: { snout: number; ears: boolean; horn: boolean; wings: boolean; glow: number }): Group {
  const g = new Group();
  const body = add(g, new BoxGeometry(0.5, 0.42, 1.25), bodyColor, 0, 0.42, 0, opts.glow);
  body.name = "body";
  add(g, new BoxGeometry(0.34, 0.3, 0.34), bodyColor, 0, 0.5, 0.72, opts.glow);
  add(g, new BoxGeometry(0.22, 0.18, opts.snout), bodyColor, 0, 0.44, 0.78 + opts.snout * 0.4, opts.glow);
  if (opts.ears) {
    for (const side of [-1, 1]) add(g, new ConeGeometry(0.07, 0.16, 4), bodyColor, side * 0.11, 0.68, 0.68, opts.glow);
  }
  if (opts.horn) add(g, new ConeGeometry(0.05, 0.22, 5), accent, 0, 0.7, 0.82, 0.5);
  if (opts.wings) {
    for (const side of [-1, 1]) {
      const wing = add(g, new BoxGeometry(0.5, 0.04, 0.42), accent, side * 0.38, 0.6, -0.05, 0.4);
      wing.rotation.z = side * 0.35;
    }
  }
  for (const z of [-0.42, 0.42]) {
    for (const side of [-1, 1]) add(g, new BoxGeometry(0.12, 0.34, 0.12), bodyColor, side * 0.19, 0.17, z, opts.glow);
  }
  add(g, new BoxGeometry(0.1, 0.1, 0.4), accent, 0, 0.5, -0.76, opts.glow);
  return g;
}

registerMeshPlaceholder("mount-wolf", ({ entry }) => beast(entry.color ?? "#5a5f66", "#2f3338", { snout: 0.3, ears: true, horn: false, wings: false, glow: 0.1 }));
registerMeshPlaceholder("mount-boar", ({ entry }) => beast(entry.color ?? "#4a3a2f", "#d8cbb0", { snout: 0.24, ears: true, horn: true, wings: false, glow: 0.1 }));
registerMeshPlaceholder("mount-ghosthorse", ({ entry }) => beast(entry.color ?? "#9fd8ff", "#dff1ff", { snout: 0.34, ears: true, horn: false, wings: false, glow: 0.75 }));
registerMeshPlaceholder("mount-dragonling", ({ entry }) => beast(entry.color ?? "#3f7a4a", "#c95a2a", { snout: 0.26, ears: false, horn: true, wings: true, glow: 0.25 }));

/** Broom: a handle with bound bristles, ridden standing up. */
registerMeshPlaceholder("mount-broom", ({ entry }) => {
  const g = new Group();
  const wood = entry.color ?? "#a8863f";
  const handle = add(g, new CylinderGeometry(0.055, 0.05, 1.6, 8), wood, 0, 0.2, 0, 0.1);
  handle.rotation.x = Math.PI / 2;
  const head = add(g, new CylinderGeometry(0.1, 0.22, 0.5, 8), "#c8a75a", 0, 0.2, 0.85, 0.12);
  head.rotation.x = Math.PI / 2;
  for (const z of [0.62, 0.72]) {
    const band = add(g, new TorusGeometry(0.085, 0.022, 6, 12), "#5a4a32", 0, 0.2, z, 0.14);
    band.rotation.y = Math.PI / 2;
  }
  return g;
});
