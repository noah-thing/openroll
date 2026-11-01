import { VOICES, type TtsOut } from "../../engine/tts-protocol";
import type { TextItem } from "../../core/project";
import type { Editor } from "./editor";
import { addMadeSound, saveWavRecording } from "./sounds";

export { VOICES };

let worker: Worker | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  worker ??= new Worker(new URL("../../engine/tts.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

export interface SpeakProgress {
  stage: "download" | "speak";
  fraction: number;
}

function speak(text: string, voice: string, onProgress: (p: SpeakProgress) => void): Promise<{ samples: Float32Array; rate: number }> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent<TtsOut>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "progress") onProgress(m);
      else {
        w.removeEventListener("message", on);
        if (m.type === "done") resolve({ samples: m.samples, rate: m.rate });
        else reject(new Error(m.message));
      }
    };
    w.addEventListener("message", on);
    w.postMessage({ type: "speak", id, text, voice });
  });
}

/** Turn a text item into narration placed where the text starts. */
export async function readAloud(editor: Editor, item: TextItem, voice: string, onProgress: (p: SpeakProgress | null) => void): Promise<void> {
  const text = item.style.text.trim();
  if (!text) return;
  try {
    onProgress({ stage: "download", fraction: 0 });
    const out = await speak(text, voice, onProgress);
    const file = await saveWavRecording(`Speech ${text.slice(0, 24)}`, [out.samples], out.rate);
    if (!file) throw new Error("The speech could not be saved");
    await addMadeSound(editor, file, "speech", item.start, "Read aloud");
  } catch (err) {
    editor.toast(`Could not read aloud: ${(err as Error).message}`, { tone: "error" });
  } finally {
    onProgress(null);
  }
}
