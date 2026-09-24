import * as THREE from 'three';
import {
  CameraSettings,
  computeBallCamAim,
  computeBallCamOrbit,
  computeCarCamAim,
  getSpeedDistanceMultiplier,
  placeBoomCamera,
  slerpAim,
  springAim,
  trackCarHeading
} from '../math/cameraMath';
import { FrameState } from '../types/replay';

export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/**
 * The POV (player view) camera: a boom arm around the followed car, aimed by Car Cam
 * or Ball Cam. Holds the smoothing state between frames and has no DOM dependencies,
 * so it runs the same in the viewer and in Node tests.
 */
export class PovCameraRig {
  /** Car being followed on the last update, or null while it is missing or demolished. */
  public followTarget: THREE.Vector3 | null = null;

  private ballCamBlend: number = 1.0; // 0 = CarCam, 1 = BallCam
  // A smoothed aim orientation around the car's live position
  private aim: THREE.Quaternion = new THREE.Quaternion();
  private aimVelocity: THREE.Vector3 = new THREE.Vector3();
  private carHeading: THREE.Vector3 = new THREE.Vector3(1, 0, 0);
  private distanceMultiplier: number = 1;
  private orbit: number = 0;
  private lastCarPos: THREE.Vector3 = new THREE.Vector3();
  private hasLastCarPos: boolean = false;
  private needsSnap: boolean = true;

  /** Jump straight to the target view on the next update, without smoothing. */
  public snap() {
    this.needsSnap = true;
  }

  /**
   * Advances the rig by `deltaTime` seconds. Returns the camera pose, or null to hold
   * the previous view (the followed car is missing or demolished).
   *
   * `ballCamOverride` forces Ball Cam on or off; null follows the replay's recorded state.
   */
  public update(
    frameState: FrameState,
    playerIndex: number,
    settings: CameraSettings,
    aspect: number,
    ballCamOverride: boolean | null,
    deltaTime: number
  ): CameraPose | null {
    const playerState = frameState.players[playerIndex] || frameState.players[0];
    if (!playerState) return null;
    // Hold the last view while the car is demolished; the respawn jump snaps it back.
    if (!playerState.isPresent || playerState.isDemoed) {
      this.followTarget = null;
      return null;
    }

    const ballPos = new THREE.Vector3(
      frameState.ball.position.x,
      frameState.ball.position.y,
      frameState.ball.position.z
    );
    const carPos = new THREE.Vector3(
      playerState.position.x,
      playerState.position.y,
      playerState.position.z
    );
    const carQuat = new THREE.Quaternion(
      playerState.rotation.x,
      playerState.rotation.y,
      playerState.rotation.z,
      playerState.rotation.w
    );

    if (this.hasLastCarPos && this.lastCarPos.distanceToSquared(carPos) > 600 * 600) {
      this.snap();
    }
    this.lastCarPos.copy(carPos);
    this.hasLastCarPos = true;
    this.followTarget = this.lastCarPos;

    // Determine target BallCam state (manual override or replay recorded state)
    const targetBallCam = ballCamOverride !== null ? ballCamOverride : playerState.ballCamActive;

    // Linear blend over tau = 0.5 / TransitionSpeed seconds, eased with smoothstep below
    const transSpeed = Math.max(0.2, settings.transition_speed || 1.3);
    const blendStep = deltaTime / (0.5 / transSpeed);
    if (this.needsSnap) {
      this.ballCamBlend = targetBallCam ? 1 : 0;
    } else if (targetBallCam) {
      this.ballCamBlend = Math.min(1.0, this.ballCamBlend + blendStep);
    } else {
      this.ballCamBlend = Math.max(0.0, this.ballCamBlend - blendStep);
    }
    const ballCamWeight = this.ballCamBlend * this.ballCamBlend * (3 - 2 * this.ballCamBlend);

    const carVel = new THREE.Vector3(playerState.velocity.x, playerState.velocity.y, playerState.velocity.z);
    const heading = trackCarHeading(this.needsSnap ? undefined : this.carHeading, carPos, carQuat, carVel, deltaTime);
    this.carHeading.copy(heading);

    const carAim = computeCarCamAim(carPos, carQuat, heading);
    const ballCam = computeBallCamAim(carPos, ballPos, heading);
    const targetAim = slerpAim(carAim.clone(), ballCam.aim, ballCamWeight);

    // Car Cam follows the car nearly rigidly. Ball Cam is looser, and slower still
    // while the ball is close, where its direction swings fastest.
    const stiffness = Math.min(Math.max(settings.stiffness ?? 0.45, 0), 1);
    const carRate = 12 + 12 * stiffness;
    const ballRate = 9 * Math.min(Math.max(ballCam.horizontalDistance / 700, 0.25), 1);
    const rate = carRate + (ballRate - carRate) * ballCamWeight;
    const maxTurnRate = THREE.MathUtils.degToRad(720 + (300 - 720) * ballCamWeight);

    const speedStretch = getSpeedDistanceMultiplier(carVel.length(), stiffness);
    const snapped = this.needsSnap;
    if (this.needsSnap) {
      this.aim.copy(targetAim);
      this.aimVelocity.set(0, 0, 0);
      this.distanceMultiplier = speedStretch;
      this.needsSnap = false;
    } else {
      springAim(this.aim, this.aimVelocity, targetAim, rate, maxTurnRate, deltaTime);
      this.distanceMultiplier += (speedStretch - this.distanceMultiplier) * (1 - Math.exp(-3 * deltaTime));
    }

    // Ball Cam's upward aim tilts the view rather than swinging the boom under the car,
    // so the camera keeps its height behind the car on the turf and in the air. Only a
    // ball that would still sit too high on screen swings the boom under the car. It is
    // measured from the aim the camera is turning to: mid-swing, with the ball still
    // behind the view, the boom would otherwise dive under the car and climb back out.
    const orbit = ballCamWeight > 0
      ? computeBallCamOrbit(carPos, ballPos, targetAim, settings, this.distanceMultiplier, aspect, ballCamWeight)
      : { orbitRad: 0, maxOrbitRad: 0 };
    const targetOrbit = ballCamWeight * orbit.orbitRad;
    this.orbit = snapped ? targetOrbit : this.orbit + (targetOrbit - this.orbit) * (1 - Math.exp(-rate * deltaTime));
    // The floor blocks the swing at once rather than being eased into.
    this.orbit = Math.min(this.orbit, ballCamWeight * orbit.maxOrbitRad);
    return placeBoomCamera(carPos, this.aim, settings, this.distanceMultiplier, aspect, ballCamWeight, this.orbit);
  }
}
