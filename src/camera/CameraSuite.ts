import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CameraSettings,
  DEFAULT_CAMERA_SETTINGS,
  rlFovToThreeVerticalFov
} from '../math/cameraMath';
import { FrameState } from '../types/replay';
import { PovCameraRig } from './PovCameraRig';

export type CameraMode = 'pov' | 'director' | 'free' | 'tactical';

export class CameraSuite {
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls;
  public mode: CameraMode = 'pov';
  public activePlayerIndex: number = 0;
  public ballCamManualOverride: boolean | null = null; // null = use recorded state, true/false = manual override
  public currentSettings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS };
  /** Car the POV camera is following, or null in the other modes. */
  public followTarget: THREE.Vector3 | null = null;

  private domElement: HTMLElement;
  private directorCamPos: THREE.Vector3 = new THREE.Vector3(0, 1200, -3500);
  private pov: PovCameraRig = new PovCameraRig();

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
      this.pov.snap();
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
      this.pov.snap();
    }
    this.activePlayerIndex = playerIndex;
    if (playerSettings) {
      this.applySettings(playerSettings);
    }
  }

  public snap() {
    this.pov.snap();
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
    if (this.mode !== 'pov') this.followTarget = null;

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
    const pose = this.pov.update(
      frameState,
      this.activePlayerIndex,
      this.currentSettings,
      this.camera.aspect,
      this.ballCamManualOverride,
      deltaTime
    );
    this.followTarget = this.pov.followTarget;
    if (!pose) return;
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
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
