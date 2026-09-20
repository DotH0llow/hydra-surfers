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
  ConeGeometry,
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

type Headgear = "none" | "helm" | "hood" | "wizard" | "cap" | "crown" | "circlet";
type BackItem = "none" | "pack" | "quiver" | "shield" | "lute" | "satchel";

interface HumanoidOpts {
  height: number;
  shirt: string;
  pants: string;
  skin: string;
  accent: string;
  bulk: number;
  /** What the archetype wears on its head. */
  headgear: Headgear;
  /** What it carries on its back (the camera sees the back all run long). */
  back: BackItem;
  /** Cloak colour, or null for none. */
  cape: string | null;
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
  // belt, so the silhouette has a waist at a glance
  torso.add(box(0.48 * s * o.bulk, 0.09 * s, 0.3 * s * o.bulk, pants, 0, 0.06 * s, 0));

  // back item: the camera looks at the runner's back for the whole run, so this is the read
  const backZ = 0.2 * s * o.bulk;
  switch (o.back) {
    case "quiver": {
      const q = box(0.14 * s, 0.5 * s, 0.14 * s, accent, 0.1 * s, 0.34 * s, backZ, "pack");
      q.rotation.x = 0.3;
      q.rotation.z = -0.35;
      for (let i = 0; i < 3; i++) torso.add(box(0.02 * s, 0.2 * s, 0.02 * s, lambert("#d8cbb0"), (0.06 + i * 0.04) * s, 0.62 * s, backZ + 0.02 * s));
      torso.add(q);
      break;
    }
    case "shield": {
      const sh = box(0.42 * s, 0.5 * s, 0.09 * s, accent, 0, 0.34 * s, backZ + 0.03 * s, "pack");
      torso.add(sh);
      torso.add(box(0.1 * s, 0.44 * s, 0.03 * s, lambert("#e8e2d4"), 0, 0.34 * s, backZ + 0.09 * s));
      break;
    }
    case "lute": {
      const body = new Mesh(new SphereGeometry(0.19 * s, 10, 8), accent);
      body.scale.set(1, 1.15, 0.5);
      body.position.set(-0.05 * s, 0.3 * s, backZ + 0.04 * s);
      body.name = "pack";
      torso.add(body);
      const neck = box(0.05 * s, 0.42 * s, 0.05 * s, lambert("#6b4a2a"), 0.08 * s, 0.6 * s, backZ + 0.02 * s);
      neck.rotation.z = -0.4;
      torso.add(neck);
      break;
    }
    case "satchel": {
      const bag = box(0.3 * s, 0.26 * s, 0.16 * s, accent, 0, 0.2 * s, backZ, "pack");
      torso.add(bag);
      torso.add(box(0.07 * s, 0.5 * s, 0.05 * s, lambert("#6b5a3a"), 0.12 * s, 0.42 * s, backZ - 0.04 * s));
      break;
    }
    case "pack":
      torso.add(box(0.34 * s, 0.36 * s, 0.14 * s, accent, 0, 0.32 * s, backZ, "pack"));
      break;
    default:
      break;
  }

  if (o.cape) {
    const cape = box(0.44 * s * o.bulk, 0.7 * s, 0.05 * s, lambert(o.cape), 0, 0.28 * s, backZ + 0.04 * s, "cape");
    cape.rotation.x = -0.08;
    torso.add(cape);
  }

  const head = new Group();
  head.name = "head";
  head.position.y = 0.7 * s;
  torso.add(head);
  const headMesh = new Mesh(new SphereGeometry(0.155 * s, 14, 10), skin);
  headMesh.position.y = 0.0;
  head.add(headMesh);
  const steel = lambert("#b9bec6");
  switch (o.headgear) {
    case "helm": {
      const dome = new Mesh(new SphereGeometry(0.175 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      dome.position.y = 0.02 * s;
      head.add(dome);
      head.add(box(0.36 * s, 0.07 * s, 0.36 * s, steel, 0, 0.02 * s, 0));
      head.add(box(0.06 * s, 0.2 * s, 0.2 * s, steel, 0, -0.04 * s, -0.14 * s)); // nasal bar
      head.add(box(0.1 * s, 0.22 * s, 0.1 * s, accent, 0, 0.2 * s, 0)); // crest
      break;
    }
    case "hood": {
      const hood = new Mesh(new SphereGeometry(0.2 * s, 12, 9), accent);
      hood.scale.set(1, 0.95, 1.1);
      hood.position.set(0, 0.02 * s, 0.03 * s);
      head.add(hood);
      head.add(box(0.26 * s, 0.24 * s, 0.06 * s, lambert("#1d1a17"), 0, -0.01 * s, -0.16 * s)); // shadowed face
      break;
    }
    case "wizard": {
      const hat = new Mesh(new ConeGeometry(0.22 * s, 0.5 * s, 9), accent);
      hat.position.y = 0.3 * s;
      hat.rotation.z = 0.12;
      head.add(hat);
      head.add(box(0.44 * s, 0.04 * s, 0.44 * s, accent, 0, 0.1 * s, 0));
      break;
    }
    case "cap":
      head.add(box(0.33 * s, 0.11 * s, 0.33 * s, accent, 0, 0.13 * s, 0));
      head.add(box(0.3 * s, 0.04 * s, 0.18 * s, accent, 0, 0.09 * s, -0.2 * s));
      break;
    case "crown":
      head.add(box(0.33 * s, 0.09 * s, 0.33 * s, lambert("#e8c25a"), 0, 0.15 * s, 0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        head.add(box(0.05 * s, 0.1 * s, 0.05 * s, lambert("#e8c25a"), Math.cos(a) * 0.13 * s, 0.23 * s, Math.sin(a) * 0.13 * s));
      }
      break;
    case "circlet":
      head.add(box(0.33 * s, 0.05 * s, 0.33 * s, lambert("#cfae6a"), 0, 0.14 * s, 0));
      break;
    default:
      head.add(box(0.32 * s, 0.08 * s, 0.32 * s, accent, 0, 0.12 * s, 0.01 * s));
      break;
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

/**
 * Playable archetypes. The silhouette (headgear, back item, cloak, bulk) comes from the manifest
 * entry's `meta`, so a new character is a manifest entry with no code change at all.
 */
registerMeshPlaceholder("runner", ({ entry }) => {
  const meta = (entry.meta ?? {}) as Record<string, unknown>;
  const str = (k: string, fallback: string): string => (typeof meta[k] === "string" ? (meta[k] as string) : fallback);
  const num = (k: string, fallback: number): number => (typeof meta[k] === "number" ? (meta[k] as number) : fallback);
  return humanoid({
    height: num("height", 1.7),
    shirt: entry.color ?? "#9a6b3c",
    pants: str("pants", "#4a3a2a"),
    skin: str("skin", "#e0b089"),
    accent: str("accent", "#2f6b4f"),
    bulk: num("bulk", 1),
    headgear: str("headgear", "none") as Headgear,
    back: str("back", "pack") as BackItem,
    cape: typeof meta.cape === "string" ? (meta.cape as string) : null,
  });
});

/** The royal guard giving chase: heavier, helmed, tabard over mail. */
registerMeshPlaceholder("guard", ({ entry }) =>
  humanoid({
    height: 1.85,
    shirt: entry.color ?? "#8d3b46",
    pants: "#3a3a42",
    skin: "#c99873",
    accent: "#c9a227",
    bulk: 1.25,
    headgear: "helm",
    back: "none",
    cape: "#8d3b46",
  }),
);

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

/** Packed earth and grass tufts: the field either side of the road. */
registerTexturePlaceholder("field", (e) => speckle(e, e.color ?? "#6f7a5a", 1100, 4, 18, 0.07));

/** Cobbles: offset rows of rounded stones with dark mortar between them. */
registerTexturePlaceholder("cobble", (e) => {
  const [c, g] = canvas(256, 256);
  const base = e.color ?? "#9a8b73";
  g.fillStyle = shade(base, -0.22);
  g.fillRect(0, 0, 256, 256);
  const rng = new Rng(strHash(e.id));
  const rows = 8;
  const cols = 8;
  const h = 256 / rows;
  const w = 256 / cols;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (w / 2);
    for (let i = -1; i <= cols; i++) {
      const x = i * w + offset + rng.range(-1.5, 1.5);
      const y = r * h + rng.range(-1.5, 1.5);
      g.fillStyle = shade(base, rng.range(-0.09, 0.09));
      const pad = rng.range(1.5, 3);
      const rad = Math.min(w, h) * 0.32;
      g.beginPath();
      // rounded stone, drawn wrapped so the tile stays seamless
      for (const ox of [-256, 0, 256]) {
        g.roundRect(x + pad + ox, y + pad, w - pad * 2, h - pad * 2, rad);
      }
      g.fill();
    }
  }
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
/** 8-bar loop at 128 BPM: kick, offbeat hats, bass line and an arpeggio over Am-F-C-G. */
registerSfxPlaceholder("synth-music", (ac) => {
  const beat = 60 / 128;
  const bar = beat * 4;
  const roots = [110, 87.31, 130.81, 98];
  const arp = [1, 1.5, 2, 2.5198, 2, 1.5, 3, 2];
  let hp = 0;
  let lastNoise = 0;
  return synth(
    ac,
    bar * 8,
    (t, _i, noise) => {
      const b = Math.floor(t / bar);
      const root = roots[b % 4];
      const inBeat = t % beat;
      const eighth = beat / 2;
      const inEighth = t % eighth;
      const step = Math.floor(t / eighth) % 8;
      const kick = Math.sin(TAU * (48 + 90 * Math.exp(-inBeat * 30)) * inBeat) * Math.exp(-inBeat * 9);
      const n = noise();
      hp = 0.6 * (hp + n - lastNoise);
      lastNoise = n;
      const hat = inEighth > eighth * 0.5 ? hp * Math.exp(-(inEighth - eighth * 0.5) * 60) * 0.35 : 0;
      const bassF = root * (step % 2 === 0 ? 1 : 2);
      const bassPh = (bassF * t) % 1;
      const bass = (bassPh < 0.5 ? 0.5 : -0.5) * Math.exp(-inEighth * 6) * 0.55;
      const leadF = root * 4 * arp[step];
      const leadPh = (leadF * t) % 1;
      const lead = (4 * Math.abs(leadPh - 0.5) - 1) * Math.exp(-inEighth * 10) * 0.32;
      return kick * 0.9 + hat + bass + lead;
    },
    14,
  );
});
registerSfxPlaceholder("synth-key", (ac) =>
  synth(ac, 0.34, (t, _i, noise) => {
    const f = 1568 + 400 * Math.sin(TAU * 18 * t);
    return Math.sin(TAU * f * t) * env(t, 0.002, 0.09) + noise() * 0.08 * env(t, 0.001, 0.02);
  }, 13),
);

/** Brass-ish tone: a few harmonics of a soft sawtooth. */
const brass = (f: number, t: number, bright = 1.3) => {
  let v = 0;
  for (let k = 1; k <= 5; k++) v += Math.sin(TAU * f * k * t) / Math.pow(k, bright);
  return v;
};
registerSfxPlaceholder("synth-nearmiss", (ac) => {
  let lp = 0;
  return synth(ac, 0.18, (t, _i, noise) => {
    lp += (noise() - lp) * (0.08 + 0.6 * (t / 0.18));
    return lp * env(t, 0.03, 0.05) + 0.25 * Math.sin(TAU * 2093 * t) * env(t, 0.001, 0.015);
  }, 15);
});
registerSfxPlaceholder("synth-perfect", (ac) =>
  synth(ac, 0.4, (t) => {
    const f = 1568;
    return Math.sin(TAU * f * t) * env(t, 0.002, 0.14) + 0.45 * Math.sin(TAU * f * 2.76 * t) * env(t, 0.002, 0.05) + 0.25 * Math.sin(TAU * f * 5.4 * t) * env(t, 0.001, 0.02);
  }, 16),
);
registerSfxPlaceholder("synth-combo", (ac) =>
  synth(ac, 0.46, (t) => {
    const notes = [392, 523, 659];
    const k = Math.min(notes.length - 1, Math.floor(t / 0.08));
    const lt = t - k * 0.08;
    return brass(notes[k], t) * env(lt, 0.01, k === notes.length - 1 ? 0.14 : 0.05);
  }, 17),
);
registerSfxPlaceholder("synth-block", (ac) =>
  synth(ac, 0.38, (t, _i, noise) => {
    const partials = [540, 1130, 1790, 2610];
    let v = 0;
    for (let k = 0; k < partials.length; k++) v += Math.sin(TAU * partials[k] * t) * env(t, 0.001, 0.12 / (k + 1)) / (k + 1);
    return v + noise() * 0.5 * env(t, 0.0005, 0.008);
  }, 18),
);
registerSfxPlaceholder("synth-horn", (ac) =>
  synth(ac, 0.9, (t) => {
    const second = t >= 0.32;
    const lt = second ? t - 0.32 : t;
    const f = (second ? 392 : 262) * (1 + 0.006 * Math.sin(TAU * 5 * t));
    const shape = second ? Math.min(1, lt / 0.06) * Math.exp(-Math.max(0, lt - 0.3) / 0.12) : Math.min(1, lt / 0.06) * (lt < 0.28 ? 1 : Math.exp(-(lt - 0.28) / 0.02));
    return brass(f, t, 1.6) * shape;
  }, 19),
);
registerSfxPlaceholder("synth-fanfare", (ac) =>
  synth(ac, 0.95, (t) => {
    const notes = [523, 659, 784, 1047];
    const k = Math.min(notes.length - 1, Math.floor(t / 0.11));
    const lt = t - k * 0.11;
    return brass(notes[k], t) * env(lt, 0.012, k === notes.length - 1 ? 0.3 : 0.07);
  }, 20),
);

registerSfxPlaceholder("synth-rankup", (ac) =>
  synth(ac, 0.55, (t) => {
    const notes = [1047, 1319, 1568];
    const k = Math.min(notes.length - 1, Math.floor(t / 0.09));
    const lt = t - k * 0.09;
    const f = notes[k];
    return Math.sin(TAU * f * t) * env(lt, 0.002, k === notes.length - 1 ? 0.18 : 0.07) + 0.35 * Math.sin(TAU * f * 2.76 * t) * env(lt, 0.002, 0.03);
  }, 21),
);

registerSfxPlaceholder("synth-dragon", (ac) => {
  let lp = 0;
  return synth(ac, 0.92, (t, _i, noise) => {
    lp += (noise() - lp) * 0.06;
    const growl = Math.sin(TAU * (70 + 40 * t) * t + Math.sin(TAU * 11 * t) * 1.2);
    return (growl * 0.8 + lp * 1.6) * env(t, 0.05, 0.28);
  }, 22);
});

export function buildSfxPlaceholder(ac: BaseAudioContext, entry: AssetEntry): AudioBuffer {
  const key = entry.placeholder ?? "synth-blip";
  return (sfxBuilders.get(key) ?? sfxBuilders.get("synth-blip")!)(ac, entry);
}
