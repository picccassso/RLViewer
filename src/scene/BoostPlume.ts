import * as THREE from 'three';

/** Iconic Alpha Boost (Gold Rush) golden amber signature color */
export const ALPHA_BOOST_COLOR = new THREE.Color(0xffa800);

const vertexShader = /* glsl */ `
  attribute float life;
  attribute float variant;
  uniform float viewportHeight;
  uniform vec2 nearFade;
  varying float vLife;
  varying float vAlpha;
  varying float vVariant;

  void main() {
    vec4 view = viewMatrix * vec4(position, 1.0);
    float distance = max(-view.z, 1.0);

    bool isEmber = variant > 0.80;
    // Puffs swell into golden smoke clouds; embers are small sparks.
    float baseSize = isEmber ? mix(7.0, 14.0, life) : mix(12.0, 38.0, sqrt(life)) * (0.75 + 0.35 * variant);
    gl_PointSize = min(baseSize * projectionMatrix[1][1] * 0.5 * viewportHeight / distance, 256.0);
    gl_Position = projectionMatrix * view;

    vLife = life;
    vVariant = variant;
    // Gentle fade so overlapping dual streams don't blow out
    float fade = isEmber
      ? (1.0 - life) * (0.65 + 0.3 * sin(life * 30.0 + variant * 30.0))
      : pow(1.0 - life, 1.6) * (0.55 + 0.25 * variant);
    vAlpha = fade * smoothstep(nearFade.x, nearFade.y, distance);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  varying float vLife;
  varying float vAlpha;
  varying float vVariant;

  void main() {
    vec2 fromCentre = gl_PointCoord * 2.0 - 1.0;
    bool isEmber = vVariant > 0.80;

    // Organic cloud lobe distortion for smoky puffs; crisp circular for sparkling embers
    float dist;
    if (isEmber) {
      dist = length(fromCentre);
    } else {
      float angle = atan(fromCentre.y, fromCentre.x);
      float lobe = 1.0 + 0.10 * sin(angle * 3.0 + vVariant * 6.28) + 0.06 * cos(angle * 5.0 - vVariant * 3.14);
      dist = length(fromCentre) * lobe;
    }
    if (dist > 1.0) discard;

    float soft = (1.0 - dist) * (1.0 - dist);

    // Alpha Boost (Gold Rush) multi-stage thermal color grading:
    // 1. Warm gold-white at the nozzle
    vec3 whiteHot = vec3(1.0, 0.94, 0.82);
    // 2. Radiant intense pure gold
    vec3 radiantGold = vec3(1.0, 0.72, 0.08);
    // 3. Fiery rich amber-orange
    vec3 fireAmber = vec3(1.0, 0.40, 0.03);
    // 4. Deep warm smoky russet
    vec3 smokeRusset = vec3(0.48, 0.16, 0.02);

    vec3 rgb;
    if (vLife < 0.22) {
      rgb = mix(whiteHot, radiantGold, smoothstep(0.0, 0.22, vLife));
    } else if (vLife < 0.60) {
      rgb = mix(radiantGold, fireAmber, smoothstep(0.22, 0.60, vLife));
    } else {
      rgb = mix(fireAmber, smokeRusset, smoothstep(0.60, 1.0, vLife));
    }

    if (isEmber) {
      // Golden ember sparks: glittering with gentle bloom
      rgb = mix(radiantGold * 1.6, whiteHot * 2.2, 1.0 - vLife);
      gl_FragColor = vec4(rgb, vAlpha * soft * 0.42);
    } else {
      // Soft voluminous billowing golden puffs: mild bloom at nozzle, settling to warm natural gold
      float bloomMult = mix(1.7, 1.0, smoothstep(0.0, 0.35, vLife));
      rgb *= bloomMult;
      gl_FragColor = vec4(rgb, vAlpha * soft * 0.30);
    }

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

  constructor(maxParticles: number, color: THREE.Color = ALPHA_BOOST_COLOR) {
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
