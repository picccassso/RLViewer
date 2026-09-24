import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  rlToThreeVec3,
  threeToRlVec3,
  rlToThreeQuat,
  quatToMatrix3,
  applyMatrixTransform,
  Quat
} from '../coords';
import {
  BALL_CAM_VIEW_PITCH_SHARE,
  BALL_CAM_AIR_VIEW_PITCH_SHARE,
  CAMERA_MIN_HEIGHT,
  CAR_FRAMING_LIMIT_NDC,
  CAR_MAX_DROP_DEG,
  computeBallCamAim,
  computeCarCamAim,
  DEFAULT_CAMERA_SETTINGS,
  estimateCarHeading,
  getSurfaceAlignment,
  lookRotation,
  MAX_BALL_ELEVATION_RAD,
  placeBoomCamera,
  rlFovToThreeVerticalFov,
  slerpAim,
  smoothAim,
  trackCarHeading
} from '../cameraMath';
import {
  BoostPadClockManager,
  BOOST_PAD_RESPAWN_TIME
} from '../boostPadClock';

describe('1. Coordinate Transform and Quaternion Equivalence', () => {
  it('correctly maps Unreal coordinates (Z-up) to Three coordinates (Y-up)', () => {
    const rlPos = { x: 1200, y: -3500, z: 250 };
    const threePos = rlToThreeVec3(rlPos);
    expect(threePos.x).toBe(1200);
    expect(threePos.y).toBe(250);   // Z -> Y
    expect(threePos.z).toBe(-3500); // Y -> Z

    const backPos = threeToRlVec3(threePos);
    expect(backPos.x).toBe(rlPos.x);
    expect(backPos.y).toBe(rlPos.y);
    expect(backPos.z).toBe(rlPos.z);
  });

  it('satisfies quaternion rotation equivalence: R(q3) = M * R(q_rl) * M^T', () => {
    // Test multiple arbitrary 3D rotations in Unreal Engine space
    const testRotations: Quat[] = [
      // Identity
      { x: 0, y: 0, z: 0, w: 1 },
      // 45 deg pitch around X
      { x: Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) },
      // 60 deg yaw around Z
      { x: 0, y: 0, z: Math.sin(Math.PI / 6), w: Math.cos(Math.PI / 6) },
      // 30 deg roll around Y
      { x: 0, y: Math.sin(Math.PI / 12), z: 0, w: Math.cos(Math.PI / 12) },
      // Combined compound rotation
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.7, -1.1, 'XYZ')) as unknown as Quat,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.5, 2.2, 0.3, 'ZYX')) as unknown as Quat,
    ];

    for (const qRlRaw of testRotations) {
      const qRl = new THREE.Quaternion(qRlRaw.x, qRlRaw.y, qRlRaw.z, qRlRaw.w).normalize();
      
      // Compute Three.js quaternion q3 using the coordinate transform
      const q3 = rlToThreeQuat({ x: qRl.x, y: qRl.y, z: qRl.z, w: qRl.w });

      // Rotation matrix for q3 in Three.js
      const R_q3 = quatToMatrix3(q3);

      // Rotation matrix for q_rl in Unreal
      const R_qrl = quatToMatrix3(qRl);

      // Theoretical transformation: M * R(q_rl) * M^T
      const M_R_Mt = applyMatrixTransform(R_qrl);

      // Verify element-wise equivalence: R(q3) == M * R(q_rl) * M^T
      const eActual = R_q3.elements;
      const eExpected = M_R_Mt.elements;
      for (let i = 0; i < 9; i++) {
        expect(eActual[i]).toBeCloseTo(eExpected[i], 4);
      }

      // Also verify vector rotation equivalence:
      // For any arbitrary vector v_rl, v_three = M * v_rl
      // Transforming v_three by q3 must equal M * (q_rl * v_rl)
      const v_rl = new THREE.Vector3(150, -420, 89);
      const v_three = rlToThreeVec3({ x: v_rl.x, y: v_rl.y, z: v_rl.z });

      const rotated_three = v_three.clone().applyQuaternion(q3);
      const rotated_rl = v_rl.clone().applyQuaternion(qRl);
      const expected_three = rlToThreeVec3({ x: rotated_rl.x, y: rotated_rl.y, z: rotated_rl.z });

      expect(rotated_three.x).toBeCloseTo(expected_three.x, 3);
      expect(rotated_three.y).toBeCloseTo(expected_three.y, 3);
      expect(rotated_three.z).toBeCloseTo(expected_three.z, 3);
    }
  });
});

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const V_FOV_16_9 = rlFovToThreeVerticalFov(110, 16 / 9);

function projectWith(placed: { position: THREE.Vector3; quaternion: THREE.Quaternion }, point: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera(V_FOV_16_9, 16 / 9, 10, 50000);
  camera.position.copy(placed.position);
  camera.quaternion.copy(placed.quaternion);
  camera.updateMatrixWorld();
  return point.clone().project(camera);
}

function cameraUpOf(placed: { quaternion: THREE.Quaternion }) {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(placed.quaternion);
}

/** Horizon tilt in degrees: how far the camera's up axis is turned from level around its view direction. */
function rollDegOf(quaternion: THREE.Quaternion) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const levelRight = new THREE.Vector3().crossVectors(forward, WORLD_UP).normalize();
  const levelUp = new THREE.Vector3().crossVectors(levelRight, forward);
  return THREE.MathUtils.radToDeg(Math.atan2(up.dot(levelRight), up.dot(levelUp)));
}

function carCam(carPos: THREE.Vector3, carQuat: THREE.Quaternion, settings = DEFAULT_CAMERA_SETTINGS) {
  const heading = estimateCarHeading(carQuat);
  return placeBoomCamera(carPos, computeCarCamAim(carPos, carQuat, heading), settings);
}

describe('2. Car Cam Boom Rig', () => {
  it('keeps the camera horizon level through a full 360° barrel roll', () => {
    const carPos = new THREE.Vector3(0, 400, 0); // Airborne car
    for (let rollDeg = 0; rollDeg <= 360; rollDeg += 10) {
      // In Three space car forward is +X, so a barrel roll rotates around X
      const carQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(rollDeg));
      const heading = trackCarHeading(new THREE.Vector3(1, 0, 0), carPos, carQuat, new THREE.Vector3(), 1 / 60);
      const placed = placeBoomCamera(carPos, computeCarCamAim(carPos, carQuat, heading), { ...DEFAULT_CAMERA_SETTINGS, angle: 0 });
      expect(THREE.MathUtils.radToDeg(cameraUpOf(placed).angleTo(WORLD_UP))).toBeLessThanOrEqual(1.0);
      expect(heading.x).toBeGreaterThan(0.999);
    }
  });

  it('holds the heading through a front flip instead of reversing when the car is upside down', () => {
    const carPos = new THREE.Vector3(0, 80, 0);
    const velocity = new THREE.Vector3(1500, 0, 0);
    let heading: THREE.Vector3 | undefined;
    for (let pitchDeg = 0; pitchDeg >= -360; pitchDeg -= 10) {
      const carQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(pitchDeg));
      heading = trackCarHeading(heading, carPos, carQuat, velocity, 1 / 60);
      expect(heading.x).toBeGreaterThan(0.99);
    }
  });

  it('eases the heading towards the direction of travel during a tumble', () => {
    const carPos = new THREE.Vector3(100, 75, 300);
    const travelDir = new THREE.Vector3(800, 0, 2000).normalize();
    const tumbleQuat = new THREE.Quaternion(0.765, -0.378, -0.383, 0.352).normalize();
    let heading = new THREE.Vector3(1, 0, 0);
    const startDot = heading.dot(travelDir);
    for (let i = 0; i < 60; i++) {
      heading = trackCarHeading(heading, carPos, tumbleQuat, new THREE.Vector3(800, 0, 2000), 1 / 60);
    }
    expect(heading.dot(travelDir)).toBeGreaterThan(startDot);
    expect(heading.dot(travelDir)).toBeGreaterThan(0.85);
  });

  it('places the camera behind and above a grounded car, pitched down by the configured angle', () => {
    const carPos = new THREE.Vector3(0, 17, 0);
    const placed = carCam(carPos, new THREE.Quaternion(), { ...DEFAULT_CAMERA_SETTINGS, distance: 270, height: 100, angle: -3 });

    expect(placed.position.x).toBeCloseTo(-270, 3);
    expect(placed.position.y).toBeCloseTo(117, 3);
    expect(placed.position.z).toBeCloseTo(0, 3);

    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(placed.quaternion);
    expect(THREE.MathUtils.radToDeg(Math.asin(lookDir.y))).toBeCloseTo(-3, 3);
    expect(cameraUpOf(placed).y).toBeGreaterThan(0.99);

    // The car sits centred in the lower part of the frame, like in Rocket League
    const ndc = projectWith(placed, carPos);
    expect(ndc.x).toBeCloseTo(0, 5);
    expect(ndc.y).toBeLessThan(-0.3);
    expect(ndc.y).toBeGreaterThan(-0.5);
  });

  it('pins the car to the same screen position for any aim away from walls', () => {
    const carPos = new THREE.Vector3(500, 300, -800);
    const reference = projectWith(placeBoomCamera(carPos, new THREE.Quaternion(), DEFAULT_CAMERA_SETTINGS), carPos);
    for (const [yawDeg, pitchDeg] of [[0, 0], [45, 10], [135, -20], [-100, 30], [180, 0]]) {
      const aim = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ')
      );
      const ndc = projectWith(placeBoomCamera(carPos, aim, DEFAULT_CAMERA_SETTINGS), carPos);
      expect(ndc.x).toBeCloseTo(reference.x, 4);
      expect(ndc.y).toBeCloseTo(reference.y, 4);
    }
  });

  it('aligns the Car Cam to the wall while driving up a side wall', () => {
    // Car on the +X side wall, wheels towards +X, nose pointing up the wall
    const carPos = new THREE.Vector3(4079, 800, 0);
    const carQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0),  // forward: up the wall
      new THREE.Vector3(-1, 0, 0), // up: away from the wall
      new THREE.Vector3(0, 0, 1)   // right
    ));
    expect(getSurfaceAlignment(carPos, carQuat)).toBe(1);

    const placed = carCam(carPos, carQuat);
    expect(placed.position.x).toBeLessThanOrEqual(4030);
    expect(placed.position.y).toBeLessThan(carPos.y); // Behind the car, further down the wall
    expect(cameraUpOf(placed).x).toBeLessThan(-0.9); // Camera up follows the car off the wall
    const ndc = projectWith(placed, carPos);
    expect(Math.abs(ndc.x)).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(Math.abs(ndc.y)).toBeLessThanOrEqual(0.8 + 1e-6);
  });

  it('turns towards the target at the same pace regardless of frame rate', () => {
    const target = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, THREE.MathUtils.degToRad(60));
    const at60 = new THREE.Quaternion();
    const at144 = new THREE.Quaternion();
    for (let i = 0; i < 12; i++) smoothAim(at60, target, 10, Math.PI * 4, 1 / 60);
    for (let i = 0; i < 29; i++) smoothAim(at144, target, 10, Math.PI * 4, 1 / 144);
    expect(THREE.MathUtils.radToDeg(at60.angleTo(at144))).toBeLessThan(0.5);

    // Turn-rate cap: never more than 90°/s
    const capped = new THREE.Quaternion();
    smoothAim(capped, target, 1000, Math.PI / 2, 0.1);
    expect(THREE.MathUtils.radToDeg(capped.angleTo(new THREE.Quaternion()))).toBeCloseTo(9, 3);
  });
});

describe('3. Ball Cam Aim, Elevation Limits & Framing', () => {
  it('limits the aim for a ball directly overhead and keeps the car in view', () => {
    const carPos = new THREE.Vector3(0, 17, 0);
    const ballCam = computeBallCamAim(carPos, new THREE.Vector3(0, 3000, 0), new THREE.Vector3(1, 0, 0));
    expect(ballCam.elevationRad).toBeLessThanOrEqual(MAX_BALL_ELEVATION_RAD + 1e-6);

    const placed = placeBoomCamera(carPos, ballCam.aim, DEFAULT_CAMERA_SETTINGS, 1, 16 / 9, BALL_CAM_VIEW_PITCH_SHARE);
    expect(placed.position.y).toBeGreaterThanOrEqual(CAMERA_MIN_HEIGHT - 1e-6);
    const ndc = projectWith(placed, carPos);
    expect(ndc.y).toBeGreaterThanOrEqual(-CAR_FRAMING_LIMIT_NDC - 1e-6);
    expect(Math.abs(ndc.x)).toBeLessThan(1e-6);
    expect(Number.isFinite(placed.quaternion.x)).toBe(true);
  });

  it('keeps the car and ball in view on a side wall with a high ball', () => {
    // Car on the side wall, ball high in the corner near the ceiling
    const carPos = new THREE.Vector3(-4079.0, 362.4, 730.5);
    const ballPos = new THREE.Vector3(-3571.1, 1616.3, 3401.4);
    const ballCam = computeBallCamAim(carPos, ballPos, new THREE.Vector3(0, 0, 1));
    const placed = placeBoomCamera(carPos, ballCam.aim, DEFAULT_CAMERA_SETTINGS, 1, 16 / 9, BALL_CAM_VIEW_PITCH_SHARE);

    const carNdc = projectWith(placed, carPos);
    expect(Math.abs(carNdc.x)).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(Math.abs(carNdc.y)).toBeLessThanOrEqual(0.8 + 1e-6);
    const ballNdc = projectWith(placed, ballPos);
    expect(Math.abs(ballNdc.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(ballNdc.y)).toBeLessThanOrEqual(1);
  });

  it('points the camera away from the ball so car and ball share the frame', () => {
    const carPos = new THREE.Vector3(0, 17, 0);
    const ballPos = new THREE.Vector3(0, 93, 2000);
    const ballCam = computeBallCamAim(carPos, ballPos, new THREE.Vector3(1, 0, 0));
    const placed = placeBoomCamera(carPos, ballCam.aim, DEFAULT_CAMERA_SETTINGS, 1, 16 / 9, BALL_CAM_VIEW_PITCH_SHARE);

    expect(placed.position.z).toBeLessThan(carPos.z - 200);
    const ballNdc = projectWith(placed, ballPos);
    const carNdc = projectWith(placed, carPos);
    expect(Math.abs(ballNdc.x)).toBeLessThan(1e-4);
    expect(ballNdc.y).toBeGreaterThan(carNdc.y);
  });

  it('eases onto the car heading as the ball crosses overhead instead of flipping 180°', () => {
    const carPos = new THREE.Vector3(0, 17, 0);
    const heading = new THREE.Vector3(1, 0, 0);
    const before = computeBallCamAim(carPos, new THREE.Vector3(-1, 1500, 0), heading);
    const after = computeBallCamAim(carPos, new THREE.Vector3(1, 1500, 0), heading);
    expect(THREE.MathUtils.radToDeg(before.aim.angleTo(after.aim))).toBeLessThan(1);
  });

  it('keeps the camera higher than a full orbit when the ball is high', () => {
    const carPos = new THREE.Vector3(-2786.42, 17.04, 889.84);
    const highBallPos = new THREE.Vector3(-3482.09, 1570.44, -4417.68);
    const settings = { ...DEFAULT_CAMERA_SETTINGS, height: 110, distance: 280 };
    const ballCam = computeBallCamAim(carPos, highBallPos, new THREE.Vector3(0, 0, -1));

    const fullOrbit = placeBoomCamera(carPos, ballCam.aim, settings, 1, 16 / 9, 0);
    const shared = placeBoomCamera(carPos, ballCam.aim, settings, 1, 16 / 9, BALL_CAM_VIEW_PITCH_SHARE);
    expect(shared.position.y).toBeGreaterThan(fullOrbit.position.y + 20);
    expect(fullOrbit.position.y).toBeGreaterThanOrEqual(CAMERA_MIN_HEIGHT - 1e-6);

    // The ball stays on screen with the shared tilt
    const ballNdc = projectWith(shared, highBallPos);
    expect(Math.abs(ballNdc.y)).toBeLessThan(1);
  });

  it('keeps a fixed boom length and car framing in corners and against walls', () => {
    // Ball Cam pointing into the field swings the camera through the wall behind the car
    const heading = new THREE.Vector3(0, 0, 1);
    const boomLength = Math.hypot(DEFAULT_CAMERA_SETTINGS.distance, DEFAULT_CAMERA_SETTINGS.height);
    const openField = new THREE.Vector3(0, 17, 0);
    const reference = projectWith(
      placeBoomCamera(openField, computeBallCamAim(openField, new THREE.Vector3(0, 93, 2000), heading).aim, DEFAULT_CAMERA_SETTINGS),
      openField
    );
    for (const carPos of [new THREE.Vector3(3950, 17, -4950), new THREE.Vector3(-4000, 17, 0), new THREE.Vector3(0, 17, -5050)]) {
      const ballPos = new THREE.Vector3(0, 93, 0).sub(carPos).setY(0).normalize().multiplyScalar(2000).add(carPos).setY(93);
      const placed = placeBoomCamera(carPos, computeBallCamAim(carPos, ballPos, heading).aim, DEFAULT_CAMERA_SETTINGS);
      expect(placed.position.distanceTo(carPos)).toBeCloseTo(boomLength, 3);
      const ndc = projectWith(placed, carPos);
      expect(ndc.x).toBeCloseTo(reference.x, 4);
      expect(ndc.y).toBeCloseTo(reference.y, 4);
    }
  });

  it('keeps the camera level behind the car for an air dribble instead of swinging underneath', () => {
    // Air dribble off the side wall (sample replay, Picasso, frames 6151-6190)
    const settings = { ...DEFAULT_CAMERA_SETTINGS, height: 90, angle: -5 };
    const heading = new THREE.Vector3(0, 0, -1);
    const dribble: Array<[THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(3779, 828, -1350), new THREE.Vector3(3698, 984, -1608)],
      [new THREE.Vector3(4014, 944, -2529), new THREE.Vector3(3824, 1101, -2767)],
      [new THREE.Vector3(3845, 841, -2949), new THREE.Vector3(3709, 968, -3079)],
    ];
    for (const [carPos, ballPos] of dribble) {
      const ballCam = computeBallCamAim(carPos, ballPos, heading);
      const placed = placeBoomCamera(carPos, ballCam.aim, settings, 1, 16 / 9, BALL_CAM_AIR_VIEW_PITCH_SHARE);
      const fullOrbit = placeBoomCamera(carPos, ballCam.aim, settings, 1, 16 / 9, 0);

      expect(placed.position.y).toBeGreaterThan(carPos.y - 30);
      expect(placed.position.y).toBeGreaterThan(fullOrbit.position.y + 40);
      // The car stays near its usual spot, clear of the bottom of the frame
      const carNdc = projectWith(placed, carPos);
      const ballNdc = projectWith(placed, ballPos);
      expect(carNdc.y).toBeGreaterThan(-0.6);
      expect(ballNdc.y).toBeGreaterThan(carNdc.y);
      expect(Math.abs(ballNdc.x)).toBeLessThan(1);
    }
  });

  it('keeps car and ball in view for a flip reset with the ball right on top of the car', () => {
    const carPos = new THREE.Vector3(1741, 1192, -3356);
    const heading = new THREE.Vector3(0, 0, 1);
    for (const ballPos of [new THREE.Vector3(1740, 1357, -3300), new THREE.Vector3(1800, 1400, -3300), new THREE.Vector3(1700, 1900, -3000)]) {
      const ballCam = computeBallCamAim(carPos, ballPos, heading);
      const placed = placeBoomCamera(carPos, ballCam.aim, DEFAULT_CAMERA_SETTINGS, 1, 16 / 9, BALL_CAM_AIR_VIEW_PITCH_SHARE);
      const fullOrbit = placeBoomCamera(carPos, ballCam.aim, DEFAULT_CAMERA_SETTINGS, 1, 16 / 9, 0);
      expect(placed.position.y).toBeGreaterThan(fullOrbit.position.y);
      expect(Math.abs(projectWith(placed, carPos).y)).toBeLessThanOrEqual(CAR_FRAMING_LIMIT_NDC + 1e-6);
      expect(Math.abs(projectWith(placed, ballPos).y)).toBeLessThan(1);
    }
  });

  it('keeps an airborne car in the lower framing when the ball is below it', () => {
    const carPos = new THREE.Vector3(0, 900, 0);
    const lowBall = new THREE.Vector3(1200, 92.75, 0);
    const ballCam = computeBallCamAim(carPos, lowBall, new THREE.Vector3(1, 0, 0));
    const placed = placeBoomCamera(carPos, ballCam.aim, { ...DEFAULT_CAMERA_SETTINGS, angle: -5 }, 1, 16 / 9, BALL_CAM_AIR_VIEW_PITCH_SHARE);

    expect(placed.position.y).toBeGreaterThan(carPos.y);
    expect(projectWith(placed, carPos).y).toBeLessThan(0);
  });

  it('keeps the car near its usual spot for a high ball and lets the ball ride up the frame', () => {
    const heading = new THREE.Vector3(0, 0, -1);
    const cases = [
      [new THREE.Vector3(0, 17, 0), BALL_CAM_VIEW_PITCH_SHARE],
      [new THREE.Vector3(0, 600, 0), BALL_CAM_AIR_VIEW_PITCH_SHARE],
    ] as const;
    for (const [carPos, share] of cases) {
      const usual = placeBoomCamera(carPos, lookRotation(heading, WORLD_UP), DEFAULT_CAMERA_SETTINGS, 1, 16 / 9, share);
      const usualCarY = projectWith(usual, carPos).y;

      const ballPos = new THREE.Vector3(0, carPos.y + 1500, -800);
      const ballCam = computeBallCamAim(carPos, ballPos, heading);
      const placed = placeBoomCamera(carPos, ballCam.aim, DEFAULT_CAMERA_SETTINGS, 1, 16 / 9, share);
      const tanHalfV = Math.tan((V_FOV_16_9 * Math.PI) / 360);
      const dropDeg = THREE.MathUtils.radToDeg(
        Math.atan(usualCarY * tanHalfV) - Math.atan(projectWith(placed, carPos).y * tanHalfV)
      );
      expect(dropDeg).toBeLessThanOrEqual(CAR_MAX_DROP_DEG + 1e-3);
      expect(projectWith(placed, ballPos).y).toBeGreaterThan(0.2);
    }
  });

  it('keeps the horizon level while Ball Cam turns and pitches up at once', () => {
    const carPos = new THREE.Vector3(0, 17, 0);
    const heading = new THREE.Vector3(0, 0, -1);
    const aim = computeBallCamAim(carPos, new THREE.Vector3(0, 93, -1500), heading).aim;
    const target = computeBallCamAim(carPos, new THREE.Vector3(900, 1400, 300), heading).aim;

    let worstRoll = 0;
    for (let i = 0; i < 120; i++) {
      smoothAim(aim, target, 9, THREE.MathUtils.degToRad(300), 1 / 60);
      worstRoll = Math.max(worstRoll, Math.abs(rollDegOf(aim)));
    }
    expect(worstRoll).toBeLessThan(0.01);
    expect(aim.angleTo(target)).toBeLessThan(1e-3);
  });

  it('keeps the horizon level while blending from Car Cam to Ball Cam for a high ball', () => {
    const carPos = new THREE.Vector3(0, 17, 0);
    const heading = new THREE.Vector3(0, 0, -1);
    const carAim = computeCarCamAim(carPos, new THREE.Quaternion(), heading);
    const ballAim = computeBallCamAim(carPos, new THREE.Vector3(900, 1400, 300), heading).aim;

    for (let t = 0; t <= 1.0001; t += 0.05) {
      expect(Math.abs(rollDegOf(slerpAim(carAim.clone(), ballAim, t)))).toBeLessThan(0.01);
    }
    expect(slerpAim(carAim.clone(), ballAim, 1).angleTo(ballAim)).toBeLessThan(1e-6);
  });

  it('still rolls onto a wall-aligned aim', () => {
    const level = lookRotation(new THREE.Vector3(0, 0, -1), WORLD_UP);
    const onWall = lookRotation(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
    expect(Math.abs(rollDegOf(slerpAim(level.clone(), onWall, 0.5)))).toBeCloseTo(45, 3);
    expect(slerpAim(level.clone(), onWall, 1).angleTo(onWall)).toBeLessThan(1e-6);
  });
});

describe('4. Boost Pad Respawn Timer Clock Logic', () => {
  it('accurately tracks 10s respawn for Big pads and 4s respawn for Small pads', () => {
    const manager = new BoostPadClockManager();
    const bigPadId = 'pad_big_corner';
    const smallPadId = 'pad_small_center';

    manager.registerPad(bigPadId, 'Big');
    manager.registerPad(smallPadId, 'Small');

    expect(BOOST_PAD_RESPAWN_TIME.Big).toBe(10.0);
    expect(BOOST_PAD_RESPAWN_TIME.Small).toBe(4.0);

    // Both pads are initially available
    expect(manager.getPadStateAt(bigPadId, 0).isAvailable).toBe(true);
    expect(manager.getPadStateAt(smallPadId, 0).isAvailable).toBe(true);

    // Pick up both pads at t = 100.0s
    manager.addPickup(bigPadId, 100.0);
    manager.addPickup(smallPadId, 100.0);

    // At t = 101.0s (1s after pickup):
    // Big pad: 9.0s remaining, not available
    const bigState101 = manager.getPadStateAt(bigPadId, 101.0);
    expect(bigState101.isAvailable).toBe(false);
    expect(bigState101.remainingSeconds).toBeCloseTo(9.0, 2);
    expect(bigState101.progress).toBeCloseTo(0.1, 2);

    // Small pad: 3.0s remaining, not available
    const smallState101 = manager.getPadStateAt(smallPadId, 101.0);
    expect(smallState101.isAvailable).toBe(false);
    expect(smallState101.remainingSeconds).toBeCloseTo(3.0, 2);
    expect(smallState101.progress).toBeCloseTo(0.25, 2);

    // At t = 104.1s (4.1s after pickup):
    // Small pad should be RESPAWNED (respawn is 4.0s)
    const smallState104 = manager.getPadStateAt(smallPadId, 104.1);
    expect(smallState104.isAvailable).toBe(true);
    expect(smallState104.remainingSeconds).toBe(0);
    expect(smallState104.progress).toBe(1.0);

    // Big pad should STILL be on cooldown (5.9s remaining)
    const bigState104 = manager.getPadStateAt(bigPadId, 104.1);
    expect(bigState104.isAvailable).toBe(false);
    expect(bigState104.remainingSeconds).toBeCloseTo(5.9, 2);

    // At t = 110.1s (10.1s after pickup):
    // Big pad should now be RESPAWNED
    const bigState110 = manager.getPadStateAt(bigPadId, 110.1);
    expect(bigState110.isAvailable).toBe(true);
    expect(bigState110.remainingSeconds).toBe(0);
    expect(bigState110.progress).toBe(1.0);
  });

  it('handles timeline scrubbing backwards and multiple pickups', () => {
    const manager = new BoostPadClockManager();
    const padId = 'pad_mid';
    manager.registerPad(padId, 'Big');

    // Pickups at 10s, 30s, and 50s
    manager.addPickup(padId, 10.0);
    manager.addPickup(padId, 30.0);
    manager.addPickup(padId, 50.0);

    // Scrub to t = 5.0 (before any pickup) -> available
    expect(manager.getPadStateAt(padId, 5.0).isAvailable).toBe(true);

    // Scrub to t = 12.0 (picked up at 10, respawns at 20) -> unavailable
    expect(manager.getPadStateAt(padId, 12.0).isAvailable).toBe(false);

    // Scrub to t = 25.0 (between 20 and 30) -> available
    expect(manager.getPadStateAt(padId, 25.0).isAvailable).toBe(true);

    // Scrub to t = 35.0 (picked up at 30, respawns at 40) -> unavailable
    expect(manager.getPadStateAt(padId, 35.0).isAvailable).toBe(false);
  });
});

describe('5. Rocket League Authentic Camera Geometry & FOV Scaling Verification', () => {
  it('implements authentic Hor+ FOV scaling: vertical FOV is preserved across wide and ultrawide displays', () => {
    const fovSetting = 110;
    // Standard 16:9 aspect ratio:
    const vFov16_9 = rlFovToThreeVerticalFov(fovSetting, 16 / 9);
    expect(vFov16_9).toBeCloseTo(77.56, 1);

    // 21:9 Ultrawide display (aspect ~ 2.37 or 2.2):
    // In Rocket League (Hor+), vertical FOV does NOT shrink; extra horizontal width is revealed
    const vFov21_9 = rlFovToThreeVerticalFov(fovSetting, 21 / 9);
    expect(vFov21_9).toBeCloseTo(vFov16_9, 4);

    // 32:9 Super-ultrawide display:
    const vFov32_9 = rlFovToThreeVerticalFov(fovSetting, 32 / 9);
    expect(vFov32_9).toBeCloseTo(vFov16_9, 4);

    // 4:3 Narrower display: expands vertical FOV so horizontal view is not cropped
    const vFov4_3 = rlFovToThreeVerticalFov(fovSetting, 4 / 3);
    expect(vFov4_3).toBeGreaterThan(vFov16_9);
  });
});
