import { describe, expect, it } from 'vitest';
import { FLOATS_PER_BALL, FLOATS_PER_PLAYER, MAX_PLAYERS, ParsedReplayData, TOTAL_FLOATS_PER_FRAME } from '../../types/replay';
import { buildWheelTravel, sampleWheelTravel } from '../wheelRotation';

const META = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
function driving(speed = 600): ParsedReplayData {
  const framesBuffer = new Float32Array(5 * TOTAL_FLOATS_PER_FRAME);
  for (let f = 0; f < 5; f++) {
    const o = f * TOTAL_FLOATS_PER_FRAME;
    framesBuffer.set([speed * f * 0.05, 17, 0, 0, 0, 0, 1, speed, 0, 0, 0, 1], o + FLOATS_PER_BALL);
    framesBuffer[o + META] = f * 0.05;
  }
  return { framesBuffer, totalFrames: 5, duration: 0.2, frameRate: 20,
    players: [{ index: 0, team: 0 }] as ParsedReplayData['players'], boostPads: [], tickMarks: [],
    teamScores: { team0: 0, team1: 0 }, flipResets: [], ballTouches: [], demolitions: [] };
}

describe('Wheel rolling distance', () => {
  it('tracks speed and reverse, and remains still at rest', () => {
    expect(buildWheelTravel(driving(600))[0][4]).toBeCloseTo(120, 4);
    expect(buildWheelTravel(driving(-600))[0][4]).toBeCloseTo(-120, 4);
    expect([...buildWheelTravel(driving(0))[0]]).toEqual([0, 0, 0, 0, 0]);
  });
  it('projects onto the car forward axis instead of spinning from sideways motion', () => {
    const data = driving();
    for (let f = 0; f < 5; f++) {
      const o = f * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL;
      data.framesBuffer[o + 4] = Math.SQRT1_2;
      data.framesBuffer[o + 6] = Math.SQRT1_2;
    }
    expect(buildWheelTravel(data)[0][4]).toBeCloseTo(0, 4);
  });
  it('coasts during an air roll without reversing when the car rotates', () => {
    const data = driving();
    for (let f = 1; f < 5; f++) {
      const o = f * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL;
      data.framesBuffer[o + 1] = 100;
      data.framesBuffer[o + 4] = 1;
      data.framesBuffer[o + 6] = 0;
    }
    const [travel] = buildWheelTravel(data);
    expect(travel[4]).toBeGreaterThan(90);
    expect(travel[4]).toBeLessThan(120);
    expect(travel[4] - travel[3]).toBeLessThan(travel[2] - travel[1]);
  });
  it.each(['gap', 'teleport', 'absent', 'demo'])('holds rotation across a %s', (cause) => {
    const data = driving();
    for (let f = 2; f < 5; f++) {
      const o = f * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL;
      if (cause === 'gap') data.framesBuffer[f * TOTAL_FLOATS_PER_FRAME + META] += 2;
      if (cause === 'teleport') data.framesBuffer[o] += 10000;
      if (cause === 'absent') data.framesBuffer[o + 11] = 0;
      if (cause === 'demo') data.framesBuffer[o + 11] = 5;
    }
    const [travel] = buildWheelTravel(data);
    expect(travel[2]).toBe(travel[1]);
  });
  it('samples recorded timestamps deterministically through pause and scrubbing', () => {
    const data = driving();
    // Uneven source packets with unchanged rolling velocity.
    data.framesBuffer[2 * TOTAL_FLOATS_PER_FRAME + META] = 0.12;
    const [travel] = buildWheelTravel(data);
    const sample = () => sampleWheelTravel(data, travel, 1, 0.08);
    expect(sample()).toBeCloseTo(48, 4);
    sampleWheelTravel(data, travel, 3, 0.18);
    sampleWheelTravel(data, travel, 0, 0.01);
    expect(sample()).toBeCloseTo(48, 4);
  });
});
