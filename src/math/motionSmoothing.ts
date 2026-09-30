import {
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS,
  TOTAL_FLOATS_PER_FRAME,
} from '../types/replay';

const TIME_OFFSET = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;

/**
 * How much more the reconstruction trusts each frame-to-frame step given by the recorded
 * velocities than each recorded position. Position errors shorter than about
 * sqrt(STEP_TRUST) frames (~0.13 s) are removed, and slower drift follows the recorded
 * positions.
 */
export const STEP_TRUST = 16;

/**
 * Rebuilds ball and car positions from the recorded positions and velocities.
 *
 * Replay positions are sampled a little early or late of their frame's timestamp, so
 * frame-to-frame steps are often 25% shorter or longer than the travel at the recorded
 * speed and the motion stutters. The recorded velocities come from the same physics
 * state but hardly change over that timing error, so they give the true step between
 * frames. The positions are solved, per axis, as the closest fit to both:
 *
 *   minimise  sum (x[i] - p[i])^2 + STEP_TRUST * sum (x[i+1] - x[i] - (v[i] + v[i+1]) / 2 * dt)^2
 *
 * Unlike averaging nearby frames, this keeps jumps, dodges, landings and turns as sharp
 * as the game played them: nothing starts moving before it did, and no corner is cut.
 * The fit never reaches across a replay break, a missing transform or an impact (where
 * the velocity changes at an unknown moment inside the frame).
 */
export function smoothReplayPositions(
  framesBuffer: Float32Array,
  totalFrames: number,
  ballHasTransform: Uint8Array
): void {
  if (totalFrames < 2) return;

  const entityOffset = (frame: number, player: number): number =>
    frame * TOTAL_FLOATS_PER_FRAME + (player < 0 ? 0 : FLOATS_PER_BALL + player * FLOATS_PER_PLAYER);

  const present = (frame: number, player: number): boolean => {
    if (player < 0) return ballHasTransform[frame] === 1;
    const flags = framesBuffer[entityOffset(frame, player) + 11] | 0;
    return (flags & 1) !== 0 && (flags & 4) === 0;
  };

  const frameGap = (left: number): number =>
    framesBuffer[(left + 1) * TOTAL_FLOATS_PER_FRAME + TIME_OFFSET] - framesBuffer[left * TOTAL_FLOATS_PER_FRAME + TIME_OFFSET];

  const continuous = (left: number, player: number): boolean => {
    if (!present(left, player) || !present(left + 1, player)) return false;
    const dt = frameGap(left);
    if (dt <= 0 || dt > 0.1) return false;

    const a = entityOffset(left, player);
    const b = entityOffset(left + 1, player);
    const dx = framesBuffer[b] - framesBuffer[a];
    const dy = framesBuffer[b + 1] - framesBuffer[a + 1];
    const dz = framesBuffer[b + 2] - framesBuffer[a + 2];
    const distance = Math.hypot(dx, dy, dz);
    const speedA = Math.hypot(framesBuffer[a + 7], framesBuffer[a + 8], framesBuffer[a + 9]);
    const speedB = Math.hypot(framesBuffer[b + 7], framesBuffer[b + 8], framesBuffer[b + 9]);
    if (distance > Math.max(200, 3 * Math.max(speedA, speedB) * dt)) return false;

    const velocityChange = Math.hypot(
      framesBuffer[b + 7] - framesBuffer[a + 7],
      framesBuffer[b + 8] - framesBuffer[a + 8],
      framesBuffer[b + 9] - framesBuffer[a + 9]
    );
    return velocityChange < (player < 0 ? 600 : 800);
  };

  // Scratch space for the tridiagonal solve, sized for the longest possible run.
  const diag = new Float64Array(totalFrames);
  const rhs = new Float64Array(totalFrames);
  const step = new Float64Array(totalFrames);

  const solveRun = (start: number, end: number, player: number) => {
    const n = end - start + 1;
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i < n - 1; i++) {
        const a = entityOffset(start + i, player);
        const b = entityOffset(start + i + 1, player);
        step[i] = 0.5 * (framesBuffer[a + 7 + axis] + framesBuffer[b + 7 + axis]) * frameGap(start + i);
      }
      for (let i = 0; i < n; i++) {
        let d = 1;
        let r = framesBuffer[entityOffset(start + i, player) + axis];
        if (i > 0) { d += STEP_TRUST; r += STEP_TRUST * step[i - 1]; }
        if (i < n - 1) { d += STEP_TRUST; r -= STEP_TRUST * step[i]; }
        diag[i] = d;
        rhs[i] = r;
      }
      // Thomas algorithm; every off-diagonal entry is -STEP_TRUST.
      for (let i = 1; i < n; i++) {
        const m = -STEP_TRUST / diag[i - 1];
        diag[i] += m * STEP_TRUST;
        rhs[i] -= m * rhs[i - 1];
      }
      let next = rhs[n - 1] / diag[n - 1];
      framesBuffer[entityOffset(end, player) + axis] = next;
      for (let i = n - 2; i >= 0; i--) {
        next = (rhs[i] + STEP_TRUST * next) / diag[i];
        framesBuffer[entityOffset(start + i, player) + axis] = next;
      }
    }
  };

  for (let player = -1; player < MAX_PLAYERS; player++) {
    // Find each run of frames joined by continuous steps, then solve it. The runs are
    // found before any position is rewritten, since `continuous` reads positions.
    const breaks: number[] = [];
    for (let frame = 0; frame < totalFrames - 1; frame++) {
      if (!continuous(frame, player)) breaks.push(frame);
    }
    breaks.push(totalFrames - 1);
    let start = 0;
    for (const end of breaks) {
      if (end > start) solveRun(start, end, player);
      start = end + 1;
    }
  }
}
