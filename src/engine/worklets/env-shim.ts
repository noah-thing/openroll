// The Emscripten glue inside the RNNoise build probes for a browser global to pick its
// environment, and an audio worklet has none. Imported first so the probe succeeds.
const scope = globalThis as unknown as Record<string, unknown>;
if (typeof scope.window === "undefined") scope.window = globalThis;
