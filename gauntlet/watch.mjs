// Tails gauntlet/progress.jsonl and emits at most one batched line per interval
// so the orchestrator can sync the live progress page without a wake-up per event.
// usage: node gauntlet/watch.mjs [intervalSeconds=150]
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "progress.jsonl");
const every = Number(process.argv[2] || 150) * 1000;
let offset = 0;
try { offset = statSync(file).size; } catch { offset = 0; }

setInterval(() => {
  let size = 0;
  try { size = statSync(file).size; } catch { return; }
  if (size <= offset) return;
  const chunk = readFileSync(file).subarray(offset, size).toString("utf8");
  offset = size;
  const events = chunk.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!events.length) return;
  const compact = events.map((e) => `${e.at.slice(11, 19)}|${e.piece}|${e.stage}|${e.status}|${e.text}`);
  process.stdout.write(`PROGRESS ${events.length} events\n${compact.join("\n")}\n`);
}, every);
