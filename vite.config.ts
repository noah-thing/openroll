import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Kokoro (text to speech) is built on Transformers.js 3 and ships its own copy; captions use 4.
// The TTS worker configures the copy Kokoro actually runs on through this alias.
const kokoroTransformers = fileURLToPath(new URL("./node_modules/kokoro-js/node_modules/@huggingface/transformers", import.meta.url));

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "kokoro-transformers": kokoroTransformers },
  },
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
