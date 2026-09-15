/**
 * Procedural placeholders for the obstacle kit and track structures. Each follows the size, pivot and
 * orientation contract written in its manifest `spec` (public/assets/manifest/track.json), so a real
 * model dropped at `src` replaces it with zero code changes.
 */
import { BoxGeometry, Color, Group, Mesh, MeshLambertMaterial, type Material, type Object3D } from "three";
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

/** Tall board on posts with an open gap below: reads as "roll under, cannot jump". */
registerMeshPlaceholder("barrier-high", ({ entry, getTexture }) => {
  const g = new Group();
  const post = mat("#3b4252");
  const map = entry.maps?.map ? getTexture(entry.maps.map) : null;
  const board = new MeshLambertMaterial({ color: map ? "#ffffff" : (entry.color ?? "#ffc83d"), map });
  box(g, 0.16, 3.45, 0.16, post, -1.08, 1.725, 0);
  box(g, 0.16, 3.45, 0.16, post, 1.08, 1.725, 0);
  box(g, 2.3, 2.3, 0.12, board, 0, 2.1, 0, "board");
  box(g, 2.36, 0.1, 0.18, post, 0, 0.95, 0);
  box(g, 0.34, 0.18, 0.34, post, -1.08, 0.09, 0);
  box(g, 0.34, 0.18, 0.34, post, 1.08, 0.09, 0);
  box(g, 0.22, 0.22, 0.22, mat("#ff4d4d", "#c21f1f"), 0, 3.4, 0, "beacon");
  return g;
});

/** Commuter car driving toward the runner; `cabFront` (windscreen + headlights) is hidden on trailing cars. */
registerMeshPlaceholder("train-oncoming", ({ entry, getTexture }) => {
  const g = new Group();
  const color = entry.color ?? "#d94a3d";
  const map = entry.maps?.map ? getTexture(entry.maps.map) : null;
  const body = new MeshLambertMaterial({ color: map ? "#ffffff" : color, map });
  const len = 13;
  box(g, 2.3, 2.9, len, body, 0, 1.95, 0, "car", 8);
  box(g, 2.1, 0.2, len - 0.2, mat("#c9ced6"), 0, 3.5, 0, "roof", 8);
  box(g, 1.9, 0.5, len - 1.5, mat("#23262d"), 0, 0.25, 0, "bogies", 4);
  box(g, 2.32, 0.18, len, mat("#f2f2f2"), 0, 1.45, 0, "stripe", 8);
  box(g, 2.32, 2.9, 0.05, mat("#3a4150"), 0, 1.95, -len / 2 - 0.02, "rear");
  const front = new Group();
  front.name = "cabFront";
  g.add(front);
  const face = mat(color);
  face.color.offsetHSL(0, 0, -0.1);
  box(front, 2.34, 2.9, 0.06, face, 0, 1.95, len / 2 + 0.03);
  box(front, 1.8, 0.9, 0.05, mat("#9fd3f0"), 0, 2.7, len / 2 + 0.07);
  const lamp = mat("#fffbe0", "#fff3b0");
  box(front, 0.4, 0.28, 0.06, lamp, -0.72, 1.1, len / 2 + 0.08, "headlightL");
  box(front, 0.4, 0.28, 0.06, lamp, 0.72, 1.1, len / 2 + 0.08, "headlightR");
  box(front, 2.3, 0.16, 0.08, mat("#f2f2f2"), 0, 1.6, len / 2 + 0.08);
  return g;
});

/** Ramp onto a train roof: 0 m at the near (+Z) end, roof height at the far (-Z) end. */
registerMeshPlaceholder("ramp", ({ entry }) => {
  const g = new Group();
  const L = 6.5;
  const H = 3.6;
  const slope = Math.hypot(L, H);
  const angle = Math.atan2(H, L);
  const wood = mat(entry.color ?? "#a0764b");
  const steel = mat("#50565f");
  const deck = box(g, 2.2, 0.16, slope, wood, 0, H / 2, 0, "deck", 6);
  deck.rotation.x = angle;
  for (const side of [-1, 1]) {
    const rail = box(g, 0.08, 0.28, slope, steel, side * 1.08, H / 2 + 0.2, 0, "", 6);
    rail.rotation.x = angle;
    box(g, 0.14, H, 0.14, steel, side * 0.9, H / 2, -L / 2 + 0.2);
    box(g, 0.14, H / 2, 0.14, steel, side * 0.9, H / 4, 0);
  }
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const slat = box(g, 2.2, 0.05, 0.12, steel, 0, H * t + 0.1, L / 2 - L * t);
    slat.rotation.x = angle;
  }
  return g;
});

/** Tunnel section spanning all lanes (ground plane at y = -0.45), portal on the +Z end. */
registerMeshPlaceholder("tunnel", ({ entry }) => {
  const g = new Group();
  const L = 30;
  const halfW = 5;
  const H = 6.2;
  const t = 0.7;
  const base = -0.45;
  const wall = mat(entry.color ?? "#6d737d");
  const dark = mat("#3c4048");
  for (const side of [-1, 1]) {
    box(g, t, H, L, wall, side * (halfW + t / 2), base + H / 2, 0, "", 10);
    box(g, 1.3, H + 1.6, 0.8, wall, side * (halfW + 0.65), base + (H + 1.6) / 2, L / 2 + 0.4);
    box(g, 0.1, 0.3, L, mat("#f2c14e", "#6b5310"), side * (halfW - 0.05), base + 3.2, 0, "", 10);
  }
  box(g, 2 * halfW + 2 * t, t, L, dark, 0, base + H + t / 2, 0, "roof", 10);
  box(g, 2 * halfW + 2.6, 1.6, 0.8, wall, 0, base + H + 0.8, L / 2 + 0.4, "portal");
  return g;
});

/** Light signal on a post; the engine shows one of `lampRed` / `lampGreen`. */
registerMeshPlaceholder("signal", () => {
  const g = new Group();
  box(g, 0.14, 4.2, 0.14, mat("#2b2f36"), 0, 2.1, 0);
  box(g, 0.5, 1.0, 0.4, mat("#1b1e24"), 0, 4.4, 0, "head");
  box(g, 0.28, 0.28, 0.06, mat("#ff4d4d", "#ff2a2a"), 0, 4.62, 0.22, "lampRed");
  box(g, 0.28, 0.28, 0.06, mat("#57e389", "#2ecc71"), 0, 4.18, 0.22, "lampGreen");
  return g;
});
