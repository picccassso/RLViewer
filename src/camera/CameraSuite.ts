import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CameraSettings,
  DEFAULT_CAMERA_SETTINGS,
  computeHorizonLockedCarCam,
  computeBallCam,
  blendCamera,
  rlFovToThreeVerticalFov
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
  private currentCamPos: THREE.Vector3 = new THREE.Vector3(0, 300, -1000);
  private currentCamQuat: THREE.Quaternion = new THREE.Quaternion();
  private directorCamPos: THREE.Vector3 = new THREE.Vector3(0, 1200, -3500);
  private ballCamOrbitYaw: number = 0;
  private hasBallCamOrbitYaw: boolean = false;

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
      this.hasBallCamOrbitYaw = false;
    }
    this.activePlayerIndex = playerIndex;
    if (playerSettings) {
      this.applySettings(playerSettings);
    }
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
    const carSpeed = new THREE.Vector3(
      playerState.velocity.x,
      playerState.velocity.y,
      playerState.velocity.z
    ).length();

    // Determine target BallCam state (manual override or replay recorded state)
    const targetBallCam = this.ballCamManualOverride !== null
      ? this.ballCamManualOverride
      : playerState.ballCamActive;

    // Smoothstep transition slerp: tau = 0.5 / TransitionSpeed seconds
    const transSpeed = Math.max(0.2, this.currentSettings.transition_speed || 1.3);
    const tau = 0.5 / transSpeed;
    const blendRate = deltaTime / tau;

    if (targetBallCam) {
      this.ballCamBlend = Math.min(1.0, this.ballCamBlend + blendRate);
    } else {
      this.ballCamBlend = Math.max(0.0, this.ballCamBlend - blendRate);
    }

    // Compute Car Cam with Horizon-Locked roll stability
    const carCam = computeHorizonLockedCarCam(carPos, carQuat, this.currentSettings, carSpeed);

    // Track a persistent orbit around the player. Directly rebuilding this
    // direction from ball-to-car every frame makes it reverse by 180 degrees
    // when the ball crosses overhead. Rate-limiting the shortest yaw arc keeps
    // the player framed while reproducing Rocket League's camera swivel.
    const ballToCarGround = new THREE.Vector3(
      carPos.x - ballPos.x,
      0,
      carPos.z - ballPos.z
    );
    if (ballToCarGround.lengthSq() > 25) {
      const desiredYaw = Math.atan2(ballToCarGround.z, ballToCarGround.x);
      if (!this.hasBallCamOrbitYaw) {
        this.ballCamOrbitYaw = desiredYaw;
        this.hasBallCamOrbitYaw = true;
      } else {
        const yawDelta = Math.atan2(
          Math.sin(desiredYaw - this.ballCamOrbitYaw),
          Math.cos(desiredYaw - this.ballCamOrbitYaw)
        );
        const swivelSpeed = Math.max(1, this.currentSettings.swivel_speed || 5);
        const swivelRate = 8 + swivelSpeed * 3;
        this.ballCamOrbitYaw += yawDelta * (1 - Math.exp(-swivelRate * deltaTime));
      }
    }
    const ballCamOrbitDirection = new THREE.Vector3(
      Math.cos(this.ballCamOrbitYaw),
      0,
      Math.sin(this.ballCamOrbitYaw)
    );

    // Compute BallCam with Overhead Singularity Clamping (<= 82 deg)
    const ballCam = computeBallCam(
      carPos,
      ballPos,
      this.currentSettings,
      carSpeed,
      ballCamOrbitDirection
    );

    // Slerp blend between Car Cam and Ball Cam
    const blended = blendCamera(carCam, ballCam, this.ballCamBlend);

    // Apply stiffness interpolation: stiffness 0.0 (loose lag) to 1.0 (rigid lock)
    const stiffness = Math.min(Math.max(this.currentSettings.stiffness || 0.45, 0), 1);
    // Exponential damping is stable across 60 Hz, high-refresh displays, and
    // the occasional long frame; a linear k * dt factor changes the feel with
    // render cadence and makes dropped frames visible as camera bumps.
    const posLerpRate = 1 - Math.exp(-(15 + stiffness * 45) * deltaTime);
    const rotSlerpRate = 1 - Math.exp(-(18 + stiffness * 42) * deltaTime);

    this.currentCamPos.lerp(blended.position, posLerpRate);
    this.currentCamQuat.slerp(blended.quaternion, rotSlerpRate);

    this.camera.position.copy(this.currentCamPos);
    this.camera.quaternion.copy(this.currentCamQuat);
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
