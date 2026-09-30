import { describe, expect, it } from 'vitest';
import { smoothReplayPositions } from '../motionSmoothing';
import { FLOATS_PER_BALL, MAX_PLAYERS, FLOATS_PER_PLAYER, TOTAL_FLOATS_PER_FRAME } from '../../types/replay';

const TIME_OFFSET = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;

function makeFrames(positions: number[], times = positions.map((_, i) => i / 30)) {
  const buffer = new Float32Array(positions.length * TOTAL_FLOATS_PER_FRAME);
  for (let i = 0; i < positions.length; i++) {
    const base = i * TOTAL_FLOATS_PER_FRAME;
    buffer[base] = positions[i];
    buffer[base + 7] = 300;
    const car = base + FLOATS_PER_BALL;
    buffer[car] = positions[i] + 1000;
    buffer[car + 7] = 300;
    buffer[car + FLOATS_PER_PLAYER - 1] = 1;
    buffer[base + TIME_OFFSET] = times[i];
  }
  return buffer;
}

describe('Replay position smoothing', () => {
  it('keeps a jump sharp and takes the jitter out of the steps', () => {
    // A car at rest that jumps at frame 10 (292 uu/s impulse, then gravity 650 uu/s^2), with
    // the recorded heights sampled a little early or late of each frame like real replays.
    const frames = 20;
    const dt = 1 / 30;
    const jitter = [0, 3, -2, 4, -3, 2, -4, 3, -2, 0];
    const buffer = new Float32Array(frames * TOTAL_FLOATS_PER_FRAME);
    const car = FLOATS_PER_BALL;
    for (let i = 0; i < frames; i++) {
      const base = i * TOTAL_FLOATS_PER_FRAME;
      const airtime = Math.max(0, i - 10) * dt;
      const velocity = i >= 10 ? 292 - 650 * airtime : 0;
      const height = 17 + 292 * airtime - 325 * airtime * airtime;
      buffer[base + car + 1] = height + (i >= 10 ? jitter[i % 10] : 0);
      buffer[base + car + 8] = velocity;
      buffer[base + car + FLOATS_PER_PLAYER - 1] = 1;
      buffer[base + TIME_OFFSET] = i * dt;
    }
    smoothReplayPositions(buffer, frames, new Uint8Array(frames));

    // The car stays within a couple of uu of the turf until it jumps...
    for (let i = 0; i < 10; i++) expect(Math.abs(buffer[i * TOTAL_FLOATS_PER_FRAME + car + 1] - 17)).toBeLessThan(2.5);
    // ...and every step, through the jump itself, matches the recorded speed.
    for (let i = 1; i < frames; i++) {
      const step = buffer[i * TOTAL_FLOATS_PER_FRAME + car + 1] - buffer[(i - 1) * TOTAL_FLOATS_PER_FRAME + car + 1];
      const expected = 0.5 * (buffer[i * TOTAL_FLOATS_PER_FRAME + car + 8] + buffer[(i - 1) * TOTAL_FLOATS_PER_FRAME + car + 8]) * dt;
      expect(Math.abs(step - expected)).toBeLessThan(1);
    }
  });

  it('removes short and long network steps for both ball and car', () => {
    const buffer = makeFrames([0, 10, 20, 26, 44, 50, 60]);
    smoothReplayPositions(buffer, 7, new Uint8Array(7).fill(1));

    expect(buffer[3 * TOTAL_FLOATS_PER_FRAME]).toBeGreaterThan(29);
    expect(buffer[3 * TOTAL_FLOATS_PER_FRAME]).toBeLessThan(31);
    expect(buffer[4 * TOTAL_FLOATS_PER_FRAME]).toBeGreaterThan(39);
    expect(buffer[4 * TOTAL_FLOATS_PER_FRAME]).toBeLessThan(41);
    expect(buffer[3 * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL]).toBeGreaterThan(1029);
    expect(buffer[3 * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL]).toBeLessThan(1031);
    expect(buffer[4 * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL]).toBeGreaterThan(1039);
    expect(buffer[4 * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL]).toBeLessThan(1041);
  });

  it('does not pull positions across a match break, missing transform, or impact', () => {
    const positions = [0, 10, 20, 30, 500, 510, 520];
    const times = [0, 1 / 30, 2 / 30, 3 / 30, 2, 2 + 1 / 30, 2 + 2 / 30];
    const gap = makeFrames(positions, times);
    smoothReplayPositions(gap, 7, new Uint8Array(7).fill(1));
    expect(gap[3 * TOTAL_FLOATS_PER_FRAME]).toBe(30);
    expect(gap[4 * TOTAL_FLOATS_PER_FRAME]).toBe(500);

    const missing = makeFrames([0, 10, 20, 30, 40]);
    const ballValid = new Uint8Array([1, 1, 0, 1, 1]);
    smoothReplayPositions(missing, 5, ballValid);
    expect(missing[2 * TOTAL_FLOATS_PER_FRAME]).toBe(20);

    const impact = makeFrames([0, 10, 20, 30, 40]);
    impact[3 * TOTAL_FLOATS_PER_FRAME + 7] = -1200;
    smoothReplayPositions(impact, 5, new Uint8Array(5).fill(1));
    expect(impact[2 * TOTAL_FLOATS_PER_FRAME]).toBe(20);
  });
});
