/**
 * Procedural fallbacks keyed by a manifest entry's `placeholder` field. Used whenever an
 * asset's `src` is missing, 404s, or fails to parse — so the game never breaks on art.
 *
 * Builders are registries: a lane can add `registerMeshPlaceholder("my-key", fn)` additively.
 * All placeholder geometry follows the same size/pivot/orientation contract as the real
 * asset described in the entry's `spec`.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
  SphereGeometry,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import type { AssetEntry } from "./manifest";
import { Rng, hash32 } from "../core/rng";
import brand from "../brand/brand.json";

export interface PlaceholderCtx {
  entry: AssetEntry;
  /** Resolve another texture id (real file or its placeholder). */
  getTexture(id: string): Texture | null;
}

export type MeshBuilder = (ctx: PlaceholderCtx) => Object3D;
export type TextureBuilder = (entry: AssetEntry) => Texture;
export type SpriteBuilder = (entry: AssetEntry) => string;
export type SfxBuilder = (ac: BaseAudioContext, entry: AssetEntry) => AudioBuffer;

const meshBuilders = new Map<string, MeshBuilder>();
const textureBuilders = new Map<string, TextureBuilder>();
const spriteBuilders = new Map<string, SpriteBuilder>();
const sfxBuilders = new Map<string, SfxBuilder>();

export const registerMeshPlaceholder = (k: string, f: MeshBuilder) => void meshBuilders.set(k, f);
export const registerTexturePlaceholder = (k: string, f: TextureBuilder) => void textureBuilders.set(k, f);
export const registerSpritePlaceholder = (k: string, f: SpriteBuilder) => void spriteBuilders.set(k, f);
export const registerSfxPlaceholder = (k: string, f: SfxBuilder) => void sfxBuilders.set(k, f);

export function hasPlaceholder(kind: "mesh" | "texture" | "sprite" | "sfx", key: string): boolean {
  const m = { mesh: meshBuilders, texture: textureBuilders, sprite: spriteBuilders, sfx: sfxBuilders }[kind];
  return m.has(key);
}

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return hash32(h);
}

// ---------------------------------------------------------------- meshes

const lambert = (color: string | number, extra: Partial<MeshLambertMaterial> = {}): MeshLambertMaterial => {
  const m = new MeshLambertMaterial({ color });
  Object.assign(m, extra);
  return m;
};

function box(w: number, h: number, d: number, mat: Material, x = 0, y = 0, z = 0, name = "", segZ = 1): Mesh {
  const g = new BoxGeometry(w, h, d, 1, 1, segZ);
  const m = new Mesh(g, mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}

interface HumanoidOpts {
  height: number;
  shirt: string;
  pants: string;
  skin: string;
  accent: string;
  bulk: number;
  hat: boolean;
}

/**
 * Articulated greybox humanoid. Named nodes (used by PlayerAnimator):
 * body, hips, torso, head, armL, armR, legL, legR, ball.
 * Origin at feet centre, faces -Z (backpack on +Z so the camera sees the back).
 */
function humanoid(o: HumanoidOpts): Group {
  const s = o.height / 1.7;
  const root = new Group();
  const body = new Group();
  body.name = "body";
  root.add(body);

  const shirt = lambert(o.shirt);
  const pants = lambert(o.pants);
  const skin = lambert(o.skin);
  const accent = lambert(o.accent);

  const hipY = 0.86 * s;
  const hips = new Group();
  hips.name = "hips";
  hips.position.y = hipY;
  body.add(hips);

  const torso = new Group();
  torso.name = "torso";
  hips.add(torso);
  torso.add(box(0.46 * s * o.bulk, 0.56 * s, 0.28 * s * o.bulk, shirt, 0, 0.3 * s, 0));
  torso.add(box(0.34 * s, 0.36 * s, 0.14 * s, accent, 0, 0.32 * s, 0.2 * s * o.bulk, "pack"));

  const head = new Group();
  head.name = "head";
  head.position.y = 0.7 * s;
  torso.add(head);
  const headMesh = new Mesh(new SphereGeometry(0.155 * s, 14, 10), skin);
  headMesh.position.y = 0.0;
  head.add(headMesh);
  if (o.hat) {
    head.add(box(0.34 * s, 0.1 * s, 0.34 * s, accent, 0, 0.13 * s, 0));
    head.add(box(0.3 * s, 0.03 * s, 0.16 * s, accent, 0, 0.09 * s, -0.2 * s));
  } else {
    head.add(box(0.32 * s, 0.08 * s, 0.32 * s, accent, 0, 0.12 * s, 0.01 * s));
  }

  const limb = (name: string, x: number, y: number, len: number, w: number, mat: Material, parent: Object3D) => {
    const pivot = new Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    const mesh = box(w, len, w, mat, 0, -len / 2, 0);
    pivot.add(mesh);
    parent.add(pivot);
    return pivot;
  };
  limb("armL", -0.3 * s * o.bulk, 0.55 * s, 0.58 * s, 0.12 * s, shirt, torso);
  limb("armR", 0.3 * s * o.bulk, 0.55 * s, 0.58 * s, 0.12 * s, shirt, torso);
  limb("legL", -0.12 * s, 0.0, hipY, 0.17 * s, pants, hips);
  limb("legR", 0.12 * s, 0.0, hipY, 0.17 * s, pants, hips);

  const ball = new Mesh(new SphereGeometry(0.42 * s, 16, 12), shirt);
  ball.name = "ball";
  ball.position.y = 0.42 * s;
  ball.visible = false;
  const stripe = box(0.86 * s, 0.14 * s, 0.14 * s, accent, 0, 0, 0);
  ball.add(stripe);
  root.add(ball);
  return root;
}

registerMeshPlaceholder("capsule-runner", ({ entry }) =>
  humanoid({ height: 1.7, shirt: entry.color ?? "#ff7a1a", pants: "#2b3a55", skin: "#e0b089", accent: "#2fc4b2", bulk: 1, hat: false }),
);

registerMeshPlaceholder("capsule-chaser", ({ entry }) =>
  humanoid({ height: 1.85, shirt: entry.color ?? "#3d5a80", pants: "#1e2a3a", skin: "#c99873", accent: "#f2c14e", bulk: 1.2, hat: true }),
);

registerMeshPlaceholder("rail", ({ entry }) => {
  const g = new Group();
  g.add(box(0.07, 0.12, 1, lambert(entry.color ?? "#b9bec6"), 0, 0.06, 0));
  return g;
});

registerMeshPlaceholder("sleeper", ({ entry }) => {
  const g = new Group();
  g.add(box(2.3, 0.12, 0.24, lambert(entry.color ?? "#5b4636"), 0, 0.06, 0));
  return g;
});

registerMeshPlaceholder("building-block", ({ entry, getTexture }) => {
  const map = entry.maps?.map ? getTexture(entry.maps.map) : null;
  const g = new Group();
  g.add(box(1, 1, 1, lambert(map ? "#ffffff" : entry.color ?? "#9aa5b1", { map }), 0, 0.5, 0, "block", 2));
  return g;
});

registerMeshPlaceholder("barrier-low", ({ entry, getTexture }) => {
  const g = new Group();
  const post = lambert("#3b4252");
  const map = entry.maps?.map ? getTexture(entry.maps.map) : null;
  const plank = lambert(map ? "#ffffff" : entry.color ?? "#f2f2f2", { map });
  g.add(box(0.14, 1.12, 0.14, post, -1.05, 0.56, 0));
  g.add(box(0.14, 1.12, 0.14, post, 1.05, 0.56, 0));
  g.add(box(2.2, 0.5, 0.12, plank, 0, 0.8, 0, "plank"));
  g.add(box(2.0, 0.06, 0.3, post, 0, 0.03, 0)); // foot rail for grounding
  return g;
});

registerMeshPlaceholder("train-car", ({ entry, getTexture }) => {
  const g = new Group();
  const map = entry.maps?.map ? getTexture(entry.maps.map) : null;
  const bodyMat = lambert(map ? "#ffffff" : entry.color ?? "#2d6cdf", { map });
  const roof = lambert("#c9ced6");
  const under = lambert("#23262d");
  const face = lambert(entry.color ? shade(entry.color, -0.12) : "#23508f");
  const rear = lambert("#3a4150");
  const glass = lambert("#9fd3f0");
  const len = 13;
  g.add(box(2.3, 2.9, len, bodyMat, 0, 0.5 + 1.45, 0, "car", 8));
  g.add(box(2.1, 0.2, len - 0.2, roof, 0, 3.5, 0, "roof", 8));
  g.add(box(1.9, 0.5, len - 1.5, under, 0, 0.25, 0, "bogies", 4));
  // Cab end faces +Z — toward the approaching runner and camera — so it reads at a glance.
  g.add(box(2.32, 2.9, 0.05, face, 0, 1.95, len / 2 + 0.02, "cab"));
  g.add(box(1.7, 0.8, 0.05, glass, 0, 2.6, len / 2 + 0.05));
  g.add(box(2.2, 0.12, 0.06, lambert("#f2c14e"), 0, 1.55, len / 2 + 0.05));
  const lamp = lambert("#fff3b0", { emissive: new Color("#fff3b0") });
  g.add(box(0.3, 0.18, 0.06, lamp, -0.7, 1.2, len / 2 + 0.06));
  g.add(box(0.3, 0.18, 0.06, lamp, 0.7, 1.2, len / 2 + 0.06));
  g.add(box(2.32, 2.9, 0.05, rear, 0, 1.95, -len / 2 - 0.02));
  return g;
});

registerMeshPlaceholder("coin", ({ entry }) => {
  const geo = new CylinderGeometry(0.35, 0.35, 0.08, 20, 1);
  geo.rotateX(Math.PI / 2); // disc faces -Z / +Z
  const mat = lambert(entry.color ?? "#ffc83d", { emissive: new Color("#8a5a00") });
  const g = new Group();
  g.add(new Mesh(geo, mat));
  return g;
});

registerMeshPlaceholder("missing", () => {
  const g = new Group();
  g.add(box(1, 1, 1, lambert("#ff00ff"), 0, 0.5, 0));
  return g;
});

export function buildMeshPlaceholder(ctx: PlaceholderCtx): Object3D {
  const key = ctx.entry.placeholder ?? "missing";
  const f = meshBuilders.get(key) ?? meshBuilders.get("missing")!;
  const obj = f(ctx);
  obj.userData.placeholder = key;
  return obj;
}

// ---------------------------------------------------------------- textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finishTexture(c: HTMLCanvasElement, entry: AssetEntry, srgbDefault = true): Texture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = (entry.srgb ?? srgbDefault) ? SRGBColorSpace : NoColorSpace;
  if (entry.repeat) t.repeat.set(entry.repeat[0], entry.repeat[1]);
  t.anisotropy = 4;
  return t;
}

function shade(hex: string, amt: number): string {
  const c = new Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

function speckle(entry: AssetEntry, base: string, n: number, sizeMin: number, sizeMax: number, spread: number): Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const rng = new Rng(strHash(entry.id));
  for (let i = 0; i < n; i++) {
    g.fillStyle = shade(base, rng.range(-spread, spread));
    const s = rng.range(sizeMin, sizeMax);
    const x = rng.range(0, 256);
    const y = rng.range(0, 256);
    // draw wrapped so the tile is seamless
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) g.fillRect(x + ox, y + oy, s, s * rng.range(0.6, 1.2));
  }
  return finishTexture(c, entry);
}

registerTexturePlaceholder("gravel", (e) => speckle(e, e.color ?? "#8a8174", 2600, 2, 6, 0.12));
registerTexturePlaceholder("dirt", (e) => speckle(e, e.color ?? "#6f7a5a", 900, 4, 18, 0.06));

registerTexturePlaceholder("wall-panels", (e) => {
  const [c, g] = canvas(256, 256);
  const base = e.color ?? "#9aa5b1";
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = shade(base, x % 32 === 0 ? -0.06 : 0.04);
    g.fillRect(x, 0, 8, 256);
  }
  g.fillStyle = shade(base, -0.18);
  g.fillRect(0, 0, 256, 10);
  g.fillStyle = "rgba(20,26,40,0.55)";
  for (let y = 60; y < 256; y += 96) for (let x = 20; x < 256; x += 64) g.fillRect(x, y, 34, 22);
  return finishTexture(c, e);
});

registerTexturePlaceholder("hazard-stripes", (e) => {
  const [c, g] = canvas(256, 64);
  g.fillStyle = "#f4f4f4";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = e.color ?? "#e5484d";
  for (let x = -64; x < 320; x += 48) {
    g.beginPath();
    g.moveTo(x, 64);
    g.lineTo(x + 24, 64);
    g.lineTo(x + 24 + 64, 0);
    g.lineTo(x + 64, 0);
    g.closePath();
    g.fill();
  }
  return finishTexture(c, e);
});

registerTexturePlaceholder("train-side", (e) => {
  const [c, g] = canvas(512, 256);
  const base = e.color ?? "#2d6cdf";
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = shade(base, 0.15);
  g.fillRect(0, 170, 512, 18);
  g.fillStyle = "#1b2233";
  for (let x = 24; x < 512; x += 62) g.fillRect(x, 50, 40, 60);
  g.fillStyle = shade(base, -0.15);
  g.fillRect(230, 40, 52, 170);
  return finishTexture(c, e);
});

registerTexturePlaceholder("radial-shadow", (e) => {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = finishTexture(c, e, false);
  t.wrapS = t.wrapT = 1001; // ClampToEdgeWrapping
  return t;
});

registerTexturePlaceholder("checker", (e) => {
  const [c, g] = canvas(64, 64);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? "#ff00ff" : "#222";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  return finishTexture(c, e);
});

export function buildTexturePlaceholder(entry: AssetEntry): Texture {
  const key = entry.placeholder ?? "checker";
  const t = (textureBuilders.get(key) ?? textureBuilders.get("checker")!)(entry);
  t.userData.placeholder = key;
  return t;
}

// ---------------------------------------------------------------- sprites (UI)

const svg = (body: string, view = "0 0 64 64") =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${body}</svg>`)}`;

registerSpritePlaceholder("icon-coin", (e) =>
  svg(`<circle cx="32" cy="32" r="27" fill="${e.color ?? "#ffc83d"}" stroke="#b07a00" stroke-width="5"/><rect x="27" y="17" width="10" height="30" rx="4" fill="#fff3c4"/>`),
);
registerSpritePlaceholder("icon-pause", () => svg(`<rect x="15" y="12" width="12" height="40" rx="4" fill="#fff"/><rect x="37" y="12" width="12" height="40" rx="4" fill="#fff"/>`));
registerSpritePlaceholder("icon-play", () => svg(`<path d="M20 12 L52 32 L20 52 Z" fill="#fff" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>`));
registerSpritePlaceholder("icon-home", () =>
  svg(`<path d="M10 32 L32 12 L54 32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><rect x="19" y="30" width="26" height="22" rx="3" fill="#fff"/>`),
);
registerSpritePlaceholder("icon-trophy", (e) =>
  svg(`<path d="M18 10 H46 V26 A14 14 0 0 1 18 26 Z" fill="${e.color ?? "#ffc83d"}"/><rect x="28" y="38" width="8" height="10" fill="${e.color ?? "#ffc83d"}"/><rect x="18" y="48" width="28" height="7" rx="3" fill="${e.color ?? "#ffc83d"}"/>`),
);
registerSpritePlaceholder("wordmark", () =>
  svg(
    `<text x="200" y="90" text-anchor="middle" textLength="370" lengthAdjust="spacingAndGlyphs" font-family="Arial Rounded MT Bold, Arial Black, sans-serif" font-weight="900" font-size="72" fill="${brand.palette.primary}" stroke="${brand.palette.ink}" stroke-width="10" paint-order="stroke">${brand.name.toUpperCase()}</text>`,
    "0 0 400 130",
  ),
);
registerSpritePlaceholder("square", () => svg(`<rect x="8" y="8" width="48" height="48" rx="10" fill="#ff00ff"/>`));

export function buildSpritePlaceholder(entry: AssetEntry): string {
  const key = entry.placeholder ?? "square";
  return (spriteBuilders.get(key) ?? spriteBuilders.get("square")!)(entry);
}

// ---------------------------------------------------------------- sfx (synthesised)

type SampleFn = (t: number, i: number, noise: () => number) => number;

function synth(ac: BaseAudioContext, seconds: number, fn: SampleFn, seed: number): AudioBuffer {
  const sr = ac.sampleRate;
  const n = Math.max(1, Math.floor(seconds * sr));
  const buf = ac.createBuffer(1, n, sr);
  const data = buf.getChannelData(0);
  const rng = new Rng(seed);
  const noise = () => rng.next() * 2 - 1;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = fn(i / sr, i, noise);
    data[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak > 0) for (let i = 0; i < n; i++) data[i] *= 0.7 / peak;
  // 4 ms fade-out to avoid clicks
  const fade = Math.min(n, Math.floor(0.004 * sr));
  for (let i = 0; i < fade; i++) data[n - 1 - i] *= i / fade;
  return buf;
}

const TAU = Math.PI * 2;
const env = (t: number, attack: number, decay: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

registerSfxPlaceholder("synth-coin", (ac) =>
  synth(ac, 0.18, (t) => {
    const f = t < 0.05 ? 988 : 1319;
    return Math.sin(TAU * f * t) * env(t, 0.003, 0.06) + 0.3 * Math.sin(TAU * f * 2 * t) * env(t, 0.003, 0.03);
  }, 1),
);
registerSfxPlaceholder("synth-jump", (ac) =>
  synth(ac, 0.22, (t) => {
    const f = 280 + 900 * t;
    return Math.sin(TAU * f * t) * env(t, 0.01, 0.08);
  }, 2),
);
registerSfxPlaceholder("synth-land", (ac) => {
  let lp = 0;
  return synth(ac, 0.12, (t, _i, noise) => {
    lp += (noise() - lp) * 0.08;
    return (lp * 2 + 0.6 * Math.sin(TAU * 90 * t)) * env(t, 0.002, 0.03);
  }, 3);
});
registerSfxPlaceholder("synth-roll", (ac) => {
  let lp = 0;
  return synth(ac, 0.3, (t, _i, noise) => {
    const k = 0.02 + 0.25 * (1 - t / 0.3);
    lp += (noise() - lp) * k;
    return lp * env(t, 0.03, 0.1);
  }, 4);
});
registerSfxPlaceholder("synth-swipe", (ac) => {
  let lp = 0;
  return synth(ac, 0.14, (t, _i, noise) => {
    lp += (noise() - lp) * (0.05 + 0.4 * (t / 0.14));
    return lp * env(t, 0.02, 0.04);
  }, 5);
});
registerSfxPlaceholder("synth-crash", (ac) => {
  let lp = 0;
  return synth(ac, 0.6, (t, _i, noise) => {
    lp += (noise() - lp) * 0.3;
    return (lp + 0.8 * Math.sin(TAU * (70 - 30 * t) * t)) * env(t, 0.002, 0.16);
  }, 6);
});
registerSfxPlaceholder("synth-tap", (ac) => synth(ac, 0.06, (t) => Math.sin(TAU * 1250 * t) * env(t, 0.001, 0.015), 7));
registerSfxPlaceholder("synth-blip", (ac) => synth(ac, 0.1, (t) => Math.sin(TAU * 660 * t) * env(t, 0.002, 0.03), 8));
registerSfxPlaceholder("synth-powerup", (ac) =>
  synth(ac, 0.36, (t) => {
    const notes = [523, 659, 784, 1047];
    const k = Math.min(notes.length - 1, Math.floor(t / 0.07));
    const lt = t - k * 0.07;
    return Math.sin(TAU * notes[k] * t) * env(lt, 0.003, 0.08) + 0.25 * Math.sin(TAU * notes[k] * 2 * t) * env(lt, 0.003, 0.04);
  }, 9),
);
registerSfxPlaceholder("synth-stumble", (ac) => {
  let lp = 0;
  return synth(ac, 0.26, (t, _i, noise) => {
    lp += (noise() - lp) * 0.12;
    return (lp * 1.4 + Math.sin(TAU * (120 - 160 * t) * t)) * env(t, 0.002, 0.07);
  }, 10);
});
registerSfxPlaceholder("synth-board", (ac) =>
  synth(ac, 0.45, (t) => {
    const f = 140 + 520 * (t / 0.45);
    return (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.5 * t)) * env(t, 0.04, 0.16);
  }, 11),
);
registerSfxPlaceholder("synth-mission", (ac) =>
  synth(ac, 0.46, (t) => {
    const f = t < 0.14 ? 880 : 1319;
    const lt = t < 0.14 ? t : t - 0.14;
    return Math.sin(TAU * f * t) * env(lt, 0.004, 0.11) + 0.3 * Math.sin(TAU * f * 3 * t) * env(lt, 0.004, 0.05);
  }, 12),
);
registerSfxPlaceholder("synth-key", (ac) =>
  synth(ac, 0.34, (t, _i, noise) => {
    const f = 1568 + 400 * Math.sin(TAU * 18 * t);
    return Math.sin(TAU * f * t) * env(t, 0.002, 0.09) + noise() * 0.08 * env(t, 0.001, 0.02);
  }, 13),
);

export function buildSfxPlaceholder(ac: BaseAudioContext, entry: AssetEntry): AudioBuffer {
  const key = entry.placeholder ?? "synth-blip";
  return (sfxBuilders.get(key) ?? sfxBuilders.get("synth-blip")!)(ac, entry);
}
