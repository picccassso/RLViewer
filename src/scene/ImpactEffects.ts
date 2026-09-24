import * as THREE from 'three';
import { FrameState, ParsedReplayData } from '../types/replay';
import { buildImpacts, EmitImpactSprite, Impact, sampleImpacts } from '../math/impacts';
import { sampleFlipResetFlashes } from '../math/flipReset';

/** Most sprites on screen at once: a couple of overlapping hits and a demo. */
const MAX_SPRITES = 512;

const vertexShader = /* glsl */ `
  attribute vec2 corner;
  attribute vec3 spriteCentre;
  attribute vec3 spriteStreak;
  attribute float spriteSize;
  attribute vec3 spriteColor;
  attribute float spriteAlpha;
  attribute float spriteShape;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;

  void main() {
    vec3 toCamera = cameraPosition - spriteCentre;
    float distance = length(toCamera);
    toCamera /= max(distance, 1e-3);
    // Drawn a little towards the camera, so the ball or car at the contact doesn't cut it in half.
    vec3 centre = spriteCentre + toCamera * min(spriteSize * 0.5, 60.0);

    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    // Sparks stretch along their flight, facing the camera across it.
    float streak = length(spriteStreak);
    if (streak > 1e-3) {
      vec3 along = spriteStreak / streak;
      vec3 across = cross(along, toCamera);
      float acrossLength = length(across);
      if (acrossLength > 1e-4) {
        right = along * (0.5 * streak / spriteSize + 1.0);
        up = across / acrossLength;
      }
    }
    vec3 world = centre + (right * corner.x + up * corner.y) * spriteSize;

    vUv = corner;
    vColor = spriteColor;
    // Effects right on top of the camera would white out the screen.
    vAlpha = spriteAlpha * smoothstep(30.0, 140.0, distance);
    vShape = spriteShape;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;

  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float shape;
    if (vShape < 0.5) {
      shape = (1.0 - r * r) * (1.0 - r * r);
    } else if (vShape < 1.5) {
      float band = (r - 0.84) / 0.09;
      shape = exp(-band * band);
    } else {
      // A narrow, bright filament with pointed ends, rather than a stretched fuzzy blob.
      float taper = max(0.0, 1.0 - vUv.x * vUv.x);
      float width = abs(vUv.y) / max(0.15, taper);
      float core = exp(-width * width * 32.0);
      float halo = exp(-width * width * 5.0) * 0.22;
      shape = (core + halo) * taper;
    }
    gl_FragColor = vec4(vColor, vAlpha * shape);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Ball contact sparks, compact hit/reset flashes, and demolition fireballs.
 * All particles are sampled from replay time, like the trails.
 */
export class ImpactEffects {
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly centres = new Float32Array(MAX_SPRITES * 3);
  private readonly streaks = new Float32Array(MAX_SPRITES * 3);
  private readonly sizes = new Float32Array(MAX_SPRITES);
  private readonly colors = new Float32Array(MAX_SPRITES * 3);
  private readonly alphas = new Float32Array(MAX_SPRITES);
  private readonly shapes = new Float32Array(MAX_SPRITES);
  private impacts: Impact[] = [];
  private flipResets: number[][] = [];

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('spriteCentre', instanced(this.centres, 3));
    geometry.setAttribute('spriteStreak', instanced(this.streaks, 3));
    geometry.setAttribute('spriteSize', instanced(this.sizes, 1));
    geometry.setAttribute('spriteColor', instanced(this.colors, 3));
    geometry.setAttribute('spriteAlpha', instanced(this.alphas, 1));
    geometry.setAttribute('spriteShape', instanced(this.shapes, 1));
    geometry.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    // The sprites move every frame, so a stale bounding sphere would cull them wrongly.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  public setReplay(replayData: ParsedReplayData) {
    this.impacts = buildImpacts(replayData);
    this.flipResets = replayData.flipResets;
  }

  public update(state: FrameState) {
    let count = 0;
    const emit: EmitImpactSprite = (x, y, z, sx, sy, sz, size, r, g, b, alpha, shape) => {
      if (count >= MAX_SPRITES || alpha <= 0) return;
      const i3 = count * 3;
      this.centres[i3] = x; this.centres[i3 + 1] = y; this.centres[i3 + 2] = z;
      this.streaks[i3] = sx; this.streaks[i3 + 1] = sy; this.streaks[i3 + 2] = sz;
      this.colors[i3] = r; this.colors[i3 + 1] = g; this.colors[i3 + 2] = b;
      this.sizes[count] = size;
      this.alphas[count] = alpha;
      this.shapes[count] = shape;
      count++;
    };
    sampleFlipResetFlashes(this.flipResets, state, emit);
    sampleImpacts(this.impacts, state.time, emit);

    const geometry = this.mesh.geometry;
    geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (!count) return;
    for (const name of ['spriteCentre', 'spriteStreak', 'spriteSize', 'spriteColor', 'spriteAlpha', 'spriteShape']) {
      const attribute = geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  public dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.impacts = [];
    this.flipResets = [];
  }
}

function instanced(array: Float32Array, itemSize: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}
