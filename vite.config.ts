import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import pkg from "./package.json" with { type: "json" };
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * D5 performance budget (gauntlet criterion): initial JS <= 250 KB gzip, excluding the devtools
 * chunk and anything else that is only reached through a dynamic import().
 */
const INITIAL_JS_GZIP_BUDGET_KB = 250;
/**
 * Vite's per-chunk raw-size warning. The largest single chunk is three.js core in its own vendor
 * chunk (~585 kB minified, ~146 kB gzip) and cannot be split further, so the limit sits just above
 * it. Any app chunk growing past this still warns; the hard gate is the gzip budget check below.
 * Sizes are kB (1000 bytes), the same unit Vite's build report prints.
 */
const CHUNK_WARNING_LIMIT_KB = 600;

/** Files under an assets dir, relative with forward slashes (dotfiles, code and the index itself skipped). */
function listAssetFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith(".")) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!/\.(m?js|css|map)$/.test(name)) out.push(relative(dir, p).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out.filter((f) => f !== ASSET_INDEX).sort();
}

const ASSET_INDEX = "files.json";
const assetIndexJson = (dir: string) => JSON.stringify({ version: 1, files: listAssetFiles(dir) });

/**
 * `assets/files.json`: which asset files actually exist, so the AssetLibrary requests only those
 * (manifest entries without a file go straight to their procedural placeholder: no 404s on boot).
 * - build: generated from public/assets/ into dist/assets/files.json
 * - dev / preview servers: answered live from disk, so dropping a file in is picked up on reload
 *   with zero code or manifest edits.
 */
function assetFileIndex(): Plugin {
  let publicAssets = "";
  let outAssets = "";
  const serve = (dir: () => string) => (req: { url?: string }, res: { setHeader(k: string, v: string): void; end(s: string): void }, next: () => void) => {
    if (!(req.url ?? "").split("?")[0].endsWith(`/assets/${ASSET_INDEX}`)) return next();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-cache");
    res.end(assetIndexJson(dir()));
  };
  return {
    name: "yard-dash:asset-file-index",
    configResolved(c) {
      publicAssets = c.publicDir ? resolve(c.publicDir, "assets") : "";
      outAssets = resolve(c.root, c.build.outDir, "assets");
    },
    configureServer(server) {
      server.middlewares.use(serve(() => publicAssets));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve(() => outAssets));
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: `assets/${ASSET_INDEX}`, source: assetIndexJson(publicAssets) });
    },
  };
}

/** Fails the build when the initial (statically reachable) JS exceeds the D5 gzip budget. */
function initialJsBudget(budgetKb: number): Plugin {
  return {
    name: "yard-dash:initial-js-budget",
    apply: "build",
    writeBundle(_opts, bundle) {
      const chunks = new Map<string, { code: string; imports: string[]; isEntry: boolean }>();
      for (const [name, item] of Object.entries(bundle)) if (item.type === "chunk") chunks.set(name, item);
      const initial = new Set<string>();
      const visit = (name: string) => {
        if (initial.has(name) || !chunks.has(name)) return;
        initial.add(name);
        for (const dep of chunks.get(name)!.imports) visit(dep);
      };
      for (const [name, c] of chunks) if (c.isEntry) visit(name);
      let raw = 0;
      let gz = 0;
      const rows: string[] = [];
      for (const name of initial) {
        const code = chunks.get(name)!.code;
        const g = gzipSync(code).length;
        raw += Buffer.byteLength(code);
        gz += g;
        rows.push(`${name} ${(g / 1000).toFixed(1)} kB gz`);
      }
      const lazy = [...chunks.keys()].filter((n) => !initial.has(n));
      const kb = gz / 1000;
      const line = `initial JS ${kb.toFixed(1)} kB gzip (${(raw / 1000).toFixed(0)} kB raw) / budget ${budgetKb} kB, ${(budgetKb - kb).toFixed(1)} kB headroom; ${initial.size} chunk(s): ${rows.join(", ")}; lazy: ${lazy.length ? lazy.join(", ") : "none"}`;
      if (kb > budgetKb) this.error(`[budget] FAIL ${line}`);
      console.log(`[budget] PASS ${line}`);
    },
  };
}

// Port convention (PLAN.md §8): main 5100, lane-a 5101 … lane-d 5104. Override with PORT=51xx.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.PORT || process.env.PORT) || 5100;
  // Compile-time switch: when false, `if (__DEVTOOLS_BUILD__)` branches (and the dynamic
  // import of src/dev) are removed from the production bundle entirely.
  const devtoolsBuild = mode === "development" || env.VITE_DEVTOOLS === "1";
  return {
    base: "./",
    define: {
      __DEVTOOLS_BUILD__: JSON.stringify(devtoolsBuild),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [assetFileIndex(), initialJsBudget(INITIAL_JS_GZIP_BUDGET_KB)],
    server: { port, strictPort: true, host: true },
    preview: { port, strictPort: true, host: true },
    build: {
      target: "es2022",
      // Source maps are opt-in (VITE_SOURCEMAP=1) so production dist never publishes the client source.
      sourcemap: env.VITE_SOURCEMAP === "1",
      chunkSizeWarningLimit: CHUNK_WARNING_LIMIT_KB,
      rolldownOptions: {
        output: {
          // three.js core in its own long-cacheable vendor chunk. Only three/build/ matches, so the
          // lazily imported loaders under three/examples/ stay in their own dynamic chunks.
          codeSplitting: {
            groups: [{ name: "three", test: /[\\/]node_modules[\\/]three[\\/]build[\\/]/ }],
          },
        },
      },
    },
  };
});
