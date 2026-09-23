import * as THREE from 'three';
import { CameraSettings, getSurfaceAlignment, rlFovToThreeVerticalFov } from '../../math/cameraMath';
import { rlToThreeVec3, threeToRlVec3 } from '../../math/coords';
import { getFrameSampleAtTime, getFrameTime, unpackFrame } from '../../math/frameUnpacker';
import { FrameState, ParsedReplayData } from '../../types/replay';
import { CameraPose, PovCameraRig } from '../PovCameraRig';

/**
 * Rocket League camera captures, recorded in-game by the BakkesMod plugin in
 * tools/camera-capture, and their comparison against the viewer's POV camera.
 *
 * Positions and rotations in a capture are in Unreal space and are converted to
 * Three.js space here (see math/coords.ts).
 */

/** Unreal rotator units per full turn. */
const UNREAL_ROTATION_UNITS = 65536;

export type CameraKind = 'ball' | 'car' | 'other';

export interface CaptureSample {
  renderTime: number;
  replayFrame: number;
  replayTime: number;
  cameraPosition: THREE.Vector3;
  cameraQuaternion: THREE.Quaternion;
  /** Horizontal FOV rendered this frame, in degrees. */
  fov: number;
  cameraState: string;
  /** Name of the followed player; empty while the view target is not a car. */
  target: string;
  targetPosition: THREE.Vector3 | null;
  ballPosition: THREE.Vector3;
  settings: CameraSettings;
  aspect: number;
}

export interface CameraCapture {
  meta: Record<string, string>;
  samples: CaptureSample[];
}

/** Converts an Unreal rotator (65536 units per turn) to a Three.js camera orientation. */
export function unrealRotatorToCameraQuaternion(pitch: number, yaw: number, roll: number): THREE.Quaternion {
  const toRad = (units: number) => (units / UNREAL_ROTATION_UNITS) * Math.PI * 2;
  const p = toRad(pitch);
  const y = toRad(yaw);
  const r = toRad(roll);
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(p), Math.cos(p), Math.sin(y), Math.cos(y), Math.sin(r), Math.cos(r)];

  // Unreal's rotation matrix axes (FRotationMatrix), in Unreal space
  const forward = { x: cp * cy, y: cp * sy, z: sp };
  const right = { x: sr * sp * cy - cr * sy, y: sr * sp * sy + cr * cy, z: -sr * cp };
  const up = { x: -(cr * sp * cy + sr * sy), y: cy * sr - cr * sp * sy, z: cr * cp };

  // A Three.js camera looks down -Z with +X right and +Y up. Swapping Unreal's Y and Z
  // also turns its left-handed axes into a right-handed basis.
  const basis = new THREE.Matrix4().makeBasis(
    rlToThreeVec3(right),
    rlToThreeVec3(up),
    rlToThreeVec3(forward).negate()
  );
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

/** Inverse of unrealRotatorToCameraQuaternion, in fractional rotator units. */
export function cameraQuaternionToUnrealRotator(quaternion: THREE.Quaternion): { pitch: number; yaw: number; roll: number } {
  const forward = threeToRlVec3(new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion));
  const up = threeToRlVec3(new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion));
  const p = Math.asin(Math.min(Math.max(forward.z, -1), 1));
  const y = Math.atan2(forward.y, forward.x);
  // With roll r: up = cos(r) * up0 + sin(r) * right0
  const up0 = { x: -Math.sin(p) * Math.cos(y), y: -Math.sin(p) * Math.sin(y), z: Math.cos(p) };
  const right0 = { x: -Math.sin(y), y: Math.cos(y), z: 0 };
  const dot = (a: typeof up, b: typeof up) => a.x * b.x + a.y * b.y + a.z * b.z;
  const r = Math.atan2(dot(up, right0), dot(up, up0));
  const toUnits = (rad: number) => (rad / (Math.PI * 2)) * UNREAL_ROTATION_UNITS;
  return { pitch: toUnits(p), yaw: toUnits(y), roll: toUnits(r) };
}

export function classifyCameraState(state: string): CameraKind {
  if (/ball/i.test(state)) return 'ball';
  if (/car/i.test(state)) return 'car';
  return 'other';
}

/** Parses a capture CSV written by the plugin. */
export function parseCameraCapture(text: string): CameraCapture {
  const meta: Record<string, string> = {};
  const samples: CaptureSample[] = [];
  let columns: string[] | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const body = line.slice(1).trim();
      const eq = body.indexOf('=');
      if (eq > 0) meta[body.slice(0, eq)] = body.slice(eq + 1);
      else meta.format = body;
      continue;
    }
    const cells = line.split(',');
    if (!columns) {
      columns = cells;
      continue;
    }
    const row: Record<string, string> = {};
    columns.forEach((name, i) => { row[name] = cells[i] ?? ''; });
    const num = (name: string) => Number(row[name]);
    const unreal = (prefix: string) => rlToThreeVec3({ x: num(`${prefix}_x`), y: num(`${prefix}_y`), z: num(`${prefix}_z`) });

    samples.push({
      renderTime: num('render_time'),
      replayFrame: num('replay_frame'),
      replayTime: num('replay_time'),
      cameraPosition: unreal('cam'),
      cameraQuaternion: unrealRotatorToCameraQuaternion(num('cam_pitch'), num('cam_yaw'), num('cam_roll')),
      fov: num('fov'),
      cameraState: row.camera_state,
      target: row.target,
      targetPosition: row.target ? unreal('target') : null,
      ballPosition: unreal('ball'),
      settings: {
        fov: num('settings_fov'),
        height: num('settings_height'),
        angle: num('settings_pitch'),
        distance: num('settings_distance'),
        stiffness: num('settings_stiffness'),
        swivel_speed: 0,
        transition_speed: num('settings_transition_speed'),
      },
      aspect: num('viewport_h') > 0 ? num('viewport_w') / num('viewport_h') : 16 / 9,
    });
  }
  return { meta, samples };
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function frameAt(replayData: ParsedReplayData, time: number): FrameState {
  const { frameA, frameB, alpha } = getFrameSampleAtTime(replayData, time);
  return unpackFrame(replayData, frameA, frameB, alpha);
}

function ballErrorAtOffset(replayData: ParsedReplayData, samples: CaptureSample[], offset: number): number {
  return median(samples.map((s) => {
    const ball = frameAt(replayData, s.replayTime + offset).ball.position;
    return s.ballPosition.distanceTo(new THREE.Vector3(ball.x, ball.y, ball.z));
  }));
}

/**
 * Finds the offset from the game's replay clock to the viewer's playback clock, by
 * matching the captured ball against the parsed ball. Returns the offset and the
 * remaining median ball error in uu (a few uu for a good match).
 */
export function alignCaptureToReplay(
  replayData: ParsedReplayData,
  samples: CaptureSample[]
): { offset: number; ballError: number } {
  const stride = Math.max(1, Math.floor(samples.length / 200));
  const probe = samples.filter((_, i) => i % stride === 0);
  if (probe.length === 0) return { offset: 0, ballError: NaN };

  // Candidates: the same clock, or the clock implied by the replay frame numbers
  const frameOffset = median(probe.map((s) => getFrameTime(replayData, s.replayFrame) - s.replayTime));
  let best = { offset: 0, ballError: Infinity };
  const tryOffset = (offset: number) => {
    const ballError = ballErrorAtOffset(replayData, probe, offset);
    if (ballError < best.ballError) best = { offset, ballError };
  };

  for (const center of [0, frameOffset]) {
    for (let d = -1; d <= 1 + 1e-9; d += 1 / 30) tryOffset(center + d);
  }
  if (best.ballError > 100) {
    for (let d = -20; d <= 20; d += 0.1) tryOffset(d);
  }
  // Refine to a fraction of a millisecond: at 2000 uu/s every millisecond is 2 uu
  for (const [span, step] of [[1 / 30, 1 / 600], [1 / 600, 1 / 12000]]) {
    const center = best.offset;
    for (let d = -span; d <= span + 1e-9; d += step) tryOffset(center + d);
  }
  return best;
}

export type Situation = 'ground' | 'air' | 'wall';

export interface ComparedSample {
  replayTime: number;
  kind: CameraKind;
  situation: Situation;
  /** Distance between our camera and the game's, uu. */
  positionError: number;
  /** Angle between the view directions, degrees. */
  viewAngleError: number;
  /** Angle between the camera up vectors, degrees. */
  rollError: number;
  /** Camera to car distance, uu. */
  trueBoom: number;
  ourBoom: number;
  /** Camera height above the car, uu. */
  trueHeight: number;
  ourHeight: number;
  /** Followed car and ball positions on screen, NDC (-1..1). */
  trueCarNdc: [number, number];
  ourCarNdc: [number, number];
  trueBallNdc: [number, number];
  ourBallNdc: [number, number];
}

export interface MetricSummary {
  count: number;
  positionError: { median: number; p95: number };
  viewAngleError: { median: number; p95: number };
  rollError: { median: number; p95: number };
  /** Our boom length relative to the game's: 1.1 means 10% further from the car. */
  boomRatio: { median: number; p95Deviation: number };
  /** Our camera height above the car minus the game's, uu (negative = we sit lower). */
  heightError: { median: number; p95Abs: number };
  /** Distance between where the car lands on screen, NDC units. */
  carScreenError: { median: number; p95: number };
  ballScreenError: { median: number; p95: number };
}

export interface CaptureComparison {
  offset: number;
  alignmentBallError: number;
  ballCamSource: 'capture' | 'replay';
  cameraStates: Record<string, number>;
  /** Share of samples where the replay's recorded Ball Cam matches the game's camera. */
  ballCamAgreement: number;
  /** Players whose recorded camera settings differ from what the game used. */
  settingsMismatches: string[];
  samples: ComparedSample[];
  summary: Record<string, MetricSummary>;
  skipped: { noTarget: number; unknownPlayer: number; otherCamera: number; missingCar: number };
}

function projectNdc(pose: CameraPose, aspect: number, fovDeg: number, point: THREE.Vector3): [number, number] {
  const camera = new THREE.PerspectiveCamera(rlFovToThreeVerticalFov(fovDeg, aspect), aspect, 10, 50000);
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  camera.updateMatrixWorld();
  const ndc = point.clone().project(camera);
  return [ndc.x, ndc.y];
}

function classifySituation(frame: FrameState, playerIndex: number): Situation {
  const player = frame.players[playerIndex];
  const position = new THREE.Vector3(player.position.x, player.position.y, player.position.z);
  const rotation = new THREE.Quaternion(player.rotation.x, player.rotation.y, player.rotation.z, player.rotation.w);
  if (getSurfaceAlignment(position, rotation) > 0.5) return 'wall';
  return position.y < 50 ? 'ground' : 'air';
}

function summarize(samples: ComparedSample[]): MetricSummary {
  const pick = (f: (s: ComparedSample) => number) => samples.map(f);
  const ndcDistance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const boomRatios = pick((s) => s.ourBoom / s.trueBoom);
  const heightErrors = pick((s) => s.ourHeight - s.trueHeight);
  const carScreen = pick((s) => ndcDistance(s.ourCarNdc, s.trueCarNdc));
  const ballScreen = pick((s) => ndcDistance(s.ourBallNdc, s.trueBallNdc));
  return {
    count: samples.length,
    positionError: { median: median(pick((s) => s.positionError)), p95: percentile(pick((s) => s.positionError), 0.95) },
    viewAngleError: { median: median(pick((s) => s.viewAngleError)), p95: percentile(pick((s) => s.viewAngleError), 0.95) },
    rollError: { median: median(pick((s) => s.rollError)), p95: percentile(pick((s) => s.rollError), 0.95) },
    boomRatio: { median: median(boomRatios), p95Deviation: percentile(boomRatios.map((r) => Math.abs(r - 1)), 0.95) },
    heightError: { median: median(heightErrors), p95Abs: percentile(heightErrors.map(Math.abs), 0.95) },
    carScreenError: { median: median(carScreen), p95: percentile(carScreen, 0.95) },
    ballScreenError: { median: median(ballScreen), p95: percentile(ballScreen, 0.95) },
  };
}

/**
 * Runs the viewer's POV camera over the same replay moments as a capture and measures
 * how far it is from the game's camera.
 *
 * The camera is advanced with the capture's own frame timing, snapping wherever the
 * capture jumps (seeks, target changes). Ball Cam follows the game's camera state when
 * the capture distinguishes it, so that aim and framing errors are measured on their
 * own; `ballCamAgreement` reports how often the replay's recorded state agrees.
 * The game's camera settings are used, and differences from the replay's recorded
 * settings are listed in `settingsMismatches`.
 */
export function compareWithCapture(replayData: ParsedReplayData, capture: CameraCapture): CaptureComparison {
  const { samples } = capture;
  const { offset, ballError } = alignCaptureToReplay(replayData, samples);

  const cameraStates: Record<string, number> = {};
  for (const s of samples) cameraStates[s.cameraState] = (cameraStates[s.cameraState] ?? 0) + 1;
  const ballCamSource = samples.some((s) => classifyCameraState(s.cameraState) === 'ball') ? 'capture' : 'replay';

  const playerIndexByName = new Map(replayData.players.map((p) => [p.name, p.index]));
  const settingsMismatches = new Set<string>();
  const skipped = { noTarget: 0, unknownPlayer: 0, otherCamera: 0, missingCar: 0 };
  const compared: ComparedSample[] = [];
  let ballCamMatches = 0;
  let ballCamChecked = 0;

  const rig = new PovCameraRig();
  let previous: CaptureSample | null = null;
  for (const sample of samples) {
    const last = previous;
    previous = sample;
    if (!sample.target || !sample.targetPosition) { skipped.noTarget++; rig.snap(); continue; }
    const playerIndex = playerIndexByName.get(sample.target);
    if (playerIndex === undefined) { skipped.unknownPlayer++; rig.snap(); continue; }
    const kind = classifyCameraState(sample.cameraState);
    if (ballCamSource === 'capture' && kind === 'other') { skipped.otherCamera++; rig.snap(); continue; }

    const time = sample.replayTime + offset;
    const deltaTime = last ? sample.renderTime - last.renderTime : 0;
    const replayStep = last ? sample.replayTime - last.replayTime : 0;
    if (!last || last.target !== sample.target || deltaTime <= 0 || deltaTime > 0.25 || replayStep < 0 || replayStep > 0.5) {
      rig.snap();
    }

    const frame = frameAt(replayData, time);
    const player = frame.players[playerIndex];
    if (!player?.isPresent || player.isDemoed) { skipped.missingCar++; rig.snap(); continue; }

    const recorded = player.ballCamActive;
    const ballCam = ballCamSource === 'capture' ? kind === 'ball' : recorded;
    if (ballCamSource === 'capture') {
      ballCamChecked++;
      if (recorded === ballCam) ballCamMatches++;
    }

    const replaySettings = replayData.players[playerIndex].camera_settings;
    if (
      Math.abs(replaySettings.fov - sample.settings.fov) > 0.5 ||
      Math.abs(replaySettings.distance - sample.settings.distance) > 0.5 ||
      Math.abs(replaySettings.height - sample.settings.height) > 0.5 ||
      Math.abs(replaySettings.angle - sample.settings.angle) > 0.5 ||
      Math.abs(replaySettings.stiffness - sample.settings.stiffness) > 0.01
    ) {
      settingsMismatches.add(sample.target);
    }

    const pose = rig.update(frame, playerIndex, sample.settings, sample.aspect, ballCam, Math.min(Math.max(deltaTime, 0), 0.1));
    if (!pose) { skipped.missingCar++; continue; }

    const truth: CameraPose = { position: sample.cameraPosition, quaternion: sample.cameraQuaternion };
    const car = sample.targetPosition;
    const forward = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = (q: THREE.Quaternion) => new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    compared.push({
      replayTime: time,
      kind: ballCam ? 'ball' : 'car',
      situation: classifySituation(frame, playerIndex),
      positionError: pose.position.distanceTo(truth.position),
      viewAngleError: THREE.MathUtils.radToDeg(forward(pose.quaternion).angleTo(forward(truth.quaternion))),
      rollError: THREE.MathUtils.radToDeg(up(pose.quaternion).angleTo(up(truth.quaternion))),
      trueBoom: truth.position.distanceTo(car),
      ourBoom: pose.position.distanceTo(car),
      trueHeight: truth.position.y - car.y,
      ourHeight: pose.position.y - car.y,
      trueCarNdc: projectNdc(truth, sample.aspect, sample.fov, car),
      ourCarNdc: projectNdc(pose, sample.aspect, sample.settings.fov, car),
      trueBallNdc: projectNdc(truth, sample.aspect, sample.fov, sample.ballPosition),
      ourBallNdc: projectNdc(pose, sample.aspect, sample.settings.fov, sample.ballPosition),
    });
  }

  const groups: Record<string, ComparedSample[]> = {
    all: compared,
    'ball cam': compared.filter((s) => s.kind === 'ball'),
    'car cam': compared.filter((s) => s.kind === 'car'),
    ground: compared.filter((s) => s.situation === 'ground'),
    air: compared.filter((s) => s.situation === 'air'),
    wall: compared.filter((s) => s.situation === 'wall'),
  };
  const summary: Record<string, MetricSummary> = {};
  for (const [name, group] of Object.entries(groups)) {
    if (group.length > 0) summary[name] = summarize(group);
  }

  return {
    offset,
    alignmentBallError: ballError,
    ballCamSource,
    cameraStates,
    ballCamAgreement: ballCamChecked > 0 ? ballCamMatches / ballCamChecked : NaN,
    settingsMismatches: [...settingsMismatches],
    samples: compared,
    summary,
    skipped,
  };
}

/** Plain-text table of a comparison, for the test log. */
export function formatComparison(name: string, comparison: CaptureComparison): string {
  const f = (value: number, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '-');
  const lines = [
    `Camera capture: ${name}`,
    `  clock offset ${f(comparison.offset, 3)} s, ball alignment error ${f(comparison.alignmentBallError)} uu`,
    `  ball cam from ${comparison.ballCamSource}` +
      (Number.isFinite(comparison.ballCamAgreement) ? `, replay agrees ${f(comparison.ballCamAgreement * 100, 0)}% of the time` : ''),
    `  camera states: ${Object.entries(comparison.cameraStates).map(([k, v]) => `${k || '(none)'}=${v}`).join(', ')}`,
    `  skipped: ${Object.entries(comparison.skipped).map(([k, v]) => `${k}=${v}`).join(', ')}`,
  ];
  if (comparison.settingsMismatches.length > 0) {
    lines.push(`  replay camera settings differ from the game's for: ${comparison.settingsMismatches.join(', ')}`);
  }
  lines.push(
    '',
    '  group       n      pos uu (med/p95)  view deg      roll deg      boom ratio (med/p95 dev)  height uu (med/p95)  car scr ndc   ball scr ndc',
  );
  for (const [group, s] of Object.entries(comparison.summary)) {
    lines.push(
      `  ${group.padEnd(10)} ${String(s.count).padStart(5)}` +
      `  ${f(s.positionError.median).padStart(7)} / ${f(s.positionError.p95).padEnd(7)}` +
      `  ${f(s.viewAngleError.median).padStart(5)} / ${f(s.viewAngleError.p95).padEnd(5)}` +
      `  ${f(s.rollError.median).padStart(5)} / ${f(s.rollError.p95).padEnd(5)}` +
      `  ${f(s.boomRatio.median, 3).padStart(6)} / ${f(s.boomRatio.p95Deviation, 3).padEnd(17)}` +
      `  ${f(s.heightError.median).padStart(7)} / ${f(s.heightError.p95Abs).padEnd(9)}` +
      `  ${f(s.carScreenError.median, 3)} / ${f(s.carScreenError.p95, 3)}` +
      `  ${f(s.ballScreenError.median, 3)} / ${f(s.ballScreenError.p95, 3)}`
    );
  }
  return lines.join('\n');
}
