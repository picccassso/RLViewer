import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import initSubtr, { get_replay_frames_data } from '@rlrml/subtr-actor';
import {
  ParsedReplayData,
  TOTAL_FLOATS_PER_FRAME,
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS,
} from '../../types/replay';
import {
  buildBallTouches,
  isOnFloor,
  lastTouchAt,
  nextSupersonic,
  sampleBallTrail,
  sampleCarWheelTrail,
  SUPERSONIC_FLAG,
} from '../trails';
import { unpackFrame } from '../frameUnpacker';
import { buildReplayData } from '../../parser/buildReplayData';
import { TrailManager } from '../../scene/TrailManager';

const TIME_OFFSET = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
const FRAME_SECONDS = 1 / 30;

/** A replay with one car and the ball, each frame filled in by `frame(f, buffer, offset)`. */
function syntheticReplay(
  totalFrames: number,
  frame: (f: number, buffer: Float32Array, offset: number) => void,
  ballTouches: ParsedReplayData['ballTouches'] = []
): ParsedReplayData {
  const framesBuffer = new Float32Array(totalFrames * TOTAL_FLOATS_PER_FRAME);
  for (let f = 0; f < totalFrames; f++) {
    const offset = f * TOTAL_FLOATS_PER_FRAME;
    framesBuffer[offset + 6] = 1;
    framesBuffer[offset + FLOATS_PER_BALL + 6] = 1;
    framesBuffer[offset + TIME_OFFSET] = f * FRAME_SECONDS;
    frame(f, framesBuffer, offset);
  }
  return {
    totalFrames,
    duration: (totalFrames - 1) * FRAME_SECONDS,
    frameRate: 30,
    players: [],
    boostPads: [],
    tickMarks: [],
    teamScores: { team0: 0, team1: 0 },
    flipResets: [],
    ballTouches,
    framesBuffer,
  };
}

function collect(sample: (emit: (x: number, y: number, z: number, age: number, lit: boolean) => void) => unknown) {
  const points: { x: number; y: number; z: number; age: number; lit: boolean }[] = [];
  sample((x, y, z, age, lit) => points.push({ x, y, z, age, lit }));
  return points;
}

describe('Supersonic state', () => {
  it('starts at 2200 uu/s and holds down to 2100 uu/s', () => {
    expect(nextSupersonic(false, 2150)).toBe(false);
    expect(nextSupersonic(false, 2200)).toBe(true);
    expect(nextSupersonic(true, 2150)).toBe(true);
    expect(nextSupersonic(true, 2099)).toBe(false);
  });

  it('counts a car as on the floor only when low and upright', () => {
    const level = { x: 0, y: 0, z: 0, w: 1 };
    const onSide = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2);
    expect(isOnFloor(17, level)).toBe(true);
    expect(isOnFloor(17, turned)).toBe(true);
    expect(isOnFloor(17, onSide)).toBe(false);
    expect(isOnFloor(120, level)).toBe(false);
  });
});

describe('Ball touches', () => {
  it('re-times touch events and finds the latest touch', () => {
    const touches = buildBallTouches(
      [
        { frame: 60, team_is_team_0: false },
        { frame: 30, team_is_team_0: true },
      ],
      (frame) => frame / 30
    );
    expect(touches).toEqual([{ time: 1, team: 0 }, { time: 2, team: 1 }]);
    expect(lastTouchAt(touches, 0.5)).toBeNull();
    expect(lastTouchAt(touches, 1)).toEqual({ time: 1, team: 0 });
    expect(lastTouchAt(touches, 1.9)).toEqual({ time: 1, team: 0 });
    expect(lastTouchAt(touches, 5)).toEqual({ time: 2, team: 1 });
  });
});

describe('Ball trail', () => {
  // The ball rolls +X at 3000 uu/s from frame 0.
  const data = syntheticReplay(
    120,
    (f, buffer, offset) => {
      buffer[offset] = f * 100;
      buffer[offset + 1] = 92.75;
    },
    [{ time: 30 * FRAME_SECONDS, team: 1 }]
  );
  const at = (f: number) => {
    const state = unpackFrame(data, f);
    return collect((emit) => sampleBallTrail(data, f, state.time, state.ball.position, 1.5, emit));
  };

  it('has no trail before the first touch', () => {
    expect(at(20)).toEqual([]);
  });

  it('starts at the touch and runs back from the ball', () => {
    const points = at(40);
    expect(points[0].x).toBe(4000);
    expect(points[0].age).toBe(0);
    expect(points[points.length - 1].x).toBe(3000);
    expect(points[points.length - 1].age).toBeCloseTo(10 * FRAME_SECONDS, 4);
  });

  it('reaches back at most its maximum age', () => {
    const points = at(110);
    expect(points[points.length - 1].age).toBeLessThanOrEqual(1.5 + 1e-3);
    expect(points[points.length - 1].x).toBeCloseTo(11000 - 4500, 0);
  });

  it('reports the touching team', () => {
    const state = unpackFrame(data, 40);
    expect(sampleBallTrail(data, 40, state.time, state.ball.position, 1.5, () => {})).toBe(1);
  });

  it('stops at a teleport such as a kickoff reset', () => {
    const reset = syntheticReplay(
      60,
      (f, buffer, offset) => {
        buffer[offset] = f < 40 ? f * 100 : 0;
        buffer[offset + 1] = 92.75;
      },
      [{ time: 0, team: 0 }]
    );
    const state = unpackFrame(reset, 45);
    const points = collect((emit) => sampleBallTrail(reset, 45, state.time, state.ball.position, 1.5, emit));
    expect(points.every((p) => p.x === 0)).toBe(true);
  });
});

describe('Supersonic wheel trail', () => {
  // A level car drives +X at 2300 uu/s along the floor, then jumps from frame 30.
  const data = syntheticReplay(60, (f, buffer, offset) => {
    const car = offset + FLOATS_PER_BALL;
    buffer[car] = f * 2300 * FRAME_SECONDS;
    buffer[car + 1] = f < 30 ? 17 : 17 + (f - 29) * 30;
    buffer[car + 11] = 1 | (f >= 10 ? SUPERSONIC_FLAG : 0);
  });
  const at = (f: number) => {
    const offset = f * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL;
    const position = { x: data.framesBuffer[offset], y: data.framesBuffer[offset + 1], z: 0 };
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    const car = { position, rotation, lit: f >= 10 && isOnFloor(position.y, rotation) };
    return collect((emit) =>
      sampleCarWheelTrail(data, 0, f, f * FRAME_SECONDS, car, { x: -35, y: 0, z: 34 }, 0.5, emit)
    );
  };

  it('follows the back wheel', () => {
    const points = at(20);
    expect(points[0].x).toBeCloseTo(20 * 2300 * FRAME_SECONDS - 35, 3);
    expect(points[0].z).toBe(34);
  });

  it('is lit only while supersonic', () => {
    const points = at(14);
    const litAges = points.filter((p) => p.lit).map((p) => p.age);
    expect(Math.max(...litAges)).toBeCloseTo(4 * FRAME_SECONDS, 4);
    expect(points.some((p) => !p.lit)).toBe(true);
  });

  it('goes dark once the car leaves the floor', () => {
    const points = at(35);
    expect(points[0].lit).toBe(false);
    expect(points.some((p) => p.lit)).toBe(true);
  });
});

describe('Trails on the sample replay', () => {
  it('flags supersonic cars, keeps touches, and draws trails', async () => {
    const wasmPath = path.resolve(__dirname, '../../../node_modules/@rlrml/subtr-actor/rl_replay_subtr_actor_bg.wasm');
    await initSubtr(fs.readFileSync(wasmPath));
    const rawData = get_replay_frames_data(fs.readFileSync(path.resolve(__dirname, '../../../public/sample.replay')));
    const data = buildReplayData(rawData);

    expect(data.ballTouches).toHaveLength(rawData.touch_events.length);
    expect(data.ballTouches[0].team).toBe(1);

    let supersonicFrames = 0;
    let firstFloorSupersonic: number | null = null;
    for (let f = 0; f < data.totalFrames; f++) {
      const state = unpackFrame(data, f);
      for (const player of state.players) {
        const speed = Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z);
        if (player.supersonic) {
          supersonicFrames++;
          expect(speed).toBeGreaterThanOrEqual(2100 - 1);
          if (firstFloorSupersonic === null && isOnFloor(player.position.y, player.rotation)) firstFloorSupersonic = f;
        } else if (player.isPresent && !player.isDemoed) {
          expect(speed).toBeLessThan(2200 + 1);
        }
      }
    }
    expect(supersonicFrames).toBeGreaterThan(1000);
    expect(firstFloorSupersonic).not.toBeNull();

    const scene = new THREE.Scene();
    const trails = new TrailManager(scene);
    trails.setReplay(data);
    const meshes = () => scene.children[0].children as THREE.Mesh[];
    expect(meshes()).toHaveLength(1 + data.players.length * 2);

    // Just after the first touch, the ball trail is drawn in the touching team's colour.
    const firstTouchFrame = rawData.touch_events[0].frame;
    trails.update(unpackFrame(data, firstTouchFrame + 5));
    expect(meshes()[0].visible).toBe(true);

    // A floor-supersonic car has its streaks drawn a few frames later.
    trails.update(unpackFrame(data, firstFloorSupersonic! + 3));
    expect(meshes().slice(1).some((mesh) => mesh.visible)).toBe(true);

    trails.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
