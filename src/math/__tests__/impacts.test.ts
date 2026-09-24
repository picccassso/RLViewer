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
import { sampleFlipResetFlashes } from '../flipReset';
import { unpackFrame } from '../frameUnpacker';

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

/** A gentle airborne carry with only one discrete touch, moving at 1200 uu/s. */
function carryReplay(fps = 30): ParsedReplayData {
  const data = hitReplay(0, [{ time: 0.1, team: 0 }]);
  data.totalFrames = 2 * fps + 1;
  data.duration = 2;
  data.frameRate = fps;
  data.framesBuffer = new Float32Array(data.totalFrames * TOTAL_FLOATS_PER_FRAME);
  for (let f = 0; f < data.totalFrames; f++) {
    const offset = f * TOTAL_FLOATS_PER_FRAME;
    const x = 1200 * f / fps;
    data.framesBuffer.set([x, 400, 0, 0, 0, 0, 1, 1200, 0, 0], offset);
    data.framesBuffer.set([x, 270, -50, 0, 0, 0, 1, 1200, 0, 0, 100, 1], offset + FLOATS_PER_BALL);
    data.framesBuffer[offset + TIME_OFFSET] = f / fps;
  }
  return data;
}

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

  it('gives soft touches fine sparks without a flash, and flip hits more punch', () => {
    const soft = collect(buildImpacts(hitReplay(250, [touch])), touch.time + 0.02);
    expect(soft.length).toBeGreaterThan(0);
    expect(soft.every((sprite) => sprite[11] === 2)).toBe(true);
    expect(collect(buildImpacts(hitReplay(0, [touch])), touch.time + 0.02)
      .every((sprite) => sprite.every(Number.isFinite))).toBe(true);
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
    // Flash and sparks fade out on their own clocks.
    expect(collect(impacts, touch.time + 0.3).length).toBeLessThan(early.length);
    expect(collect(impacts, touch.time + HIT_SECONDS + 0.01)).toEqual([]);
  });

  it('sustains sparks between gentle air-dribble touches, following the moving contact', () => {
    const impacts = buildImpacts(carryReplay());
    expect(collect(impacts, 0.09)).toEqual([]);
    for (const time of [0.4, 0.8, 1.2, 1.6]) {
      const sprites = collect(impacts, time);
      expect(sprites.length).toBeGreaterThan(15);
      expect(sprites.every((s) => s[11] === 2 && s.every(Number.isFinite))).toBe(true);
      expect(sprites.every((s) => Math.abs(s[0] - 1200 * time) < 200)).toBe(true);
    }
    const paused = collect(impacts, 1.2);
    collect(impacts, 1.9);
    collect(impacts, 0.2);
    expect(collect(impacts, 1.2)).toEqual(paused);
  });

  it('emits at the same rate with different packet rates', () => {
    const births = (fps: number) => buildImpacts(carryReplay(fps))
      .filter((i) => i.kind === 'spark' && i.time > 0.3 && i.time < 1.8).map((i) => i.time);
    expect(births(30)).toEqual(births(60));
  });

  it.each(['separated', 'absent', 'demoed', 'grounded', 'passing'])(
    'stops the stream when the car is %s', (condition) => {
      const data = carryReplay();
      for (let f = 30; f < data.totalFrames; f++) {
        const o = f * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL;
        if (condition === 'separated') data.framesBuffer[o + 2] = -500;
        if (condition === 'absent') data.framesBuffer[o + 11] = 0;
        if (condition === 'demoed') data.framesBuffer[o + 11] = 5;
        if (condition === 'grounded') data.framesBuffer[o + 1] = 17;
        if (condition === 'passing') data.framesBuffer[o + 7] = -1200;
      }
      const impacts = buildImpacts(data);
      expect(collect(impacts, 0.8).length).toBeGreaterThan(15);
      expect(impacts.some((i) => i.kind === 'spark' && i.time >= 1)).toBe(false);
      expect(collect(impacts, 1.35)).toEqual([]);
    }
  );

  it('requires a recorded touch and does not bridge replay gaps or teleports', () => {
    const untouched = carryReplay();
    untouched.ballTouches = [];
    expect(buildImpacts(untouched)).toEqual([]);
    for (const gap of [true, false]) {
      const data = carryReplay();
      for (let f = 30; f < data.totalFrames; f++) {
        const o = f * TOTAL_FLOATS_PER_FRAME;
        if (gap) data.framesBuffer[o + TIME_OFFSET] += 2;
        else {
          data.framesBuffer[o] += 10000;
          data.framesBuffer[o + FLOATS_PER_BALL] += 10000;
        }
      }
      if (gap) data.duration += 2;
      const sparks = buildImpacts(data).filter((i) => i.kind === 'spark');
      expect(sparks.some((i) => i.time > 29 / 30 && i.time <= (gap ? 3 : 1))).toBe(false);
    }
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
    // Every recorded touch can spark, including soft carries.
    const hits = impacts.filter((i) => i.kind === 'hit').length;
    expect(hits).toBe(data.ballTouches.length);
  });
});

describe('Flip reset flash placement', () => {
  it('stays on the wheel side of the moving car as it rolls', () => {
    const state = unpackFrame(carryReplay(), 30);
    const car = state.players[0];
    const sprites = () => {
      const result: number[][] = [];
      sampleFlipResetFlashes([[1]], state, (...sprite) => result.push(sprite));
      return result;
    };
    const upright = sprites();
    expect(upright).toHaveLength(2);
    expect(upright[0].slice(0, 3)).toEqual([car.position.x, car.position.y - 20, car.position.z]);
    expect(upright.every((s) => s[7] === s[8] && s[8] === s[9])).toBe(true);

    car.rotation = { x: 1, y: 0, z: 0, w: 0 };
    car.position.x += 300;
    expect(sprites()[0].slice(0, 3)).toEqual([car.position.x, car.position.y + 20, car.position.z]);
    car.rotation = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    expect(sprites()[0][0]).toBeCloseTo(car.position.x + 20);
    expect(sprites()[0][1]).toBeCloseTo(car.position.y);

    state.time = 1.3;
    expect(sprites()).toEqual([]);
    state.time = 1;
    car.isDemoed = true;
    expect(sprites()).toEqual([]);
    car.isDemoed = false;
    car.isPresent = false;
    expect(sprites()).toEqual([]);
  });
});
