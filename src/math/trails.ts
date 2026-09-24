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

/** A car on its wheels has its origin ~17 uu off the surface; this allows for suspension and bumps. */
const MAX_SURFACE_HEIGHT = 40;
/** How square to the surface a car must be to count as driving on it (cos of ~25 deg). */
const MIN_SURFACE_ALIGNMENT = 0.9;

// Arena surfaces in Three space (X width, Y height, Z length).
const ARENA_HALF_WIDTH = 4096;
const ARENA_HALF_LENGTH = 5120;
const ARENA_CEILING = 2044;
/** |x| + |z| of the 45 degree corner walls. */
const ARENA_CORNER = 8064;
const GOAL_HALF_WIDTH = 892.755;
const GOAL_HEIGHT = 642.775;
/**
 * Radii of the curved ramps where the walls meet the floor and ceiling, fitted to cars
 * driving up them in the sample replay: the side and corner walls ~264 uu, the back walls ~176 uu.
 */
const SIDE_RAMP_RADIUS = 264;
const BACK_RAMP_RADIUS = 176;
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

/**
 * Distance from `p` to the nearest arena surface (floor, walls, ceiling or the curved ramps
 * between them), positive inside the arena. Writes the surface's normal, pointing into the
 * arena, to `normal`. The rounded vertical edges between walls are treated as sharp.
 */
export function nearestArenaSurface(p: Vec3, normal: THREE.Vector3): number {
  const sx = Math.sign(p.x) || 1;
  const sz = Math.sign(p.z) || 1;

  // Nearest wall, with the radius of its ramps.
  let wall = ARENA_HALF_WIDTH - Math.abs(p.x);
  let wallX = -sx;
  let wallZ = 0;
  let radius = SIDE_RAMP_RADIUS;
  const inGoalMouth = Math.abs(p.x) < GOAL_HALF_WIDTH && p.y < GOAL_HEIGHT;
  const back = ARENA_HALF_LENGTH - Math.abs(p.z);
  if (!inGoalMouth && back < wall) {
    wall = back;
    wallX = 0;
    wallZ = -sz;
    radius = BACK_RAMP_RADIUS;
  }
  const corner = (ARENA_CORNER - Math.abs(p.x) - Math.abs(p.z)) / Math.SQRT2;
  if (corner < wall) {
    wall = corner;
    wallX = -sx * Math.SQRT1_2;
    wallZ = -sz * Math.SQRT1_2;
    radius = SIDE_RAMP_RADIUS;
  }

  // Floor or ceiling, whichever is nearer.
  const onFloorSide = p.y < ARENA_CEILING / 2;
  const level = onFloorSide ? p.y : ARENA_CEILING - p.y;
  const levelY = onFloorSide ? 1 : -1;

  if (wall < radius && level < radius) {
    // On the ramp: a quarter circle whose centre is `radius` from both the wall and the floor.
    const fromWall = radius - wall;
    const fromLevel = radius - level;
    const reach = Math.hypot(fromWall, fromLevel);
    if (reach > 1e-6) {
      normal.set(wallX * fromWall, levelY * fromLevel, wallZ * fromWall).divideScalar(reach);
      return radius - reach;
    }
  }
  if (wall < level) {
    normal.set(wallX, 0, wallZ);
    return wall;
  }
  normal.set(0, levelY, 0);
  return level;
}

const surfaceNormal = new THREE.Vector3();

/** Whether a car is on its wheels on a floor, wall, ramp or ceiling, from how close and square to it it is. */
export function isOnSurface(position: Vec3, rotation: Quat): boolean {
  const distance = nearestArenaSurface(position, surfaceNormal);
  if (distance > MAX_SURFACE_HEIGHT) return false;
  // The car's roof direction: +Y rotated by the quaternion.
  const { x, y, z, w } = rotation;
  const upX = 2 * (x * y - w * z);
  const upY = 1 - 2 * (x * x + z * z);
  const upZ = 2 * (y * z + w * x);
  return upX * surfaceNormal.x + upY * surfaceNormal.y + upZ * surfaceNormal.z > MIN_SURFACE_ALIGNMENT;
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

/** Receives a point on an arena surface, with the surface normal; `age` is seconds behind the current time. */
export type EmitSurfacePoint = (
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  age: number, lit: boolean
) => void;

const carQuaternion = new THREE.Quaternion();
const wheelPoint = new THREE.Vector3();
const wheelNormal = new THREE.Vector3();

/**
 * Where one wheel of a car has touched the arena over the last `maxAge` seconds, newest first.
 * `wheelOffset` is in the car's frame (+X forward, +Y up); each point is dropped onto the
 * nearest surface. A point is lit while the car was supersonic and driving on a surface.
 */
export function sampleCarWheelTrail(
  data: ParsedReplayData,
  playerIndex: number,
  frameIndex: number,
  time: number,
  car: { position: Vec3; rotation: Quat; lit: boolean },
  wheelOffset: Vec3,
  maxAge: number,
  emit: EmitSurfacePoint
) {
  const buffer = data.framesBuffer;
  const playerOffset = FLOATS_PER_BALL + playerIndex * FLOATS_PER_PLAYER;
  const emitWheel = (position: Vec3, rotation: Quat, age: number, lit: boolean) => {
    carQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    wheelPoint.set(wheelOffset.x, wheelOffset.y, wheelOffset.z).applyQuaternion(carQuaternion);
    wheelPoint.x += position.x;
    wheelPoint.y += position.y;
    wheelPoint.z += position.z;
    const distance = nearestArenaSurface(wheelPoint, wheelNormal);
    wheelPoint.addScaledVector(wheelNormal, -distance);
    emit(wheelPoint.x, wheelPoint.y, wheelPoint.z, wheelNormal.x, wheelNormal.y, wheelNormal.z, age, lit);
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
      const lit = (flags & SUPERSONIC_FLAG) !== 0 && (flags & 4) === 0 && isOnSurface(position, rotation);
      emitWheel(position, rotation, age, lit);
    }
  );
}
