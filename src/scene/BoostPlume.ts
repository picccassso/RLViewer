import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute float life;
  attribute float variant;
  uniform float viewportHeight;
  uniform vec2 nearFade;
  varying float vLife;
  varying float vAlpha;

  void main() {
    vec4 view = viewMatrix * vec4(position, 1.0);
    float distance = max(-view.z, 1.0);
    // Puffs swell as they leave the exhaust, each a little different.
    float size = mix(12.0, 46.0, sqrt(life)) * (0.75 + 0.5 * variant);
    gl_PointSize = min(size * projectionMatrix[1][1] * 0.5 * viewportHeight / distance, 256.0);
    gl_Position = projectionMatrix * view;

    vLife = life;
    vAlpha = pow(1.0 - life, 1.6) * (0.7 + 0.3 * variant);
    // Particles streaming back past the camera would blot out the screen.
    vAlpha *= smoothstep(nearFade.x, nearFade.y, distance);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  varying float vLife;
  varying float vAlpha;

  void main() {
    vec2 fromCentre = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(fromCentre, fromCentre);
    if (r2 > 1.0) discard;
    float soft = (1.0 - r2) * (1.0 - r2);
    // White-hot out of the exhaust, cooling to the team colour; brighter than white blooms.
    vec3 rgb = mix(vec3(1.0, 0.96, 0.88), color, smoothstep(0.0, 0.3, vLife));
    rgb *= mix(3.0, 1.2, smoothstep(0.0, 0.5, vLife));
    gl_FragColor = vec4(rgb, vAlpha * soft * 0.45);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const viewport = new THREE.Vector4();

/**
 * A car's boost plume: glowing puffs in world space, so at speed they stream back past
 * the camera. Refilled every frame from `push`, like `TrailRibbon`.
 */
export class BoostPlume {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly maxParticles: number;
  private readonly positions: Float32Array;
  private readonly lives: Float32Array;
  private readonly variants: Float32Array;
  private count = 0;

  constructor(maxParticles: number, color: THREE.Color) {
    this.maxParticles = maxParticles;
    this.positions = new Float32Array(maxParticles * 3);
    this.lives = new Float32Array(maxParticles);
    this.variants = new Float32Array(maxParticles);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', dynamicAttribute(this.positions, 3));
    geometry.setAttribute('life', dynamicAttribute(this.lives, 1));
    geometry.setAttribute('variant', dynamicAttribute(this.variants, 1));
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        color: { value: color.clone() },
        viewportHeight: { value: 1080 },
        nearFade: { value: new THREE.Vector2(40, 180) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, material);
    // The particles move every frame, so a stale bounding sphere would cull them wrongly.
    this.points.frustumCulled = false;
    this.points.visible = false;
    // Point sizes are in pixels of whatever target is being drawn to.
    this.points.onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(viewport);
      material.uniforms.viewportHeight.value = viewport.w;
    };
  }

  public clear() {
    this.count = 0;
  }

  /** Adds a particle; `life` runs 0 at the exhaust to 1 when it fades out. Returns false once full. */
  public push(x: number, y: number, z: number, life: number, variant: number): boolean {
    if (this.count >= this.maxParticles) return false;
    const i = this.count;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.lives[i] = life;
    this.variants[i] = variant;
    this.count++;
    return true;
  }

  /** Uploads the particles added since clear(). */
  public commit() {
    const { count } = this;
    const geometry = this.points.geometry;
    this.points.visible = count > 0;
    if (!count) return;
    for (const name of ['position', 'life', 'variant']) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    geometry.setDrawRange(0, count);
  }

  public dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

function dynamicAttribute(array: Float32Array, itemSize: number): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}
