import { Camera, Vector3 } from 'three';
import { ParsedReplayData } from '../types/replay';
import { buildSoundEvents, SoundEvent, SoundEventCursor, SoundKind } from './events';
import { SOUND_LENGTHS, synthesizeSound } from './synthesis';

export type AudioStatus = 'locked' | 'ready' | 'unavailable';
const MAX_VOICES = 24;
/** Wall-clock seconds between drawn frames the sound schedule must cover (two at 60 fps). */
const FRAME_LEAD = 0.034;
/** Most output latency made up for; beyond this (some Bluetooth headsets) sounds start late. */
const MAX_LATENCY_LEAD = 0.15;

/** Browser audio lives outside React renders and follows the same clock as the scene. */
export class ReplayAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private buffers = new Map<SoundKind, AudioBuffer[]>();
  private voices = new Map<AudioBufferSourceNode, () => void>();
  private cursor = new SoundEventCursor([]);
  private volume = 0.65;
  private muted = false;
  private disposed = false;
  private unavailable = false;
  private right = new Vector3();

  constructor(private readonly onStatus: (status: AudioStatus) => void) {
    // Create/resume directly in a gesture, including the initial Load sample click.
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private unlock = () => {
    if (this.disposed || this.unavailable) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -8;
        this.compressor.knee.value = 14;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.005;
        this.compressor.release.value = 0.16;
        this.master.connect(this.compressor);
        this.compressor.connect(this.context.destination);
        for (const kind of Object.keys(SOUND_LENGTHS) as SoundKind[]) {
          this.buffers.set(kind, [0, 1, 2].map((variant) => {
            const samples = synthesizeSound(kind, this.context!.sampleRate, variant);
            const buffer = this.context!.createBuffer(1, samples.length, this.context!.sampleRate);
            buffer.getChannelData(0).set(samples);
            return buffer;
          }));
        }
      }
      if (this.context.state === 'running') { this.onStatus('ready'); return; }
      void this.context.resume().then(() => {
        if (!this.disposed) this.onStatus(this.context?.state === 'running' ? 'ready' : 'locked');
      }).catch(() => { if (!this.disposed) this.onStatus('locked'); });
    } catch (error) {
      this.unavailable = true;
      this.onStatus('unavailable');
      console.warn('[ReplayAudio] Audio is unavailable:', error);
    }
  };

  private onVisibility = () => {
    this.stop();
    this.cursor.reset();
    if (document.hidden && this.context?.state === 'running') {
      void this.context.suspend().catch(() => {});
    } else if (!document.hidden && this.context) {
      this.unlock();
    }
  };

  public setReplay(data: ParsedReplayData) {
    this.stop();
    this.cursor = new SoundEventCursor(buildSoundEvents(data));
    this.cursor.reset(0);
  }

  public setMix(volume: number, muted: boolean) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.015);
    }
    if (muted || this.volume === 0) this.stop();
  }

  public seek(time: number) {
    this.stop();
    this.cursor.reset(time);
  }

  /**
   * Plays the sounds due by the next drawn frame. Each one is scheduled ahead on the audio
   * clock, early by the output latency, so a hit is heard on the frame the ball turns
   * rather than a frame or two plus the speaker delay after it.
   */
  public update(time: number, playing: boolean, speed: number, camera: Camera) {
    const latency = this.outputLatency();
    const events = this.cursor.advance(time + (FRAME_LEAD + latency) * speed, playing, speed);
    if (!playing || document.hidden) { this.stop(); return; }
    if (!this.context || this.context.state !== 'running' || this.muted || this.volume === 0) return;
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const event of events) this.play(event, time, speed, camera, latency);
  }

  /** Seconds from scheduling a sound to hearing it, as far as the browser reports it. */
  private outputLatency(): number {
    const context = this.context;
    if (!context) return 0;
    const latency = (context.outputLatency || 0) + (context.baseLatency || 0);
    return Math.min(Math.max(latency, 0), MAX_LATENCY_LEAD);
  }

  private play(event: SoundEvent, time: number, speed: number, camera: Camera, latency: number) {
    const context = this.context!;
    const buffers = this.buffers.get(event.kind);
    if (!buffers || !this.master || this.voices.size >= MAX_VOICES) return;
    const buffer = buffers[Math.abs(Math.round(event.time * 1000)) % buffers.length];
    // Wall-clock wait until the sound should start leaving the speakers; a sound already
    // under way starts partway through (the buffer plays at `speed`).
    const delay = (event.time - time) / speed - latency;
    const offset = Math.max(0, -delay) * speed;
    if (offset >= buffer.duration) return;
    const dx = event.position.x - camera.position.x;
    const dy = event.position.y - camera.position.y;
    const dz = event.position.z - camera.position.z;
    const distance = Math.hypot(dx, dy, dz);
    const falloffRadius =
      event.kind === 'demo' ? 3500 :
      event.kind === 'ball' ? 1950 :
      event.kind === 'reset' ? 1400 :
      event.kind === 'bump' ? 1200 :
      event.kind === 'dodge' ? 850 :
      event.kind === 'jump' ? 750 : 550; // 'land' stays tight around the watched car
    const attenuation = 1 / (1 + (distance / falloffRadius) ** 1.65);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.min(2, Math.max(0.25, speed));
    const gain = context.createGain();
    const kindWeight =
      event.kind === 'land' ? 0.58 :
      event.kind === 'jump' ? 0.68 :
      event.kind === 'dodge' ? 0.75 :
      event.kind === 'bump' ? 0.82 : 1.0;
    const dynamicCurve = event.kind === 'ball'
      ? 0.12 + 0.88 * Math.pow(event.strength, 1.3)
      : 0.22 + 0.78 * event.strength;
    gain.gain.value = kindWeight * dynamicCurve * attenuation;
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-0.85, Math.min(0.85,
      (dx * this.right.x + dy * this.right.y + dz * this.right.z) / Math.max(distance, 1)));
    source.connect(gain);
    gain.connect(pan);
    pan.connect(this.master);
    const cleanup = () => {
      source.onended = null;
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
      this.voices.delete(source);
    };
    this.voices.set(source, cleanup);
    source.onended = cleanup;
    source.start(context.currentTime + Math.max(0, delay), offset);
  }

  public stop() {
    for (const [source, cleanup] of this.voices) {
      source.stop();
      cleanup();
    }
  }

  public dispose() {
    this.disposed = true;
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stop();
    this.buffers.clear();
    this.master?.disconnect();
    this.compressor?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
  }
}
