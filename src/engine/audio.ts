import { ALL_FORMATS, AudioBufferSink, Input, UrlSource, type InputAudioTrack } from "mediabunny";
import type { MediaItem, MediaRef, Micros, Project } from "../core/project";
import { itemEnd } from "../core/project";
import { audible } from "../core/audio-plan";
import { localAtPlayed, playedOffset, speedNow } from "../core/speed";
import { buildChain, createBus, loadWorklet, setRate, type ItemChain } from "./audio-graph";

/** Seconds of audio scheduled ahead of what is playing. */
const LEAD = 1.2;
/** Delay before the first sample plays, so the first buffers are decoded in time. */
const START_DELAY = 0.08;
/** How long a finished voice stays connected, so echo and reverb tails ring out. */
const TAIL_MS = 2500;

interface Voice {
  cancelled: boolean;
  /** Every buffer of the clip has been scheduled. */
  done: boolean;
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
    const voice: Voice = { cancelled: false, done: false, nodes: new Set(), gain, chain };
    this.voices.push(voice);
    void this.runVoice(voice, item, media, url)
      .catch(err => console.warn("audio voice stopped", err))
      .finally(() => {
        voice.done = true;
        this.retire(voice);
      });
  }

  /** A clip that has played out would otherwise hold its nodes until the next stop, which a long timeline never reaches. */
  private retire(voice: Voice): void {
    if (!voice.done || voice.cancelled || voice.nodes.size) return;
    setTimeout(() => {
      if (voice.cancelled) return;
      voice.cancelled = true;
      voice.gain.disconnect();
      voice.chain.output.disconnect();
      this.voices = this.voices.filter(v => v !== voice);
    }, TAIL_MS);
  }

  private async runVoice(voice: Voice, item: MediaItem, media: MediaRef, url: string): Promise<void> {
    const track = await this.trackFor(media, url);
    if (!track || voice.cancelled) return;
    const sink = new AudioBufferSink(track);
    const from = Math.max(this.startT, item.start);
    const srcStart = (item.in + playedOffset(item, from - item.start)) / 1e6;
    const srcEnd = (item.in + playedOffset(item, item.duration)) / 1e6;

    for await (const { buffer, timestamp } of sink.buffers(srcStart, srcEnd)) {
      if (voice.cancelled) break;
      // timeline position of this buffer's first sample
      const tl = item.start + localAtPlayed(item, timestamp * 1e6 - item.in);
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
      let skipped = 0;
      if (late > 0) {
        // decoder fell behind: skip what we missed rather than play it late and drift
        skipped = item.ramp ? sourceSkipped(item, timestamp + offset, late) : late * item.speed;
        offset += skipped;
        when = this.ctx.currentTime;
        if (offset >= buffer.duration) continue;
      }
      const node = this.ctx.createBufferSource();
      node.buffer = buffer;
      const length = Math.max(0, duration - skipped);
      setRate(node, item, when, timestamp + offset, timestamp + offset + length);
      node.connect(voice.chain.input);
      node.onended = () => {
        voice.nodes.delete(node);
        this.retire(voice);
      };
      node.start(when, offset, length);
      voice.nodes.add(node);

      const ahead = when - this.ctx.currentTime;
      if (ahead > LEAD) await sleep((ahead - LEAD) * 1000);
    }
  }

  private scrubSinks = new Map<string, AudioBufferSink>();
  private scrubBusy = false;
  private scrubWanted: { p: Project; t: Micros; urls: Record<string, string> } | null = null;
  private scrubVoice: GainNode | null = null;

  /**
   * Sound for one spot while the playhead is dragged: a few tens of milliseconds from
   * each audible clip under it. Calls arrive faster than decoding, so only the latest
   * position waits its turn.
   */
  scrub(p: Project, t: Micros, urls: Record<string, string>): void {
    if (this.running) return;
    this.scrubWanted = { p, t, urls };
    if (this.scrubBusy) return;
    this.scrubBusy = true;
    void this.scrubLoop().finally(() => (this.scrubBusy = false));
  }

  private async scrubLoop(): Promise<void> {
    while (this.scrubWanted) {
      const { p, t, urls } = this.scrubWanted;
      this.scrubWanted = null;
      if (this.ctx.state !== "running") await this.ctx.resume();
      for (const track of p.tracks) {
        if (track.muted) continue;
        for (const item of track.items) {
          if (item.type !== "media" || item.freeze || item.volume <= 0 || t < item.start || t >= itemEnd(item)) continue;
          const media = p.media[item.mediaId];
          if (!media?.hasAudio || !urls[media.id]) continue;
          await this.grain(item, media, urls[media.id], t).catch(() => {});
        }
      }
      await sleep(30);
    }
  }

  private async grain(item: MediaItem, media: MediaRef, url: string, t: Micros): Promise<void> {
    const track = await this.trackFor(media, url);
    if (!track) return;
    let sink = this.scrubSinks.get(media.id);
    if (!sink) {
      sink = new AudioBufferSink(track);
      this.scrubSinks.set(media.id, sink);
    }
    const played = playedOffset(item, t - item.start);
    const src = (item.reversed ? item.in + (item.ramp ? item.ramp.span : item.duration * item.speed) - played : item.in + played) / 1e6;
    const wrapped = await sink.getBuffer(src);
    if (!wrapped) return;
    const offset = Math.max(0, src - wrapped.timestamp);
    const length = Math.min(0.07, wrapped.buffer.duration - offset);
    if (length <= 0.005) return;
    // Cut the previous grain short so fast drags do not pile up into a smear.
    if (this.scrubVoice) {
      this.scrubVoice.gain.setTargetAtTime(0, this.ctx.currentTime, 0.004);
      this.scrubVoice = null;
    }
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    const peak = Math.min(1, item.volume) * 0.9;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.006);
    gain.gain.setValueAtTime(peak, now + Math.max(0.006, length - 0.012));
    gain.gain.linearRampToValueAtTime(0, now + length);
    gain.connect(this.master);
    const node = this.ctx.createBufferSource();
    node.buffer = wrapped.buffer;
    node.playbackRate.value = item.reversed ? 1 : item.ramp ? Math.min(4, Math.max(0.25, speedNow(item, t - item.start))) : item.speed;
    node.connect(gain);
    node.onended = () => gain.disconnect();
    node.start(now, offset, length);
    this.scrubVoice = gain;
  }

  dispose(): void {
    this.stop();
    if (this.ctx.state !== "closed") void this.ctx.close().catch(() => {});
  }
}

/** Source seconds a ramped clip gets through in `late` seconds of timeline, starting from source second `from`. */
function sourceSkipped(item: MediaItem, from: number, late: number): number {
  const l = localAtPlayed(item, from * 1e6 - item.in);
  return (playedOffset(item, l + late * 1e6) - playedOffset(item, l)) / 1e6;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
