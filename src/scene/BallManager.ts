import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const BALL_RADIUS = 92.75; // uu

const groundIndicatorVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Rocket League-style concentric ball ground indicator:
 * - Soft dark contact shadow directly under the ball (strongest when grounded)
 * - Crisp outer reference ring at ball radius with 4 cardinal tick marks
 * - Dynamic inner height ring that shrinks when the ball is high and expands
 *   outward to meet the outer ring right as the ball touches the turf
 */
const groundIndicatorFragmentShader = /* glsl */ `
  uniform float uHeightNorm;
  uniform vec3 uAccentColor;
  uniform float uGoalPulse;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // Soft ground shadow under the ball, strongest when close to the turf
    float shadowAlpha = smoothstep(0.76, 0.05, r) * mix(0.46, 0.14, uHeightNorm);

    // Outer reference ring at r = 0.74 (~1.04x BALL_RADIUS)
    float outerRadius = 0.74;
    float outerDist = abs(r - outerRadius);
    float outerRing = exp(- (outerDist * outerDist) / 0.00055);

    // 4 subtle cardinal ticks around the outer ring
    float absX = abs(p.x);
    float absY = abs(p.y);
    float onAxis = max(smoothstep(0.045, 0.01, absX), smoothstep(0.045, 0.01, absY));
    float tickBand = smoothstep(0.66, 0.70, r) * (1.0 - smoothstep(0.78, 0.83, r));
    float ticks = onAxis * tickBand * 0.55;

    // Inner height-gauge ring: expands to outerRadius as uHeightNorm -> 0 (touching ground)
    float innerRadius = mix(outerRadius, 0.14, pow(uHeightNorm, 0.75));
    float innerDist = abs(r - innerRadius);
    float innerRing = exp(- (innerDist * innerDist) / 0.00045) * smoothstep(0.01, 0.06, uHeightNorm);

    // Subtle glowing fill between center and inner ring when airborne
    float innerFill = smoothstep(innerRadius, 0.0, r) * 0.12 * uHeightNorm;

    float ringEnergy = clamp(outerRing * 0.9 + innerRing * 0.85 + ticks + innerFill, 0.0, 1.0);
    vec3 ringColor = mix(vec3(0.88, 0.96, 1.0), uAccentColor, 0.45 + 0.35 * uGoalPulse);
    ringColor *= 1.15 + 0.35 * uGoalPulse;

    vec3 finalRgb = mix(vec3(0.0), ringColor, ringEnergy);
    float finalAlpha = max(shadowAlpha, ringEnergy * 0.85);
    if (finalAlpha < 0.01) discard;

    gl_FragColor = vec4(finalRgb, finalAlpha);
  }
`;

export class BallManager {
  private scene: THREE.Scene;
  private ballGroup: THREE.Group;
  private ballMesh: THREE.Mesh;
  private groundIndicator: THREE.Mesh;
  private groundIndicatorUniforms: {
    uHeightNorm: { value: number };
    uAccentColor: { value: THREE.Color };
    uGoalPulse: { value: number };
  };
  private groundLine: THREE.Line;
  private isDisposed: boolean = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ballGroup = new THREE.Group();
    this.scene.add(this.ballGroup);

    // Procedural high-detail geodesic sports Ball
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 36, 36);
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas) {
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Metallic silver-grey geodesic shell
        const bgGrad = ctx.createLinearGradient(0, 0, 0, 512);
        bgGrad.addColorStop(0, '#d1d5db');
        bgGrad.addColorStop(0.5, '#f3f4f6');
        bgGrad.addColorStop(1, '#9ca3af');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, 1024, 512);

        // Dark recessed octagonal armor plates
        ctx.fillStyle = '#1f2937';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 10;
        const cols = 8;
        const rows = 4;
        const cellW = 1024 / cols;
        const cellH = 512 / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cx = (c + 0.5) * cellW;
            const cy = (r + 0.5) * cellH;
            if ((r + c) % 2 === 0) {
              ctx.beginPath();
              for (let a = 0; a < 6; a++) {
                const ang = (a * Math.PI) / 3;
                const px = cx + Math.cos(ang) * (cellW * 0.34);
                const py = cy + Math.sin(ang) * (cellH * 0.34);
                if (a === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
              }
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
        }

        // Glowing equatorial & meridian seams
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 8;
        for (let y = 0; y <= 512; y += 128) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(1024, y);
          ctx.stroke();
        }
        for (let x = 0; x <= 1024; x += 128) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 512);
          ctx.stroke();
        }

        // Glowing core indicator rings on both hemispheres
        for (const cx of [256, 768]) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 14;
          ctx.beginPath();
          ctx.arc(cx, 256, 86, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#e0f2fe';
          ctx.beginPath();
          ctx.arc(cx, 256, 22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const ballTex = canvas ? new THREE.CanvasTexture(canvas) : null;
    const ballMat = new THREE.MeshStandardMaterial({
      map: ballTex,
      metalness: 0.68,
      roughness: 0.22,
      envMapIntensity: 1.35,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.18,
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
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat && mat.isMeshStandardMaterial) {
                mat.roughness = Math.min(mat.roughness, 0.32);
                mat.metalness = Math.max(mat.metalness, 0.55);
                mat.envMapIntensity = 1.4;
                mat.needsUpdate = true;
              }
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

    // Concentric Ground Indicator (projected on turf directly below the ball)
    this.groundIndicatorUniforms = {
      uHeightNorm: { value: 0 },
      uAccentColor: { value: new THREE.Color(0x38bdf8) },
      uGoalPulse: { value: 0 },
    };
    const indicatorSize = BALL_RADIUS * 2.75;
    const ringGeo = new THREE.PlaneGeometry(indicatorSize, indicatorSize);
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: groundIndicatorVertexShader,
      fragmentShader: groundIndicatorFragmentShader,
      uniforms: this.groundIndicatorUniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.groundIndicator = new THREE.Mesh(ringGeo, ringMat);
    this.groundIndicator.rotation.x = -Math.PI / 2;
    this.groundIndicator.position.y = 2.5;
    this.scene.add(this.groundIndicator);

    // Vertical line connecting ball to ground
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 2.5, 0),
      new THREE.Vector3(0, BALL_RADIUS, 0),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.28,
    });
    this.groundLine = new THREE.Line(lineGeo, lineMat);
    this.scene.add(this.groundLine);
  }

  public update(
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number }
  ) {
    this.ballGroup.position.set(position.x, position.y, position.z);
    this.ballMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    // Ground indicator is always visible on the pitch, expanding/contracting its inner ring with height
    this.groundIndicator.position.set(position.x, 2.5, position.z);
    this.groundIndicator.visible = true;

    const altitude = Math.max(0, position.y - BALL_RADIUS);
    const heightRatio = Math.min(altitude / 1500, 1);
    this.groundIndicatorUniforms.uHeightNorm.value = heightRatio;

    // Tint and pulse when the ball is deep in either goal zone
    const goalProximity = Math.max(0, Math.min(1, (Math.abs(position.z) - 3600) / 1520));
    this.groundIndicatorUniforms.uGoalPulse.value = goalProximity;
    if (position.z < -3600) {
      this.groundIndicatorUniforms.uAccentColor.value.setHex(0x3b9cff);
    } else if (position.z > 3600) {
      this.groundIndicatorUniforms.uAccentColor.value.setHex(0xff8a1f);
    } else {
      this.groundIndicatorUniforms.uAccentColor.value.setHex(0x38bdf8);
    }

    const isAirborne = position.y > BALL_RADIUS + 5;
    this.groundLine.visible = isAirborne;

    if (isAirborne) {
      // Update vertical line positions
      const linePositions = new Float32Array([
        position.x, 2.5, position.z,
        position.x, Math.max(2.5, position.y - BALL_RADIUS * 0.85), position.z,
      ]);
      this.groundLine.geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    }
  }

  public getPosition(): THREE.Vector3 {
    return this.ballGroup.position;
  }

  public dispose() {
    this.isDisposed = true;
    this.scene.remove(this.ballGroup);
    this.scene.remove(this.groundIndicator);
    this.scene.remove(this.groundLine);

    this.groundIndicator.geometry.dispose();
    (this.groundIndicator.material as THREE.Material).dispose();
    this.groundLine.geometry.dispose();
    (this.groundLine.material as THREE.Material).dispose();
  }
}
