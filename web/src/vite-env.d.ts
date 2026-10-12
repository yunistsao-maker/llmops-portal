/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "clean" builds the edition for everyone in the company (npm run build:clean); anything else is the full portal. */
  readonly VITE_EDITION?: string;
}
