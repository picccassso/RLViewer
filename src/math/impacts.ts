import { ParsedReplayData } from '../types/replay';
import { getFrameSampleAtTime, unpackFrame } from './frameUnpacker';

const BALL_RADIUS = 92.75; // uu

/** A car further than this from the ball can't have made the touch. */
const MAX_TOUCH_DISTANCE = 320; // uu
/**
 * Change in the ball's velocity (uu/s) below which a touch gets no effect, so dribbles
 * and soft pushes stay quiet; at `FULL_HIT_SPEED_CHANGE` the effect is at full size.
 */
const MIN_HIT_SPEED_CHANGE = 350;
const FULL_HIT_SPEED_CHANGE = 4500;
/** Flip hits carry extra punch. */
const FLIP_HIT_BONUS = 0.15;

/** How long a ball hit and a demolition stay on screen. */
export const HIT_SECONDS = 0.45;
export const DEMO_SECONDS = 0.9;

const GRAVITY = -650; // uu/s²
const TEAM_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [0.18, 0.55, 1],
  [1, 0.48, 0.1],
];

export interface Impact {
  kind: 'hit' | 'demo';
  time: number;
  /** Contact point, in Three.js space. */
  x: number; y: number; z: number;
  /** Unit normal of the contact, pointing from the ball towards the car (hits) or up (demos). */
  nx: number; ny: number; nz: number;
  /** 0..1, how hard the hit was. */
  strength: number;
  team: 0 | 1;
}

/**
 * Where and how hard every notable ball hit and demolition happened. A hit's contact point
 * is on the ball towards the nearest car of the touching team, or opposite the ball's
 * change of velocity if no such car is close. Sorted by time.
 */
export function buildImpacts(data: ParsedReplayData): Impact[] {
  const impacts: Impact[] = [];
  const stateAt = (time: number) => {
    const { frameA, frameB, alpha } = getFrameSampleAtTime(data, time);
    return unpackFrame(data, frameA, frameB, alpha);
  };

  for (const touch of data.ballTouches) {
    const before = stateAt(touch.time - 0.05).ball.velocity;
    const after = stateAt(touch.time + 0.05).ball.velocity;
    const dvx = after.x - before.x;
    const dvy = after.y - before.y;
    const dvz = after.z - before.z;
    const speedChange = Math.hypot(dvx, dvy, dvz);
    let strength = (speedChange - MIN_HIT_SPEED_CHANGE) / (FULL_HIT_SPEED_CHANGE - MIN_HIT_SPEED_CHANGE);
    if (strength <= 0) continue;
    strength = Math.min(strength + (touch.flip ? FLIP_HIT_BONUS : 0), 1);

    const state = stateAt(touch.time);
    const ball = state.ball.position;
    let nx = -dvx / speedChange;
    let ny = -dvy / speedChange;
    let nz = -dvz / speedChange;
    let nearest = MAX_TOUCH_DISTANCE;
    for (const player of state.players) {
      if (player.info.team !== touch.team || !player.isPresent || player.isDemoed) continue;
      const cx = player.position.x - ball.x;
      const cy = player.position.y - ball.y;
      const cz = player.position.z - ball.z;
      const distance = Math.hypot(cx, cy, cz);
      if (distance < nearest && distance > 1e-3) {
        nearest = distance;
        nx = cx / distance;
        ny = cy / distance;
        nz = cz / distance;
      }
    }
    impacts.push({
      kind: 'hit',
      time: touch.time,
      x: ball.x + nx * BALL_RADIUS,
      y: ball.y + ny * BALL_RADIUS,
      z: ball.z + nz * BALL_RADIUS,
      nx, ny, nz,
      strength,
      team: touch.team,
    });
  }

  for (const demo of data.demolitions) {
    impacts.push({
      kind: 'demo',
      time: demo.time,
      x: demo.position.x, y: demo.position.y + 20, z: demo.position.z,
      nx: 0, ny: 1, nz: 0,
      strength: 1,
      team: demo.team,
    });
  }
  return impacts.sort((a, b) => a.time - b.time);
}

/**
 * Receives one glowing sprite: its centre, a world-space streak to stretch it along (zero
 * for a round sprite), its half size, HDR colour, opacity, and shape (0 soft blob, 1 ring).
 */
export type EmitImpactSprite = (
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  size: number,
  r: number, g: number, b: number,
  alpha: number,
  shape: 0 | 1
) => void;

/** Stable pseudo-random 0..1 for spark `i` of impact `seed`. */
function random(seed: number, i: number, channel: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca77) ^ Math.imul(channel + 1, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/**
 * The sprites of every impact still on screen at `time`, worked out from the impact alone,
 * so the effect looks the same paused, scrubbing or at any playback speed.
 */
export function sampleImpacts(impacts: Impact[], time: number, emit: EmitImpactSprite) {
  // First impact recent enough to still show.
  let low = 0;
  let high = impacts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (impacts[mid].time < time - DEMO_SECONDS) low = mid + 1;
    else high = mid;
  }
  for (let i = low; i < impacts.length && impacts[i].time <= time; i++) {
    const impact = impacts[i];
    const age = time - impact.time;
    if (impact.kind === 'hit') {
      if (age < HIT_SECONDS) sampleHit(impact, age, emit);
    } else {
      sampleDemo(impact, age, emit);
    }
  }
}

function sampleHit(hit: Impact, age: number, emit: EmitImpactSprite) {
  const s = hit.strength;
  const [tr, tg, tb] = TEAM_RGB[hit.team];
  const seed = Math.round(hit.time * 1000);

  // A white-hot flash at the contact point.
  const flashLife = 0.08 + 0.06 * s;
  if (age < flashLife) {
    const t = age / flashLife;
    const glow = 2.5 + 2.5 * s;
    emit(hit.x, hit.y, hit.z, 0, 0, 0, (35 + 55 * s) * (1 + 0.5 * t), glow, glow * 0.96, glow * 0.9, (1 - t) * (1 - t), 0);
  }

  // A thin shockwave ring, tinted by the touching team.
  const ringLife = 0.22 + 0.1 * s;
  if (age < ringLife) {
    const t = age / ringLife;
    const glow = 1.6;
    emit(
      hit.x, hit.y, hit.z, 0, 0, 0,
      (30 + 130 * s) * easeOut(t) + 10,
      glow * (0.5 + 0.5 * tr), glow * (0.5 + 0.5 * tg), glow * (0.5 + 0.5 * tb),
      Math.pow(1 - t, 1.5) * (0.35 + 0.45 * s),
      1
    );
  }

  // Sparks thrown out across the contact, streaking as they fly and dropping under gravity.
  const sparks = Math.round(5 + 13 * s);
  for (let i = 0; i < sparks; i++) {
    const life = 0.2 + 0.2 * random(seed, i, 0);
    if (age >= life) continue;
    // A random direction, flattened towards the plane of the contact.
    let dx = random(seed, i, 1) * 2 - 1;
    let dy = random(seed, i, 2) * 2 - 1;
    let dz = random(seed, i, 3) * 2 - 1;
    const along = dx * hit.nx + dy * hit.ny + dz * hit.nz;
    dx -= 0.7 * along * hit.nx;
    dy -= 0.7 * along * hit.ny;
    dz -= 0.7 * along * hit.nz;
    const length = Math.hypot(dx, dy, dz) || 1;
    const speed = (450 + 800 * s) * (0.5 + random(seed, i, 4));
    const vx = (dx / length) * speed;
    const vy = (dy / length) * speed + 150;
    const vz = (dz / length) * speed;
    const vyNow = vy + GRAVITY * age;
    const t = age / life;
    const heat = 1 - t;
    emit(
      hit.x + vx * age,
      hit.y + vy * age + 0.5 * GRAVITY * age * age,
      hit.z + vz * age,
      vx * 0.025, vyNow * 0.025, vz * 0.025,
      2.5 + 2 * s,
      3 * (tr + (1 - tr) * heat), 3 * (tg + (1 - tg) * heat * 0.9), 3 * (tb + (1 - tb) * heat * 0.7),
      1 - t * t,
      0
    );
  }
}

function sampleDemo(demo: Impact, age: number, emit: EmitImpactSprite) {
  const [tr, tg, tb] = TEAM_RGB[demo.team];
  const seed = Math.round(demo.time * 1000) + 7;

  // The blast.
  if (age < 0.2) {
    const t = age / 0.2;
    emit(demo.x, demo.y, demo.z, 0, 0, 0, 180 + 160 * t, 5, 4.2, 3.2, (1 - t) * (1 - t), 0);
  }

  // Shockwave ring in the attacker's colour.
  if (age < 0.45) {
    const t = age / 0.45;
    emit(demo.x, demo.y, demo.z, 0, 0, 0, 40 + 420 * easeOut(t), 2 * tr + 0.6, 2 * tg + 0.6, 2 * tb + 0.6, Math.pow(1 - t, 1.5) * 0.8, 1);
  }

  // A fireball of billowing puffs, cooling from yellow to deep orange.
  for (let i = 0; i < 14; i++) {
    const life = 0.5 + 0.4 * random(seed, i, 0);
    if (age >= life) continue;
    const t = age / life;
    const dx = random(seed, i, 1) * 2 - 1;
    const dy = random(seed, i, 2) * 1.4 - 0.2;
    const dz = random(seed, i, 3) * 2 - 1;
    const reach = (120 + 140 * random(seed, i, 4)) * easeOut(t);
    const heat = 1 - t;
    emit(
      demo.x + dx * reach, demo.y + dy * reach + 60 * t, demo.z + dz * reach,
      0, 0, 0,
      (50 + 40 * random(seed, i, 5)) * (0.6 + 0.8 * t),
      2.4, 0.9 + 1.1 * heat, 0.25 + 0.5 * heat * heat,
      0.45 * (1 - t) * (1 - t),
      0
    );
  }

  // Debris sparks.
  for (let i = 0; i < 26; i++) {
    const life = 0.35 + 0.35 * random(seed, i + 100, 0);
    if (age >= life) continue;
    const dx = random(seed, i + 100, 1) * 2 - 1;
    const dy = random(seed, i + 100, 2) * 1.5 - 0.3;
    const dz = random(seed, i + 100, 3) * 2 - 1;
    const length = Math.hypot(dx, dy, dz) || 1;
    const speed = 900 + 900 * random(seed, i + 100, 4);
    const vx = (dx / length) * speed;
    const vy = (dy / length) * speed;
    const vz = (dz / length) * speed;
    const t = age / life;
    emit(
      demo.x + vx * age, demo.y + vy * age + 0.5 * GRAVITY * age * age, demo.z + vz * age,
      vx * 0.025, (vy + GRAVITY * age) * 0.025, vz * 0.025,
      4,
      3, 2.2 * (1 - t) + 0.6, 1.2 * (1 - t) + 0.2,
      1 - t * t,
      0
    );
  }
}
