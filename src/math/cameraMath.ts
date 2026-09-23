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
/**
 * Converts Rocket League's 16:9 horizontal FOV to Three.js vertical FOV in degrees.
 * Three.js cameras take vertical FOV in degrees.
 * Rocket League FOV uses Hor+ scaling:
 * - On 16:9 or wider screens (e.g. 21:9), vertical FOV remains constant while extra horizontal
 *   field is revealed.
 * - On narrower screens (< 16:9), vertical FOV expands so horizontal FOV is preserved.
 */
export function rlFovToThreeVerticalFov(horizontalFovDeg: number, aspect: number): number {
  const hFovRad = (horizontalFovDeg * Math.PI) / 180;
  const baseAspect = 16 / 9;
  const effectiveAspect = Math.min(aspect, baseAspect);
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
 * Clamps a camera position inside the authentic Rocket League arena boundary with safety padding.
 * Standard arena dimensions:
 * - Half width (X): 4096 uu -> clamped to [-4030, +4030] uu
 * - Half length (Z): 5120 uu -> clamped to [-5050, +5050] uu (or up to +/-5800 uu in goal nets)
 * - Ceiling (Y): 2044 uu -> clamped to [20, 1980] uu
 * - 4 Corner angled cuts at 45 degrees: |X| + |Z| <= 7950 uu
 */
export function clampCameraInsideArena(
  desiredPosition: THREE.Vector3,
  carPosition: THREE.Vector3
): THREE.Vector3 {
  const result = desiredPosition.clone();

  // Floor and ceiling limits
  if (result.y < 20) result.y = 20;
  if (result.y > 1980) result.y = 1980;

  // Goal net penetration check:
  // Standard RL goal: width 1785 uu (X in [-892, +892]), height 642 uu (Y < 642), depth extends to +/-6000
  const isInsideGoalX = Math.abs(result.x) < 850;
  const isInsideGoalY = result.y < 600;
  const maxZ = (isInsideGoalX && isInsideGoalY) ? 5800 : 5050;

  // Ray-plane intersection from carPosition to desiredPosition to smoothly slide along boundaries
  const toCam = result.clone().sub(carPosition);
  let t = 1.0;

  const maxX = 4030;
  if (result.x > maxX && toCam.x > 1e-4) {
    t = Math.min(t, (maxX - carPosition.x) / toCam.x);
  } else if (result.x < -maxX && toCam.x < -1e-4) {
    t = Math.min(t, (-maxX - carPosition.x) / toCam.x);
  }

  if (result.z > maxZ && toCam.z > 1e-4) {
    t = Math.min(t, (maxZ - carPosition.z) / toCam.z);
  } else if (result.z < -maxZ && toCam.z < -1e-4) {
    t = Math.min(t, (-maxZ - carPosition.z) / toCam.z);
  }

  const maxCorner = 7950;
  const cornerSum = Math.abs(result.x) + Math.abs(result.z);
  if (cornerSum > maxCorner) {
    const signX = Math.sign(result.x) || 1;
    const signZ = Math.sign(result.z) || 1;
    const dCorner = (signX * toCam.x) + (signZ * toCam.z);
    const carCorner = (signX * carPosition.x) + (signZ * carPosition.z);
    if (dCorner > 1e-4) {
      t = Math.min(t, (maxCorner - carCorner) / dCorner);
    }
  }

  if (t > 0 && t < 1.0) {
    result.copy(carPosition).add(toCam.multiplyScalar(t));
  }

  // Hard safety clamp as absolute guarantee
  result.x = Math.max(-maxX, Math.min(maxX, result.x));
  result.z = Math.max(-maxZ, Math.min(maxZ, result.z));

  const hardCorner = Math.abs(result.x) + Math.abs(result.z);
  if (hardCorner > maxCorner) {
    const excess = (hardCorner - maxCorner) / 2;
    result.x -= Math.sign(result.x) * excess;
    result.z -= Math.sign(result.z) * excess;
  }

  return result;
}

/**
 * Computes the chase camera position and rotation.
 * 
 * In Rocket League:
 * - Distance is maintained behind the car along its heading.
 * - Height is anchored above the car along World Up on turf/air (or surface normal on walls).
 * - Roll is strictly locked to World Up (0, 1, 0) during flips, dodges, speedflips, and aerials.
 * - Pitch angle (settings.angle in degrees, negative) tilts downward toward the vehicle.
 *   The camera NEVER pitches down steeper than settings.angle during flips or dodges.
 * - During flips / speedflips / dodges, heading tracks travel direction rather than
 *   somersaulting with the flipping car chassis.
 */
export function computeHorizonLockedCarCam(
  carPosition: THREE.Vector3,
  carQuaternion: THREE.Quaternion,
  settings: CameraSettings,
  carSpeed: number = 0,
  carVelocity?: THREE.Vector3,
  isDodgeActive?: boolean,
  stableHeading?: THREE.Vector3
): { cameraPosition: THREE.Vector3; cameraQuaternion: THREE.Quaternion; cameraUp: THREE.Vector3; lookTarget: THREE.Vector3 } {
  // In our Three space: Local +X is Forward, Local +Y is Up, Local +Z is Right
  const forwardLocal = new THREE.Vector3(1, 0, 0);
  const upLocal = new THREE.Vector3(0, 1, 0);
  const carForwardWorld = forwardLocal.clone().applyQuaternion(carQuaternion);
  const carUpWorld = upLocal.clone().applyQuaternion(carQuaternion);

  const worldUp = new THREE.Vector3(0, 1, 0);

  // Arena wall / ceiling detection
  const isNearWallOrCeiling = Math.abs(carPosition.x) > 3700 || Math.abs(carPosition.z) > 4800 || carPosition.y > 1850;
  // A car is mounted on a wall/ceiling if near the perimeter and its up vector points away from the wall
  const isWallMounted = isNearWallOrCeiling && (
    carUpWorld.y < 0.6 || Math.abs(carUpWorld.x) > 0.6 || Math.abs(carUpWorld.z) > 0.6
  );

  let effectiveForward: THREE.Vector3;
  let effectiveUp: THREE.Vector3;
  let pitchRad: number;

  if (isWallMounted) {
    // Wall / Ceiling driving: Camera aligns to the driving surface normal
    effectiveForward = carForwardWorld.clone().normalize();
    const refUp = carUpWorld;
    let camRightTemp = new THREE.Vector3().crossVectors(effectiveForward, refUp);
    if (camRightTemp.lengthSq() < 1e-4) {
      camRightTemp = new THREE.Vector3().crossVectors(effectiveForward, new THREE.Vector3(0, 0, 1));
      if (camRightTemp.lengthSq() < 1e-4) {
        camRightTemp = new THREE.Vector3().crossVectors(effectiveForward, new THREE.Vector3(1, 0, 0));
      }
    }
    camRightTemp.normalize();
    effectiveUp = new THREE.Vector3().crossVectors(camRightTemp, effectiveForward).normalize();
    pitchRad = (settings.angle * Math.PI) / 180;
  } else {
    // Floor driving, aerials, jumps, and dodges/flips:
    // Camera roll is strictly locked to World Up (0, 1, 0)
    effectiveUp = worldUp.clone();

    // Check if the car is currently performing a flip / dodge / acrobatic tumble
    const isFlipping = !!isDodgeActive || carUpWorld.y < 0.4 || carForwardWorld.y < -0.4;

    if (stableHeading) {
      // Use externally supplied smoothed/stable heading (e.g. from CameraSuite persistent tracker)
      effectiveForward = new THREE.Vector3(stableHeading.x, 0, stableHeading.z);
      if (effectiveForward.lengthSq() < 1e-4) {
        effectiveForward.set(1, 0, 0);
      } else {
        effectiveForward.normalize();
      }
    } else if (isFlipping) {
      // When tumbling or dodging without persistent tracker:
      // If moving horizontally, follow velocity vector; otherwise horizontal car forward
      const vHorizSq = carVelocity ? (carVelocity.x * carVelocity.x + carVelocity.z * carVelocity.z) : 0;
      if (carVelocity && vHorizSq > 2500) {
        effectiveForward = new THREE.Vector3(carVelocity.x, 0, carVelocity.z).normalize();
      } else {
        effectiveForward = new THREE.Vector3(carForwardWorld.x, 0, carForwardWorld.z);
        if (effectiveForward.lengthSq() < 1e-4) {
          effectiveForward.set(1, 0, 0);
        } else {
          effectiveForward.normalize();
        }
      }
    } else {
      // Normal driving on turf or upright aerial
      effectiveForward = new THREE.Vector3(carForwardWorld.x, 0, carForwardWorld.z);
      if (effectiveForward.lengthSq() < 1e-4) {
        effectiveForward.set(1, 0, 0);
      } else {
        effectiveForward.normalize();
      }
    }

    // Authentic Rocket League pitch:
    // Base pitch angle from settings (negative, e.g. -3°, tilting down towards the car).
    // The camera NEVER pitches down steeper than settings.angle (e.g. into the grass).
    // If aerial climbing (nose pitched up into the air), allow camera to pitch up smoothly.
    const basePitchRad = (settings.angle * Math.PI) / 180;
    if (!isFlipping && carPosition.y > 100 && carForwardWorld.y > 0.05) {
      const climbAngle = Math.asin(Math.min(Math.max(carForwardWorld.y, 0), 1));
      const maxAerialPitchRad = (65 * Math.PI) / 180;
      pitchRad = Math.min(basePitchRad + climbAngle * 0.7, maxAerialPitchRad);
    } else {
      pitchRad = basePitchRad;
    }
  }

  // Effective distance considering supersonic speed extension
  const distMult = getSpeedDistanceMultiplier(carSpeed);
  const effectiveDistance = settings.distance * distMult;

  let cameraPosition: THREE.Vector3;
  if (isWallMounted) {
    cameraPosition = carPosition.clone()
      .sub(effectiveForward.clone().multiplyScalar(effectiveDistance))
      .add(effectiveUp.clone().multiplyScalar(settings.height));
  } else {
    // Ground & aerial: horizontally behind the car, vertically height above car
    cameraPosition = carPosition.clone()
      .sub(effectiveForward.clone().multiplyScalar(effectiveDistance));
    cameraPosition.y = carPosition.y + settings.height;
  }

  // Collision constraint: Clamp camera strictly inside arena walls, corners, floor, and ceiling
  cameraPosition = clampCameraInsideArena(cameraPosition, carPosition);

  // Camera Right axis (strictly orthogonal to effectiveForward and effectiveUp)
  let camRight = new THREE.Vector3().crossVectors(effectiveForward, effectiveUp).normalize();
  if (camRight.lengthSq() < 1e-4) {
    camRight.set(0, 0, 1);
  }

  // Apply pitch angle (settings.angle in degrees, negative tilts down towards the car)
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(camRight, pitchRad);

  // Pitch the forward vector down towards the car
  const camForward = effectiveForward.clone().applyQuaternion(pitchQuat).normalize();

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
 * Computes BallCam camera position and look target with overhead singularity clamping
 * and dynamic framing guarantees that prevent the player's vehicle from leaving view.
 */
export function computeBallCam(
  carPosition: THREE.Vector3,
  ballPosition: THREE.Vector3,
  settings: CameraSettings,
  carSpeed: number = 0,
  cameraOrbitDirection?: THREE.Vector3,
  cameraAspect: number = 16 / 9
): { cameraPosition: THREE.Vector3; cameraQuaternion: THREE.Quaternion; lookTarget: THREE.Vector3; elevationRad: number } {
  // Ball Cam orbits to the opposite side of the player from the ball. This
  // keeps both the player and ball in the central vertical composition.
  const horizontalDiff = new THREE.Vector3(
    carPosition.x - ballPosition.x,
    0,
    carPosition.z - ballPosition.z
  );
  const orbitDirection = cameraOrbitDirection?.clone() ?? horizontalDiff;
  orbitDirection.y = 0;
  if (orbitDirection.lengthSq() < 1e-4) {
    orbitDirection.set(1, 0, 0);
  } else {
    orbitDirection.normalize();
  }

  // Distance extension
  const distMult = getSpeedDistanceMultiplier(carSpeed);
  const effectiveDistance = settings.distance * distMult;

  let cameraPosition = carPosition.clone().add(orbitDirection.clone().multiplyScalar(effectiveDistance));

  // Authentic Rocket League height: anchored strictly to carPosition.y + settings.height
  cameraPosition.y = carPosition.y + settings.height;

  // Collision constraint: Clamp camera strictly inside arena walls, corners, floor, and ceiling
  cameraPosition = clampCameraInsideArena(cameraPosition, carPosition);

  // Calculate direction to ball
  const toBall = ballPosition.clone().sub(cameraPosition);
  const horizDistBall = Math.sqrt(toBall.x * toBall.x + toBall.z * toBall.z);
  const rawElevationRad = Math.atan2(toBall.y, horizDistBall || 1);

  // Calculate direction from camera to car for vertical framing guarantee
  const toCar = carPosition.clone().sub(cameraPosition);
  const horizDistCar = Math.sqrt(toCar.x * toCar.x + toCar.z * toCar.z);
  const carElevationRad = Math.atan2(toCar.y, horizDistCar || 1);

  // Compute camera vertical FOV for current aspect ratio
  const vFovDeg = rlFovToThreeVerticalFov(settings.fov, cameraAspect);
  const vFovRad = (vFovDeg * Math.PI) / 180;
  const halfFov = vFovRad / 2;

  // Authentic framing: The camera elevation must not pitch so high that the car
  // falls off the bottom of the viewport. Clamping to NDC y >= -0.75 guarantees
  // the player's vehicle is ALWAYS visible in the lower portion of the screen.
  const maxFramingElevationRad = carElevationRad + Math.atan(0.75 * Math.tan(halfFov));
  const maxAllowedElevationRad = Math.min(maxFramingElevationRad, MAX_BALL_ELEVATION_RAD);

  // Lower framing limit from settings.angle (e.g. -3 deg)
  const configuredFloorRad = (Math.min(Math.max(settings.angle, -15), 0) * Math.PI) / 180;

  // Elevation clamped within safe framing window
  const elevationRad = Math.min(
    Math.max(rawElevationRad, configuredFloorRad),
    maxAllowedElevationRad
  );

  // Rebuild the look target when elevation is adjusted
  const totalDist = toBall.length();
  let clampedLookTarget = ballPosition.clone();
  if (Math.abs(elevationRad - rawElevationRad) > 1e-4) {
    const clampedY = cameraPosition.y + Math.sin(elevationRad) * totalDist;
    const clampedHorizDist = Math.cos(elevationRad) * totalDist;
    const horizUnit = new THREE.Vector3(ballPosition.x - cameraPosition.x, 0, ballPosition.z - cameraPosition.z);
    if (horizUnit.lengthSq() < 1e-4) horizUnit.copy(orbitDirection).negate();
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
