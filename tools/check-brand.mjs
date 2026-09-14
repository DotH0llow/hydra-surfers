#!/usr/bin/env node
// Brand-safety check: the benchmark game's names/trademarks must never appear in shipped code,
// assets, UI text, docs or build output.
//
//   node tools/check-brand.mjs            scan tracked + untracked (non-ignored) files and dist/ if present
//   node tools/check-brand.mjs --no-dist  skip dist/
//
// Only the internal planning files (PLAN.md, gauntlet/) may name the comparison target
// (gauntlet/pieces.json, F1-foundation criterion 8). Exits 1 on any hit.
// The patterns are assembled at runtime so this file does not contain the names itself.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const TERMS = [
  ["sub", "way"],
  ["sur", "fers"],
  ["sy", "bo"],
].map((p) => p.join(""));
const PATTERN = new RegExp(`\\b(${TERMS.join("|")})\\b`, "i");
const ALLOWED = [/^PLAN\.md$/, /^gauntlet\//];
const BINARY = /\.(png|jpe?g|webp|gif|ico|glb|gltf\.bin|bin|ogg|mp3|wav|m4a|woff2?|ttf|otf|zip)$/i;

function gitFiles() {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split("\0").filter(Boolean);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function scanFile(abs, label, hits) {
  if (!existsSync(abs)) return;
  // File names count too (e.g. an imported logo), binary or not.
  if (PATTERN.test(label)) hits.push(`${label}: file name`);
  if (BINARY.test(abs)) return;
  const txt = readFileSync(abs, "utf8");
  if (!PATTERN.test(txt)) return;
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (PATTERN.test(lines[i])) hits.push(`${label}:${i + 1}`);
}

const hits = [];
let scanned = 0;
for (const f of gitFiles()) {
  if (ALLOWED.some((re) => re.test(f))) continue;
  scanFile(join(ROOT, f), f, hits);
  scanned++;
}
const dist = join(ROOT, "dist");
if (!args.has("--no-dist") && existsSync(dist)) {
  for (const f of walk(dist)) {
    scanFile(f, `dist/${relative(dist, f).replace(/\\/g, "/")}`, hits);
    scanned++;
  }
}

if (hits.length) {
  console.error(`FAIL brand check: ${hits.length} hit(s) outside PLAN.md / gauntlet/ (line numbers only, text withheld):`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`PASS brand check: 0 hits in ${scanned} files (PLAN.md and gauntlet/ exempt${existsSync(dist) && !args.has("--no-dist") ? ", dist/ included" : ""})`);
