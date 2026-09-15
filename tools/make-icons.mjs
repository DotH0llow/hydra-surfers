#!/usr/bin/env node
// Renders public/icons/icon.svg into the PNG icons used by the web app manifest and iOS home screen,
// with the locally installed Chrome (playwright-core, no browser download).
//
//   node tools/make-icons.mjs
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(ROOT, "public", "icons");
mkdirSync(dir, { recursive: true });
const svg = readFileSync(join(dir, "icon.svg")).toString("base64");

// [file, size, inset fraction, full-bleed background]
const OUTPUTS = [
  ["icon-192.png", 192, 0, false],
  ["icon-512.png", 512, 0, false],
  ["icon-maskable-512.png", 512, 0.12, true],
  ["apple-touch-icon.png", 180, 0, true],
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  for (const [file, size, inset, bleed] of OUTPUTS) {
    const inner = Math.round(size * (1 - 2 * inset));
    const pad = Math.round((size - inner) / 2);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;width:${size}px;height:${size}px;background:${bleed ? "#1b2233" : "transparent"}">` +
        `<img src="data:image/svg+xml;base64,${svg}" style="display:block;width:${inner}px;height:${inner}px;margin:${pad}px"></body></html>`,
    );
    await page.screenshot({ path: join(dir, file), omitBackground: !bleed });
    console.log(`wrote public/icons/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
