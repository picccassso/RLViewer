import { FrameState, ParsedReplayData } from '../types/replay';
import { getFrameSampleAtTime, unpackFrame } from './frameUnpacker';
import { lastTouchAt } from './trails';

const BALL_RADIUS = 92.75; // uu

/** A car further than this from the ball can't have made the touch. */
const MAX_TOUCH_DISTANCE = 320; // uu
/**
 * Soft touches still spark; velocity changes above this start adding impact strength.
 */
const MIN_HIT_SPEED_CHANGE = 350;
const FULL_HIT_SPEED_CHANGE = 4500;
/** Flip hits carry extra punch. */
const FLIP_HIT_BONUS = 0.15;

/** How long a ball hit and a demolition stay on screen. */
export const HIT_SECONDS = 0.45;
export const DEMO_SECONDS = 0.9;
const CONTACT_SPARK_RATE = 140;
const SPARK_SECONDS = 0.3;

const GRAVITY = -650; // uu/s²
const TEAM_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [0.18, 0.55, 1],
  [1, 0.48, 0.1],
];

export interface Impact {
  kind: 'hit' | 'demo' | 'spark';
  time: number;
  /** Contact point, in Three.js space. */
  x: number; y: number; z: number;
  /** Unit normal of the contact, pointing from the ball towards the car (hits) or up (demos). */
  nx: number; ny: number; nz: number;
  /** 0..1, how hard the hit was. */
  strength: number;
  team: 0 | 1;
  /** Motion inherited at birth, keeping sparks with a moving air dribble. */
  velocity?: { x: number; y: number; z: number };
}

/**
 * Ball hits, sustained contact spark births, and demolitions on the replay clock. A hit's contact point
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
    strength = Math.min(Math.max(strength, 0) + (touch.flip ? FLIP_HIT_BONUS : 0), 1);

    const state = stateAt(touch.time);
    const ball = state.ball.position;
    let nx = speedChange > 1e-3 ? -dvx / speedChange : 0;
    let ny = speedChange > 1e-3 ? -dvy / speedChange : -1;
    let nz = speedChange > 1e-3 ? -dvz / speedChange : 0;
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
      velocity: state.ball.velocity,
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
  buildContactSparks(data, impacts);
  return impacts.sort((a, b) => a.time - b.time);
}

/** A sustained carry can have very few recorded touch events. Proximity and relative
 * velocity bridge those events, but only for the last touching team and airborne cars. */
function carryContact(data: ParsedReplayData, state: FrameState) {
  const touch = lastTouchAt(data.ballTouches, state.time);
  if (!touch || state.ball.position.y < 160) return null;
  let nearest = 205;
  let contact = null;
  for (let i = 0; i < state.players.length; i++) {
    const car = state.players[i];
    if (!car.isPresent || car.isDemoed || car.info.team !== touch.team || car.position.y < 55) continue;
    const dx = car.position.x - state.ball.position.x;
    const dy = car.position.y - state.ball.position.y;
    const dz = car.position.z - state.ball.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1 || distance >= nearest) continue;
    // Only very close contact can sustain an effect long after the last discrete touch.
    if (state.time - touch.time > 0.8 && distance > 170) continue;
    const relativeSpeed = Math.hypot(
      car.velocity.x - state.ball.velocity.x,
      car.velocity.y - state.ball.velocity.y,
      car.velocity.z - state.ball.velocity.z
    );
    if (relativeSpeed > 900) continue;
    nearest = distance;
    contact = { player: i, team: touch.team, nx: dx / distance, ny: dy / distance, nz: dz / distance };
  }
  return contact;
}

/** Fixed replay-time births, interpolated between real packets, independent of render FPS. */
function buildContactSparks(data: ParsedReplayData, impacts: Impact[]) {
  if (data.totalFrames < 2 || !data.ballTouches.length) return;
  let previous = unpackFrame(data, 0);
  let from = carryContact(data, previous);
  for (let f = 1; f < data.totalFrames; f++) {
    const current = unpackFrame(data, f);
    const to = carryContact(data, current);
    const span = current.time - previous.time;
    const a = previous.ball.position;
    const b = current.ball.position;
    if (from && to && from.player === to.player && span > 0 && span <= 0.25 &&
        Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) <= 7000 * span) {
      for (let k = Math.floor(previous.time * CONTACT_SPARK_RATE) + 1;
        k <= Math.floor(current.time * CONTACT_SPARK_RATE); k++) {
        const time = k / CONTACT_SPARK_RATE;
        const t = (time - previous.time) / span;
        const lerp = (a: number, b: number) => a + (b - a) * t;
        let nx = lerp(from.nx, to.nx);
        let ny = lerp(from.ny, to.ny);
        let nz = lerp(from.nz, to.nz);
        const length = Math.hypot(nx, ny, nz);
        if (length < 0.5) continue;
        nx /= length; ny /= length; nz /= length;
        impacts.push({
          kind: 'spark', time, team: to.team, strength: 0.12,
          x: lerp(a.x, b.x) + nx * (BALL_RADIUS + 2),
          y: lerp(a.y, b.y) + ny * (BALL_RADIUS + 2),
          z: lerp(a.z, b.z) + nz * (BALL_RADIUS + 2),
          nx, ny, nz,
          velocity: {
            x: lerp(previous.ball.velocity.x, current.ball.velocity.x),
            y: lerp(previous.ball.velocity.y, current.ball.velocity.y),
            z: lerp(previous.ball.velocity.z, current.ball.velocity.z),
          },
        });
      }
    }
    previous = current;
    from = to;
  }
}

/**
 * Receives one glowing sprite: its centre, a world-space streak to stretch it along (zero
 * for a round sprite), its half size, HDR colour, opacity, and shape (0 blob, 1 ring, 2 spark).
 */
export type EmitImpactSprite = (
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  size: number,
  r: number, g: number, b: number,
  alpha: number,
  shape: 0 | 1 | 2
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
    if (impact.kind === 'spark') {
      if (age < SPARK_SECONDS) sampleSpark(impact, age, 0, emit);
    } else if (impact.kind === 'hit') {
      if (age < HIT_SECONDS) sampleHit(impact, age, emit);
    } else {
      sampleDemo(impact, age, emit);
    }
  }
}

function sampleHit(hit: Impact, age: number, emit: EmitImpactSprite) {
  const s = hit.strength;

  // A white-hot flash at the contact point.
  const flashLife = 0.08 + 0.06 * s;
  if (s > 0.08 && age < flashLife) {
    const t = age / flashLife;
    const glow = 2 + 1.5 * s;
    emit(hit.x, hit.y, hit.z, 0, 0, 0, (12 + 28 * s) * (1 + 0.5 * t), glow, glow * 0.96, glow * 0.9, (1 - t) * (1 - t), 0);
  }
  const sparks = Math.round(6 + 20 * s);
  for (let i = 0; i < sparks; i++) sampleSpark(hit, age, i, emit);
}

function sampleSpark(hit: Impact, age: number, i: number, emit: EmitImpactSprite) {
  const s = hit.strength;
  const seed = Math.round(hit.time * 10000);
  const life = 0.14 + (SPARK_SECONDS - 0.14) * random(seed, i, 0);
  if (age >= life) return;
  // A random direction, flattened towards the plane of the contact.
  let dx = random(seed, i, 1) * 2 - 1;
  let dy = random(seed, i, 2) * 2 - 1;
  let dz = random(seed, i, 3) * 2 - 1;
  const along = dx * hit.nx + dy * hit.ny + dz * hit.nz;
  dx += (0.2 - along) * hit.nx;
  dy += (0.2 - along) * hit.ny;
  dz += (0.2 - along) * hit.nz;
  const length = Math.hypot(dx, dy, dz) || 1;
  const speed = (280 + 750 * s) * (0.5 + random(seed, i, 4));
  const vx = (dx / length) * speed;
  const vy = (dy / length) * speed;
  const vz = (dz / length) * speed;
  const vyNow = vy + GRAVITY * age;
  const t = age / life;
  const heat = 1 - t;
  emit(
    hit.x + (vx + (hit.velocity?.x ?? 0) * 0.75) * age,
    hit.y + (vy + (hit.velocity?.y ?? 0) * 0.75) * age + 0.5 * GRAVITY * age * age,
    hit.z + (vz + (hit.velocity?.z ?? 0) * 0.75) * age,
    vx * 0.045, vyNow * 0.045, vz * 0.045,
    (1.3 + 1.2 * s) * (0.6 + 0.4 * heat),
    3.5, 1.5 + 1.9 * heat, 0.35 + 2.7 * heat * heat,
    1 - t * t,
    2
  );
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
