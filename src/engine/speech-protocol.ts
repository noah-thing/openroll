export type SpeechModel = "base" | "small";

export const SPEECH_MODELS: Record<SpeechModel, { repo: string; label: string; note: string }> = {
  base: { repo: "Xenova/whisper-base", label: "Base", note: "Fast, about 80 MB" },
  small: { repo: "Xenova/whisper-small", label: "Small", note: "More accurate, about 250 MB" },
};

/** Whisper language names the picker offers, keyed by the ISO code the rest of the app uses. */
export const SPEECH_LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "fa", name: "Persian" },
  { code: "hi", name: "Hindi" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
];

export type SpeechDevice = "auto" | "webgpu" | "wasm";

export type SpeechRequest =
  | {
      kind: "run";
      id: number;
      url: string;
      /** Source range in seconds. */
      from: number;
      to: number;
      model: SpeechModel;
      /** ISO code, or null to let the model decide. */
      language: string | null;
      device: SpeechDevice;
    }
  | { kind: "cancel"; id: number };

export interface SpokenWord {
  text: string;
  /** Seconds in the source file. */
  start: number;
  end: number;
}

export type SpeechStage = "model" | "decode" | "listen";

export type SpeechEvent =
  | { id: number; kind: "progress"; stage: SpeechStage; fraction: number; /** True while bytes are coming over the network. */ downloading?: boolean }
  | {
      id: number;
      kind: "done";
      words: SpokenWord[];
      /** What was spoken, as an ISO code, when it could be told. */
      language: string | null;
      device: "webgpu" | "wasm";
      /** Seconds of audio that was listened to, and how long each stage took. */
      audioSeconds: number;
      timings: { modelMs: number; decodeMs: number; listenMs: number };
    }
  | { id: number; kind: "cancelled" }
  | { id: number; kind: "error"; message: string };
