import { Quaternion, Vector3 } from 'three';
import type { FrameState } from '../types/replay';
import type { EmitImpactSprite } from './impacts';

/** A brief white glint on the wheel side of the car. */
export const FLIP_RESET_FLASH_SECONDS = 0.22;

/**
 * Playback times of each player's flip resets, indexed like `players`, sorted.
 *
 * subtr-actor reports a dodge refresh whenever a car's wheels touch the ball in the air
 * and give its flip back: a flip reset. Events are re-timed from their frame onto the
 * playback clock, and matched to players by remote id (`PlayerInfo.id`).
 */
export function buildFlipResets(
  rawDodgeRefreshedEvents: any[],
  playerIds: string[],
  toPlaybackTime: (frame: number) => number
): number[][] {
  const resets = playerIds.map((): number[] => []);
  for (const e of rawDodgeRefreshedEvents) {
    const playerIndex = playerIds.indexOf(JSON.stringify(e.player));
    if (playerIndex >= 0) resets[playerIndex].push(toPlaybackTime(e.frame));
  }
  resets.forEach((times) => times.sort((a, b) => a - b));
  return resets;
}

/**
 * Immediate flash followed by a quick fade, sampled entirely from replay time.
 */
export function flipResetFlashAt(
  resetTimes: number[],
  time: number
): { opacity: number; scale: number } | null {
  let low = 0;
  let high = resetTimes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (resetTimes[mid] <= time) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return null;

  const age = time - resetTimes[low - 1];
  if (age >= FLIP_RESET_FLASH_SECONDS) return null;
  const t = age / FLIP_RESET_FLASH_SECONDS;
  return { opacity: (1 - t) ** 2, scale: 0.8 + 0.6 * t };
}

const flashPosition = new Vector3();
const carRotation = new Quaternion();

/** Follow the current car transform, including rolls/inversion; independent of the HUD. */
export function sampleFlipResetFlashes(resetTimes: number[][], state: FrameState, emit: EmitImpactSprite) {
  for (const car of state.players) {
    if (!car.isPresent || car.isDemoed) continue;
    const flash = flipResetFlashAt(resetTimes[car.info.index] ?? [], state.time);
    if (!flash) continue;
    carRotation.set(car.rotation.x, car.rotation.y, car.rotation.z, car.rotation.w);
    flashPosition.set(0, -20, 0).applyQuaternion(carRotation);
    flashPosition.x += car.position.x;
    flashPosition.y += car.position.y;
    flashPosition.z += car.position.z;
    const { x, y, z } = flashPosition;
    // Compact white core with a soft halo, using the existing additive sprite batch.
    emit(x, y, z, 0, 0, 0, 70 * flash.scale, 2, 2, 2, 0.4 * flash.opacity, 0);
    emit(x, y, z, 0, 0, 0, 25 * flash.scale, 4, 4, 4, flash.opacity, 0);
  }
}
