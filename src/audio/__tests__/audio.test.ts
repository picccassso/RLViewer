import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSubtr, { get_replay_frames_data } from '@rlrml/subtr-actor';
import { buildReplayData } from '../../parser/buildReplayData';
import { TOTAL_FLOATS_PER_FRAME, FLOATS_PER_BALL, MAX_PLAYERS, FLOATS_PER_PLAYER } from '../../types/replay';
import { replay, car } from './fixtures';
const META = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
import { buildSoundEvents, SoundEvent, SoundEventCursor, SoundKind } from '../events';
import { SOUND_LENGTHS, synthesizeSound } from '../synthesis';

describe('Replay sound events', () => {
  it('builds finite, ordered sounds from the bundled real match', async () => {
    await initSubtr(readFileSync(resolve('node_modules/@rlrml/subtr-actor/rl_replay_subtr_actor_bg.wasm')));
    const data = buildReplayData(get_replay_frames_data(readFileSync(resolve('public/sample.replay'))));
    const events = buildSoundEvents(data);
    const counts = Object.fromEntries(Object.keys(SOUND_LENGTHS).map((kind) => [kind, events.filter((e) => e.kind === kind).length]));
    console.log('Sample match sound events:', counts);
    expect(counts.demo).toBe(data.demolitions.length);
    expect(counts.ball).toBeGreaterThanOrEqual(data.ballTouches.length);
    expect(counts.reset).toBe(data.flipResets.flat().length);
    expect(counts.jump).toBeGreaterThan(0);
    expect(counts.dodge).toBeGreaterThan(0);
    expect(counts.bump).toBeGreaterThan(0);
    expect(counts.land).toBeGreaterThan(0);
    expect(events.every((e, i) => Number.isFinite(e.time) && e.time >= 0 && e.time <= data.duration &&
      e.strength > 0 && e.strength <= 1 && Object.values(e.position).every(Number.isFinite) &&
      (i === 0 || events[i - 1].time <= e.time))).toBe(true);
  });

  it('uses recorded demo, touch and reset timestamps, including soft touches', () => {
    const data = replay();
    data.ballTouches = [{ time: 0.1, team: 0 }];
    data.demolitions = [{ time: 0.4, position: { x: 10, y: 20, z: 30 }, team: 0 }];
    data.flipResets = [[], [0.7]];
    const events = buildSoundEvents(data);
    expect(events.map((e) => [e.kind, e.time])).toEqual([['ball', 0.1], ['demo', 0.4], ['reset', 0.7]]);
    expect(events[0].strength).toBeGreaterThan(0);
    expect(events[1].position).toEqual(data.demolitions[0].position);
    expect(events[2].position.x).toBe(2000);
  });

  it('sounds a jump/dodge once on flag activation, not every held frame', () => {
    const data = replay();
    for (let f = 3; f < 9; f++) car(data, f)[11] = 33;
    for (let f = 12; f < 18; f++) car(data, f)[11] = 97;
    expect(buildSoundEvents(data).map((e) => e.kind)).toEqual(['jump', 'dodge']);
  });

  it('does not invent jumps on a spawn, demo, teleport or a timestamp gap', () => {
    for (const cause of ['spawn', 'demo', 'teleport', 'gap']) {
      const data = replay();
      car(data, 2)[11] = cause === 'spawn' ? 0 : cause === 'demo' ? 5 : 1;
      for (let f = 3; f < data.totalFrames; f++) {
        car(data, f)[11] = 33;
        if (cause === 'teleport') car(data, f)[0] = 10000;
        if (cause === 'gap') data.framesBuffer[f * TOTAL_FLOATS_PER_FRAME + META] += 2;
      }
      if (cause === 'gap') data.duration += 2;
      expect(buildSoundEvents(data).filter((e) => e.kind === 'jump')).toEqual([]);
    }
  });

  it('requires closing contact and a velocity impulse for a bump, and suppresses demo duplicates', () => {
    const data = replay();
    for (let f = 0; f < data.totalFrames; f++) {
      car(data, f, 1)[0] = 140;
      car(data, f)[7] = f < 4 ? 900 : 0;
    }
    const bumps = () => buildSoundEvents(data).filter((e) => e.kind === 'bump');
    expect(bumps()).toHaveLength(1);
    expect(bumps()[0].position.x).toBe(70);
    data.demolitions = [{ time: 4 / 30, position: { x: 70, y: 17, z: 0 }, team: 0 }];
    expect(bumps()).toEqual([]);
    data.demolitions = [];
    for (let f = 0; f < data.totalFrames; f++) car(data, f)[7] = 900;
    expect(bumps()).toEqual([]);
  });

  it('adds landings and ball bounces without duplicating a recorded ball touch', () => {
    const data = replay();
    for (let f = 0; f < data.totalFrames; f++) {
      car(data, f)[1] = f < 5 ? 65 : 17;
      car(data, f)[8] = f < 5 ? -500 : 0;
      const o = f * TOTAL_FLOATS_PER_FRAME;
      data.framesBuffer[o + 1] = 93;
      data.framesBuffer[o + 8] = f < 10 ? -500 : 500;
    }
    expect(buildSoundEvents(data).map((e) => e.kind)).toEqual(['land', 'ball']);
    data.ballTouches = [{ time: 10 / 30, team: 0 }];
    expect(buildSoundEvents(data).filter((e) => e.kind === 'ball')).toHaveLength(1);
  });
});

describe('Replay sound clock', () => {
  const events: SoundEvent[] = [0.1, 0.2, 0.3, 0.8].map((time) => ({ time, kind: 'ball', position: { x: 0, y: 0, z: 0 }, strength: 1 }));
  it('consumes each event once across frame redraws and speed changes', () => {
    const cursor = new SoundEventCursor(events);
    cursor.reset(0);
    expect(cursor.advance(0.1, true, 1)).toEqual([events[0]]);
    expect(cursor.advance(0.1, true, 1)).toEqual([]);
    expect(cursor.advance(0.31, true, 2)).toEqual(events.slice(1, 3));
  });
  it('stays quiet on pause, explicit small/large seeks, loops and missing time', () => {
    const cursor = new SoundEventCursor(events);
    cursor.reset(0);
    expect(cursor.advance(0.2, false, 1)).toEqual([]);
    expect(cursor.advance(0.21, true, 1)).toEqual([]);
    cursor.reset(0.31);
    expect(cursor.advance(0.32, true, 1)).toEqual([]);
    expect(cursor.advance(0.9, true, 1)).toEqual([]);
    expect(cursor.advance(0, true, 1)).toEqual([]);
    expect(cursor.advance(0.1, true, 1)).toEqual([events[0]]);
  });
});

describe('Synthesized audio samples', () => {
  it.each(Object.keys(SOUND_LENGTHS) as SoundKind[])('%s is audible, finite, bounded and fades to silence', (kind) => {
    const samples = synthesizeSound(kind, 48000);
    expect(samples.length).toBe(Math.ceil(SOUND_LENGTHS[kind] * 48000));
    expect(samples.every(Number.isFinite)).toBe(true);
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
    expect(rms(samples)).toBeGreaterThan(0.015);
    expect(samples.every((x) => Math.abs(x) <= 0.7)).toBe(true);
    expect(samples[0]).toBe(0);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.001);
    expect(rms(samples.slice(-480))).toBeLessThan(rms(samples.slice(0, 4800)) * 0.2);
    expect(synthesizeSound(kind, 48000)).toEqual(samples);
  });
});
