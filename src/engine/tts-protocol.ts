export interface Voice {
  id: string;
  name: string;
}

export const VOICES: Voice[] = [
  { id: "af_heart", name: "Heart" },
  { id: "af_bella", name: "Bella" },
  { id: "am_michael", name: "Michael" },
  { id: "bf_emma", name: "Emma, British" },
  { id: "bm_george", name: "George, British" },
];

export type TtsIn = { type: "speak"; id: number; text: string; voice: string };

export type TtsOut =
  | { type: "progress"; id: number; fraction: number; stage: "download" | "speak" }
  | { type: "done"; id: number; samples: Float32Array; rate: number }
  | { type: "error"; id: number; message: string };
