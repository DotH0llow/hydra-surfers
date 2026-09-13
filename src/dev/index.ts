/**
 * Devtools entry point (lane D owns src/dev). Only reachable through a dynamic import guarded by
 * `__DEVTOOLS_BUILD__ && flags.devtools` in main.ts, so production bundles built without
 * VITE_DEVTOOLS=1 contain none of this code.
 *
 * Build the cheats panel from `listCheats()` (core/cheats.ts) and the editor from `tuning.list()`
 * (core/tuning.ts) + the ProfileStore (`app.store`).
 */
import type { App } from "../App";
import { listCheats } from "../core/cheats";
import { tuning } from "../core/tuning";

export const DEVTOOLS_MARKER = "yard-dash-devtools";

export function installDevtools(app: App): void {
  console.info(
    `[dev] ${DEVTOOLS_MARKER}: ${listCheats().length} cheats, ${tuning.list().length} tuning fields registered; screen=${app.getState().screen}`,
  );
}
