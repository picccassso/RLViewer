import {
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS,
  TOTAL_FLOATS_PER_FRAME,
} from '../types/replay';

const TIME_OFFSET = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;

/**
 * Replay network corrections make some position steps much shorter or longer
 * than the actual travel. A centred position filter spreads those corrections
 * over nearby frames without crossing a collision or replay reset.
 */
export function smoothReplayPositions(
  framesBuffer: Float32Array,
  totalFrames: number,
  ballHasTransform: Uint8Array
): void {
  if (totalFrames < 3) return;
  const source = framesBuffer.slice();
  const weights = [5, 4, 3, 2, 1];

  const entityOffset = (frame: number, player: number): number =>
    frame * TOTAL_FLOATS_PER_FRAME + (player < 0 ? 0 : FLOATS_PER_BALL + player * FLOATS_PER_PLAYER);

  const present = (frame: number, player: number): boolean => {
    if (player < 0) return ballHasTransform[frame] === 1;
    const flags = source[entityOffset(frame, player) + 11] | 0;
    return (flags & 1) !== 0 && (flags & 4) === 0;
  };

  const continuous = (left: number, player: number): boolean => {
    if (!present(left, player) || !present(left + 1, player)) return false;
    const leftBase = left * TOTAL_FLOATS_PER_FRAME;
    const rightBase = leftBase + TOTAL_FLOATS_PER_FRAME;
    const dt = source[rightBase + TIME_OFFSET] - source[leftBase + TIME_OFFSET];
    if (dt <= 0 || dt > 0.1) return false;

    const a = entityOffset(left, player);
    const b = entityOffset(left + 1, player);
    const dx = source[b] - source[a];
    const dy = source[b + 1] - source[a + 1];
    const dz = source[b + 2] - source[a + 2];
    const distance = Math.hypot(dx, dy, dz);
    const speedA = Math.hypot(source[a + 7], source[a + 8], source[a + 9]);
    const speedB = Math.hypot(source[b + 7], source[b + 8], source[b + 9]);
    if (distance > Math.max(200, 3 * Math.max(speedA, speedB) * dt)) return false;

    const velocityChange = Math.hypot(
      source[b + 7] - source[a + 7],
      source[b + 8] - source[a + 8],
      source[b + 9] - source[a + 9]
    );
    return velocityChange < (player < 0 ? 600 : 800);
  };

  for (let player = -1; player < MAX_PLAYERS; player++) {
    for (let frame = 1; frame < totalFrames - 1; frame++) {
      const center = entityOffset(frame, player);
      if (!present(frame, player)) continue;

      for (let axis = 0; axis < 3; axis++) {
        let weighted = weights[0] * source[center + axis];
        let weightSum = weights[0];
        for (let distance = 1; distance < weights.length; distance++) {
          const leftFrame = frame - distance;
          const rightFrame = frame + distance;
          if (leftFrame < 0 || rightFrame >= totalFrames
            || !continuous(leftFrame, player)
            || !continuous(rightFrame - 1, player)) break;
          weighted += weights[distance] * (
            source[entityOffset(leftFrame, player) + axis]
            + source[entityOffset(rightFrame, player) + axis]
          );
          weightSum += 2 * weights[distance];
        }
        framesBuffer[center + axis] = weighted / weightSum;
      }
    }
  }
}
