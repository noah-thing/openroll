declare module "*?worker&url" {
  const url: string;
  export default url;
}

declare module "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js" {
  interface RnnoiseModule {
    HEAPF32: Float32Array;
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    _rnnoise_create(model?: number): number;
    _rnnoise_destroy(state: number): void;
    _rnnoise_process_frame(state: number, out: number, input: number): number;
  }
  export default function createRnnoise(): RnnoiseModule;
}
