/**
 * Asset manifest types + loader. `public/assets/manifest.json` lists `parts`
 * (`manifest/core.json`, `track.json`, `ui.json`, `audio.json`) merged at load; ids must be
 * unique across parts. See PLAN.md §6 and docs/ASSETS.md.
 */

export type AssetType = "gltf" | "texture" | "sprite" | "audio" | "font" | "json";

export interface AssetEntry {
  id: string;
  type: AssetType;
  /** Path relative to the assets base (public/assets/). Missing/404 → placeholder. */
  src: string;
  /** Procedural fallback key in src/assets/placeholders.ts. */
  placeholder?: string;
  /** Uniform scale applied to loaded models. */
  scale?: number;
  /** Where the model origin is: "feet-center" | "bottom-center" | "center". */
  pivot?: string;
  /** Model facing axis in its file ("-z" means already facing the run direction). */
  forward?: string;
  /** Logical clip name → clip name inside the glTF. */
  animations?: Record<string, string>;
  /** Human/art-AI brief: dimensions, budgets, orientation, style. */
  spec?: string;
  /** Texture id(s) used by the placeholder builder, e.g. {"map": "tex.train.side"}. */
  maps?: Record<string, string>;
  /** Tint used by placeholder builders (CSS color). */
  color?: string;
  /** Texture options. */
  repeat?: [number, number];
  srgb?: boolean;
  /** Audio options. */
  volume?: number;
  loop?: boolean;
  /** Free-form extras for owning systems. */
  meta?: Record<string, unknown>;
}

export interface ManifestPart {
  part?: string;
  description?: string;
  assets: AssetEntry[];
}

export interface ManifestRoot {
  version: number;
  /** Relative to the manifest root directory. */
  parts: string[];
}

export interface Manifest {
  version: number;
  base: string;
  entries: Map<string, AssetEntry>;
  /** Which part each id came from. */
  partOf: Map<string, string>;
  warnings: string[];
}

const TYPES: readonly AssetType[] = ["gltf", "texture", "sprite", "audio", "font", "json"];

export function validateEntry(e: unknown, where: string): string[] {
  const errs: string[] = [];
  if (typeof e !== "object" || e === null) return [`${where}: entry is not an object`];
  const a = e as Partial<AssetEntry>;
  if (typeof a.id !== "string" || !a.id) errs.push(`${where}: missing id`);
  if (typeof a.type !== "string" || !TYPES.includes(a.type as AssetType)) errs.push(`${where}: bad type "${String(a.type)}" for ${a.id}`);
  if (typeof a.src !== "string") errs.push(`${where}: missing src for ${a.id}`);
  return errs;
}

/** Merge parts into a manifest; pure (used by tools and tests too). */
export function mergeParts(version: number, base: string, parts: Array<{ name: string; data: ManifestPart }>): Manifest {
  const entries = new Map<string, AssetEntry>();
  const partOf = new Map<string, string>();
  const warnings: string[] = [];
  for (const { name, data } of parts) {
    const list = Array.isArray(data?.assets) ? data.assets : [];
    if (!Array.isArray(data?.assets)) warnings.push(`${name}: no "assets" array`);
    list.forEach((raw, i) => {
      const errs = validateEntry(raw, `${name}[${i}]`);
      if (errs.length) {
        warnings.push(...errs);
        return;
      }
      if (entries.has(raw.id)) {
        warnings.push(`${name}: duplicate id "${raw.id}" (already in ${partOf.get(raw.id)}); ignored`);
        return;
      }
      entries.set(raw.id, raw);
      partOf.set(raw.id, name);
    });
  }
  return { version, base, entries, partOf, warnings };
}

export async function loadManifest(url = "assets/manifest.json"): Promise<Manifest> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  let root: ManifestRoot = { version: 1, parts: [] };
  const warnings: string[] = [];
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    root = (await res.json()) as ManifestRoot;
  } catch (err) {
    warnings.push(`manifest root ${url} failed to load (${String(err)}); every asset will use placeholders`);
  }
  const parts = await Promise.all(
    (root.parts ?? []).map(async (p) => {
      try {
        const res = await fetch(base + p, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { name: p, data: (await res.json()) as ManifestPart };
      } catch (err) {
        warnings.push(`manifest part ${p} failed to load (${String(err)})`);
        return { name: p, data: { assets: [] } as ManifestPart };
      }
    }),
  );
  const m = mergeParts(root.version ?? 1, base, parts);
  m.warnings.unshift(...warnings);
  for (const w of m.warnings) console.warn(`[assets] ${w}`);
  return m;
}
