import * as THREE from 'three';

export interface CameraSettings {
  fov: number;             // degrees (RL standard horizontal FOV in 16:9, e.g. 110)
  distance: number;        // uu (e.g. 270)
  height: number;          // uu (e.g. 100)
  angle: number;           // degrees pitch (e.g. -3 to -5)
  stiffness: number;       // 0.0 to 1.0 (e.g. 0.45)
  swivel_speed: number;    // manual free-look rate in RL; not used by the replay camera
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

export const SUPERSONIC_SPEED_THRESHOLD = 2200; // uu/s

/** Ball Cam aim limits, measured from the car to the ball. */
export const MAX_BALL_ELEVATION_RAD = (80 * Math.PI) / 180;
export const MIN_BALL_ELEVATION_RAD = (-55 * Math.PI) / 180;

/** Lowest camera height above the turf, so the boom never scrapes the floor. */
export const CAMERA_MIN_HEIGHT = 30;

/**
 * Share of the ball's upward elevation from the car that Ball Cam pitches the view by.
 * Measured from broadcast POV footage of the sample match: a ball on the roof (61°)
 * tilts the view ~9°, one 20° up during an aerial ~3°, one right overhead ~13°.
 */
export const BALL_CAM_PITCH_SCALE = 0.15;

/** The followed car is kept within this fraction of the half-FOV. */
export const CAR_FRAMING_LIMIT_NDC = 0.8;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

// Arena surfaces in Three space (X width, Y height, Z length).
const ARENA_HALF_WIDTH = 4096;
const ARENA_HALF_LENGTH = 5120;
const ARENA_CEILING = 2044;
const ARENA_CORNER = 8064;

/**
 * Converts Rocket League's 16:9 horizontal FOV to Three.js vertical FOV in degrees.
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
 * Boom length multiplier from speed. Camera stiffness in RL controls how far the
 * camera is pulled back at speed: 1.0 is rigid, 0.0 stretches the most.
 */
export function getSpeedDistanceMultiplier(speedUu: number, stiffness: number = DEFAULT_CAMERA_SETTINGS.stiffness): number {
  const ratio = Math.min(Math.max(speedUu / SUPERSONIC_SPEED_THRESHOLD, 0), 1);
  const looseness = 1 - Math.min(Math.max(stiffness, 0), 1);
  return 1.0 + 0.25 * looseness * ratio;
}

/**
 * Rotation whose -Z axis looks along `forward` with +Y as close to `up` as possible
 * (the Three.js camera convention).
 */
export function lookRotation(forward: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/**
 * Horizontal heading of a car, stable through flips, tumbles and upside-down flight.
 *
 * Two heading estimates are available: the flattened forward axis (valid for any roll)
 * and worldUp x right (valid for any pitch). While upright they agree. Once inverted a
 * half-roll and a half-flip are indistinguishable, so the candidate closest to the
 * previous heading is kept.
 */
export function estimateCarHeading(
  carQuaternion: THREE.Quaternion,
  previousHeading?: THREE.Vector3
): THREE.Vector3 {
  // Car local axes in Three space: +X forward, +Y up, +Z right.
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(carQuaternion);
  const right = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuaternion);

  const fromForward = new THREE.Vector3(forward.x, 0, forward.z);
  const fromRight = new THREE.Vector3(right.z, 0, -right.x); // worldUp x right

  if (up.y > 0.1 || !previousHeading) {
    const heading = fromForward.add(fromRight);
    if (heading.lengthSq() > 1e-6) return heading.normalize();
    return previousHeading?.clone() ?? new THREE.Vector3(1, 0, 0);
  }

  let best: THREE.Vector3 | null = null;
  let bestDot = -Infinity;
  for (const base of [fromForward, fromRight]) {
    if (base.lengthSq() < 0.09) continue;
    for (const sign of [1, -1]) {
      const candidate = base.clone().multiplyScalar(sign).normalize();
      const dot = candidate.dot(previousHeading);
      if (dot > bestDot) {
        bestDot = dot;
        best = candidate;
      }
    }
  }
  return best ?? previousHeading.clone();
}

/**
 * Car Cam heading over time. While the car is upright or driving on a surface the
 * heading follows the chassis. Mid-air tumbles (flips, speedflips, recoveries) make the
 * chassis heading swing wildly, so the heading is held and only drifts towards the
 * direction of travel, the way the Rocket League camera rides out a flip.
 */
export function trackCarHeading(
  previousHeading: THREE.Vector3 | undefined,
  carPosition: THREE.Vector3,
  carQuaternion: THREE.Quaternion,
  carVelocity: THREE.Vector3,
  deltaTime: number
): THREE.Vector3 {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(carQuaternion);
  const isTumbling = up.y < 0.7 && getSurfaceAlignment(carPosition, carQuaternion) < 0.5;
  if (!previousHeading || !isTumbling) {
    return estimateCarHeading(carQuaternion, previousHeading);
  }

  const heading = previousHeading.clone();
  const travel = new THREE.Vector3(carVelocity.x, 0, carVelocity.z);
  if (travel.lengthSq() > 400 * 400) {
    const angle = heading.angleTo(travel.normalize());
    if (angle > 1e-4) {
      // Sign of (heading x travel).y picks the shorter way round world up.
      const turnSign = Math.sign(heading.z * travel.x - heading.x * travel.z) || 1;
      heading.applyAxisAngle(WORLD_UP, turnSign * angle * (1 - Math.exp(-2.5 * deltaTime)));
    }
  }
  return heading.normalize();
}

/**
 * How strongly the Car Cam should align to the driving surface: 0 on the turf or in
 * the air, 1 when driving on a wall or the ceiling. The car must be close to the
 * nearest wall or ceiling with its wheels towards it, so a car tumbling in the air
 * just off a wall (after jumping off it, say) keeps a level camera.
 */
export function getSurfaceAlignment(carPosition: THREE.Vector3, carQuaternion: THREE.Quaternion): number {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(carQuaternion);
  const tilt = Math.min(Math.max((0.9 - up.y) / 0.5, 0), 1);
  if (tilt === 0) return 0;

  // Nearest wall or ceiling, and the normal pointing back into the arena
  const { x, y, z } = carPosition;
  const sx = Math.sign(x) || 1;
  const sz = Math.sign(z) || 1;
  const surfaces: Array<[number, number, number, number]> = [
    [ARENA_HALF_WIDTH - Math.abs(x), -sx, 0, 0],
    [ARENA_HALF_LENGTH - Math.abs(z), 0, 0, -sz],
    [ARENA_CEILING - y, 0, -1, 0],
    [(ARENA_CORNER - Math.abs(x) - Math.abs(z)) / Math.SQRT2, -sx * Math.SQRT1_2, 0, -sz * Math.SQRT1_2],
  ];
  let nearest = surfaces[0];
  for (const surface of surfaces) if (surface[0] < nearest[0]) nearest = surface;
  const [distance, nx, ny, nz] = nearest;

  const toSurface = Math.max(0, distance);
  const nearSurface = 1 - Math.min(Math.max((toSurface - 150) / 250, 0), 1);
  const wheelsOnSurface = up.x * nx + up.y * ny + up.z * nz;
  const facing = Math.min(Math.max((wheelsOnSurface - 0.5) / 0.35, 0), 1);
  return tilt * nearSurface * facing;
}

/**
 * Car Cam aim: level behind the car along its heading, or aligned to the wall /
 * ceiling the car is driving on. Roll never follows the car through flips.
 */
export function computeCarCamAim(
  carPosition: THREE.Vector3,
  carQuaternion: THREE.Quaternion,
  heading: THREE.Vector3
): THREE.Quaternion {
  const levelAim = lookRotation(heading, WORLD_UP);
  const surface = getSurfaceAlignment(carPosition, carQuaternion);
  if (surface <= 0) return levelAim;

  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(carQuaternion);
  return levelAim.slerp(lookRotation(forward, up), surface);
}

/**
 * Ball Cam aim. It turns to put the ball straight ahead of the car, then pitches up by
 * only `BALL_CAM_PITCH_SCALE` of the ball's elevation from the car, so a high ball
 * rides up the frame while the car stays close to its usual spot. Balls below the car
 * are aimed at fully. As the ball comes overhead its ground direction becomes
 * meaningless, so the aim eases onto the car heading instead of spinning around.
 */
export function computeBallCamAim(
  carPosition: THREE.Vector3,
  ballPosition: THREE.Vector3,
  heading: THREE.Vector3
): { aim: THREE.Quaternion; horizontalDistance: number; elevationRad: number } {
  const toBall = ballPosition.clone().sub(carPosition);
  const horizontalDistance = Math.hypot(toBall.x, toBall.z);

  const ground = new THREE.Vector3(heading.x, 0, heading.z).normalize();
  if (horizontalDistance > 1e-3) {
    const towardBall = new THREE.Vector3(toBall.x / horizontalDistance, 0, toBall.z / horizontalDistance);
    const ballWeight = Math.min(horizontalDistance / 150, 1);
    const blended = ground.clone().multiplyScalar(1 - ballWeight).addScaledVector(towardBall, ballWeight);
    if (blended.lengthSq() > 1e-4) ground.copy(blended.normalize());
  }

  const elevationRad = Math.min(
    Math.max(Math.atan2(toBall.y, horizontalDistance), MIN_BALL_ELEVATION_RAD),
    MAX_BALL_ELEVATION_RAD
  );
  const pitchRad = elevationRad > 0 ? elevationRad * BALL_CAM_PITCH_SCALE : elevationRad;
  const direction = ground.multiplyScalar(Math.cos(pitchRad));
  direction.y = Math.sin(pitchRad);

  return { aim: lookRotation(direction, WORLD_UP), horizontalDistance, elevationRad };
}

/**
 * Places the camera on a boom arm around the car.
 *
 * The camera sits `distance` behind and `height` above the car in the aim's own frame,
 * and looks along the aim tilted by `angle`. Because the camera is derived from the
 * car's current position, the car holds a fixed screen position however the aim is
 * smoothed. `viewPitchShare` of an upward aim tilts the view instead of the boom,
 * lowering the car on screen down to the framing limit: past that a high ball rides
 * up the frame (or leaves the top) instead. The boom swings up to stay above the
 * turf, and the view turns just enough to keep the car on screen.
 *
 * Like Rocket League, the boom never shortens against the arena: the camera passes
 * through walls and the ceiling (which are see-through from outside), so the car keeps
 * a constant size on screen in corners and along walls.
 */
export function placeBoomCamera(
  pivot: THREE.Vector3,
  aim: THREE.Quaternion,
  settings: CameraSettings,
  distanceMultiplier: number = 1,
  aspect: number = 16 / 9,
  viewPitchShare: number = 0
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(aim);

  // Part of an upward aim can be taken by tilting the view instead of swinging the
  // boom under the car, so the camera keeps its height for high balls.
  const aimForward = new THREE.Vector3(0, 0, -1).applyQuaternion(aim);
  const upwardElevation = Math.max(0, Math.asin(Math.min(Math.max(aimForward.y, -1), 1)));
  const boomAim = aim.clone().premultiply(
    new THREE.Quaternion().setFromAxisAngle(right, -upwardElevation * Math.min(Math.max(viewPitchShare, 0), 1))
  );
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(boomAim);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(boomAim);
  const offset = back.multiplyScalar(settings.distance * distanceMultiplier).addScaledVector(up, settings.height);

  // Swing the boom down (camera up) just enough to clear the turf.
  if (pivot.y + offset.y < CAMERA_MIN_HEIGHT) {
    let low = 0;
    let high = Math.PI / 2;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      const y = offset.clone().applyAxisAngle(right, -mid).y;
      if (pivot.y + y < CAMERA_MIN_HEIGHT) low = mid;
      else high = mid;
    }
    offset.applyAxisAngle(right, -high);
  }

  const position = pivot.clone().add(offset);
  const quaternion = aim.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(AXIS_X, (settings.angle * Math.PI) / 180)
  );

  // Framing guarantee: when the turf swings the camera off the aim, or the view tilts
  // up for a high ball, turn the view just enough to keep the car inside the frame limits.
  const tanHalfV = Math.tan((rlFovToThreeVerticalFov(settings.fov, aspect) * Math.PI) / 360);
  const yawLimitRad = Math.atan(CAR_FRAMING_LIMIT_NDC * tanHalfV * aspect);
  const pitchLimitRad = Math.atan(CAR_FRAMING_LIMIT_NDC * tanHalfV);
  const toCar = pivot.clone().sub(position);
  const carLocal = () => toCar.clone().applyQuaternion(quaternion.clone().invert());
  const correctPitch = () => {
    const local = carLocal();
    const pitchCorrection = excessAngle(Math.atan2(local.y, -local.z), pitchLimitRad);
    if (pitchCorrection !== 0) {
      quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, pitchCorrection));
    }
  };

  // Pitch first: a steep upward view can put the car behind the camera, where its yaw
  // is meaningless. Yawing moves the car vertically a little, so pitch is rechecked.
  correctPitch();
  const local = carLocal();
  const yawCorrection = -excessAngle(Math.atan2(local.x, -local.z), yawLimitRad);
  if (yawCorrection !== 0) {
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawCorrection));
    correctPitch();
  }

  return { position, quaternion };
}

/** How far `angle` lies outside [-limit, +limit], signed; 0 when inside. */
function excessAngle(angle: number, limit: number): number {
  if (angle > limit) return angle - limit;
  if (angle < -limit) return angle + limit;
  return 0;
}

/**
 * Rotates `current` towards `target` with exponential smoothing and a turn-rate cap,
 * so behaviour is identical at 60 Hz, 144 Hz and across dropped frames.
 */
export function smoothAim(
  current: THREE.Quaternion,
  target: THREE.Quaternion,
  rate: number,
  maxTurnRateRad: number,
  deltaTime: number
): THREE.Quaternion {
  const angle = current.angleTo(target);
  if (angle < 1e-6) return current.copy(target);
  const step = Math.min(angle * (1 - Math.exp(-rate * deltaTime)), maxTurnRateRad * deltaTime);
  return slerpAim(current, target, Math.min(step / angle, 1));
}

/**
 * Slerps `current` towards `target` by `t`. A slerp between two level aims banks the
 * horizon partway whenever both yaw and pitch change, so when both ends are level the
 * result is levelled around its own view direction. Aims aligned to a wall or the
 * ceiling slerp unchanged.
 */
export function slerpAim(current: THREE.Quaternion, target: THREE.Quaternion, t: number): THREE.Quaternion {
  const level = isLevelAim(current) && isLevelAim(target);
  current.slerp(target, t);
  if (!level) return current;

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(current);
  if (Math.abs(forward.y) > 0.999) return current;
  return current.copy(lookRotation(forward, WORLD_UP));
}

/** An aim with no roll: its right axis is horizontal and its up axis points upward. */
function isLevelAim(aim: THREE.Quaternion): boolean {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(aim);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(aim);
  return Math.abs(right.y) < 1e-4 && up.y > 0;
}
