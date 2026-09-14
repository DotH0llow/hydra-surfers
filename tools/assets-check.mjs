#!/usr/bin/env node
// Validates the asset manifest and every file it references (PLAN.md §6, D3).
//
//   node tools/assets-check.mjs [--strict] [--json]
//
// Errors (exit 1): invalid/duplicate manifest entries, wrong file format for the type, unreadable or
// corrupt files, glTF missing an animation clip named in `animations`, triangle count over the
// "<= N tris" budget in `spec`, hard-coded asset file paths in src/ (assets must go through the
// manifest). With --strict, entries still served by placeholders are errors too.
// Warnings: size over budget, texture not power-of-two, dimensions differing from the spec.
// Always reports which ids are still using procedural placeholders.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, parseArgs } from "./lib/common.mjs";
import { FORMATS, SIZE_BUDGET, inspectEntry, isPow2, loadManifestParts, specDims, triBudget } from "./lib/manifest.mjs";

const a = parseArgs(process.argv.slice(2), ["strict", "json"]);
const { entries, errors: manifestErrors, parts } = loadManifestParts();
const errors = [...manifestErrors];
const warnings = [];
const placeholders = [];
const files = [];

for (const e of entries) {
  const info = inspectEntry(e);
  const tag = `${e.id} (${e.src})`;
  if (!info.formatOk) errors.push(`${tag}: extension "${info.ext}" is not a ${e.type} format (${FORMATS[e.type]?.join(", ")})`);
  if (!info.exists) {
    placeholders.push(e.id);
    if (a.strict) errors.push(`${tag}: file missing (placeholder "${e.placeholder}" in use)`);
    continue;
  }
  const row = { id: e.id, src: e.src, bytes: info.bytes };
  if (info.error) errors.push(`${tag}: ${info.error}`);
  if (info.bytes > (SIZE_BUDGET[e.type] ?? Infinity)) warnings.push(`${tag}: ${(info.bytes / 1024).toFixed(0)} KB exceeds the ${(SIZE_BUDGET[e.type] / 1024).toFixed(0)} KB ${e.type} budget`);
  if (info.dims) {
    row.dims = `${info.dims.width}x${info.dims.height}`;
    if (e.type === "texture" && info.ext !== ".svg" && !(isPow2(info.dims.width) && isPow2(info.dims.height))) warnings.push(`${tag}: ${row.dims} is not power-of-two (mipmaps/repeat)`);
    const want = specDims(e.spec);
    if (want && e.type === "texture" && (want.width !== info.dims.width || want.height !== info.dims.height)) warnings.push(`${tag}: ${row.dims} differs from spec ${want.width}x${want.height}`);
  }
  if (info.gltf) {
    row.tris = info.gltf.tris;
    row.clips = info.gltf.clips;
    const budget = triBudget(e.spec);
    if (budget && info.gltf.tris > budget) errors.push(`${tag}: ${info.gltf.tris} triangles exceeds the spec budget of ${budget}`);
    for (const [logical, clip] of Object.entries(e.animations ?? {})) {
      if (!info.gltf.clips.includes(clip)) errors.push(`${tag}: animation "${logical}" expects clip "${clip}" but the file has [${info.gltf.clips.join(", ") || "none"}]`);
    }
  }
  files.push(row);
}

// Hard-coded asset paths in game code (everything must go through manifest ids).
const ASSET_EXT = /["'`][^"'`\s]*\.(glb|gltf|png|jpe?g|webp|ktx2|ogg|mp3|m4a|wav|woff2?|ttf|svg)["'`]/i;
const hardcoded = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|css|html)$/.test(name)) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (ASSET_EXT.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) hardcoded.push(`${relative(ROOT, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
  }
};
walk(join(ROOT, "src"));
for (const h of hardcoded) errors.push(`hard-coded asset path (use a manifest id): ${h}`);

const summary = { parts: parts.length, entries: entries.length, files: files.length, placeholders: placeholders.length, errors: errors.length, warnings: warnings.length };
if (a.json) {
  console.log(JSON.stringify({ summary, errors, warnings, placeholders, files }, null, 2));
} else {
  console.log(`assets: ${entries.length} entries in ${parts.length} parts · ${files.length} files present · ${placeholders.length} using placeholders`);
  for (const f of files) console.log(`  file  ${f.id.padEnd(24)} ${f.src}  ${(f.bytes / 1024).toFixed(1)} KB${f.dims ? `  ${f.dims}` : ""}${f.tris !== undefined ? `  ${f.tris} tris  clips [${f.clips.join(", ")}]` : ""}`);
  if (placeholders.length) console.log(`  placeholders still in use (${placeholders.length}): ${placeholders.join(", ")}`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  console.log(errors.length ? `FAIL (${errors.length} error${errors.length === 1 ? "" : "s"})` : `PASS${warnings.length ? ` with ${warnings.length} warning(s)` : ""}`);
}
process.exit(errors.length ? 1 : 0);
