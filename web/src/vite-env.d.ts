/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' in the static GitHub Pages demo build (`vite build --mode demo`); undefined otherwise. */
  readonly VITE_DEMO?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
