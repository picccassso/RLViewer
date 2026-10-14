import { SoundKind } from './events';

export const SOUND_LENGTHS: Record<SoundKind, number> = {
  ball: 0.22,
  demo: 1.1,
  bump: 0.3,
  jump: 0.18,
  dodge: 0.26,
  land: 0.2,
  reset: 0.32,
};

/**
 * Clean, linear, multi-pole filtered synthesis for Rocket League-style sound effects.
 * Avoids downward drum-sweep sine waves and intermodulation distortion (`tanh` on tone+noise)
 * so every effect sounds smooth, aerodynamic, and futuristic rather than percussive or rough:
 * - `ball`: Futuristic hollow composite-metallic sphere ping + tight pneumatic thwack
 * - `jump`: Smooth upward pneumatic thruster air-jet (`psshh` lift, no drum thump)
 * - `dodge`: Soft-attack aerodynamic wind-shear swoosh
 * - `land`: Soft cushioned turf brush & quiet suspension settle
 * - `bump`: Clean composite fender impact
 * - `demo`: Deep 4-pole filtered cinematic fireball boom & sparkle
 * - `reset`: Silky futuristic D-major synth shimmer chord
 */
export function synthesizeSound(kind: SoundKind, sampleRate: number, variant = 0): Float32Array {
  const duration = SOUND_LENGTHS[kind];
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const pitch = 0.97 + variant * 0.03;
  let seed = (2463534242 + variant * 79191) | 0;

  // 2-pole Chamberlin State-Variable Filter + two cascaded smoothing poles (4-pole total rolloff)
  let svfLp = 0;
  let svfBp = 0;
  let pole1 = 0;
  let pole2 = 0;

  // Oscillator phase accumulators
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let p4 = 0;

  const dt = 1 / sampleRate;

  for (let i = 0; i < samples.length; i++) {
    const t = i * dt;
    const u = t / duration;

    // Deterministic triangular-PDF dithered noise in [-1, 1] (smoother than uniform white noise)
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const n1 = (seed >>> 0) / 4294967296;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const n2 = (seed >>> 0) / 4294967296;
    const noise = n1 - n2;

    let cutoff = 1000;
    let damp = 0.65;
    let smoothCutoff = 1600;
    let useBandpass = true;

    if (kind === 'ball') {
      cutoff = 650 + 1400 * Math.exp(-t * 65);
      damp = 0.55;
      smoothCutoff = 2200;
      useBandpass = true;
    } else if (kind === 'jump') {
      // Upward pneumatic thruster air sweep
      cutoff = 680 + 1450 * Math.pow(u, 0.65);
      damp = 0.42;
      smoothCutoff = 2400;
      useBandpass = true;
    } else if (kind === 'dodge') {
      // Silky wind-shear whoosh
      const curve = Math.sin(Math.PI * Math.pow(u, 0.8));
      cutoff = 420 + 1150 * curve;
      damp = 0.45;
      smoothCutoff = 1800;
      useBandpass = true;
    } else if (kind === 'land') {
      // Cushioned turf brush
      cutoff = 240 + 380 * Math.exp(-t * 30);
      damp = 0.8;
      smoothCutoff = 520;
      useBandpass = false;
    } else if (kind === 'bump') {
      cutoff = 380 + 950 * Math.exp(-t * 40);
      damp = 0.6;
      smoothCutoff = 1400;
      useBandpass = true;
    } else if (kind === 'demo') {
      // Warm cinematic explosion rumble
      cutoff = 95 + 620 * Math.exp(-t * 5.5);
      damp = 0.7;
      smoothCutoff = 480 + 500 * Math.exp(-t * 8);
      useBandpass = false;
    } else if (kind === 'reset') {
      cutoff = 1600 + 1000 * u;
      damp = 0.4;
      smoothCutoff = 3200;
      useBandpass = true;
    }

    const f = Math.min(0.68, 2 * Math.sin((Math.PI * Math.min(cutoff * pitch, sampleRate * 0.32)) / sampleRate));
    svfLp += f * svfBp;
    const svfHp = noise - svfLp - damp * svfBp;
    svfBp += f * svfHp;

    const rawFiltered = useBandpass ? svfBp : svfLp;
    const aSmooth = 1 - Math.exp((-2 * Math.PI * Math.min(smoothCutoff, sampleRate * 0.36)) / sampleRate);
    pole1 += aSmooth * (rawFiltered - pole1);
    pole2 += aSmooth * (pole1 - pole2);

    let value = 0;

    switch (kind) {
      case 'ball': {
        // Futuristic Rocket League ball hit: tight composite thwack + harmonic metallic shell ping
        const envFast = (1 - Math.exp(-t * 350)) * Math.exp(-t * 42);
        const envPing = (1 - Math.exp(-t * 280)) * Math.exp(-t * 22);

        // Subtle high-mid metallic shell harmonics (no 808 drum sweep!)
        p1 += 2 * Math.PI * 112 * pitch * dt;
        p2 += 2 * Math.PI * 392 * pitch * dt;
        p3 += 2 * Math.PI * 588 * pitch * dt;
        p4 += 2 * Math.PI * 980 * pitch * dt;

        const punch = Math.sin(p1) * 0.28 * envFast;
        const metallicPing =
          (Math.sin(p2) * 0.22 +
            Math.sin(p3) * 0.16 * Math.exp(-t * 10) +
            Math.sin(p4) * 0.08 * Math.exp(-t * 22)) *
          envPing;
        const airSnap = pole2 * 0.42 * envFast;

        value = punch + metallicPing + airSnap;
        break;
      }

      case 'jump': {
        // Smooth upward pneumatic thruster burst (soft 10ms attack, upward harmonic air glide)
        const env = Math.sin(Math.PI * Math.min(1, t / 0.014)) * Math.exp(-t * 16);
        const f1 = (320 + 340 * Math.pow(u, 0.7)) * pitch;
        const f2 = f1 * 1.5;
        p1 += 2 * Math.PI * f1 * dt;
        p2 += 2 * Math.PI * f2 * dt;

        const thrusterTone = (Math.sin(p1) * 0.18 + Math.sin(p2) * 0.11) * env;
        const pneumaticAir = pole2 * 0.68 * (1 - Math.exp(-t * 110)) * Math.exp(-t * 15);
        value = thrusterTone + pneumaticAir;
        break;
      }

      case 'dodge': {
        // Aerodynamic rotational wind-whoosh (smooth raised-sine swell, zero percussive click)
        const swell = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 1.3) * Math.exp(-t * 3.8);
        const glideFreq = (240 + 180 * Math.sin(Math.PI * Math.pow(u, 0.65))) * pitch;
        p1 += 2 * Math.PI * glideFreq * dt;
        p2 += 2 * Math.PI * glideFreq * 1.5 * dt;

        const windShear = pole2 * 0.82 * swell;
        const turbine = (Math.sin(p1) * 0.15 + Math.sin(p2) * 0.09) * swell;
        value = windShear + turbine;
        break;
      }

      case 'land': {
        // Soft cushioned turf brush + subtle suspension settle (no hollow drum tone)
        const env = (1 - Math.exp(-t * 110)) * Math.exp(-t * 24);
        p1 += 2 * Math.PI * 105 * pitch * dt;
        p2 += 2 * Math.PI * 168 * pitch * dt;

        const turfBrush = pole2 * 0.55 * env;
        const suspension = (Math.sin(p1) * 0.18 + Math.sin(p2) * 0.09) * env * Math.exp(-t * 12);
        value = turfBrush + suspension;
        break;
      }

      case 'bump': {
        // Clean composite chassis impact (warm mid-band modal resonance + filtered air crunch)
        const env = (1 - Math.exp(-t * 260)) * Math.exp(-t * 21);
        p1 += 2 * Math.PI * 165 * pitch * dt;
        p2 += 2 * Math.PI * 295 * pitch * dt;
        p3 += 2 * Math.PI * 465 * pitch * dt;

        const chassis =
          (Math.sin(p1) * 0.25 +
            Math.sin(p2) * 0.20 * Math.exp(-t * 8) +
            Math.sin(p3) * 0.12 * Math.exp(-t * 18)) *
          env;
        const crunch = pole2 * 0.52 * env;
        value = chassis + crunch;
        break;
      }

      case 'demo': {
        // Cinematic explosion: smooth sub-bass drop + warm 4-pole filtered roar + harmonic embers
        const subFreq = (38 + 32 * Math.exp(-t * 8)) * pitch;
        const warmFreq = (76 + 40 * Math.exp(-t * 6)) * pitch;
        p1 += 2 * Math.PI * subFreq * dt;
        p2 += 2 * Math.PI * warmFreq * dt;
        p3 += 2 * Math.PI * 880 * pitch * dt;
        p4 += 2 * Math.PI * 1320 * pitch * dt;

        const attack = 1 - Math.exp(-t * 95);
        const subBoom = (Math.sin(p1) * 0.36 + Math.sin(p2) * 0.22) * attack * Math.exp(-t * 3.8);
        const warmRoar = pole2 * 0.85 * attack * Math.exp(-t * 3.5);
        const embers =
          (Math.sin(p3) * 0.04 + Math.sin(p4) * 0.03) *
          (0.5 + 0.5 * Math.sin(t * 45)) *
          Math.exp(-t * 6.5);

        value = subBoom + warmRoar + embers;
        break;
      }

      case 'reset': {
        // Silky futuristic D-major 9th synth shimmer chord
        const env = (1 - Math.exp(-t * 110)) * Math.exp(-t * 11);
        const shimmer = 1 + 0.015 * (1 - Math.exp(-t * 18));
        p1 += 2 * Math.PI * 587.33 * shimmer * pitch * dt; // D5
        p2 += 2 * Math.PI * 880.0 * shimmer * pitch * dt;  // A5
        p3 += 2 * Math.PI * 1174.66 * shimmer * pitch * dt; // D6
        p4 += 2 * Math.PI * 1479.98 * shimmer * pitch * dt; // F#6

        const chord =
          (Math.sin(p1) * 0.22 +
            Math.sin(p2) * 0.20 +
            Math.sin(p3) * 0.15 +
            Math.sin(p4) * 0.10 * Math.exp(-t * 10)) *
          env;
        const air = pole2 * 0.12 * Math.exp(-t * 24);
        value = chord + air;
        break;
      }
    }

    // Raised-cosine fade-in & fade-out ramps for click-free edges, kept linear without harsh clipping
    const fadeIn = t < 0.004 ? 0.5 * (1 - Math.cos((Math.PI * t) / 0.004)) : 1;
    const fadeOut = duration - t < 0.028 ? 0.5 * (1 - Math.cos((Math.PI * Math.max(0, duration - t)) / 0.028)) : 1;
    const sample = value * fadeIn * fadeOut;
    samples[i] = Math.max(-0.68, Math.min(0.68, sample));
  }

  return samples;
}
