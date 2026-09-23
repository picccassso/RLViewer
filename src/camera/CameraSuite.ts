import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BALL_CAM_VIEW_PITCH_SHARE,
  CameraSettings,
  DEFAULT_CAMERA_SETTINGS,
  computeBallCamAim,
  computeCarCamAim,
  getSpeedDistanceMultiplier,
  placeBoomCamera,
  rlFovToThreeVerticalFov,
  smoothAim,
  trackCarHeading
} from '../math/cameraMath';
import { FrameState } from '../types/replay';

export type CameraMode = 'pov' | 'director' | 'free' | 'tactical';

export class CameraSuite {
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls;
  public mode: CameraMode = 'pov';
  public activePlayerIndex: number = 0;
  public ballCamManualOverride: boolean | null = null; // null = use recorded state, true/false = manual override
  public currentSettings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS };

  private domElement: HTMLElement;
  private ballCamBlend: number = 1.0; // 0 = CarCam, 1 = BallCam
  private directorCamPos: THREE.Vector3 = new THREE.Vector3(0, 1200, -3500);
  // POV boom rig: a smoothed aim orientation around the car's live position
  private aim: THREE.Quaternion = new THREE.Quaternion();
  private carHeading: THREE.Vector3 = new THREE.Vector3(1, 0, 0);
  private distanceMultiplier: number = 1;
  private lastCarPos: THREE.Vector3 = new THREE.Vector3();
  private hasLastCarPos: boolean = false;
  private needsSnap: boolean = true;

  constructor(domElement: HTMLElement, aspect: number) {
    this.domElement = domElement;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 10, 50000);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 15000;
    this.controls.minDistance = 50;
    this.controls.enabled = false;

    this.applySettings(this.currentSettings);
  }

  public setMode(mode: CameraMode) {
    if (this.mode !== mode) {
      this.needsSnap = true;
    }
    this.mode = mode;
    if (mode === 'free') {
      this.controls.enabled = true;
    } else {
      this.controls.enabled = false;
    }

    if (mode === 'tactical') {
      this.camera.position.set(0, 4200, 0);
      this.camera.lookAt(0, 0, 0);
    }
  }

  public setPlayer(playerIndex: number, playerSettings?: CameraSettings) {
    if (this.activePlayerIndex !== playerIndex) {
      this.needsSnap = true;
    }
    this.activePlayerIndex = playerIndex;
    if (playerSettings) {
      this.applySettings(playerSettings);
    }
  }

  public snap() {
    this.needsSnap = true;
  }

  public toggleBallCam() {
    if (this.ballCamManualOverride === null) {
      this.ballCamManualOverride = false;
    } else {
      this.ballCamManualOverride = !this.ballCamManualOverride;
    }
  }

  public setBallCam(enabled: boolean | null) {
    this.ballCamManualOverride = enabled;
  }

  public applySettings(settings: Partial<CameraSettings>) {
    this.currentSettings = { ...this.currentSettings, ...settings };
    this.camera.fov = rlFovToThreeVerticalFov(this.currentSettings.fov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  public handleResize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.fov = rlFovToThreeVerticalFov(this.currentSettings.fov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  public update(frameState: FrameState, deltaTime: number = 0.016) {
    if (this.mode === 'free') {
      this.controls.update();
      return;
    }

    if (this.mode === 'tactical') {
      // Keep overhead locked
      this.camera.position.set(0, 4200, 0);
      this.camera.lookAt(0, 0, 0);
      return;
    }

    const ballPos = new THREE.Vector3(
      frameState.ball.position.x,
      frameState.ball.position.y,
      frameState.ball.position.z
    );

    if (this.mode === 'director') {
      this.updateDirectorCam(frameState, ballPos, deltaTime);
      return;
    }

    // Mode is 'pov'
    const playerState = frameState.players[this.activePlayerIndex] || frameState.players[0];
    if (!playerState) return;
    // Hold the last view while the car is demolished; the respawn jump snaps it back.
    if (!playerState.isPresent || playerState.isDemoed) return;

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

    // Determine target BallCam state (manual override or replay recorded state)
    const targetBallCam = this.ballCamManualOverride !== null
      ? this.ballCamManualOverride
      : playerState.ballCamActive;

    // Linear blend over tau = 0.5 / TransitionSpeed seconds, eased with smoothstep below
    const transSpeed = Math.max(0.2, this.currentSettings.transition_speed || 1.3);
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
    const targetAim = carAim.clone().slerp(ballCam.aim, ballCamWeight);

    // Car Cam follows the car nearly rigidly. Ball Cam is looser, and slower still
    // while the ball is close, where its direction swings fastest.
    const stiffness = Math.min(Math.max(this.currentSettings.stiffness ?? 0.45, 0), 1);
    const carRate = 12 + 12 * stiffness;
    const ballRate = 9 * Math.min(Math.max(ballCam.horizontalDistance / 700, 0.25), 1);
    const rate = carRate + (ballRate - carRate) * ballCamWeight;
    const maxTurnRate = THREE.MathUtils.degToRad(720 + (300 - 720) * ballCamWeight);

    const speedStretch = getSpeedDistanceMultiplier(carVel.length(), stiffness);
    if (this.needsSnap) {
      this.aim.copy(targetAim);
      this.distanceMultiplier = speedStretch;
      this.needsSnap = false;
    } else {
      smoothAim(this.aim, targetAim, rate, maxTurnRate, deltaTime);
      this.distanceMultiplier += (speedStretch - this.distanceMultiplier) * (1 - Math.exp(-3 * deltaTime));
    }

    // On the turf a high ball tilts the view so the camera keeps its height. In the air
    // the boom swings fully round the car, keeping it locked on screen for aerials.
    const groundedWeight = 1 - Math.min(Math.max((carPos.y - 60) / 200, 0), 1);
    const placed = placeBoomCamera(
      carPos,
      this.aim,
      this.currentSettings,
      this.distanceMultiplier,
      this.camera.aspect,
      BALL_CAM_VIEW_PITCH_SHARE * ballCamWeight * groundedWeight
    );
    this.camera.position.copy(placed.position);
    this.camera.quaternion.copy(placed.quaternion);
  }

  private updateDirectorCam(frameState: FrameState, ballPos: THREE.Vector3, deltaTime: number) {
    // Director cam follows the ball from an elevated broadcast angle,
    // positioning itself dynamically behind the attacking offensive player
    let bestAttackerPos = new THREE.Vector3(0, 0, 0);
    let minBallDist = Infinity;

    for (const p of frameState.players) {
      if (!p.isPresent || p.isDemoed) continue;
      const pPos = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
      const d = pPos.distanceTo(ballPos);
      if (d < minBallDist) {
        minBallDist = d;
        bestAttackerPos.copy(pPos);
      }
    }

    // Vector from ball to offensive player
    const attackDir = new THREE.Vector3().subVectors(bestAttackerPos, ballPos).normalize();
    if (attackDir.lengthSq() < 1e-3) attackDir.set(0, 0, 1);

    // Camera target position: behind action, elevated
    const targetPos = ballPos.clone()
      .add(attackDir.multiplyScalar(900))
      .add(new THREE.Vector3(0, 450, 0));

    // Clamp inside arena ceiling
    if (targetPos.y > 1800) targetPos.y = 1800;
    if (targetPos.y < 80) targetPos.y = 80;

    this.directorCamPos.lerp(targetPos, deltaTime * 3.5);
    this.camera.position.copy(this.directorCamPos);

    // Look slightly ahead of the ball
    const lookTarget = ballPos.clone().add(new THREE.Vector3(0, 40, 0));
    this.camera.lookAt(lookTarget);
  }

  public dispose() {
    this.controls.dispose();
  }
}
