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
