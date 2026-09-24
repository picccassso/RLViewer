import { SoundKind } from './events';

export const SOUND_LENGTHS: Record<SoundKind, number> = {
  ball: 0.22, demo: 1.1, bump: 0.3, jump: 0.18, dodge: 0.26, land: 0.2, reset: 0.32,
};

/** Small, original game-like effects; deterministic PCM, generated once, with no downloads. */
export function synthesizeSound(kind: SoundKind, sampleRate: number, variant = 0): Float32Array {
  const duration = SOUND_LENGTHS[kind];
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const pitch = 0.94 + variant * 0.06;
  let seed = 1837 + variant * 7919;
  let lowNoise = 0;
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const u = t / duration;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = ((seed >>> 0) / 2147483648) - 1;
    const cutoff = kind === 'demo' ? 700 : kind === 'dodge' ? 3200 : 1800;
    lowNoise += (1 - Math.exp(-2 * Math.PI * cutoff / sampleRate)) * (noise - lowNoise);
    let value = 0;
    let frequency = 100;
    if (kind === 'ball') frequency = 85 + 180 * Math.exp(-t * 32);
    if (kind === 'demo') frequency = 34 + 65 * Math.exp(-t * 12);
    if (kind === 'bump') frequency = 70 + 100 * Math.exp(-t * 25);
    if (kind === 'jump') frequency = 130 + 270 * Math.exp(-t * 20);
    if (kind === 'dodge') frequency = 150 + 230 * u;
    if (kind === 'land') frequency = 65 + 70 * Math.exp(-t * 28);
    if (kind === 'reset') frequency = 1100 + 500 * u;
    phase += 2 * Math.PI * frequency * pitch / sampleRate;
    const tone = Math.sin(phase);
    switch (kind) {
      case 'ball': value = tone * 0.7 * Math.exp(-t * 22) + lowNoise * 0.65 * Math.exp(-t * 50); break;
      case 'demo': value = tone * 0.8 * Math.exp(-t * 5) + lowNoise * 2.2 * Math.exp(-t * 4) + noise * 0.2 * Math.exp(-t * 30); break;
      case 'bump': value = tone * 0.5 * Math.exp(-t * 20) + Math.sin(phase * 3.73) * 0.2 * Math.exp(-t * 30) + lowNoise * Math.exp(-t * 22); break;
      case 'jump': value = tone * 0.3 * Math.exp(-t * 23) + lowNoise * 0.6 * Math.exp(-t * 19); break;
      case 'dodge': value = lowNoise * 0.85 * Math.sin(Math.PI * u) * Math.exp(-t * 5) + tone * 0.12 * Math.exp(-t * 14); break;
      case 'land': value = tone * 0.5 * Math.exp(-t * 30) + lowNoise * 0.9 * Math.exp(-t * 26); break;
      case 'reset': value = (tone * 0.25 + Math.sin(phase * 1.5) * 0.12) * Math.exp(-t * 17); break;
    }
    // Short edge ramps avoid clicks; leave headroom for simultaneous impacts.
    const edge = Math.min(1, t / 0.002, (duration - t) / 0.018);
    samples[i] = Math.tanh(value) * 0.7 * Math.max(0, edge);
  }
  return samples;
}
