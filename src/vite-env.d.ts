/// <reference types="vite/client" />

/** Compile-time: true in dev builds or when VITE_DEVTOOLS=1 at build time (see vite.config.ts). */
declare const __DEVTOOLS_BUILD__: boolean;

/** Compile-time: the package version, sent with every run so old clients can be turned away. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_DEVTOOLS?: string;
  readonly VITE_ONLINE_PROVIDER?: "mock" | "http";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
