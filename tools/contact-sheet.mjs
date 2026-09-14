#!/usr/bin/env node
// Builds a labelled grid image from a folder of frames by rendering an HTML page in Chrome and
// screenshotting it (PLAN.md §2/§5).
//
//   node tools/contact-sheet.mjs --dir <frames dir> [--out contact.png] [--fps 30] [--cols 10]
//        [--thumb 180] [--max 90] [--every N] [--meta meta.json] [--title "text"]
//
// Labels: frame index + time (index / fps). Frames with an event in meta.json ({events:[{frame,label}]})
// get a highlighted border and the event label. With more than --max frames, frames are sampled
// evenly (or use --every N). Also importable: buildContactSheet(opts).
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChrome } from "./lib/browser.mjs";
import { log, num, parseArgs } from "./lib/common.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function pngSize(file) {
  try {
    const b = readFileSync(file);
    if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {{dir: string, out?: string, fps?: number, cols?: number, thumb?: number, max?: number,
 *   every?: number, meta?: object|string, title?: string, browser?: import("playwright-core").Browser}} o
 */
export async function buildContactSheet(o) {
  const dir = resolve(o.dir);
  if (!existsSync(dir)) throw new Error(`frames dir not found: ${dir}`);
  const out = resolve(o.out ?? join(dirname(dir), "contact.png"));
  let meta = o.meta ?? null;
  if (typeof meta === "string") meta = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")) : null;
  const fps = num(o.fps, meta?.fps ?? 30);
  const files = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();
  if (!files.length) throw new Error(`no frames in ${dir}`);

  // frame index from file name (0012.png → 12); falls back to position
  const frames = files.map((f, i) => {
    const m = /(\d+)/.exec(basename(f));
    return { file: f, index: m ? Number(m[1]) : i };
  });
  const events = new Map();
  for (const e of meta?.events ?? []) {
    const list = events.get(e.frame) ?? [];
    list.push(e.label);
    events.set(e.frame, list);
  }
  const max = Math.max(1, num(o.max, 90));
  const every = num(o.every, 0);
  let picked = frames;
  if (every > 0) picked = frames.filter((_, i) => i % every === 0);
  else if (frames.length > max) {
    const eventFrames = new Set(events.keys());
    const step = (frames.length - 1) / (max - 1);
    const keep = new Set();
    for (let i = 0; i < max; i++) keep.add(Math.round(i * step));
    picked = frames.filter((f, i) => keep.has(i) || eventFrames.has(f.index));
  }

  const size = pngSize(join(dir, picked[0].file)) ?? { width: 540, height: 960 };
  const thumb = num(o.thumb, size.width >= size.height ? 280 : 180);
  const thumbH = Math.round((thumb * size.height) / size.width);
  const cols = Math.max(1, num(o.cols, picked.length <= 6 ? picked.length : picked.length <= 30 ? 6 : 10));
  const title =
    o.title ??
    [meta?.scenario, meta?.viewport ? `${meta.viewport.width}x${meta.viewport.height}` : null, `${fps} fps`, `${frames.length} frames`, meta?.touch ? "touch" : null]
      .filter(Boolean)
      .join(" · ");

  const htmlPath = join(dirname(out), `.contact-${basename(out, ".png")}.html`);
  const rel = (f) => relative(dirname(htmlPath), join(dir, f)).split("\\").join("/");
  const tiles = picked
    .map((f) => {
      const ev = events.get(f.index);
      const t = (f.index / fps).toFixed(2);
      return `<figure class="${ev ? "ev" : ""}"><img src="${esc(rel(f.file))}" width="${thumb}" height="${thumbH}">
<figcaption><b>#${String(f.index).padStart(4, "0")}</b><span>${t} s</span></figcaption>${ev ? `<div class="evl">${esc(ev.join(" · "))}</div>` : ""}</figure>`;
    })
    .join("\n");
  const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#111620;color:#dfe6ef;font:12px/1.2 "Segoe UI",system-ui,sans-serif}
header{padding:10px 12px;font-weight:600;font-size:14px;color:#fff;border-bottom:1px solid #263041}
main{display:grid;grid-template-columns:repeat(${cols},${thumb}px);gap:6px;padding:8px;width:max-content}
figure{margin:0;position:relative;background:#000;border:2px solid #263041;border-radius:4px;overflow:hidden}
figure.ev{border-color:#ff9a2e}
img{display:block;width:${thumb}px;height:${thumbH}px;object-fit:cover}
figcaption{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;padding:3px 5px;background:rgba(0,0,0,.62);font-variant-numeric:tabular-nums}
figcaption b{color:#fff}figcaption span{color:#b6c2d2}
.evl{position:absolute;left:0;right:0;bottom:0;padding:3px 5px;background:rgba(255,122,26,.9);color:#111;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style><header>${esc(title)}</header><main>${tiles}</main>`;
  writeFileSync(htmlPath, html);

  const browser = o.browser ?? (await launchChrome());
  try {
    const page = await browser.newPage({ viewport: { width: cols * (thumb + 6) + 16, height: 400 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null)))));
    await page.screenshot({ path: out, fullPage: true });
    await page.close();
  } finally {
    if (!o.browser) await browser.close();
    rmSync(htmlPath, { force: true });
  }
  return { out, tiles: picked.length, frames: frames.length, cols };
}

const isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const a = parseArgs();
  const dir = a.dir ?? a._[0];
  if (!dir || a.help) {
    console.log("usage: node tools/contact-sheet.mjs --dir <frames> [--out contact.png] [--fps 30] [--cols N] [--thumb px] [--max 90] [--every N] [--meta meta.json] [--title t]");
    process.exit(dir ? 0 : 1);
  }
  const metaPath = a.meta ?? join(dirname(resolve(dir)), "meta.json");
  buildContactSheet({ ...a, dir, meta: existsSync(metaPath) ? metaPath : null })
    .then((r) => log(`contact sheet ${r.out} (${r.tiles}/${r.frames} frames, ${r.cols} cols)`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
