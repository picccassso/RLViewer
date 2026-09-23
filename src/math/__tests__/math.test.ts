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
  computeHorizonLockedCarCam,
  computeBallCam,
  clampCameraInsideArena,
  DEFAULT_CAMERA_SETTINGS,
  MAX_BALL_ELEVATION_RAD,
  rlFovToThreeVerticalFov
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

describe('2. Camera Horizon Stability on Car Roll', () => {
  it('asserts camera Up vector remains within 1° of World Up (0, 1, 0) during 360° barrel rolls', () => {
    const carPos = new THREE.Vector3(0, 100, 0); // Airborne car
    const worldUp = new THREE.Vector3(0, 1, 0);

    // Test a full 360-degree barrel roll at 10-degree increments
    for (let rollDeg = 0; rollDeg <= 360; rollDeg += 10) {
      const rollRad = (rollDeg * Math.PI) / 180;
      // In Three space, car forward is +X, so barrel roll is rotation around X axis
      const carQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rollRad);

      const { cameraUp } = computeHorizonLockedCarCam(carPos, carQuat, {
        ...DEFAULT_CAMERA_SETTINGS,
        angle: 0, // pure horizon check without pitch angle bias
      });

      // Compute angle between camera Up and World Up
      const angleRad = cameraUp.angleTo(worldUp);
      const angleDeg = (angleRad * 180) / Math.PI;

      // Must remain within 1.0 degree of World Up (0, 1, 0)
      expect(angleDeg).toBeLessThanOrEqual(1.0);
    }
  });

  it('keeps camera Up stable during flips and combinations of pitch and roll', () => {
    const carPos = new THREE.Vector3(500, 200, -1000);
    const worldUp = new THREE.Vector3(0, 1, 0);

    // Inverted car (ceiling aerial / upside down flip)
    const upsideDownQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    const { cameraUp } = computeHorizonLockedCarCam(carPos, upsideDownQuat, {
      ...DEFAULT_CAMERA_SETTINGS,
      angle: 0,
    });

    const angleDeg = (cameraUp.angleTo(worldUp) * 180) / Math.PI;
    expect(angleDeg).toBeLessThanOrEqual(1.0);
  });

  it('keeps camera height, pitch, and roll completely stable during a front flip', () => {
    const carPos = new THREE.Vector3(0, 60, 0);
    const carVel = new THREE.Vector3(1500, 0, 0); // Moving forward along +X
    const worldUp = new THREE.Vector3(0, 1, 0);

    // In Three space, forward is +X, up is +Y, right is +Z.
    // Pitching down 90 degrees (nose pointing straight down into turf)
    const pitchDownQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);

    const { cameraPosition, cameraUp, lookTarget } = computeHorizonLockedCarCam(
      carPos,
      pitchDownQuat,
      { ...DEFAULT_CAMERA_SETTINGS, height: 110, distance: 280, angle: -3 },
      1500,
      carVel,
      true // isDodgeActive
    );

    // Camera height must remain anchored strictly to carPos.y + settings.height (60 + 110 = 170)
    expect(cameraPosition.y).toBe(170);

    // Camera Up must match the configured pitch angle (3 deg tilt from World Up) with zero roll
    const angleDeg = (cameraUp.angleTo(worldUp) * 180) / Math.PI;
    expect(angleDeg).toBeCloseTo(3.0, 1);

    // Camera must stay BEHIND the car along its travel direction (-X)
    expect(cameraPosition.x).toBeLessThan(carPos.x);

    // Camera pitch must not dive straight down into the floor; lookTarget.y should reflect -3 deg
    expect(lookTarget.y).toBeLessThan(cameraPosition.y);
    expect(lookTarget.y).toBeGreaterThan(cameraPosition.y - 30); // Not pointing straight down
  });

  it('keeps camera heading aligned with forward travel direction during a speedflip', () => {
    // In a speedflip, the car travels diagonally down the field while tumbling diagonally
    const carPos = new THREE.Vector3(100, 75, 300);
    const carVel = new THREE.Vector3(800, 0, 2000); // Kickoff diagonal velocity
    const travelDir = new THREE.Vector3(800, 0, 2000).normalize();

    // Tumbling diagonal rotation (upside down and pitched)
    const tumbleQuat = new THREE.Quaternion(0.765, -0.378, -0.383, 0.352).normalize();

    const { cameraPosition, cameraUp } = computeHorizonLockedCarCam(
      carPos,
      tumbleQuat,
      { ...DEFAULT_CAMERA_SETTINGS, height: 110, distance: 280, angle: -3 },
      2154,
      carVel,
      true
    );

    // Camera height must remain at car height + settings.height
    expect(cameraPosition.y).toBe(75 + 110);

    // Camera Up must remain upright
    expect(cameraUp.y).toBeGreaterThan(0.99);

    // The camera position offset from the car must be directly opposite the travel direction
    const camOffset = new THREE.Vector3().subVectors(carPos, cameraPosition);
    camOffset.y = 0;
    camOffset.normalize();

    // camOffset should point in the travel direction
    const dot = camOffset.dot(travelDir);
    expect(dot).toBeGreaterThan(0.99);
  });

  it('tilts camera downward towards the car on turf when angle is negative (standard RL setting)', () => {
    const carPos = new THREE.Vector3(0, 30, 0); // Car resting on ground
    const carQuat = new THREE.Quaternion(); // Identity

    const { cameraPosition, lookTarget } = computeHorizonLockedCarCam(carPos, carQuat, {
      ...DEFAULT_CAMERA_SETTINGS,
      height: 100,
      distance: 270,
      angle: -3, // RL standard pitch angle is negative (tilts down towards car)
    });

    // Camera is positioned at car height + settings.height (130)
    expect(cameraPosition.y).toBe(130);

    // Look target must be lower than camera position (pointing down towards the pitch/car)
    expect(lookTarget.y).toBeLessThan(cameraPosition.y);

    // With angle = -3° and distance = 270, dy should be approx -270 * sin(3°) ≈ -14.1 uu
    const dy = lookTarget.y - cameraPosition.y;
    expect(dy).toBeLessThan(0);
    expect(dy).toBeCloseTo(-270 * Math.sin((3 * Math.PI) / 180), 1);
  });
});

describe('3. BallCam Overhead Singularity Clamping & Dynamic Framing', () => {
  it('clamps overhead elevation to <= 82° and keeps the car within view', () => {
    const carPos = new THREE.Vector3(0, 20, 0);
    
    // High altitude ball directly overhead: elevation angle would be ~85°+ without clamp
    const ballDirectlyAbove = new THREE.Vector3(0, 3000, 0);

    const result = computeBallCam(carPos, ballDirectlyAbove, DEFAULT_CAMERA_SETTINGS);

    // Elevation must be clamped to <= 82 degrees (1.43117 rad)
    expect(result.elevationRad).toBeLessThanOrEqual(MAX_BALL_ELEVATION_RAD + 1e-4);

    // Camera must frame the car inside the viewport
    const camera = new THREE.PerspectiveCamera(77.56, 16 / 9, 10, 50000);
    camera.position.copy(result.cameraPosition);
    camera.quaternion.copy(result.cameraQuaternion);
    camera.updateMatrixWorld();

    const carProj = carPos.clone().project(camera);
    expect(carProj.y).toBeGreaterThanOrEqual(-0.85);
    expect(carProj.y).toBeLessThanOrEqual(0.5);

    // Look direction must be valid non-NaN finite vectors
    expect(Number.isFinite(result.lookTarget.x)).toBe(true);
    expect(Number.isFinite(result.lookTarget.y)).toBe(true);
    expect(Number.isFinite(result.lookTarget.z)).toBe(true);
    expect(Number.isFinite(result.cameraQuaternion.x)).toBe(true);
  });

  it('guarantees car remains in view and camera inside arena when car is on wall with high ball', () => {
    // Frame 316 scenario: car on side wall, ball high in corner near ceiling
    const carPos = new THREE.Vector3(-4079.0, 362.4, 730.5);
    const ballPos = new THREE.Vector3(-3571.1, 1616.3, 3401.4);

    const result = computeBallCam(carPos, ballPos, DEFAULT_CAMERA_SETTINGS);

    // Camera must NOT penetrate the arena wall (X must be inside [-4030, +4030])
    expect(result.cameraPosition.x).toBeGreaterThanOrEqual(-4030);
    expect(result.cameraPosition.x).toBeLessThanOrEqual(4030);

    // Car must be visible in viewport (NDC Y >= -0.85 and <= 0.85)
    const camera = new THREE.PerspectiveCamera(77.56, 16 / 9, 10, 50000);
    camera.position.copy(result.cameraPosition);
    camera.quaternion.copy(result.cameraQuaternion);
    camera.updateMatrixWorld();

    const carProj = carPos.clone().project(camera);
    expect(carProj.y).toBeGreaterThanOrEqual(-0.85);
    expect(carProj.y).toBeLessThanOrEqual(0.85);

    // Ball must also remain visible in viewport
    const ballProj = ballPos.clone().project(camera);
    expect(ballProj.y).toBeGreaterThanOrEqual(-0.85);
    expect(ballProj.y).toBeLessThanOrEqual(0.85);
  });

  it('allows natural elevation when ball is within normal sight range (< 82°)', () => {
    const carPos = new THREE.Vector3(0, 20, 0);
    // 45 degrees elevation: distance = 500, height = 500
    const ballInFront = new THREE.Vector3(500, 500, 0);

    const result = computeBallCam(carPos, ballInFront, DEFAULT_CAMERA_SETTINGS);
    expect(result.elevationRad).toBeLessThan(MAX_BALL_ELEVATION_RAD);
    expect(result.elevationRad).toBeGreaterThan(0);
  });

  it('keeps an airborne car in the lower framing when the ball is below it', () => {
    const carPos = new THREE.Vector3(0, 900, 0);
    const lowBall = new THREE.Vector3(1200, 92.75, 0);
    const settings = { ...DEFAULT_CAMERA_SETTINGS, angle: -5 };
    const result = computeBallCam(carPos, lowBall, settings);

    expect(result.elevationRad).toBeCloseTo((-5 * Math.PI) / 180, 6);

    const cameraToCar = carPos.clone().sub(result.cameraPosition);
    const viewDirection = result.lookTarget.clone().sub(result.cameraPosition);
    const carElevation = Math.atan2(
      cameraToCar.y,
      Math.hypot(cameraToCar.x, cameraToCar.z)
    );
    const viewElevation = Math.atan2(
      viewDirection.y,
      Math.hypot(viewDirection.x, viewDirection.z)
    );

    // The car's angular elevation is below the view centre, so it renders in
    // the lower part of the viewport instead of above the player horizon.
    expect(carElevation).toBeLessThan(viewElevation);
  });

  it('accepts a stable orbit anchor as the ball crosses overhead', () => {
    const carPos = new THREE.Vector3(0, 20, 0);
    const orbitDirection = new THREE.Vector3(1, 0, 0);
    const before = computeBallCam(
      carPos,
      new THREE.Vector3(-1, 1500, 0),
      DEFAULT_CAMERA_SETTINGS,
      0,
      orbitDirection
    );
    const after = computeBallCam(
      carPos,
      new THREE.Vector3(1, 1500, 0),
      DEFAULT_CAMERA_SETTINGS,
      0,
      orbitDirection
    );

    expect(before.cameraPosition.distanceTo(after.cameraPosition)).toBeCloseTo(0, 6);
    expect(before.cameraPosition.x).toBeGreaterThan(carPos.x);
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

  it('BallCam preserves full camera height above car even when the ball is at high elevation', () => {
    const carPos = new THREE.Vector3(-2786.42, 17.04, 889.84);
    const highBallPos = new THREE.Vector3(-3482.09, 1570.44, -4417.68);
    const settings = {
      ...DEFAULT_CAMERA_SETTINGS,
      height: 110,
      distance: 280,
    };

    const result = computeBallCam(carPos, highBallPos, settings);

    // Camera height must be exactly carPos.y + settings.height (127.04 uu), NOT lowered to turf
    expect(result.cameraPosition.y).toBeCloseTo(carPos.y + settings.height, 2);
    expect(result.cameraPosition.y).toBeCloseTo(127.04, 1);
  });

  it('CarCam pitches upward with the vehicle during aerials while stabilizing roll', () => {
    const carPos = new THREE.Vector3(0, 500, 0); // Aerial car
    // Pitch car 45 degrees nose up (rotate around local right / Z)
    const pitchRad = Math.PI / 4;
    const carQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitchRad);

    const { cameraPosition, lookTarget, cameraUp } = computeHorizonLockedCarCam(carPos, carQuat, {
      ...DEFAULT_CAMERA_SETTINGS,
      height: 100,
      distance: 270,
      angle: 0,
    });

    // Camera look direction must point upward following car climb
    const lookVector = lookTarget.clone().sub(cameraPosition);
    expect(lookVector.y).toBeGreaterThan(50);

    // Camera Up must remain stable and upright
    expect(cameraUp.y).toBeGreaterThan(0.5);
  });
});
