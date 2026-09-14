#!/usr/bin/env node
// Proves devtools are excluded from production bundles unless VITE_DEVTOOLS=1.
//
//   node tools/check-devstrip.mjs               build twice into temp dirs (without / with VITE_DEVTOOLS=1) and compare
//   node tools/check-devstrip.mjs --skip-build  only scan the existing dist/ (must contain no dev code)
//
// Markers searched for: the DEVTOOLS_MARKER string and CSS class names that only exist in src/dev.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKERS = ["yard-dash-devtools", "yd-dev-fab", "Toggle dev panel"];
const args = new Set(process.argv.slice(2));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

function scan(dir) {
  const hits = [];
  for (const f of walk(dir)) {
    const txt = readFileSync(f, "utf8");
    for (const m of MARKERS) if (txt.includes(m)) hits.push(`${relative(dir, f)}: "${m}"`);
  }
  return hits;
}

function build(outDir, devtools) {
  const env = { ...process.env };
  delete env.VITE_DEVTOOLS;
  if (devtools) env.VITE_DEVTOOLS = "1";
  const vite = join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const r = spawnSync(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`vite build failed (VITE_DEVTOOLS=${devtools ? 1 : "unset"})`);
}

let failed = false;
if (args.has("--skip-build")) {
  const dist = join(ROOT, "dist");
  if (!existsSync(dist)) throw new Error("dist/ missing: run npm run build first");
  const hits = scan(dist);
  if (hits.length) {
    failed = true;
    console.error(`FAIL dist/ contains devtools code:\n  ${hits.join("\n  ")}`);
  } else console.log(`PASS dist/ has no devtools code (${walk(dist).length} files scanned)`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), "yd-devstrip-"));
  try {
    const prod = join(tmp, "prod");
    const dev = join(tmp, "devtools");
    build(prod, false);
    build(dev, true);
    const prodHits = scan(prod);
    const devHits = scan(dev);
    const prodFiles = walk(prod).map((f) => relative(prod, f));
    const devFiles = walk(dev).map((f) => relative(dev, f));
    if (prodHits.length) {
      failed = true;
      console.error(`FAIL production build (VITE_DEVTOOLS unset) contains devtools code:\n  ${prodHits.join("\n  ")}`);
    } else console.log(`PASS production build (VITE_DEVTOOLS unset): 0 devtools markers in ${prodFiles.length} files`);
    if (!devHits.length) {
      failed = true;
      console.error("FAIL VITE_DEVTOOLS=1 build has no devtools markers — the check itself is not detecting anything");
    } else console.log(`PASS VITE_DEVTOOLS=1 build contains the devtools chunk (${devHits.length} marker hits: ${[...new Set(devHits.map((h) => h.split(":")[0]))].join(", ")})`);
    console.log(`     files: prod ${prodFiles.length} vs devtools ${devFiles.length}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
