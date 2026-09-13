/** Boot: debug API stub → load manifest → preload assets → create App → route to Home. */
import "./style.css";
import brand from "./brand/brand.json";
import { loadManifest } from "./assets/manifest";
import { AssetLibrary } from "./assets/AssetLibrary";
import { installDebugApi } from "./core/debugApi";
import { bus } from "./core/events";
import { flags } from "./core/flags";
import { ProfileStore } from "./core/store";
import { App } from "./App";

async function boot(): Promise<void> {
  document.title = brand.name;
  const debug = flags.debug ? installDebugApi() : null;
  const bootEl = document.getElementById("boot");
  if (bootEl) bootEl.textContent = brand.copy.loading;
  try {
    const manifest = await loadManifest(`${import.meta.env.BASE_URL}assets/manifest.json`);
    const assets = new AssetLibrary(manifest);
    await assets.preload((done, total) => {
      if (bootEl) bootEl.textContent = `${brand.copy.loading} ${Math.round((done / total) * 100)}%`;
    });
    const store = new ProfileStore(`${brand.id}.profile`);
    const app = new App(
      assets,
      store,
      document.getElementById("playfield")!,
      document.getElementById("scene") as HTMLCanvasElement,
      document.getElementById("ui")!,
    );
    app.init();
    if (bootEl) {
      // Manual clock (captures): remove instantly so the first captured frame is clean.
      if (flags.clock === "manual") bootEl.remove();
      else {
        bootEl.classList.add("hidden");
        bootEl.addEventListener("transitionend", () => bootEl.remove(), { once: true });
      }
    }
    bus.emit("app:ready", { placeholders: assets.report().placeholders.length });
    debug?.attach(app);

    if (__DEVTOOLS_BUILD__ && flags.devtools) {
      const dev = await import("./dev/index");
      dev.installDevtools(app);
    }
  } catch (err) {
    console.error("[boot] failed", err);
    if (bootEl) bootEl.textContent = "Failed to start. Please reload.";
    debug?.fail(err);
  }
}

void boot();
