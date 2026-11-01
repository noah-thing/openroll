import { VideoSampleSink, type InputVideoTrack, type VideoSample } from "mediabunny";

/** How many frames to decode past the playhead while playing. Hardware decoders hold few surfaces. */
const AHEAD = 3;
/** Within this distance forward it is cheaper to keep decoding than to seek. */
const NEAR_SECONDS = 0.6;

/**
 * Pulls frames for one clip. The render loop says where it wants to be with `want()`
 * every frame and draws whatever `frame()` has; decoding runs behind that and never
 * blocks a paint. When requests outrun the decoder (fast scrubbing) only the newest
 * request is honoured, so the picture catches up instead of replaying a backlog.
 */
export class VideoReader {
  private sink: VideoSampleSink;
  private frames: VideoSample[] = [];
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private iterDone = false;
  private target = 0;
  private playing = false;
  private running = false;
  private disposed = false;
  private version = 0;
  private seekedTo = -1;
  onFrame: (() => void) | null = null;
  /** Frames drawn while playing and how many of them were not the exact frame, for spotting sources that decode too slowly. */
  playedFrames = 0;
  lateFrames = 0;
  /** Time from a new target to the first exact frame for it, for the stats overlay. */
  onSettle: ((ms: number) => void) | null = null;
  private wantedAt = 0;
  private settled = true;

  /** Set from user settings before readers are made; a reader that finds hardware unsupported still falls back on its own. */
  static preferHardware = true;
  private hardware = VideoReader.preferHardware;
  private failed = false;

  constructor(readonly track: InputVideoTrack, private duration: number) {
    this.sink = this.makeSink();
  }

  private makeSink(): VideoSampleSink {
    return new VideoSampleSink(this.track, { hardwareAcceleration: this.hardware ? "prefer-hardware" : VideoReader.preferHardware ? "no-preference" : "prefer-software", optimizeForLatency: true });
  }

  /** Source time in seconds. */
  want(t: number, playing: boolean): void {
    const next = Math.min(Math.max(0, t), Math.max(0, this.duration - 1e-3));
    if (next !== this.target && !playing) {
      this.wantedAt = performance.now();
      this.settled = false;
    }
    this.target = next;
    this.playing = playing;
    if (!this.running && !this.failed) void this.pump();
  }

  /** The frame that covers the wanted time, or the closest one decoded so far. */
  frame(): { sample: VideoSample; version: number; exact: boolean } | null {
    const t = this.target;
    let best: VideoSample | null = null;
    for (const f of this.frames) {
      if (f.timestamp <= t + 1e-4) best = f;
      else break;
    }
    best ??= this.frames[0] ?? null;
    if (!best) return null;
    const exact = best.timestamp <= t + 1e-4 && t < best.timestamp + Math.max(best.duration, 1 / 120);
    if (this.playing) {
      this.playedFrames++;
      if (!exact) this.lateFrames++;
    }
    if (exact && !this.settled) {
      this.settled = true;
      this.onSettle?.(performance.now() - this.wantedAt);
    }
    return { sample: best, version: this.version * 10_000 + Math.round(best.timestamp * 1000), exact };
  }

  private covering(t: number): number {
    for (let i = 0; i < this.frames.length; i++) {
      const f = this.frames[i];
      const end = f.timestamp + Math.max(f.duration, 1 / 120);
      if (f.timestamp <= t + 1e-4 && t < end) return i;
    }
    return -1;
  }

  private async pump(): Promise<void> {
    this.running = true;
    let retry = false;
    try {
      while (!this.disposed) {
        const t = this.target;
        let at = this.covering(t);
        if (at < 0) {
          const first = this.frames[0], last = this.frames.at(-1);
          // Streams can start after zero and end before the container says; take the nearest edge.
          if (first && t === this.seekedTo && first.timestamp >= t) at = 0;
          else if (last && this.iterDone && t >= last.timestamp) at = this.frames.length - 1;
          else if (!first && this.iterDone && t === this.seekedTo) break;
        }
        if (at >= 0) {
          this.dropBefore(at);
          if (!this.playing || this.iterDone || this.frames.length > AHEAD) break;
          if (!(await this.pull())) break;
          continue;
        }
        const last = this.frames.at(-1);
        const near = this.iter && !this.iterDone && last && t >= this.frames[0].timestamp && t - last.timestamp < NEAR_SECONDS;
        if (near) {
          if (!(await this.pull())) break;
          // keep one frame behind the target on screen until the right one lands
          const keep = Math.max(0, this.frames.findIndex(f => f.timestamp > t) - 1);
          if (keep > 0) this.dropBefore(keep);
        } else {
          await this.seek(t);
        }
        this.onFrame?.();
      }
    } catch (err) {
      if (this.disposed) return;
      // Some streams (4:4:4, 10 bit on older GPUs) only decode in software. Retry once that way.
      if (this.hardware && err instanceof DOMException && err.name === "NotSupportedError") {
        this.hardware = false;
        await this.closeIter();
        this.sink = this.makeSink();
        retry = true;
        return;
      }
      this.failed = true;
      console.warn("decoding stopped for good", err);
    } finally {
      this.running = false;
      if (retry) void this.pump();
    }
  }

  private async seek(t: number): Promise<void> {
    await this.closeIter();
    this.seekedTo = t;
    this.iter = this.sink.samples(t);
    this.iterDone = false;
    this.version++;
    const first = await this.iter.next();
    if (this.disposed) {
      if (!first.done) first.value.close();
      return;
    }
    // Swap in the new frame only once it exists, so the old picture stays up during the seek.
    for (const f of this.frames) f.close();
    this.frames = [];
    if (first.done) this.iterDone = true;
    else this.frames.push(first.value);
  }

  private async pull(): Promise<boolean> {
    if (!this.iter) return false;
    const next = await this.iter.next();
    if (this.disposed) {
      if (!next.done) next.value.close();
      return false;
    }
    if (next.done) {
      this.iterDone = true;
      return false;
    }
    this.frames.push(next.value);
    return true;
  }

  private dropBefore(index: number): void {
    if (index <= 0) return;
    for (const f of this.frames.splice(0, index)) f.close();
  }

  private async closeIter(): Promise<void> {
    const it = this.iter;
    this.iter = null;
    if (it) await it.return(undefined).catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.frames) f.close();
    this.frames = [];
    void this.closeIter();
  }
}
