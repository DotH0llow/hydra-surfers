import { defineConfig, loadEnv } from "vite";

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
    },
    server: { port, strictPort: true, host: true },
    preview: { port, strictPort: true, host: true },
    build: {
      target: "es2022",
      // Source maps are opt-in (VITE_SOURCEMAP=1) so production dist never publishes the client source.
      sourcemap: env.VITE_SOURCEMAP === "1",
      chunkSizeWarningLimit: 900,
    },
  };
});
