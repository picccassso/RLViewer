import * as THREE from 'three';

export interface CameraSettings {
  fov: number;             // degrees (RL standard horizontal FOV in 16:9, e.g. 110)
  distance: number;        // uu (e.g. 270)
  height: number;          // uu (e.g. 100)
  angle: number;           // degrees pitch (e.g. -3 to -5)
  stiffness: number;       // 0.0 to 1.0 (e.g. 0.45)
  swivel_speed: number;    // swivel rate (e.g. 4.5 to 10)
  transition_speed: number;// 1.0 to 2.0 (e.g. 1.3)
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  fov: 110,
  distance: 270,
  height: 100,
  angle: -3,
  stiffness: 0.45,
  swivel_speed: 5.0,
  transition_speed: 1.3,
};

export const MAX_BALL_ELEVATION_RAD = (82 * Math.PI) / 180; // <= 82 degrees overhead clamp (~1.43117 rad)
export const SUPERSONIC_SPEED_THRESHOLD = 2200; // uu/s

/**
 * Converts Rocket League's 16:9 horizontal FOV to Three.js vertical FOV in degrees.
 * Three.js cameras take vertical FOV in degrees.
 */
export function rlFovToThreeVerticalFov(horizontalFovDeg: number, aspect: number): number {
  const hFovRad = (horizontalFovDeg * Math.PI) / 180;
  // RL camera FOV is defined at 16:9 base aspect ratio
  const baseAspect = 16 / 9;
  const effectiveAspect = Math.max(aspect, baseAspect);
  // vFov = 2 * atan(tan(hFov / 2) / aspect)
  const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / effectiveAspect);
  return (vFovRad * 180) / Math.PI;
}

/**
 * Calculates the supersonic distance extension factor based on speed.
 * Expands camera distance by up to 12% as car reaches supersonic speed.
 */
export function getSpeedDistanceMultiplier(speedUu: number): number {
  const ratio = Math.min(Math.max(speedUu / SUPERSONIC_SPEED_THRESHOLD, 0), 1);
  return 1.0 + 0.12 * ratio;
}

/**
 * Computes the horizon-locked chase camera position and rotation.
 * 
 * In Rocket League:
 * - The camera does NOT roll when the car rolls (horizon lock).
 * - Height is anchored to car position + World Up * height.
 * - The camera's forward heading is determined by the car's ground-projected forward vector.
 * - The camera Up vector remains locked to World Up (0, 1, 0) during car roll.
 * - Pitch angle is applied around the horizon-locked right axis.
 */
export function computeHorizonLockedCarCam(
  carPosition: THREE.Vector3,
  carQuaternion: THREE.Quaternion,
  settings: CameraSettings,
  carSpeed: number = 0
): { cameraPosition: THREE.Vector3; cameraQuaternion: THREE.Quaternion; cameraUp: THREE.Vector3; lookTarget: THREE.Vector3 } {
  // In our Three.js coordinate system:
  // Forward for the car in Three space is +X (from Unreal +X forward, remap x->x, z->y, y->z).
  const forwardLocal = new THREE.Vector3(1, 0, 0);
  const carForwardWorld = forwardLocal.clone().applyQuaternion(carQuaternion);

  // Ground-projected forward direction (X-Z plane, ignoring pitch/roll)
  const groundForward = new THREE.Vector3(carForwardWorld.x, 0, carForwardWorld.z);
  if (groundForward.lengthSq() < 1e-4) {
    groundForward.set(1, 0, 0);
  } else {
    groundForward.normalize();
  }

  // Effective distance considering supersonic speed extension
  const distMult = getSpeedDistanceMultiplier(carSpeed);
  const effectiveDistance = settings.distance * distMult;

  // Position camera behind the car and above ground
  const cameraPosition = carPosition.clone()
    .sub(groundForward.clone().multiplyScalar(effectiveDistance))
    .add(new THREE.Vector3(0, settings.height, 0));

  // Minimum height clamp above field floor (Y >= 20)
  if (cameraPosition.y < 20) {
    cameraPosition.y = 20;
  }

  // World Up vector
  const worldUp = new THREE.Vector3(0, 1, 0);

  // Focus point on the car: at the same relative height anchor
  const focusPoint = carPosition.clone().add(new THREE.Vector3(0, settings.height, 0));

  // Base horizontal forward vector: points directly from cameraPosition to focusPoint
  const horizontalForward = groundForward.clone();

  // Camera Right axis is strictly in the ground plane (perpendicular to forward and World Up)
  const camRight = new THREE.Vector3().crossVectors(horizontalForward, worldUp).normalize();

  // Apply pitch angle (settings.angle in degrees, negative tilts down towards the car)
  const pitchRad = (settings.angle * Math.PI) / 180;
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(camRight, pitchRad);

  // Pitch the forward vector down towards the car
  const camForward = horizontalForward.clone().applyQuaternion(pitchQuat).normalize();

  // Camera Up is orthogonal to camRight and camForward
  const camUp = new THREE.Vector3().crossVectors(camRight, camForward).normalize();

  // Construct rotation matrix (Three.js camera looks down -Z):
  // Basis vectors: X = camRight, Y = camUp, Z = -camForward
  const rotMatrix = new THREE.Matrix4().makeBasis(camRight, camUp, camForward.clone().negate());
  const cameraQuaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

  // Look target along the pitched camera direction
  const lookTarget = cameraPosition.clone().add(camForward.clone().multiplyScalar(effectiveDistance));

  return { cameraPosition, cameraQuaternion, cameraUp: camUp, lookTarget };
}

/**
 * Computes BallCam camera position and look target with overhead singularity clamping.
 * When the ball is directly above the car, the angle is clamped to <= 82 degrees
 * to avoid gimbal singularity / flip.
 */
export function computeBallCam(
  carPosition: THREE.Vector3,
  ballPosition: THREE.Vector3,
  settings: CameraSettings,
  carSpeed: number = 0
): { cameraPosition: THREE.Vector3; cameraQuaternion: THREE.Quaternion; lookTarget: THREE.Vector3; elevationRad: number } {
  // Vector from ball to car in horizontal plane
  const horizontalDiff = new THREE.Vector3(carPosition.x - ballPosition.x, 0, carPosition.z - ballPosition.z);
  const horizDist = horizontalDiff.length();
  
  let horizDir = horizontalDiff.clone();
  if (horizDist < 1e-4) {
    horizDir.set(1, 0, 0);
  } else {
    horizDir.normalize();
  }

  // Distance extension
  const distMult = getSpeedDistanceMultiplier(carSpeed);
  const effectiveDistance = settings.distance * distMult;

  // Position camera behind car relative to ball
  const cameraPosition = carPosition.clone().add(horizDir.multiplyScalar(effectiveDistance));

  // Dynamic height adjustment when ball is high
  const heightDelta = ballPosition.y - carPosition.y;
  const heightFactor = Math.min(Math.max(heightDelta / 800, 0), 1);
  cameraPosition.y = carPosition.y + settings.height - heightFactor * 60;
  if (cameraPosition.y < 20) {
    cameraPosition.y = 20;
  }

  // Calculate direction to ball
  const toBall = ballPosition.clone().sub(cameraPosition);
  const totalDist = toBall.length();

  // Calculate elevation angle: angle above horizontal plane
  let elevationRad = Math.asin(Math.min(Math.max(toBall.y / (totalDist || 1), -1), 1));

  // Clamp overhead elevation to <= MAX_BALL_ELEVATION_RAD (82 degrees)
  let clampedLookTarget = ballPosition.clone();
  if (elevationRad > MAX_BALL_ELEVATION_RAD) {
    elevationRad = MAX_BALL_ELEVATION_RAD;
    // Adjust look target to respect the clamp
    const clampedY = cameraPosition.y + Math.sin(MAX_BALL_ELEVATION_RAD) * totalDist;
    const clampedHorizDist = Math.cos(MAX_BALL_ELEVATION_RAD) * totalDist;
    const horizUnit = new THREE.Vector3(ballPosition.x - cameraPosition.x, 0, ballPosition.z - cameraPosition.z);
    if (horizUnit.lengthSq() < 1e-4) horizUnit.set(0, 0, 1);
    horizUnit.normalize();
    clampedLookTarget.set(
      cameraPosition.x + horizUnit.x * clampedHorizDist,
      clampedY,
      cameraPosition.z + horizUnit.z * clampedHorizDist
    );
  }

  // Construct horizon-stabilized look-at quaternion
  const lookDir = clampedLookTarget.clone().sub(cameraPosition).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const camRight = new THREE.Vector3().crossVectors(lookDir, worldUp).normalize();
  const camUp = new THREE.Vector3().crossVectors(camRight, lookDir).normalize();
  const rotMatrix = new THREE.Matrix4().makeBasis(camRight, camUp, lookDir.clone().negate());
  const cameraQuaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

  return { cameraPosition, cameraQuaternion, lookTarget: clampedLookTarget, elevationRad };
}

/**
 * Evaluates smoothstep transition parameter tau and blended quaternion between CarCam and BallCam.
 */
export function blendCamera(
  carCam: { cameraPosition: THREE.Vector3; cameraQuaternion: THREE.Quaternion },
  ballCam: { cameraPosition: THREE.Vector3; cameraQuaternion: THREE.Quaternion },
  blendFactor: number // 0.0 (CarCam) to 1.0 (BallCam)
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  // Smoothstep: s = 3*t^2 - 2*t^3
  const t = Math.min(Math.max(blendFactor, 0), 1);
  const smoothT = t * t * (3 - 2 * t);

  const position = new THREE.Vector3().lerpVectors(carCam.cameraPosition, ballCam.cameraPosition, smoothT);
  const quaternion = new THREE.Quaternion().copy(carCam.cameraQuaternion).slerp(ballCam.cameraQuaternion, smoothT);

  return { position, quaternion };
}
