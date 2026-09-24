import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getFrameSampleAtTime, unpackFrame } from '../frameUnpacker';
import {
  ParsedReplayData,
  TOTAL_FLOATS_PER_FRAME,
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS
} from '../../types/replay';

describe('Frame Unpacker & Interpolation', () => {
  it('correctly unpacks discrete frames and smoothly interpolates between frames', () => {
    const totalFrames = 10;
    const buffer = new Float32Array(totalFrames * TOTAL_FLOATS_PER_FRAME);

    // Populate Frame 0:
    // Ball at (0, 92.75, 0), rot (0,0,0,1), vel (100, 0, 0)
    buffer[0] = 0;
    buffer[1] = 92.75;
    buffer[2] = 0;
    buffer[6] = 1.0;
    buffer[7] = 100;

    // Player 0: Pos (1000, 20, -500), rot (0,0,0,1), boost 50, flags = 1 (present) | 2 (ballcam)
    const p0Offset = FLOATS_PER_BALL;
    buffer[p0Offset + 0] = 1000;
    buffer[p0Offset + 1] = 20;
    buffer[p0Offset + 2] = -500;
    buffer[p0Offset + 6] = 1.0;
    buffer[p0Offset + 10] = 50;
    buffer[p0Offset + 11] = 3; // present + ballcam

    const u32Buffer = new Uint32Array(buffer.buffer);

    // Metadata Frame 0: time = 0, secondsRemaining = 300, boost mask = 0xFFFFFFFF
    const metaOffset0 = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
    buffer[metaOffset0 + 0] = 0.0;
    buffer[metaOffset0 + 1] = 300;
    u32Buffer[metaOffset0 + 2] = 0xFFFFFFFF; // all 32 low pads available
    u32Buffer[metaOffset0 + 3] = 0x3;        // top 2 pads available

    // Populate Frame 1:
    const frame1Offset = TOTAL_FLOATS_PER_FRAME;
    // Ball moved to (100, 92.75, 0)
    buffer[frame1Offset + 0] = 100;
    buffer[frame1Offset + 1] = 92.75;
    buffer[frame1Offset + 2] = 0;
    buffer[frame1Offset + 6] = 1.0;

    // Player 0 moved to (1100, 20, -500), boost consumed down to 40
    const p0Offset1 = frame1Offset + FLOATS_PER_BALL;
    buffer[p0Offset1 + 0] = 1100;
    buffer[p0Offset1 + 1] = 20;
    buffer[p0Offset1 + 2] = -500;
    buffer[p0Offset1 + 6] = 1.0;
    buffer[p0Offset1 + 10] = 40;
    buffer[p0Offset1 + 11] = 3;

    // Metadata Frame 1: time = 0.033, secondsRemaining = 300
    const metaOffset1 = frame1Offset + FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
    buffer[metaOffset1 + 0] = 0.033;
    buffer[metaOffset1 + 1] = 300;
    u32Buffer[metaOffset1 + 2] = 0xFFFFFFFE; // pad 0 picked up (bit 0 = 0)
    u32Buffer[metaOffset1 + 3] = 0x3;

    const mockData: ParsedReplayData = {
      totalFrames,
      duration: 5.0,
      frameRate: 30,
      players: [
        {
          index: 0,
          id: 'player_0',
          name: 'Alpha',
          team: 0,
          car_body_id: 4284,
          car_hitbox_family: 'Octane',
          camera_settings: {
            fov: 110,
            distance: 270,
            height: 100,
            angle: -3,
            stiffness: 0.45,
            swivel_speed: 5.0,
            transition_speed: 1.3
          }
        }
      ],
      boostPads: Array.from({ length: 34 }, (_, i) => ({
        index: i,
        pad_id: `pad_${i}`,
        size: i < 6 ? 'Big' : 'Small',
        position: { x: 0, y: 10, z: 0 }
      })),
      tickMarks: [],
      teamScores: { team0: 0, team1: 0 },
      flipResets: [],
      framesBuffer: buffer
    };

    // 1. Unpack exact frame 0
    const state0 = unpackFrame(mockData, 0, 0, 0);
    expect(state0.ball.position.x).toBe(0);
    expect(state0.ball.position.y).toBe(92.75);
    expect(state0.players[0].position.x).toBe(1000);
    expect(state0.players[0].boost).toBe(50);
    expect(state0.players[0].ballCamActive).toBe(true);
    expect(state0.boostPadsAvailable[0]).toBe(true);

    // 2. Unpack with alpha = 0.5 (halfway between frame 0 and frame 1)
    const stateHalf = unpackFrame(mockData, 0, 1, 0.5);
    // Ball position should be exactly 50 (interpolated between 0 and 100)
    expect(stateHalf.ball.position.x).toBeCloseTo(50, 4);
    // Player position should be 1050 (interpolated between 1000 and 1100)
    expect(stateHalf.players[0].position.x).toBeCloseTo(1050, 4);
    // Player boost should be 45 (interpolated between 50 and 40)
    expect(stateHalf.players[0].boost).toBeCloseTo(45, 4);
    expect(stateHalf.time).toBeCloseTo(0.0165, 4);

    // 3. Unpack frame 1
    const state1 = unpackFrame(mockData, 1, 1, 0);
    expect(state1.ball.position.x).toBe(100);
    expect(state1.players[0].position.x).toBe(1100);
    expect(state1.players[0].boost).toBe(40);
    // Pad 0 was picked up in frame 1
    expect(state1.boostPadsAvailable[0]).toBe(false);
    expect(state1.boostPadsAvailable[1]).toBe(true);

    // Sampling uses the recorded timestamps rather than an averaged FPS.
    const sample = getFrameSampleAtTime(
      { ...mockData, totalFrames: 2, duration: 0.033 },
      0.00825
    );
    expect(sample.frameA).toBe(0);
    expect(sample.frameB).toBe(1);
    expect(sample.alpha).toBeCloseTo(0.25, 4);

    // Do not pull a visible player towards an absent next-frame placeholder.
    buffer[p0Offset1 + 11] = 0;
    const beforeDespawn = unpackFrame(mockData, 0, 1, 0.75);
    expect(beforeDespawn.players[0].position.x).toBe(1000);
  });

  it('holds the last frame instead of interpolating across replay discontinuities', () => {
    const totalFrames = 2;
    const buffer = new Float32Array(totalFrames * TOTAL_FLOATS_PER_FRAME);
    const metaOffset = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
    buffer[metaOffset] = 0;
    buffer[TOTAL_FLOATS_PER_FRAME + metaOffset] = 2;

    const replayData: ParsedReplayData = {
      totalFrames,
      duration: 2,
      frameRate: 30,
      players: [],
      boostPads: [],
      tickMarks: [],
      teamScores: { team0: 0, team1: 0 },
      flipResets: [],
      framesBuffer: buffer,
    };

    expect(getFrameSampleAtTime(replayData, 1)).toEqual({
      frameA: 0,
      frameB: 0,
      alpha: 0,
    });
  });
});
