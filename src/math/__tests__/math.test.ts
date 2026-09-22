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
  DEFAULT_CAMERA_SETTINGS,
  MAX_BALL_ELEVATION_RAD
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

describe('3. BallCam Overhead Singularity Clamping', () => {
  it('clamps overhead elevation to <= 82° when ball passes directly above car (90°)', () => {
    const carPos = new THREE.Vector3(0, 20, 0);
    
    // High altitude ball directly overhead: elevation angle would be ~85°+ without clamp
    const ballDirectlyAbove = new THREE.Vector3(0, 3000, 0);

    const result = computeBallCam(carPos, ballDirectlyAbove, DEFAULT_CAMERA_SETTINGS);

    // Elevation must be clamped to <= 82 degrees (1.43117 rad)
    expect(result.elevationRad).toBeLessThanOrEqual(MAX_BALL_ELEVATION_RAD + 1e-4);
    expect(result.elevationRad).toBeCloseTo(MAX_BALL_ELEVATION_RAD, 3);

    // Look direction must be valid non-NaN finite vectors
    expect(Number.isFinite(result.lookTarget.x)).toBe(true);
    expect(Number.isFinite(result.lookTarget.y)).toBe(true);
    expect(Number.isFinite(result.lookTarget.z)).toBe(true);
    expect(Number.isFinite(result.cameraQuaternion.x)).toBe(true);
  });

  it('allows natural elevation when ball is within normal sight range (< 82°)', () => {
    const carPos = new THREE.Vector3(0, 20, 0);
    // 45 degrees elevation: distance = 500, height = 500
    const ballInFront = new THREE.Vector3(500, 500, 0);

    const result = computeBallCam(carPos, ballInFront, DEFAULT_CAMERA_SETTINGS);
    expect(result.elevationRad).toBeLessThan(MAX_BALL_ELEVATION_RAD);
    expect(result.elevationRad).toBeGreaterThan(0);
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
