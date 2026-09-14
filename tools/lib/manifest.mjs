// Node-side manifest reader + file inspectors shared by assets-check.mjs and assets-doc.mjs.
// Mirrors src/assets/manifest.ts (parts merged in order, ids unique across parts).
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { ROOT } from "./common.mjs";

export const ASSETS_DIR = join(ROOT, "public", "assets");
export const TYPES = ["gltf", "texture", "sprite", "audio", "font", "json"];
export const FORMATS = {
  gltf: [".glb", ".gltf"],
  texture: [".png", ".jpg", ".jpeg", ".webp", ".ktx2"],
  sprite: [".svg", ".png", ".webp", ".jpg", ".jpeg"],
  audio: [".ogg", ".mp3", ".m4a", ".wav", ".webm"],
  font: [".woff2", ".woff", ".ttf", ".otf"],
  json: [".json"],
};
/** Soft size budgets (bytes) per type; exceeding one is a warning. */
export const SIZE_BUDGET = { gltf: 3 * 1048576, texture: 1048576, sprite: 256 * 1024, audio: 512 * 1024, font: 256 * 1024, json: 512 * 1024 };

export function loadManifestParts() {
  const rootPath = join(ASSETS_DIR, "manifest.json");
  const root = JSON.parse(readFileSync(rootPath, "utf8"));
  const parts = [];
  const entries = [];
  const errors = [];
  const seen = new Map();
  for (const name of root.parts ?? []) {
    const p = join(ASSETS_DIR, name);
    if (!existsSync(p)) {
      errors.push(`manifest part ${name} is missing`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(p, "utf8"));
    } catch (err) {
      errors.push(`manifest part ${name} is not valid JSON: ${err.message}`);
      continue;
    }
    parts.push({ name, part: data.part ?? name, description: data.description ?? "", count: (data.assets ?? []).length });
    (data.assets ?? []).forEach((e, i) => {
      const where = `${name}[${i}]`;
      if (!e || typeof e !== "object") return errors.push(`${where}: not an object`);
      if (!e.id) errors.push(`${where}: missing id`);
      if (!TYPES.includes(e.type)) errors.push(`${where} (${e.id}): bad type "${e.type}"`);
      if (typeof e.src !== "string" || !e.src) errors.push(`${where} (${e.id}): missing src`);
      if (!e.placeholder) errors.push(`${where} (${e.id}): no placeholder key (a missing file would break)`);
      if (seen.has(e.id)) return errors.push(`${where}: duplicate id "${e.id}" (first in ${seen.get(e.id)})`);
      seen.set(e.id, name);
      entries.push({ ...e, part: name });
    });
  }
  return { root, parts, entries, errors };
}

/** Image dimensions from PNG / JPEG / WebP / SVG headers (no decoding). */
export function imageSize(buf, ext) {
  try {
    if (ext === ".png" && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if ((ext === ".jpg" || ext === ".jpeg") && buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o < buf.length) {
        if (buf[o] !== 0xff) break;
        const marker = buf[o + 1];
        const len = buf.readUInt16BE(o + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) };
        o += 2 + len;
      }
    }
    if (ext === ".webp" && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      const kind = buf.toString("ascii", 12, 16);
      if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (ext === ".svg") {
      const txt = buf.toString("utf8", 0, Math.min(buf.length, 4096));
      const w = /\bwidth="([\d.]+)/.exec(txt);
      const h = /\bheight="([\d.]+)/.exec(txt);
      const vb = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(txt);
      if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
      if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** glTF/GLB summary: animation clip names, triangle count, meshes, materials, embedded images. */
export function gltfInfo(buf, ext, filePath) {
  let json;
  if (ext === ".glb") {
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (bad magic)");
    const len0 = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB first chunk is not JSON");
    json = JSON.parse(buf.toString("utf8", 20, 20 + len0));
  } else {
    json = JSON.parse(buf.toString("utf8"));
    for (const b of json.buffers ?? []) {
      if (b.uri && !b.uri.startsWith("data:") && !existsSync(join(filePath, "..", b.uri))) throw new Error(`external buffer missing: ${b.uri}`);
    }
  }
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      const acc = prim.indices !== undefined ? json.accessors?.[prim.indices] : json.accessors?.[prim.attributes?.POSITION];
      const count = acc?.count ?? 0;
      if (mode === 4) tris += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
    }
  }
  return {
    clips: (json.animations ?? []).map((an, i) => an.name ?? `animation_${i}`),
    tris,
    meshes: (json.meshes ?? []).length,
    materials: (json.materials ?? []).length,
    skins: (json.skins ?? []).length,
    images: (json.images ?? []).length,
  };
}

/** Parses "<= 6k tris", "≤ 800 tris" etc. from a spec string. */
export function triBudget(spec = "") {
  const m = /(?:<=|≤)\s*([\d.]+)\s*(k)?\s*tris/i.exec(spec);
  return m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : null;
}

/** Parses the first "NxN" (e.g. "512x512", "1024x512") from a spec string. */
export function specDims(spec = "") {
  const m = /(\d{2,5})\s*[x×]\s*(\d{2,5})(?!\s*m\b)/.exec(spec);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

export const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/** Inspects one entry's file. Returns {exists, bytes, ext, formatOk, dims?, gltf?, error?}. */
export function inspectEntry(e) {
  const file = join(ASSETS_DIR, e.src ?? "");
  const ext = extname(e.src ?? "").toLowerCase();
  const info = { file, ext, exists: !!e.src && existsSync(file) && statSync(file).isFile(), formatOk: (FORMATS[e.type] ?? []).includes(ext) };
  if (!info.exists) return info;
  info.bytes = statSync(file).size;
  const buf = readFileSync(file);
  try {
    if (e.type === "texture" || e.type === "sprite") info.dims = imageSize(buf, ext);
    if (e.type === "gltf") info.gltf = gltfInfo(buf, ext, file);
    if (e.type === "json") JSON.parse(buf.toString("utf8"));
    if (e.type === "audio") {
      const head = buf.toString("ascii", 0, 4);
      const okMagic = (ext === ".ogg" && head === "OggS") || (ext === ".wav" && head === "RIFF") || (ext === ".mp3" && (head.startsWith("ID3") || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) || ext === ".m4a" || ext === ".webm";
      if (!okMagic) info.error = `file content does not look like ${ext}`;
    }
  } catch (err) {
    info.error = err.message;
  }
  return info;
}
