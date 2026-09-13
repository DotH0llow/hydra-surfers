// Append one progress event for the live progress page.
// usage: node gauntlet/log.mjs <piece> <stage> <status> "<short text>" ['{"extra":"json"}']
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [piece = "?", stage = "?", status = "?", text = "", extra = "{}"] = process.argv.slice(2);
let more = {};
try { more = JSON.parse(extra); } catch { more = { extra }; }
const line = { at: new Date().toISOString(), piece, stage, status, text: String(text).slice(0, 240), ...more };
appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "progress.jsonl"), JSON.stringify(line) + "\n");
