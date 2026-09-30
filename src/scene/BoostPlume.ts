import * as THREE from 'three';

/** Alpha Boost (Gold Rush) signature gold. */
export const ALPHA_BOOST_COLOR = new THREE.Color(0xffc21a);

/**
 * Alpha Boost's plume is mostly a dense stream of fine glittering gold specks in a soft
 * golden haze, with a few larger gold flakes tumbling out of it. A particle's `variant`
 * (stable random 0..1) picks which it is:
 * - below GLITTER_SHARE: a tiny speck that twinkles,
 * - up to FLAKE_FROM: a soft haze puff that swells and cools to amber smoke,
 * - above: a flake that spins, flashes as it turns, and falls.
 */
const GLITTER_SHARE = '0.66';
const FLAKE_FROM = '0.97';

const vertexShader = /* glsl */ `
  attribute float life;
  attribute float variant;
  uniform float viewportHeight;
  uniform float lifeSeconds;
  varying float vLife;
  varying float vAlpha;
  varying float vVariant;
  varying float vKind;
  varying float vSpin;

  void main() {
    float age = life * lifeSeconds;
    float kind = variant < ${GLITTER_SHARE} ? 0.0 : (variant < ${FLAKE_FROM} ? 1.0 : 2.0);
    // Specks settle a little, flakes fall.
    float fall = kind == 2.0 ? 325.0 : (kind == 0.0 ? 60.0 : -40.0);
    vec3 world = position - vec3(0.0, fall * age * age, 0.0);
    vec4 view = viewMatrix * vec4(world, 1.0);
    float distance = max(-view.z, 1.0);

    float size;
    float alpha;
    vec2 nearFade;
    if (kind == 0.0) {
      size = mix(4.2, 2.4, life) * (0.7 + 0.6 * fract(variant * 37.0));
      // Twinkle: each speck flickers at its own rate.
      float twinkle = 0.55 + 0.45 * sin(age * (40.0 + 50.0 * fract(variant * 13.0)) + variant * 60.0);
      alpha = pow(1.0 - life, 1.1) * twinkle;
      nearFade = vec2(8.0, 40.0);
    } else if (kind == 1.0) {
      size = mix(10.0, 34.0, sqrt(life)) * (0.8 + 0.4 * fract(variant * 7.0));
      alpha = pow(1.0 - life, 1.4) * 0.6;
      // Puffs right at the lens would wash the screen gold.
      nearFade = vec2(40.0, 160.0);
    } else {
      size = 2.5 + 1.5 * fract(variant * 29.0);
      alpha = 1.0 - life * life;
      nearFade = vec2(60.0, 160.0);
    }
    float pixels = size * projectionMatrix[1][1] * 0.5 * viewportHeight / distance;
    // Far specks stay a visible pixel or two instead of vanishing.
    gl_PointSize = clamp(pixels, kind == 1.0 ? 0.0 : 1.5, 256.0);
    // Sub-pixel specks keep their brightness by losing opacity instead of size.
    alpha *= min(1.0, pixels / 1.5 + 0.35);
    gl_Position = projectionMatrix * view;

    vLife = life;
    vVariant = variant;
    vKind = kind;
    vSpin = variant * 6.2832 + age * (8.0 + 10.0 * fract(variant * 17.0));
    vAlpha = alpha * smoothstep(nearFade.x, nearFade.y, distance);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vLife;
  varying float vAlpha;
  varying float vVariant;
  varying float vKind;
  varying float vSpin;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    vec3 whiteGold = vec3(1.0, 0.95, 0.75);
    vec3 gold = vec3(1.0, 0.76, 0.12);
    vec3 amber = vec3(1.0, 0.48, 0.05);
    vec3 smoke = vec3(0.42, 0.2, 0.05);
    vec3 rgb;
    float shape;

    if (vKind == 0.0) {
      // Glitter: a hot pinpoint with a small glow, white-gold out of the nozzle.
      float r = length(p);
      if (r > 1.0) discard;
      shape = exp(-r * r * 6.0);
      rgb = mix(whiteGold, gold, smoothstep(0.0, 0.45, vLife)) * 3.2;
    } else if (vKind == 1.0) {
      // Haze: soft golden billows cooling to amber, then brown smoke.
      float angle = atan(p.y, p.x);
      float r = length(p) * (1.0 + 0.1 * sin(angle * 3.0 + vVariant * 6.28) + 0.06 * cos(angle * 5.0 - vVariant * 3.14));
      if (r > 1.0) discard;
      shape = (1.0 - r) * (1.0 - r) * 0.28;
      rgb = vLife < 0.4 ? mix(gold * 1.6, amber, smoothstep(0.0, 0.4, vLife)) : mix(amber, smoke, smoothstep(0.4, 1.0, vLife));
    } else {
      // Flake: a spinning square of gold leaf that flashes when it faces the camera.
      float c = cos(vSpin);
      float s = sin(vSpin);
      vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
      float squash = 0.35 + 0.65 * abs(sin(vSpin * 0.7));
      q.y /= squash;
      if (max(abs(q.x), abs(q.y)) > 0.7) discard;
      shape = 1.0;
      float flash = pow(abs(cos(vSpin * 0.7)), 6.0);
      rgb = mix(gold * 1.2, whiteGold * 4.0, flash);
    }

    gl_FragColor = vec4(rgb, vAlpha * shape);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const viewport = new THREE.Vector4();

/**
 * A car's Alpha Boost plume: gold glitter, haze and flakes in world space, so at speed
 * they stream back past the camera. Refilled every frame from `push`, like `TrailRibbon`.
 */
export class BoostPlume {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly maxParticles: number;
  private readonly positions: Float32Array;
  private readonly lives: Float32Array;
  private readonly variants: Float32Array;
  private count = 0;

  constructor(maxParticles: number, lifeSeconds: number) {
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
        viewportHeight: { value: 1080 },
        lifeSeconds: { value: lifeSeconds },
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
