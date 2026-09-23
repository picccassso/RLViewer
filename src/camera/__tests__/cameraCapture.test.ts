import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import initSubtr, { get_replay_frames_data } from '@rlrml/subtr-actor';
import { buildReplayData } from '../../parser/buildReplayData';
import { ParsedReplayData } from '../../types/replay';
import { threeToRlVec3 } from '../../math/coords';
import { getFrameSampleAtTime, unpackFrame } from '../../math/frameUnpacker';
import { PovCameraRig } from '../PovCameraRig';
import {
  cameraQuaternionToUnrealRotator,
  classifyCameraState,
  compareWithCapture,
  formatComparison,
  parseCameraCapture,
  unrealRotatorToCameraQuaternion,
} from '../capture/cameraCapture';

const ROOT = path.resolve(__dirname, '../../..');
const CAPTURE_DIR = path.join(ROOT, 'camera-captures');
const REPORT_DIR = path.join(CAPTURE_DIR, 'reports');

/**
 * Loose starting tolerances for real captures. Tighten them as the camera gets closer
 * to the game's, so improvements are locked in.
 */
const CAMERA_MATCH_TOLERANCES = {
  carScreenErrorMedian: 0.1,  // NDC units (the screen is 2 units tall)
  boomRatioDeviationMedian: 0.1,
  viewAngleErrorMedian: 5,    // degrees
};

const CSV_HEADER = 'render_time,replay_frame,replay_time,cam_x,cam_y,cam_z,cam_pitch,cam_yaw,cam_roll,fov,camera_state,' +
  'target,target_x,target_y,target_z,ball_x,ball_y,ball_z,settings_fov,settings_height,settings_pitch,settings_distance,' +
  'settings_stiffness,settings_transition_speed,viewport_w,viewport_h';

let wasmReady: Promise<unknown> | null = null;
async function loadReplay(file: string): Promise<ParsedReplayData> {
  wasmReady ??= initSubtr(fs.readFileSync(path.join(ROOT, 'node_modules/@rlrml/subtr-actor/rl_replay_subtr_actor_bg.wasm')));
  await wasmReady;
  return buildReplayData(get_replay_frames_data(fs.readFileSync(file)));
}

function findReplayFile(replayId: string): string | null {
  for (const dir of [CAPTURE_DIR, ROOT]) {
    const file = path.join(dir, `${replayId}.replay`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const captureFiles = fs.existsSync(CAPTURE_DIR)
  ? fs.readdirSync(CAPTURE_DIR).filter((f) => f.endsWith('.csv')).sort()
  : [];

describe('Camera capture: rotator conversion', () => {
  const forwardOf = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const upOf = (q: THREE.Quaternion) => new THREE.Vector3(0, 1, 0).applyQuaternion(q);

  it('maps Unreal axes onto the viewer axes', () => {
    // Zero rotator looks along Unreal +X, which is Three +X
    const level = unrealRotatorToCameraQuaternion(0, 0, 0);
    expect(forwardOf(level).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-6);
    expect(upOf(level).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);

    // Yaw 90 degrees looks along Unreal +Y, which is Three +Z
    expect(forwardOf(unrealRotatorToCameraQuaternion(0, 16384, 0)).distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);

    // Positive pitch looks up
    const pitched = forwardOf(unrealRotatorToCameraQuaternion(8192, 0, 0));
    expect(pitched.y).toBeCloseTo(Math.SQRT1_2, 6);

    // Rolling right tilts the camera's up towards its right (Unreal +Y, Three +Z)
    expect(upOf(unrealRotatorToCameraQuaternion(0, 0, 16384)).distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
  });

  it('round-trips camera orientations', () => {
    for (const [pitch, yaw, roll] of [[0, 0, 0], [-1200, 5000, 0], [3000, -20000, 700], [-9000, 31000, -4000]]) {
      const q = unrealRotatorToCameraQuaternion(pitch, yaw, roll);
      const back = cameraQuaternionToUnrealRotator(q);
      expect(back.pitch).toBeCloseTo(pitch, 3);
      expect(back.yaw).toBeCloseTo(yaw, 3);
      expect(back.roll).toBeCloseTo(roll, 3);
    }
  });

  it('classifies camera states', () => {
    expect(classifyCameraState('CameraState_BallCam_TA')).toBe('ball');
    expect(classifyCameraState('CameraState_Car_TA')).toBe('car');
    expect(classifyCameraState('CameraState_ReplayFly_TA')).toBe('other');
  });
});

describe('Camera capture: parsing', () => {
  it('reads metadata and samples, converting Unreal space to viewer space', () => {
    const text = [
      '# rlv-camera-capture v1',
      '# replay_id=ABC123',
      '# map=stadium_p',
      CSV_HEADER,
      '0.0000,10,1.5000,100,-200,300,-500,16384,0,110,CameraState_BallCam_TA,Picasso,10,20,17,0,0,93,110,100,-3,270,0.45,1.3,1920,1080',
    ].join('\n');
    const capture = parseCameraCapture(text);
    expect(capture.meta.format).toBe('rlv-camera-capture v1');
    expect(capture.meta.replay_id).toBe('ABC123');
    expect(capture.samples).toHaveLength(1);
    const sample = capture.samples[0];
    expect(sample.cameraPosition.toArray()).toEqual([100, 300, -200]);
    expect(sample.targetPosition?.toArray()).toEqual([10, 17, 20]);
    expect(sample.ballPosition.toArray()).toEqual([0, 93, 0]);
    expect(sample.settings).toMatchObject({ fov: 110, height: 100, angle: -3, distance: 270, stiffness: 0.45, transition_speed: 1.3 });
    expect(sample.aspect).toBeCloseTo(16 / 9, 6);
  });
});

describe('Camera capture: comparison pipeline', () => {
  let replayData: ParsedReplayData;
  beforeAll(async () => {
    replayData = await loadReplay(path.join(ROOT, 'public/sample.replay'));
  });

  /**
   * Builds a capture from the viewer's own camera, as the plugin would write it, on a
   * game clock shifted by `clockShift` seconds. Comparing it must give zero error.
   */
  function syntheticCapture(playerName: string, from: number, to: number, clockShift: number): string {
    const playerIndex = replayData.players.findIndex((p) => p.name === playerName);
    const settings = replayData.players[playerIndex].camera_settings;
    const rig = new PovCameraRig();
    const rows = ['# rlv-camera-capture v1', '# replay_id=synthetic', CSV_HEADER];
    const dt = 1 / 60;
    for (let i = 0, t = from; t <= to; i++, t += dt) {
      const { frameA, frameB, alpha } = getFrameSampleAtTime(replayData, t);
      const frame = unpackFrame(replayData, frameA, frameB, alpha);
      const player = frame.players[playerIndex];
      const pose = rig.update(frame, playerIndex, settings, 16 / 9, player.ballCamActive, i === 0 ? 0 : dt);
      if (!pose) continue;
      const cam = threeToRlVec3(pose.position);
      const rot = cameraQuaternionToUnrealRotator(pose.quaternion);
      const car = threeToRlVec3(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
      const ball = threeToRlVec3(new THREE.Vector3(frame.ball.position.x, frame.ball.position.y, frame.ball.position.z));
      rows.push([
        (i * dt).toFixed(4), frameA, (t - clockShift).toFixed(4),
        cam.x, cam.y, cam.z, Math.round(rot.pitch), Math.round(rot.yaw), Math.round(rot.roll),
        settings.fov, player.ballCamActive ? 'CameraState_BallCam_TA' : 'CameraState_Car_TA',
        playerName, car.x, car.y, car.z, ball.x, ball.y, ball.z,
        settings.fov, settings.height, settings.angle, settings.distance, settings.stiffness, settings.transition_speed,
        1920, 1080,
      ].join(','));
    }
    return rows.join('\n');
  }

  it('recovers the clock offset and reports zero error for a capture of our own camera', () => {
    // Picasso's air dribble off the side wall, around 03:48
    const capture = parseCameraCapture(syntheticCapture('Picasso', 222, 232, 3.2));
    const comparison = compareWithCapture(replayData, capture);

    expect(comparison.offset).toBeCloseTo(3.2, 2);
    expect(comparison.alignmentBallError).toBeLessThan(1);
    expect(comparison.ballCamSource).toBe('capture');
    expect(comparison.ballCamAgreement).toBe(1);
    expect(comparison.settingsMismatches).toEqual([]);
    expect(comparison.samples.length).toBeGreaterThan(500);

    const all = comparison.summary.all;
    expect(all.positionError.p95).toBeLessThan(1);
    expect(all.viewAngleError.p95).toBeLessThan(0.05);
    expect(all.carScreenError.p95).toBeLessThan(0.002);
    expect(Math.abs(all.boomRatio.median - 1)).toBeLessThan(0.005);
    expect(comparison.summary.air.count).toBeGreaterThan(0);
  });
});

describe.skipIf(captureFiles.length === 0)('Camera capture: real game captures', () => {
  for (const file of captureFiles) {
    it(`matches the game camera: ${file}`, async () => {
      const capture = parseCameraCapture(fs.readFileSync(path.join(CAPTURE_DIR, file), 'utf8'));
      const replayId = capture.meta.replay_id;
      const replayFile = findReplayFile(replayId);
      expect(replayFile, `put ${replayId}.replay in camera-captures/ or the project root`).not.toBeNull();

      const replayData = await loadReplay(replayFile!);
      const comparison = compareWithCapture(replayData, capture);
      console.log(formatComparison(file, comparison));

      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(REPORT_DIR, file.replace(/\.csv$/, '.json')),
        JSON.stringify({ ...comparison, samples: comparison.samples }, null, 1)
      );

      expect(comparison.alignmentBallError, 'the capture does not line up with this replay').toBeLessThan(30);
      expect(comparison.samples.length, 'no comparable samples (was a player view followed?)').toBeGreaterThan(0);

      const all = comparison.summary.all;
      expect(all.carScreenError.median, 'car screen position').toBeLessThan(CAMERA_MATCH_TOLERANCES.carScreenErrorMedian);
      expect(Math.abs(all.boomRatio.median - 1), 'camera distance').toBeLessThan(CAMERA_MATCH_TOLERANCES.boomRatioDeviationMedian);
      expect(all.viewAngleError.median, 'view direction').toBeLessThan(CAMERA_MATCH_TOLERANCES.viewAngleErrorMedian);
    });
  }
});
