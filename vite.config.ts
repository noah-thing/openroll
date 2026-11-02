import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Kokoro (text to speech) is built on Transformers.js 3 and ships its own copy; captions use 4.
// The TTS worker configures the copy Kokoro actually runs on through this alias. It names the
// browser build outright: the bare folder would resolve to the package's Node entry, which
// pulls in onnxruntime-node and fails at startup in a worker.
const kokoroTransformers = fileURLToPath(new URL("./node_modules/kokoro-js/node_modules/@huggingface/transformers", import.meta.url));
const kokoroRuntime = fileURLToPath(new URL("./node_modules/kokoro-js/node_modules/onnxruntime-web/dist", import.meta.url));

// Every worker passes its own wasmPaths, so of the ONNX Runtime builds the bundler finds by name
// only two are ever requested, and the rest are left out of the output:
//   jspi   captions and the AI sessions. They would otherwise load the 27 MB asyncify build;
//          Chromium here has JSPI, which does the same job in 17 MB.
//   plain  Kokoro, which runs on the CPU only, so it skips its 22 MB jsep build for 11 MB.
const RUNTIME_FILE = /node_modules\/onnxruntime-web\/dist\/ort-wasm-simd-threaded[.\w]*\.(?:wasm|mjs)$/;
const WANTED_RUNTIME = /^(?:\.\.\/)*node_modules\/(?:onnxruntime-web\/dist\/ort-wasm-simd-threaded\.jspi\.|kokoro-js\/node_modules\/onnxruntime-web\/dist\/ort-wasm-simd-threaded\.(?:wasm|mjs)$)/;

function onnxRuntime(): Plugin {
  return {
    name: "onnx-runtime",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (!/^onnxruntime-web(\/webgpu)?$/.test(source) || importer?.includes("/kokoro-js/")) return null;
      return this.resolve("onnxruntime-web/jspi", importer, { ...options, skipSelf: true });
    },
    generateBundle(_options, bundle) {
      for (const [name, file] of Object.entries(bundle)) {
        const names = file.type === "asset" ? file.originalFileNames : [];
        if (names.some(n => RUNTIME_FILE.test(n) && !WANTED_RUNTIME.test(n))) delete bundle[name];
      }
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), onnxRuntime()],
  resolve: {
    alias: [
      { find: /^kokoro-transformers$/, replacement: `${kokoroTransformers}/dist/transformers.web.js` },
      { find: /^kokoro-ort\//, replacement: `${kokoroRuntime}/` },
    ],
  },
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true,
    target: "chrome140",
    sourcemap: true,
  },
  worker: { format: "es", plugins: () => [onnxRuntime()] },
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
