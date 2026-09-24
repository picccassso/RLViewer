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
import { buildFlipResets, flipResetBadgeAt, FLIP_RESET_BADGE_SECONDS } from '../flipReset';

function playerLookup(rawData: any, player: any) {
  const id = JSON.stringify(player);
  const match = [...rawData.meta.team_zero, ...rawData.meta.team_one].find(
    (p: any) => JSON.stringify(p.remote_id) === id
  );
  return match ? { name: match.name as string } : undefined;
}

/** Builds tick marks on the playback clock, the same way the replay worker does. */
function buildGoalTimeline(rawData: any) {
  const metadataFrames = rawData.frame_data.metadata_frames;
  const baseTime = metadataFrames[0].time;
  const playbackTimeAtFrame = (frame: number) =>
    metadataFrames[Math.min(Math.max(0, frame), metadataFrames.length - 1)].time - baseTime;
  const tickMarks = buildTickMarks(
    {
      tickMarks: rawData.replay_tick_marks,
      goalEvents: rawData.goal_events,
      statEvents: rawData.player_stat_events,
    },
    playbackTimeAtFrame,
    (player) => playerLookup(rawData, player)
  );
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
  it('parses the sample replay and validates match integrity', async () => {
    // Initialize WASM
    const wasmPath = path.resolve(__dirname, '../../../node_modules/@rlrml/subtr-actor/rl_replay_subtr_actor_bg.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    await initSubtr(wasmBuffer);

    // Read replay file
    const replayPath = path.resolve(__dirname, '../../../public/sample.replay');
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
    expect(team0Names).toEqual(['Kiileerrz', 'Rw9', 'dralii']);

    const team1Names = meta.team_one.map((p: any) => p.name);
    expect(team1Names).toEqual(['diaz', 'reveal', 'zach']);

    // Verify Replicated Camera Settings
    const firstCam = meta.team_zero[0].camera_settings;
    expect(firstCam.fov).toBe(110);
    expect(firstCam.distance).toBe(270);
    expect(firstCam.height).toBe(100);
    expect(firstCam.angle).toBe(-5);

    // 2. Verify 34 Boost Pads
    const boostPads = rawData.boost_pads;
    expect(boostPads.length).toBe(34);
    const bigPads = boostPads.filter((p: any) => p.size === 'Big');
    const smallPads = boostPads.filter((p: any) => p.size === 'Small');
    expect(bigPads.length).toBe(6);
    expect(smallPads.length).toBe(28);

    // 3. Verify Goals & Demolishes
    expect(rawData.goal_events.length).toBe(3);
    expect(rawData.demolish_infos.length).toBe(3);
    expect(rawData.replay_tick_marks.length).toBeGreaterThanOrEqual(10);

    // Goal timeline: 3 goals, final score 2-1, each goal counted once
    const timeline = buildGoalTimeline(rawData);
    expect(timeline.finalScore).toEqual({ team0: 2, team1: 1 });
    expect(timeline.goals.length).toBe(3);
    expectConsistentGoalTimeline(timeline);
    // The score changes exactly at each goal and nowhere else
    expect(timeline.scoreAt(28)).toEqual({ team0: 0, team1: 0 });
    expect(timeline.scoreAt(100)).toEqual({ team0: 2, team1: 0 });
    expect(timeline.scoreAt(timeline.duration)).toEqual({ team0: 2, team1: 1 });
    // Goals sit at the moment they are scored on the playback clock
    expect(timeline.goals.map((g) => Math.round(g.time))).toEqual([29, 94, 287]);
    // Every save carries its team and the saver
    const events = timeline.tickMarks
      .filter((tm) => tm.type !== 'goal')
      .map((tm) => [tm.type, tm.team, tm.description]);
    expect(events).toEqual([
      ['save', 0, 'Blue save by Kiileerrz'],
      ['save', 1, 'Orange save by zach'],
      ['save', 1, 'Orange save by reveal'],
      ['save', 1, 'Orange save by reveal'],
      ['save', 1, 'Orange save by zach'],
      ['save', 0, 'Blue save by Rw9'],
      ['save', 0, 'Blue save by dralii'],
      ['save', 1, 'Orange save by zach'],
      ['save', 0, 'Blue save by Kiileerrz'],
      ['save', 1, 'Orange save by zach'],
    ]);

    // Flip resets: every dodge refresh lands on a known player, on the playback clock
    const metadataFrames = rawData.frame_data.metadata_frames;
    const toPlaybackTime = (frame: number) =>
      metadataFrames[Math.min(frame, metadataFrames.length - 1)].time - metadataFrames[0].time;
    const roster = [...meta.team_zero, ...meta.team_one];
    const flipResets = buildFlipResets(
      rawData.dodge_refreshed_events,
      roster.map((p: any) => JSON.stringify(p.remote_id)),
      toPlaybackTime
    );
    expect(flipResets.flat()).toHaveLength(rawData.dodge_refreshed_events.length);
    expect(flipResets.flat().length).toBeGreaterThan(0);
    const zach = roster.findIndex((p: any) => p.name === 'zach');
    expect(flipResets[zach][0]).toBeCloseTo(toPlaybackTime(1877), 5);

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
});

describe('Flip reset badge', () => {
  it('pops in at the reset, holds, then fades out', () => {
    const resets = [10, 30];
    expect(flipResetBadgeAt(resets, 9.9)).toBeNull();
    const start = flipResetBadgeAt(resets, 10)!;
    expect(start.opacity).toBe(0);
    expect(start.scale).toBeGreaterThan(1);
    expect(flipResetBadgeAt(resets, 11)).toEqual({ opacity: 1, scale: 1 });
    expect(flipResetBadgeAt(resets, 10 + FLIP_RESET_BADGE_SECONDS - 0.25)!.opacity).toBeCloseTo(0.5, 5);
    expect(flipResetBadgeAt(resets, 10 + FLIP_RESET_BADGE_SECONDS)).toBeNull();
    // A later reset restarts the badge
    expect(flipResetBadgeAt(resets, 31)).toEqual({ opacity: 1, scale: 1 });
  });

  it('ignores refreshes from players not on the roster', () => {
    const ids = [JSON.stringify({ Steam: '1' }), JSON.stringify({ Steam: '2' })];
    const resets = buildFlipResets(
      [
        { frame: 60, player: { Steam: '2' } },
        { frame: 30, player: { Steam: '2' } },
        { frame: 45, player: { Steam: '9' } },
      ],
      ids,
      (frame) => frame / 30
    );
    expect(resets).toEqual([[], [1, 2]]);
  });
});
