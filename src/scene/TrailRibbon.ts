import * as THREE from 'three';

/** Points closer than this to the previous one are dropped: they add nothing and have no direction. */
const MIN_POINT_SPACING = 1; // uu

const vertexShader = /* glsl */ `
  attribute float side;
  attribute vec3 trailDirection;
  attribute float trailAlpha;
  attribute float trailHalfWidth;
  uniform float faceCamera;
  uniform vec2 nearFade;
  varying float vAlpha;
  varying float vSide;

  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    // Widen across the path, facing the camera, or flat on the floor.
    vec3 facing = faceCamera > 0.5 ? normalize(cameraPosition - world) : vec3(0.0, 1.0, 0.0);
    vec3 across = cross(trailDirection, facing);
    float acrossLength = length(across);
    across = acrossLength > 1e-5 ? across / acrossLength : vec3(0.0);
    world += across * side * trailHalfWidth;

    vAlpha = trailAlpha;
    // A trail running back past the camera would smear across the screen.
    if (faceCamera > 0.5) vAlpha *= smoothstep(nearFade.x, nearFade.y, distance(cameraPosition, world));
    vSide = side;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float intensity;
  varying float vAlpha;
  varying float vSide;

  void main() {
    float fromCentre = abs(vSide);
    float edge = 1.0 - smoothstep(0.4, 1.0, fromCentre);
    // A hotter, whiter core keeps the trail readable against any background.
    vec3 rgb = mix(color, vec3(1.0), 0.35 * (1.0 - fromCentre)) * intensity;
    gl_FragColor = vec4(rgb, vAlpha * edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface TrailRibbonOptions {
  maxPoints: number;
  /** 'camera' turns the ribbon to face the viewer; 'up' lays it flat on the floor. */
  facing: 'camera' | 'up';
  color: THREE.Color;
  /** Above 1 the trail is brighter than white and blooms. */
  intensity: number;
}

/**
 * A soft-edged strip along a path of points, each with its own opacity and half width.
 * The strip is widened in the vertex shader, so it stays facing the camera without being rebuilt
 * when only the camera moves.
 */
export class TrailRibbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly maxPoints: number;
  private readonly centres: Float32Array;
  private readonly directions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly halfWidths: Float32Array;
  private count = 0;
  private anyVisible = false;

  constructor({ maxPoints, facing, color, intensity }: TrailRibbonOptions) {
    this.maxPoints = maxPoints;
    // Two vertices per point, one either side of the path.
    const vertices = maxPoints * 2;
    this.centres = new Float32Array(vertices * 3);
    this.directions = new Float32Array(vertices * 3);
    this.alphas = new Float32Array(vertices);
    this.halfWidths = new Float32Array(vertices);
    const sides = new Float32Array(vertices);
    for (let v = 0; v < vertices; v++) sides[v] = v % 2 === 0 ? -1 : 1;

    const indices: number[] = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', dynamicAttribute(this.centres, 3));
    geometry.setAttribute('trailDirection', dynamicAttribute(this.directions, 3));
    geometry.setAttribute('trailAlpha', dynamicAttribute(this.alphas, 1));
    geometry.setAttribute('trailHalfWidth', dynamicAttribute(this.halfWidths, 1));
    geometry.setAttribute('side', new THREE.BufferAttribute(sides, 1));
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        color: { value: color.clone() },
        intensity: { value: intensity },
        faceCamera: { value: facing === 'camera' ? 1 : 0 },
        nearFade: { value: new THREE.Vector2(150, 700) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Keeps floor trails from flickering into the turf far from the camera.
      polygonOffset: facing === 'up',
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    // The path changes every frame, so a stale bounding sphere would cull it wrongly.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  public setColor(color: THREE.Color) {
    (this.mesh.material.uniforms.color.value as THREE.Color).copy(color);
  }

  /** Starts a new path. */
  public clear() {
    this.count = 0;
    this.anyVisible = false;
  }

  /** Adds the next point along the path. Returns false once the ribbon is full. */
  public push(x: number, y: number, z: number, alpha: number, halfWidth: number): boolean {
    if (this.count >= this.maxPoints) return false;
    if (this.count > 0) {
      const p = (this.count - 1) * 6;
      const c = this.centres;
      if (Math.hypot(x - c[p], y - c[p + 1], z - c[p + 2]) < MIN_POINT_SPACING) return true;
    }
    const v = this.count * 2;
    for (let side = 0; side < 2; side++) {
      const i = (v + side) * 3;
      this.centres[i] = x;
      this.centres[i + 1] = y;
      this.centres[i + 2] = z;
      this.alphas[v + side] = alpha;
      this.halfWidths[v + side] = halfWidth;
    }
    if (alpha > 0) this.anyVisible = true;
    this.count++;
    return true;
  }

  /** Uploads the path added since clear(). */
  public commit() {
    const { count, centres, directions } = this;
    const geometry = this.mesh.geometry;
    this.mesh.visible = count >= 2 && this.anyVisible;
    if (!this.mesh.visible) return;

    for (let i = 0; i < count; i++) {
      const previous = Math.max(i - 1, 0) * 6;
      const next = Math.min(i + 1, count - 1) * 6;
      for (let axis = 0; axis < 3; axis++) {
        const d = centres[next + axis] - centres[previous + axis];
        directions[i * 6 + axis] = d;
        directions[i * 6 + 3 + axis] = d;
      }
    }

    const vertices = count * 2;
    for (const name of ['position', 'trailDirection', 'trailAlpha', 'trailHalfWidth']) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, vertices * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    geometry.setDrawRange(0, (count - 1) * 6);
  }

  public dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function dynamicAttribute(array: Float32Array, itemSize: number): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}
