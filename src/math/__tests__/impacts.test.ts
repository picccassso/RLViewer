import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import initSubtr, { get_replay_frames_data } from '@rlrml/subtr-actor';
import {
  BallTouch,
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS,
  ParsedReplayData,
  TOTAL_FLOATS_PER_FRAME,
} from '../../types/replay';
import { buildImpacts, DEMO_SECONDS, HIT_SECONDS, Impact, sampleImpacts } from '../impacts';
import { buildReplayData } from '../../parser/buildReplayData';

const TIME_OFFSET = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
const FRAME_SECONDS = 1 / 30;

/**
 * The ball sits at (0, 93, 0) until frame 30, then flies off along +Z at `ballSpeed`.
 * A blue car waits 150 uu behind it along -Z.
 */
function hitReplay(ballSpeed: number, touches: BallTouch[]): ParsedReplayData {
  const totalFrames = 60;
  const framesBuffer = new Float32Array(totalFrames * TOTAL_FLOATS_PER_FRAME);
  for (let f = 0; f < totalFrames; f++) {
    const offset = f * TOTAL_FLOATS_PER_FRAME;
    const moving = f >= 30;
    framesBuffer.set([0, 93, moving ? (f - 30) * ballSpeed * FRAME_SECONDS : 0, 0, 0, 0, 1, 0, 0, moving ? ballSpeed : 0], offset);
    const car = offset + FLOATS_PER_BALL;
    framesBuffer.set([0, 60, -150, 0, 0, 0, 1], car);
    framesBuffer[car + 11] = 1;
    framesBuffer[offset + TIME_OFFSET] = f * FRAME_SECONDS;
  }
  return {
    totalFrames,
    duration: (totalFrames - 1) * FRAME_SECONDS,
    frameRate: 30,
    players: [{ index: 0, team: 0 } as ParsedReplayData['players'][number]],
    boostPads: [],
    tickMarks: [],
    teamScores: { team0: 0, team1: 0 },
    flipResets: [],
    ballTouches: touches,
    demolitions: [],
    framesBuffer,
  };
}

const collect = (impacts: Impact[], time: number) => {
  const sprites: number[][] = [];
  sampleImpacts(impacts, time, (...sprite) => sprites.push(sprite));
  return sprites;
};

describe('Contact effects', () => {
  const touch = { time: 30 * FRAME_SECONDS, team: 0 as const };

  it('puts a hard hit on the ball, towards the car that made it', () => {
    const [hit] = buildImpacts(hitReplay(3000, [touch]));
    expect(hit.kind).toBe('hit');
    expect(hit.strength).toBeGreaterThan(0.5);
    expect(hit.strength).toBeLessThan(1);
    // The car is behind and below the ball.
    expect(hit.nz).toBeLessThan(-0.9);
    expect(Math.hypot(hit.x, hit.y - 93, hit.z)).toBeCloseTo(92.75, 3);
  });

  it('leaves soft touches quiet and gives flip hits more punch', () => {
    expect(buildImpacts(hitReplay(250, [touch]))).toEqual([]);
    const plain = buildImpacts(hitReplay(1500, [touch]))[0].strength;
    const flip = buildImpacts(hitReplay(1500, [{ ...touch, flip: true }]))[0].strength;
    expect(flip).toBeCloseTo(plain + 0.15, 6);
  });

  it('draws the same sprites for the same moment, and clears once faded', () => {
    const impacts = buildImpacts(hitReplay(3000, [touch]));
    expect(collect(impacts, touch.time - 0.01)).toEqual([]);
    const early = collect(impacts, touch.time + 0.02);
    expect(early.length).toBeGreaterThan(5);
    expect(collect(impacts, touch.time + 0.02)).toEqual(early);
    // Flash, ring and sparks fade out on their own clocks.
    expect(collect(impacts, touch.time + 0.3).length).toBeLessThan(early.length);
    expect(collect(impacts, touch.time + HIT_SECONDS + 0.01)).toEqual([]);
  });

  it('blows up demolitions from the sample match', async () => {
    const wasmPath = path.resolve(__dirname, '../../../node_modules/@rlrml/subtr-actor/rl_replay_subtr_actor_bg.wasm');
    await initSubtr(fs.readFileSync(wasmPath));
    const rawData = get_replay_frames_data(fs.readFileSync(path.resolve(__dirname, '../../../public/sample.replay')));
    const data = buildReplayData(rawData);

    expect(data.demolitions).toHaveLength(rawData.demolish_infos.length);
    const impacts = buildImpacts(data);
    const demo = impacts.find((i) => i.kind === 'demo')!;
    expect(demo.y).toBeGreaterThan(0);
    expect(collect(impacts, demo.time + 0.1).length).toBeGreaterThan(20);
    expect(collect(impacts, demo.time + DEMO_SECONDS + 0.01).filter((s) => s[0] === demo.x)).toEqual([]);
    // Most touches make an effect; the softest don't.
    const hits = impacts.filter((i) => i.kind === 'hit').length;
    expect(hits).toBeGreaterThan(data.ballTouches.length / 2);
    expect(hits).toBeLessThan(data.ballTouches.length);
  });
});
