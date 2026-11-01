import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true,
    target: "chrome140",
    sourcemap: true,
  },
  worker: { format: "es" },
  server: {
    port: 5791,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
  },
});
