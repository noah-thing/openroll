/// <reference types="vite/types/importMeta.d.ts" />

declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*.css";

/** The one piece of Vite's import.meta that the code uses. */
interface ImportMeta {
  glob<T>(pattern: string, options: { query: string; import: string; eager: true }): Record<string, T>;
}
