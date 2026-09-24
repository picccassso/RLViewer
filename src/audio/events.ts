import { Vector3 } from 'three';
import { ParsedReplayData } from '../types/replay';
import { getFrameSampleAtTime, unpackFrame } from '../math/frameUnpacker';
import { isOnSurface, lastTouchAt, nearestArenaSurface } from '../math/trails';

export type SoundKind = 'ball' | 'demo' | 'bump' | 'jump' | 'dodge' | 'land' | 'reset';
type Position = { x: number; y: number; z: number };
export interface SoundEvent {
  time: number;
  kind: SoundKind;
  position: Position;
  strength: number;
}
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const strength = (speed: number, full: number) => Math.min(1, Math.max(0.15, speed / full));

/** Recorded events plus conservative contact detection; built once when a replay loads. */
export function buildSoundEvents(data: ParsedReplayData): SoundEvent[] {
  if (!data.totalFrames) return [];
  const events: SoundEvent[] = [];
  const at = (time: number) => {
    const { frameA, frameB, alpha } = getFrameSampleAtTime(data, time);
    return unpackFrame(data, frameA, frameB, alpha);
  };
  for (const touch of data.ballTouches) {
    const ball = at(touch.time).ball;
    events.push({ time: touch.time, kind: 'ball', position: ball.position,
      strength: strength(distance(at(touch.time - 0.05).ball.velocity, at(touch.time + 0.05).ball.velocity), 3500) });
  }
  for (const demo of data.demolitions) {
    events.push({ time: demo.time, kind: 'demo', position: demo.position, strength: 1 });
  }
  data.flipResets.forEach((times, index) => {
    for (const time of times) {
      const player = at(time).players.find((p) => p.info.index === index);
      if (player?.isPresent && !player.isDemoed) {
        events.push({ time, kind: 'reset', position: player.position, strength: 0.65 });
      }
    }
  });

  const lastBump = new Map<string, number>();
  const normal = new Vector3();
  let lastBounce = -Infinity;
  let before = unpackFrame(data, 0);
  for (let f = 1; f < data.totalFrames; f++) {
    const now = unpackFrame(data, f);
    const dt = now.time - before.time;
    if (dt <= 0 || dt > 0.25) { before = now; continue; }
    const valid = now.players.map((car, p) => {
      const old = before.players[p];
      return old && old.isPresent && car.isPresent && !old.isDemoed && !car.isDemoed &&
        distance(old.position, car.position) <= 3500 * dt + 20;
    });
    for (let p = 0; p < now.players.length; p++) {
      if (!valid[p]) continue;
      const car = now.players[p];
      const old = before.players[p];
      const add = (kind: SoundKind, amount: number) => events.push({ time: now.time, kind, position: car.position, strength: amount });
      // Prefer one dodge whoosh if both replicated flags rise in the same packet.
      if (car.dodgeActive && !old.dodgeActive) add('dodge', 0.65);
      else if (car.jumpActive && !old.jumpActive) add('jump', 0.55);
      if (isOnSurface(car.position, car.rotation) && !isOnSurface(old.position, old.rotation)) {
        nearestArenaSurface(car.position, normal);
        const intoSurface = -(old.velocity.x * normal.x + old.velocity.y * normal.y + old.velocity.z * normal.z);
        if (intoSurface > 200) add('land', strength(intoSurface, 1800));
      }
      for (let q = p + 1; q < now.players.length; q++) {
        if (!valid[q]) continue;
        const other = now.players[q];
        const otherOld = before.players[q];
        const separation = distance(old.position, otherOld.position);
        if (separation < 1 || Math.min(separation, distance(car.position, other.position)) > 165) continue;
        const closing = ((old.velocity.x - otherOld.velocity.x) * (otherOld.position.x - old.position.x) +
          (old.velocity.y - otherOld.velocity.y) * (otherOld.position.y - old.position.y) +
          (old.velocity.z - otherOld.velocity.z) * (otherOld.position.z - old.position.z)) / separation;
        const impulse = Math.max(distance(car.velocity, old.velocity), distance(other.velocity, otherOld.velocity));
        const key = `${p}:${q}`;
        if (closing < 250 || impulse < 200 || now.time - (lastBump.get(key) ?? -Infinity) < 0.3) continue;
        const position = { x: (car.position.x + other.position.x) / 2,
          y: (car.position.y + other.position.y) / 2, z: (car.position.z + other.position.z) / 2 };
        // A demolition already supplies its own impact and explosion.
        if (data.demolitions.some((d) => Math.abs(d.time - now.time) < 0.12 && distance(d.position, position) < 350)) continue;
        events.push({ time: now.time, kind: 'bump', position, strength: strength(impulse, 2200) });
        lastBump.set(key, now.time);
      }
    }
    const ball = now.ball;
    const oldBall = before.ball;
    if (distance(ball.position, oldBall.position) <= 7000 * dt && now.time - lastBounce > 0.09 &&
        nearestArenaSurface(ball.position, normal) < 110) {
      const impulse = Math.hypot(ball.velocity.x - oldBall.velocity.x,
        ball.velocity.y - oldBall.velocity.y + 650 * dt, ball.velocity.z - oldBall.velocity.z);
      const touch = lastTouchAt(data.ballTouches, now.time + 0.08);
      if (impulse > 300 && (!touch || Math.abs(touch.time - now.time) > 0.1)) {
        events.push({ time: now.time, kind: 'ball', position: ball.position, strength: strength(impulse, 3500) });
        lastBounce = now.time;
      }
    }
    before = now;
  }
  return events.sort((a, b) => a.time - b.time);
}

/** Consume events once during forward playback. Seeks, pauses and gaps never catch up audio. */
export class SoundEventCursor {
  private time: number | null = null;
  constructor(private readonly events: SoundEvent[]) {}
  reset(time: number | null = null) { this.time = time; }
  advance(time: number, playing: boolean, speed: number): SoundEvent[] {
    const from = this.time;
    this.time = time;
    if (!playing || from === null || time <= from || time - from > 0.3 * Math.max(1, speed)) return [];
    let low = 0;
    let high = this.events.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.events[mid].time <= from) low = mid + 1;
      else high = mid;
    }
    const result: SoundEvent[] = [];
    while (low < this.events.length && this.events[low].time <= time) result.push(this.events[low++]);
    return result;
  }
}
