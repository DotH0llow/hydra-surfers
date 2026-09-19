/**
 * Procedural placeholders for the obstacle kit.
 *
 * Each follows the size, pivot and orientation contract written in its manifest `spec`
 * (public/assets/manifest/track.json), so a real model dropped at `src` replaces it with zero code
 * changes. Unlike the scenery, these are coloured for readability rather than tinted per region:
 * a player must recognise "jump this" and "roll under this" in a glance, in any biome, so the
 * silhouettes and the warm wood/iron palette stay constant everywhere.
 */
import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshLambertMaterial, type Material, type Object3D } from "three";
import { registerMeshPlaceholder } from "../../assets/placeholders";

const mat = (color: string, emissive?: string): MeshLambertMaterial => {
  const m = new MeshLambertMaterial({ color });
  if (emissive) m.emissive = new Color(emissive);
  return m;
};

function box(parent: Object3D, w: number, h: number, d: number, m: Material, x: number, y: number, z: number, name = "", segZ = 1): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d, 1, 1, segZ), m);
  mesh.position.set(x, y, z);
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function barrel(parent: Object3D, m: Material, x: number, y: number, z: number, r = 0.34, h = 0.78): Mesh {
  const mesh = new Mesh(new CylinderGeometry(r * 0.88, r * 0.88, h, 10), m);
  mesh.position.set(x, y, z);
  mesh.rotation.z = Math.PI / 2;
  parent.add(mesh);
  return mesh;
}

/** Barricade: crates and barrels roped together. Low enough to jump, gappy enough to roll through. */
registerMeshPlaceholder("barricade", ({ entry }) => {
  const g = new Group();
  const wood = mat(entry.color ?? "#a97c46");
  const dark = mat("#6d4f2c");
  const band = mat("#59504a");
  // trestle legs leave the roll gap under the load
  for (const side of [-1, 1]) {
    box(g, 0.16, 0.58, 0.16, dark, side * 0.95, 0.29, 0);
    box(g, 0.5, 0.12, 0.34, dark, side * 0.95, 0.06, 0);
  }
  box(g, 2.16, 0.12, 0.3, dark, 0, 0.6, 0);
  // crates on the plank
  box(g, 0.62, 0.58, 0.5, wood, -0.66, 0.92, 0);
  box(g, 0.54, 0.46, 0.46, wood, 0.02, 0.86, 0.02);
  box(g, 0.66, 0.5, 0.48, wood, 0.7, 0.88, -0.02);
  box(g, 0.66, 0.06, 0.5, band, -0.66, 0.92, 0.01);
  box(g, 0.7, 0.06, 0.49, band, 0.7, 0.88, -0.01);
  barrel(g, dark, 0.02, 1.16, 0.0, 0.22, 0.5);
  return g;
});

/**
 * Hole in a broken bridge: a plank deck over one lane with the middle fallen through to dark water.
 * The deck stays flat on the road (nothing to trip on); only the gap is the obstacle.
 */
registerMeshPlaceholder("hole", ({ entry }) => {
  const g = new Group();
  const plank = mat(entry.color ?? "#8a6238");
  const dark = mat("#5b3f22");
  const water = mat("#0f1c26", "#050a10");
  const gap = 2.4;
  const deck = 1.6;
  // decking before and after the gap, planks across the lane
  for (const side of [-1, 1]) {
    const z0 = side * (gap / 2 + deck / 2);
    box(g, 2.2, 0.08, deck, plank, 0, 0.04, z0);
    for (let k = 0; k < 4; k++) box(g, 2.22, 0.02, 0.04, dark, 0, 0.09, z0 - deck / 2 + 0.2 + k * 0.4);
    // splintered plank ends hanging over the edge
    box(g, 0.34, 0.06, 0.5, plank, -0.6, 0.03, side * (gap / 2 - 0.15));
    box(g, 0.28, 0.06, 0.34, plank, 0.55, 0.03, side * (gap / 2 - 0.1));
  }
  // the gap: dark water well below the deck line
  box(g, 2.2, 0.02, gap, water, 0, 0.012, 0);
  // two stringers still spanning the gap, too narrow to run on
  box(g, 0.12, 0.1, gap + 0.4, dark, -1.04, 0.05, 0);
  box(g, 0.12, 0.1, gap + 0.4, dark, 1.04, 0.05, 0);
  return g;
});

/** Hanging beam: a trunk slung from a gallows frame. Open underneath, impossible to clear. */
registerMeshPlaceholder("beam", ({ entry }) => {
  const g = new Group();
  const post = mat("#6d4f2c");
  const timber = mat(entry.color ?? "#9a6b3c");
  const rope = mat("#c8b38a");
  box(g, 0.2, 3.4, 0.2, post, -1.12, 1.7, 0);
  box(g, 0.2, 3.4, 0.2, post, 1.12, 1.7, 0);
  box(g, 2.6, 0.22, 0.24, post, 0, 3.35, 0);
  box(g, 0.4, 0.2, 0.4, post, -1.12, 0.1, 0);
  box(g, 0.4, 0.2, 0.4, post, 1.12, 0.1, 0);
  // the slung trunk: its underside is the roll clearance
  box(g, 0.08, 0.62, 0.08, rope, -0.72, 2.85, 0);
  box(g, 0.08, 0.62, 0.08, rope, 0.72, 2.85, 0);
  const trunk = new Mesh(new CylinderGeometry(0.3, 0.32, 2.3, 10), timber);
  trunk.rotation.z = Math.PI / 2;
  trunk.position.set(0, 2.3, 0);
  g.add(trunk);
  box(g, 0.9, 0.5, 0.06, mat("#c2a06a"), 0, 1.45, 0.16, "sign");
  return g;
});

/** Cargo wagon: high board sides, a plank roof to run along, iron-rimmed wheels. */
registerMeshPlaceholder("wagon", ({ entry }) => {
  const g = new Group();
  const len = 13;
  const body = mat(entry.color ?? "#8a5a30");
  const plank = mat("#a9793f");
  const dark = mat("#4f3a22");
  const iron = mat("#3d3a36");
  box(g, 2.2, 0.5, len - 0.6, dark, 0, 0.85, 0, "chassis", 6);
  for (const side of [-1, 1]) box(g, 0.14, 1.9, len - 0.8, body, side * 1.05, 2.1, 0, "", 6);
  box(g, 2.2, 1.9, 0.16, body, 0, 2.1, -len / 2 + 0.2);
  box(g, 2.2, 1.9, 0.16, body, 0, 2.1, len / 2 - 0.2);
  box(g, 2.3, 0.18, len - 0.4, plank, 0, 3.5, 0, "roof", 8);
  for (const side of [-1, 1]) box(g, 0.1, 0.22, len - 0.6, dark, side * 1.1, 3.62, 0, "", 6);
  // wheels
  for (const z of [-len / 2 + 2, -0.5, len / 2 - 2.4]) {
    for (const side of [-1, 1]) {
      const w = new Mesh(new CylinderGeometry(0.62, 0.62, 0.16, 12), iron);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * 1.12, 0.62, z);
      g.add(w);
    }
  }
  box(g, 0.9, 0.5, 0.5, dark, 0, 1.2, len / 2 + 0.1);
  return g;
});

/** Runaway cart: the same footprint, pulled by two horses in a `harness` node the engine hides. */
registerMeshPlaceholder("cart-runaway", ({ entry }) => {
  const g = new Group();
  const len = 13;
  const body = mat(entry.color ?? "#7a3f34");
  const dark = mat("#42291d");
  const iron = mat("#3d3a36");
  box(g, 2.2, 0.5, len - 3.6, dark, 0, 0.9, -1.4, "chassis", 5);
  for (const side of [-1, 1]) box(g, 0.14, 1.5, len - 3.8, body, side * 1.05, 1.9, -1.4, "", 5);
  box(g, 2.2, 1.5, 0.16, body, 0, 1.9, -len / 2 + 0.2);
  box(g, 2.3, 0.18, len - 3.4, mat("#9a6a44"), 0, 3.5, -1.4, "roof", 6);
  for (const z of [-len / 2 + 1.6, -2.6]) {
    for (const side of [-1, 1]) {
      const w = new Mesh(new CylinderGeometry(0.66, 0.66, 0.16, 12), iron);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * 1.12, 0.66, z);
      g.add(w);
    }
  }
  // harness: shaft, yoke and a pair of horses at the +Z end (toward the runner)
  const harness = new Group();
  harness.name = "harness";
  g.add(harness);
  const hide = mat("#4a3428");
  const hideDark = mat("#33231a");
  box(harness, 0.14, 0.14, 2.6, dark, -0.6, 1, len / 2 - 3.4);
  box(harness, 0.14, 0.14, 2.6, dark, 0.6, 1, len / 2 - 3.4);
  for (const side of [-1, 1]) {
    const hx = side * 0.62;
    const hz = len / 2 - 1.5;
    box(harness, 0.78, 1.05, 2.1, hide, hx, 1.55, hz, "", 3);
    box(harness, 0.5, 0.62, 0.55, hide, hx, 2.15, hz + 1.2);
    box(harness, 0.4, 0.5, 0.42, hideDark, hx, 2.42, hz + 1.5);
    box(harness, 0.46, 0.2, 0.2, hideDark, hx, 2.2, hz + 1.72);
    for (const lz of [hz - 0.7, hz + 0.7]) {
      for (const ls of [-1, 1]) box(harness, 0.18, 1.1, 0.18, hideDark, hx + ls * 0.26, 0.55, lz);
    }
  }
  return g;
});

/** Ramp: hay bales and planks rising to a wagon roof (0 m at the +Z end, roof height at -Z). */
registerMeshPlaceholder("ramp", ({ entry }) => {
  const g = new Group();
  const L = 6.5;
  const H = 3.6;
  const slope = Math.hypot(L, H);
  const angle = Math.atan2(H, L);
  const plank = mat(entry.color ?? "#b08a4a");
  const hay = mat("#c8a24e");
  const rope = mat("#6d5a3a");
  const deck = box(g, 2.2, 0.18, slope, plank, 0, H / 2, 0, "deck", 6);
  deck.rotation.x = angle;
  // hay bales stacked under the planks, biggest at the high end
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    box(g, 1.9 - t * 0.3, 0.7, 1.3, hay, 0, 0.35 + H * t * 0.78, L / 2 - 0.9 - i * 1.55);
  }
  for (const side of [-1, 1]) {
    const rail = box(g, 0.1, 0.2, slope, rope, side * 1.06, H / 2 + 0.2, 0, "", 6);
    rail.rotation.x = angle;
  }
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const slat = box(g, 2.2, 0.06, 0.14, rope, 0, H * t + 0.11, L / 2 - L * t);
    slat.rotation.x = angle;
  }
  return g;
});

/** Gatehouse: a stone passage over all three lanes, torches burning along the inside. */
registerMeshPlaceholder("gate", ({ entry }) => {
  const g = new Group();
  const L = 30;
  const halfW = 5;
  const H = 6.2;
  const t = 0.7;
  const base = -0.45;
  const stone = mat(entry.color ?? "#8d8a80");
  const dark = mat("#4e4a44");
  const fire = mat("#ffb648", "#ff9a2e");
  for (const side of [-1, 1]) {
    box(g, t, H, L, stone, side * (halfW + t / 2), base + H / 2, 0, "", 10);
    // buttresses at the portal end
    box(g, 1.4, H + 1.8, 0.9, stone, side * (halfW + 0.7), base + (H + 1.8) / 2, L / 2 + 0.45);
    for (let i = -4; i <= 4; i += 2) {
      box(g, 0.34, 0.5, 0.34, dark, side * (halfW - 0.2), base + 3.4, i * 2.6);
      const flame = new Mesh(new CylinderGeometry(0.01, 0.14, 0.4, 6), fire);
      flame.position.set(side * (halfW - 0.2), base + 3.85, i * 2.6);
      g.add(flame);
    }
  }
  box(g, 2 * halfW + 2 * t, t, L, dark, 0, base + H + t / 2, 0, "roof", 10);
  box(g, 2 * halfW + 2.8, 1.8, 0.9, stone, 0, base + H + 0.9, L / 2 + 0.45, "portal");
  for (let i = -4; i <= 4; i++) box(g, 0.7, 0.8, 0.7, stone, i * 1.25, base + H + 2.2, L / 2 + 0.45);
  return g;
});

/** Lantern post: `lampWarn` (red) when a wagon blocks that lane, `lampCalm` (amber) otherwise. */
registerMeshPlaceholder("lantern", () => {
  const g = new Group();
  const iron = mat("#3b352e");
  box(g, 0.14, 4, 0.14, iron, 0, 2, 0);
  box(g, 0.5, 0.16, 0.5, iron, 0, 4.1, 0);
  box(g, 0.36, 0.5, 0.36, iron, 0, 4.4, 0, "housing");
  box(g, 0.26, 0.34, 0.06, mat("#ff5a4d", "#d02a1e"), 0, 4.4, 0.19, "lampWarn");
  box(g, 0.26, 0.34, 0.06, mat("#ffcf7a", "#ff9a2e"), 0, 4.4, 0.19, "lampCalm");
  box(g, 0.24, 0.16, 0.24, iron, 0, 4.72, 0);
  return g;
});
