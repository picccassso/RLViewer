import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import initSubtr, { get_replay_frames_data } from '@rlrml/subtr-actor';
import { rlToThreeVec3, rlToThreeQuat } from '../coords';
import {
  TOTAL_FLOATS_PER_FRAME,
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS,
  ParsedReplayData
} from '../../types/replay';
import { unpackFrame } from '../frameUnpacker';
import { FIELD_WIDTH, FIELD_LENGTH, FIELD_CEILING } from '../../scene/StadiumManager';
import { buildTickMarks, readFinalScore, GOAL_EVENT_MATCH_WINDOW } from '../../parser/tickMarks';

/** Builds tick marks on the playback clock, the same way the replay worker does. */
function buildGoalTimeline(rawData: any) {
  const metadataFrames = rawData.frame_data.metadata_frames;
  const baseTime = metadataFrames[0].time;
  const playbackTimeAtFrame = (frame: number) =>
    metadataFrames[Math.min(Math.max(0, frame), metadataFrames.length - 1)].time - baseTime;
  const tickMarks = buildTickMarks(rawData.replay_tick_marks, rawData.goal_events, playbackTimeAtFrame);
  const goals = tickMarks.filter((tm) => tm.type === 'goal');
  const scoreAt = (time: number) => ({
    team0: goals.filter((tm) => tm.team === 0 && tm.time <= time).length,
    team1: goals.filter((tm) => tm.team === 1 && tm.time <= time).length,
  });
  return {
    tickMarks,
    goals,
    scoreAt,
    duration: playbackTimeAtFrame(metadataFrames.length - 1),
    finalScore: readFinalScore(rawData.meta.all_headers, tickMarks),
  };
}

function expectConsistentGoalTimeline(timeline: ReturnType<typeof buildGoalTimeline>) {
  // Every mark sits on the playback clock, inside the replay
  for (const tm of timeline.tickMarks) {
    expect(tm.time).toBeGreaterThanOrEqual(0);
    expect(tm.time).toBeLessThanOrEqual(timeline.duration + 1e-6);
  }
  // One mark per goal: no two goals within the goal event match window
  for (let i = 1; i < timeline.goals.length; i++) {
    expect(timeline.goals[i].time - timeline.goals[i - 1].time).toBeGreaterThan(GOAL_EVENT_MATCH_WINDOW);
  }
  // The live score at the end of the replay matches the replay header
  expect(timeline.scoreAt(timeline.duration)).toEqual(timeline.finalScore);
}

describe('Real Replay End-to-End Integration Verification', () => {
  it('parses real 37EAB52B460DD65A5CC4679B7E8515F7.replay and validates match integrity', async () => {
    // Initialize WASM
    const wasmPath = path.resolve(__dirname, '../../../node_modules/@rlrml/subtr-actor/rl_replay_subtr_actor_bg.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    await initSubtr(wasmBuffer);

    // Read replay file
    const replayPath = path.resolve(__dirname, '../../../37EAB52B460DD65A5CC4679B7E8515F7.replay');
    expect(fs.existsSync(replayPath)).toBe(true);
    const replayBytes = fs.readFileSync(replayPath);

    const startTime = performance.now();
    const rawData = get_replay_frames_data(replayBytes);
    const parseTime = performance.now() - startTime;
    console.log(`Parsed real replay in ${parseTime.toFixed(1)}ms`);

    // 1. Verify Metadata & Roster
    const meta = rawData.meta;
    expect(meta).toBeDefined();
    expect(meta.team_zero.length).toBe(3);
    expect(meta.team_one.length).toBe(3);

    const team0Names = meta.team_zero.map((p: any) => p.name);
    expect(team0Names).toContain('evaxyprime.');
    expect(team0Names).toContain('míŁo');
    expect(team0Names).toContain('Kxrma.');

    const team1Names = meta.team_one.map((p: any) => p.name);
    expect(team1Names).toContain('Darth7.');
    expect(team1Names).toContain('Picasso');
    expect(team1Names).toContain('Jakuya on of');

    // Verify Replicated Camera Settings
    const evaxCam = meta.team_zero[0].camera_settings;
    expect(evaxCam.fov).toBe(110);
    expect(evaxCam.distance).toBe(270);
    expect(evaxCam.height).toBe(90);
    expect(evaxCam.angle).toBe(-5);

    // 2. Verify 34 Boost Pads
    const boostPads = rawData.boost_pads;
    expect(boostPads.length).toBe(34);
    const bigPads = boostPads.filter((p: any) => p.size === 'Big');
    const smallPads = boostPads.filter((p: any) => p.size === 'Small');
    expect(bigPads.length).toBe(6);
    expect(smallPads.length).toBe(28);

    // 3. Verify Goals & Demolishes
    expect(rawData.goal_events.length).toBe(3);
    expect(rawData.demolish_infos.length).toBe(2);
    expect(rawData.replay_tick_marks.length).toBeGreaterThanOrEqual(10);

    // Goal timeline: 3 goals, final score 2-1, each goal counted once
    const timeline = buildGoalTimeline(rawData);
    expect(timeline.finalScore).toEqual({ team0: 2, team1: 1 });
    expect(timeline.goals.length).toBe(3);
    expectConsistentGoalTimeline(timeline);
    // Regression: the score used to climb 2 -> 3 -> 4 between 04:52 and 04:56
    expect(timeline.scoreAt(4 * 60 + 52)).toEqual({ team0: 2, team1: 1 });
    expect(timeline.scoreAt(4 * 60 + 56)).toEqual({ team0: 2, team1: 1 });
    // Goals sit at the moment they are scored on the playback clock
    expect(timeline.goals.map((g) => Math.round(g.time))).toEqual([79, 196, 244]);

    // 4. Verify Frame Data & Bounds
    const ballFrames = rawData.frame_data.ball_data.frames;
    expect(ballFrames.length).toBeGreaterThan(9000);

    // Check sampled ball positions across match to confirm they reside within arena bounds
    const halfW = FIELD_WIDTH / 2 + 100; // plus slight margin for goal nets
    const halfL = FIELD_LENGTH / 2 + 1000; // goal depth is 880 uu
    for (let f = 0; f < ballFrames.length; f += 200) {
      const bData = ballFrames[f]?.Data?.rigid_body;
      if (bData && bData.location) {
        const threePos = rlToThreeVec3(bData.location);
        expect(Math.abs(threePos.x)).toBeLessThan(halfW);
        expect(Math.abs(threePos.z)).toBeLessThan(halfL);
        expect(threePos.y).toBeGreaterThanOrEqual(0);
        expect(threePos.y).toBeLessThan(FIELD_CEILING + 200);
      }
    }
  });

  it('parses second real replay B8E6937C41E80C502FB75195BD3255DD.replay and verifies 7 goals and 11 demos', async () => {
    const replayPath = path.resolve(__dirname, '../../../B8E6937C41E80C502FB75195BD3255DD.replay');
    expect(fs.existsSync(replayPath)).toBe(true);
    const replayBytes = fs.readFileSync(replayPath);

    const startTime = performance.now();
    const rawData = get_replay_frames_data(replayBytes);
    const parseTime = performance.now() - startTime;
    console.log(`Parsed second replay in ${parseTime.toFixed(1)}ms`);

    expect(rawData.meta).toBeDefined();
    expect(rawData.meta.team_zero.length).toBe(3);
    expect(rawData.meta.team_one.length).toBe(3);

    // 7 goals, 11 demolishes
    expect(rawData.goal_events.length).toBe(7);
    expect(rawData.demolish_infos.length).toBe(11);

    // Goal timeline: 7 goals, final score 4-3, each goal counted once
    const timeline = buildGoalTimeline(rawData);
    expect(timeline.finalScore).toEqual({ team0: 4, team1: 3 });
    expect(timeline.goals.length).toBe(7);
    expectConsistentGoalTimeline(timeline);

    // 13000+ frames
    const ballFrames = rawData.frame_data.ball_data.frames;
    expect(ballFrames.length).toBeGreaterThan(13000);

    const halfW = FIELD_WIDTH / 2 + 100;
    const halfL = FIELD_LENGTH / 2 + 1000;
    for (let f = 0; f < ballFrames.length; f += 500) {
      const bData = ballFrames[f]?.Data?.rigid_body;
      if (bData && bData.location) {
        const threePos = rlToThreeVec3(bData.location);
        expect(Math.abs(threePos.x)).toBeLessThan(halfW);
        expect(Math.abs(threePos.z)).toBeLessThan(halfL);
        expect(threePos.y).toBeGreaterThanOrEqual(0);
        expect(threePos.y).toBeLessThan(FIELD_CEILING + 200);
      }
    }
  });
});
