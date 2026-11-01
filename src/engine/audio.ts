import { ALL_FORMATS, AudioBufferSink, Input, UrlSource, type InputAudioTrack } from "mediabunny";
import type { MediaItem, MediaRef, Micros, Project } from "../core/project";
import { itemEnd } from "../core/project";
import { audible } from "../core/audio-plan";
import { buildChain, createBus, loadWorklet, type ItemChain } from "./audio-graph";

/** Seconds of audio scheduled ahead of what is playing. */
const LEAD = 1.2;
/** Delay before the first sample plays, so the first buffers are decoded in time. */
const START_DELAY = 0.08;

interface Voice {
  cancelled: boolean;
  nodes: Set<AudioBufferSourceNode>;
  /** Fades the voice out when playback stops. */
  gain: GainNode;
  chain: ItemChain;
}

/**
 * Plays the project's audio and is the master clock while playing. Video follows this
 * clock, never the other way round, because a dropped video frame is invisible and a
 * dropped audio sample is a click.
 */
export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
  private master = this.ctx.createGain();
  private voices: Voice[] = [];
  private tracks = new Map<string, Promise<InputAudioTrack | null>>();
  private startCtx = 0;
  private startT: Micros = 0;
  private running = false;
  private timers: number[] = [];
  private project: Project | null = null;
  private workletReady: Promise<void>;

  constructor() {
    this.master.connect(createBus(this.ctx, this.ctx.destination));
    this.workletReady = loadWorklet(this.ctx).catch(err => console.warn("audio worklet failed to load", err));
  }

  get playing(): boolean {
    return this.running;
  }

  set volume(v: number) {
    this.master.gain.value = v;
  }

  /** Timeline time now, in microseconds. */
  now(): Micros {
    if (!this.running) return this.startT;
    return this.startT + Math.max(0, this.ctx.currentTime - this.startCtx) * 1e6;
  }

  /** Wall clock (timeOrigin + performance.now(), ms) at which the timeline reads `startT`. */
  wallAtStart(): number {
    const ts = this.ctx.getOutputTimestamp();
    const ctxTime = ts.contextTime ?? this.ctx.currentTime;
    const perf = ts.performanceTime ?? performance.now();
    return performance.timeOrigin + perf + (this.startCtx - ctxTime) * 1000;
  }

  async play(p: Project, t: Micros, urls: Record<string, string>): Promise<void> {
    this.stop();
    if (this.ctx.state !== "running") await this.ctx.resume();
    await this.workletReady;
    this.project = p;
    this.running = true;
    this.startT = t;
    this.startCtx = this.ctx.currentTime + START_DELAY;
    for (const track of p.tracks) {
      if (track.muted) continue;
      for (const item of track.items) {
        if (item.type !== "media") continue;
        const media = p.media[item.mediaId];
        if (!audible(item, media) || itemEnd(item) <= t || !urls[media.id]) continue;
        const lead = (item.start - t) / 1e6 - LEAD * 2;
        if (lead > 0) this.timers.push(window.setTimeout(() => this.running && this.startVoice(item, media, urls[media.id]), lead * 1000));
        else this.startVoice(item, media, urls[media.id]);
      }
    }
  }

  stop(): void {
    this.running = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    for (const v of this.voices) {
      v.cancelled = true;
      for (const n of v.nodes) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      // fade the voice out over a few ms instead of cutting, which clicks
      v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.005);
      setTimeout(() => {
        v.gain.disconnect();
        v.chain.output.disconnect();
      }, 60);
    }
    this.voices = [];
  }

  /** Remember where to start next time; while stopped this is also what now() reports. */
  seek(t: Micros): void {
    this.startT = t;
  }

  private trackFor(media: MediaRef, url: string): Promise<InputAudioTrack | null> {
    let t = this.tracks.get(media.id);
    if (!t) {
      const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
      t = input.getPrimaryAudioTrack().catch(() => null);
      this.tracks.set(media.id, t);
    }
    return t;
  }

  private ctxTimeFor(t: Micros): number {
    return this.startCtx + (t - this.startT) / 1e6;
  }

  private startVoice(item: MediaItem, media: MediaRef, url: string): void {
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    let chain: ItemChain;
    try {
      chain = buildChain(this.ctx, this.project!, item, media, { from: this.startT, toCtx: t => this.ctxTimeFor(t), now: this.ctx.currentTime });
    } catch (err) {
      console.warn("audio chain failed", err);
      return;
    }
    chain.output.connect(gain);
    const voice: Voice = { cancelled: false, nodes: new Set(), gain, chain };
    this.voices.push(voice);
    void this.runVoice(voice, item, media, url).catch(err => console.warn("audio voice stopped", err));
  }

  private async runVoice(voice: Voice, item: MediaItem, media: MediaRef, url: string): Promise<void> {
    const track = await this.trackFor(media, url);
    if (!track || voice.cancelled) return;
    const sink = new AudioBufferSink(track);
    const from = Math.max(this.startT, item.start);
    const srcStart = (item.in + (from - item.start) * item.speed) / 1e6;
    const srcEnd = (item.in + item.duration * item.speed) / 1e6;

    for await (const { buffer, timestamp } of sink.buffers(srcStart, srcEnd)) {
      if (voice.cancelled) break;
      // timeline position of this buffer's first sample
      const tl = item.start + ((timestamp * 1e6 - item.in) / item.speed);
      const lead = voice.chain.latency;
      let when = this.ctxTimeFor(tl) - lead;
      let offset = 0;
      if (timestamp < srcStart) {
        offset = srcStart - timestamp;
        when = this.ctxTimeFor(from) - lead;
      }
      const remaining = srcEnd - (timestamp + offset);
      const duration = Math.min(buffer.duration - offset, remaining);
      if (duration <= 0) continue;
      const late = this.ctx.currentTime - when;
      if (late > 0) {
        // decoder fell behind: skip what we missed rather than play it late and drift
        offset += late * item.speed;
        when = this.ctx.currentTime;
        if (offset >= buffer.duration) continue;
      }
      const node = this.ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = item.speed;
      node.connect(voice.chain.input);
      node.onended = () => voice.nodes.delete(node);
      node.start(when, offset, Math.max(0, duration - (late > 0 ? late * item.speed : 0)));
      voice.nodes.add(node);

      const ahead = when - this.ctx.currentTime;
      if (ahead > LEAD) await sleep((ahead - LEAD) * 1000);
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx.state !== "closed") void this.ctx.close().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
