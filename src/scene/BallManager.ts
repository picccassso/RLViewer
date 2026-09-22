import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const BALL_RADIUS = 92.75; // uu

export class BallManager {
  private scene: THREE.Scene;
  private ballGroup: THREE.Group;
  private ballMesh: THREE.Mesh;
  private groundIndicator: THREE.Mesh;
  private groundLine: THREE.Line;
  private trailMesh: THREE.Line;
  private trailPositions: THREE.Vector3[] = [];
  private readonly maxTrailPoints = 40;
  private isDisposed: boolean = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ballGroup = new THREE.Group();
    this.scene.add(this.ballGroup);

    // Procedural high-detail Rocket League Ball
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas) {
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(0, 0, 1024, 512);

        // Dark carbon fiber panels & glowing seams
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 12;
        for (let y = 0; y < 512; y += 64) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(1024, y);
          ctx.stroke();
        }
        for (let x = 0; x < 1024; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 512);
          ctx.stroke();
        }

        // Glowing cyan center emblem ring
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(512, 256, 120, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const ballTex = canvas ? new THREE.CanvasTexture(canvas) : null;
    const ballMat = new THREE.MeshStandardMaterial({
      map: ballTex,
      metalness: 0.6,
      roughness: 0.25,
      emissive: 0x0088ff,
      emissiveIntensity: 0.15,
    });

    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.ballMesh.receiveShadow = true;
    this.ballMesh.position.set(0, 0, 0);
    this.ballGroup.add(this.ballMesh);

    // Load custom GLTF model if available
    try {
      const gltfLoader = new GLTFLoader();
      gltfLoader.load(
        '/models/ball/scene.gltf',
        (gltf) => {
          const model = gltf.scene;
          // Scale to 92.75 radius
          const bbox = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) {
            const s = (BALL_RADIUS * 2) / maxDim;
            model.scale.set(s, s, s);
          }
          model.position.set(0, 0, 0);
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          if (this.isDisposed) return;
          this.ballMesh.visible = false;
          this.ballMesh = model as unknown as THREE.Mesh;
          this.ballGroup.add(model);
          console.log('[BallManager] Custom 3D Ball model loaded');
        },
        undefined,
        (err) => {
          console.warn('[BallManager] Failed to load custom 3D ball model:', err);
          // Keeps procedural high-detail ball
        }
      );
    } catch (err) {
      console.warn('[BallManager] GLTF ball loader exception:', err);
      // Keeps procedural high-detail ball
    }

    // Ground Indicator (ring projected on turf directly below the ball)
    const ringGeo = new THREE.RingGeometry(BALL_RADIUS * 0.7, BALL_RADIUS * 0.9, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    this.groundIndicator = new THREE.Mesh(ringGeo, ringMat);
    this.groundIndicator.rotation.x = -Math.PI / 2;
    this.groundIndicator.position.y = 2;
    this.scene.add(this.groundIndicator);

    // Vertical line connecting ball to ground
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(0, BALL_RADIUS, 0),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
    });
    this.groundLine = new THREE.Line(lineGeo, lineMat);
    this.scene.add(this.groundLine);

    // Trajectory trail
    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.55,
      linewidth: 2,
    });
    this.trailMesh = new THREE.Line(trailGeo, trailMat);
    this.scene.add(this.trailMesh);
  }

  public update(
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number }
  ) {
    this.ballGroup.position.set(position.x, position.y, position.z);
    this.ballMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    // Ground indicator
    this.groundIndicator.position.set(position.x, 2, position.z);
    const isAirborne = position.y > BALL_RADIUS + 5;
    this.groundIndicator.visible = isAirborne;
    this.groundLine.visible = isAirborne;

    if (isAirborne) {
      // Scale indicator ring based on height
      const heightRatio = Math.min(position.y / 1500, 1);
      const ringScale = 1.0 + heightRatio * 0.6;
      this.groundIndicator.scale.set(ringScale, ringScale, 1);

      // Update vertical line positions
      const linePositions = new Float32Array([
        position.x, 2, position.z,
        position.x, position.y, position.z,
      ]);
      this.groundLine.geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    }

    // Trajectory trail
    const currentPos = new THREE.Vector3(position.x, position.y, position.z);
    this.trailPositions.push(currentPos);
    if (this.trailPositions.length > this.maxTrailPoints) {
      this.trailPositions.shift();
    }

    if (this.trailPositions.length > 1) {
      const trailPoints = new Float32Array(this.trailPositions.length * 3);
      for (let i = 0; i < this.trailPositions.length; i++) {
        trailPoints[i * 3 + 0] = this.trailPositions[i].x;
        trailPoints[i * 3 + 1] = this.trailPositions[i].y;
        trailPoints[i * 3 + 2] = this.trailPositions[i].z;
      }
      this.trailMesh.geometry.setAttribute('position', new THREE.BufferAttribute(trailPoints, 3));
      this.trailMesh.geometry.attributes.position.needsUpdate = true;
    }
  }

  public resetTrail() {
    this.trailPositions = [];
  }

  public getPosition(): THREE.Vector3 {
    return this.ballGroup.position;
  }

  public dispose() {
    this.isDisposed = true;
    this.scene.remove(this.ballGroup);
    this.scene.remove(this.groundIndicator);
    this.scene.remove(this.groundLine);
    this.scene.remove(this.trailMesh);

    this.groundIndicator.geometry.dispose();
    (this.groundIndicator.material as THREE.Material).dispose();
    this.groundLine.geometry.dispose();
    (this.groundLine.material as THREE.Material).dispose();
    this.trailMesh.geometry.dispose();
    (this.trailMesh.material as THREE.Material).dispose();
  }
}
