import { buildCorrection, type CameraPath, type Correction } from "../../core/ai";
import type { AiSync, MatteTrack } from "./protocol";

/**
 * What a render worker knows about analysed clips. The page keeps the results and sends
 * them over as they arrive; preview and export both read through here, so a matte or a
 * steady path means the same thing in each.
 */
export class AiStore {
  private mattes = new Map<string, MatteTrack>();
  private cameras = new Map<string, CameraPath>();
  private corrections = new Map<string, Correction>();
  /** Bumps when anything changes, so a worker knows to redraw. */
  version = 0;

  sync(m: AiSync): void {
    this.version++;
    switch (m.kind) {
      case "matte-info":
        this.mattes.set(m.media, { ...m.track, data: new Uint8Array(m.track.width * m.track.height * m.track.count) });
        break;
      case "matte-part": {
        const t = this.mattes.get(m.media);
        if (!t) break;
        const size = t.width * t.height;
        t.data.set(m.bytes, m.from * size);
        t.ready = Math.max(t.ready, m.from + m.bytes.byteLength / size);
        break;
      }
      case "camera":
        this.cameras.set(m.media, m.path);
        for (const key of this.corrections.keys()) if (key.startsWith(m.media + "|")) this.corrections.delete(key);
        break;
      case "clear":
        if (m.what === "matte") this.mattes.delete(m.media);
        else {
          this.cameras.delete(m.media);
          for (const key of this.corrections.keys()) if (key.startsWith(m.media + "|")) this.corrections.delete(key);
        }
        break;
    }
  }

  matte(media: string): MatteTrack | undefined {
    return this.mattes.get(media);
  }

  /** The correction for a clip at a strength, worked out once and kept until the path changes. */
  correction(media: string, strength: number, aspect: number): Correction | undefined {
    const path = this.cameras.get(media);
    if (!path) return undefined;
    const key = `${media}|${strength.toFixed(3)}|${aspect.toFixed(3)}`;
    let c = this.corrections.get(key);
    if (!c) {
      // only the latest strength is worth keeping while a slider is dragged
      for (const k of this.corrections.keys()) if (k.startsWith(media + "|")) this.corrections.delete(k);
      c = buildCorrection(path, strength, aspect);
      this.corrections.set(key, c);
    }
    return c;
  }
}
