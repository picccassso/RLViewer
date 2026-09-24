import * as THREE from 'three';
import {
  BallTouch,
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS,
  ParsedReplayData,
  TOTAL_FLOATS_PER_FRAME,
} from '../types/replay';
import { SUPERSONIC_SPEED_THRESHOLD } from './cameraMath';
import { Vec3, Quat } from './coords';

/** Once supersonic, a car keeps it until it slows below this, as in game. */
export const SUPERSONIC_EXIT_SPEED = 2100; // uu/s

/** Flag bit set on a player's frame while the car is supersonic. */
export const SUPERSONIC_FLAG = 128;

const TIME_OFFSET = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;

/** A car on its wheels has its origin ~17 uu above the turf; this allows for suspension and bumps. */
const MAX_FLOOR_HEIGHT = 40;
/** How upright a car must be to count as driving on the floor (cos of ~25 deg). */
const MIN_FLOOR_UPRIGHTNESS = 0.9;
/** Faster than anything moves in game: a bigger step between frames is a reset or a teleport. */
const MAX_TRAIL_SPEED = 7000; // uu/s
/** Frame times are stored as float32, so a touch's own frame can read a hair earlier than the touch. */
const TIME_TOLERANCE = 1e-3;

export function nextSupersonic(wasSupersonic: boolean, speed: number): boolean {
  return speed >= (wasSupersonic ? SUPERSONIC_EXIT_SPEED : SUPERSONIC_SPEED_THRESHOLD);
}

/** subtr-actor's touch events re-timed onto the playback clock. */
export function buildBallTouches(
  rawTouchEvents: any[],
  toPlaybackTime: (frame: number) => number
): BallTouch[] {
  return rawTouchEvents
    .map((e): BallTouch => ({ time: toPlaybackTime(e.frame), team: e.team_is_team_0 ? 0 : 1 }))
    .sort((a, b) => a.time - b.time);
}

/** The latest touch at or before `time`, or null before the first touch. */
export function lastTouchAt(touches: BallTouch[], time: number): BallTouch | null {
  let low = 0;
  let high = touches.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (touches[mid].time <= time + TIME_TOLERANCE) low = mid + 1;
    else high = mid;
  }
  return low > 0 ? touches[low - 1] : null;
}

/** Whether a car is on its wheels on the floor, from its height and how upright it is. */
export function isOnFloor(y: number, rotation: Quat): boolean {
  // Vertical component of the car's roof direction: +Y rotated by the quaternion.
  const uprightness = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
  return y < MAX_FLOOR_HEIGHT && uprightness > MIN_FLOOR_UPRIGHTNESS;
}

/** Receives trail points newest first; `age` is seconds behind the current time. */
export type EmitTrailPoint = (x: number, y: number, z: number, age: number, lit: boolean) => void;

/**
 * Walks recorded frames back from `frameIndex` while they are no older than `since`,
 * stopping at a teleport. `read` writes the entity's position for a frame into `out`
 * and returns whether the entity exists in it.
 */
function walkFrames(
  data: ParsedReplayData,
  frameIndex: number,
  time: number,
  since: number,
  head: Vec3,
  read: (offset: number, out: THREE.Vector3) => boolean,
  emit: (offset: number, position: THREE.Vector3, age: number) => void
) {
  const buffer = data.framesBuffer;
  const position = new THREE.Vector3();
  let previousX = head.x;
  let previousY = head.y;
  let previousZ = head.z;
  let previousTime = time;
  for (let f = Math.min(frameIndex, data.totalFrames - 1); f >= 0; f--) {
    const offset = f * TOTAL_FLOATS_PER_FRAME;
    const frameTime = buffer[offset + TIME_OFFSET];
    if (frameTime < since - TIME_TOLERANCE) break;
    if (!read(offset, position)) break;
    const step = Math.hypot(position.x - previousX, position.y - previousY, position.z - previousZ);
    if (step > MAX_TRAIL_SPEED * Math.max(previousTime - frameTime, 1 / 60)) break;
    emit(offset, position, Math.max(0, time - frameTime));
    previousX = position.x;
    previousY = position.y;
    previousZ = position.z;
    previousTime = frameTime;
  }
}

/**
 * The ball's path since it was last touched, going back at most `maxAge` seconds:
 * its current position, then each recorded frame back to the touch.
 * Returns the touching team, or null when nothing has touched the ball yet.
 */
export function sampleBallTrail(
  data: ParsedReplayData,
  frameIndex: number,
  time: number,
  ballPosition: Vec3,
  maxAge: number,
  emit: EmitTrailPoint
): 0 | 1 | null {
  const touch = lastTouchAt(data.ballTouches, time);
  if (!touch) return null;
  const buffer = data.framesBuffer;
  emit(ballPosition.x, ballPosition.y, ballPosition.z, 0, true);
  walkFrames(
    data,
    frameIndex,
    time,
    Math.max(touch.time, time - maxAge),
    ballPosition,
    (offset, out) => {
      out.set(buffer[offset], buffer[offset + 1], buffer[offset + 2]);
      return true;
    },
    (_, p, age) => emit(p.x, p.y, p.z, age, true)
  );
  return touch.team;
}

const carQuaternion = new THREE.Quaternion();
const wheelPoint = new THREE.Vector3();

/**
 * Where one wheel of a car has been over the last `maxAge` seconds, newest first.
 * `wheelOffset` is in the car's frame (+X forward, +Y up). A point is lit while the car
 * was supersonic and on the floor.
 */
export function sampleCarWheelTrail(
  data: ParsedReplayData,
  playerIndex: number,
  frameIndex: number,
  time: number,
  car: { position: Vec3; rotation: Quat; lit: boolean },
  wheelOffset: Vec3,
  maxAge: number,
  emit: EmitTrailPoint
) {
  const buffer = data.framesBuffer;
  const playerOffset = FLOATS_PER_BALL + playerIndex * FLOATS_PER_PLAYER;
  const emitWheel = (position: Vec3, rotation: Quat, age: number, lit: boolean) => {
    carQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    wheelPoint.set(wheelOffset.x, wheelOffset.y, wheelOffset.z).applyQuaternion(carQuaternion);
    emit(position.x + wheelPoint.x, position.y + wheelPoint.y, position.z + wheelPoint.z, age, lit);
  };
  const rotation = { x: 0, y: 0, z: 0, w: 1 };

  emitWheel(car.position, car.rotation, 0, car.lit);
  walkFrames(
    data,
    frameIndex,
    time,
    time - maxAge,
    car.position,
    (offset, out) => {
      const o = offset + playerOffset;
      out.set(buffer[o], buffer[o + 1], buffer[o + 2]);
      return (buffer[o + 11] & 1) !== 0;
    },
    (offset, position, age) => {
      const o = offset + playerOffset;
      rotation.x = buffer[o + 3];
      rotation.y = buffer[o + 4];
      rotation.z = buffer[o + 5];
      rotation.w = buffer[o + 6];
      const flags = buffer[o + 11];
      const lit = (flags & SUPERSONIC_FLAG) !== 0 && (flags & 4) === 0 && isOnFloor(position.y, rotation);
      emitWheel(position, rotation, age, lit);
    }
  );
}
