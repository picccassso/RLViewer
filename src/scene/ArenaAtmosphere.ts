import * as THREE from 'three';

/** Team light colours, shared by the sky, the reflection environment and the rim lights. */
export const BLUE_LIGHT = new THREE.Color(0x1f8aff);
export const ORANGE_LIGHT = new THREE.Color(0xff7315);

/**
 * Equirectangular night sky: deep indigo zenith, stadium searchlight beams, floodlight
 * bokeh along the upper rim, the blue team's glow behind -Z and orange behind +Z, plus stars.
 * Returns null outside the browser (tests), where there is no canvas.
 */
export function createNightSkyTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width: w, height: h } = canvas;

  // Vertical gradient: v = 0 is straight up, v = 0.5 the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.0, '#020412');
  sky.addColorStop(0.24, '#081032');
  sky.addColorStop(0.42, '#162058');
  sky.addColorStop(0.5, '#2b2468');
  sky.addColorStop(0.56, '#12102c');
  sky.addColorStop(1.0, '#05050d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Stars, denser and brighter towards the zenith.
  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1800; i++) {
    const v = Math.pow(rand(), 1.6) * 0.47;
    const x = rand() * w;
    const y = v * h;
    const size = rand() < 0.05 ? 1.15 : 0.55;
    ctx.globalAlpha = (0.25 + rand() * 0.65) * (1 - v * 1.6);
    ctx.fillStyle = rand() < 0.2 ? '#bce0ff' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Upward stadium searchlight beams rising from the arena corners into the night sky.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beamPositions = [
    { u: 0.14, rgb: '40, 140, 255', tilt: -0.12 },
    { u: 0.25, rgb: '60, 160, 255', tilt: 0.0 },
    { u: 0.36, rgb: '40, 140, 255', tilt: 0.12 },
    { u: 0.64, rgb: '255, 120, 35', tilt: -0.12 },
    { u: 0.75, rgb: '255, 145, 50', tilt: 0.0 },
    { u: 0.86, rgb: '255, 120, 35', tilt: 0.12 },
  ];
  for (const b of beamPositions) {
    const bx = b.u * w;
    const by = h * 0.5;
    const beamGrad = ctx.createLinearGradient(bx, by, bx + b.tilt * w * 0.2, h * 0.08);
    beamGrad.addColorStop(0, `rgba(${b.rgb}, 0.22)`);
    beamGrad.addColorStop(0.5, `rgba(${b.rgb}, 0.06)`);
    beamGrad.addColorStop(1, `rgba(${b.rgb}, 0)`);
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(bx - 18, by);
    ctx.lineTo(bx + 18, by);
    ctx.lineTo(bx + b.tilt * w * 0.2 + 95, h * 0.08);
    ctx.lineTo(bx + b.tilt * w * 0.2 - 95, h * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Team glows on the horizon. With Three's equirect mapping, u = 0.25 faces -Z and 0.75 faces +Z.
  const glow = (u: number, rgb: string) => {
    const cx = u * w;
    const cy = h * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.24);
    g.addColorStop(0, `rgba(${rgb}, 0.85)`);
    g.addColorStop(0.32, `rgba(${rgb}, 0.34)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.45);
    ctx.translate(-cx, -cy);
    ctx.fillRect(cx - w * 0.25, cy - h, w * 0.5, h * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  };
  glow(0.25, '30, 130, 255');
  glow(0.75, '255, 115, 25');

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Pre-filtered reflection environment of a floodlit arena: dark stands, banks of white
 * floodlights overhead, and a blue and an orange LED wall at either end. It gives the
 * metal, glass and car paint something stadium-like to reflect.
 */
export function createArenaEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const panel = (w: number, h: number, color: THREE.Color, intensity: number) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), side: THREE.DoubleSide });
    disposables.push(geo, mat);
    return new THREE.Mesh(geo, mat);
  };

  // Room: dark stands on the sides, a slightly lighter pitch below.
  const roomGeo = new THREE.BoxGeometry(24, 12, 28);
  const roomMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x0d1030), side: THREE.BackSide });
  disposables.push(roomGeo, roomMat);
  const room = new THREE.Mesh(roomGeo, roomMat);
  room.position.y = 4;
  env.add(room);

  const floor = panel(24, 28, new THREE.Color(0x1d3b24), 0.6);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.9;
  env.add(floor);

  // Floodlight banks: two rows running the length of the pitch.
  const white = new THREE.Color(0xfff3e2);
  for (const x of [-5, 5]) {
    for (const z of [-9, -3, 3, 9]) {
      const light = panel(3, 2, white, 9);
      light.rotation.x = Math.PI / 2;
      light.position.set(x, 9.9, z);
      env.add(light);
    }
  }

  // Team LED walls at each end and a softer violet band around the stands.
  const blueWall = panel(18, 2.5, BLUE_LIGHT, 4);
  blueWall.position.set(0, 1.5, -13.9);
  env.add(blueWall);
  const orangeWall = panel(18, 2.5, ORANGE_LIGHT, 4);
  orangeWall.position.set(0, 1.5, 13.9);
  orangeWall.rotation.y = Math.PI;
  env.add(orangeWall);
  for (const x of [-11.9, 11.9]) {
    const band = panel(26, 1.2, new THREE.Color(0x7a5cff), 1.2);
    band.position.set(x, 3, 0);
    band.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    env.add(band);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return target.texture;
}

/**
 * Tints a floor material with the pool of team light spilling out of each goal (blue
 * towards -Z, orange towards +Z), plus subtle alternating lawn-mower turf stripes and
 * a faint hexagonal field weave so the pitch reads crisply at any camera angle.
 */
export function withTeamLightWash(material: THREE.Material, strength: number): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWashBlue = { value: BLUE_LIGHT };
    shader.uniforms.uWashOrange = { value: ORANGE_LIGHT };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWashWorldPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSightWash_init:;\nvWashWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'.replace('vSightWash_init:;\n', '')
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWashWorldPos;\nuniform vec3 uWashBlue;\nuniform vec3 uWashOrange;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Alternating cross-pitch mower bands (~640 uu wide) + subtle lengthwise cut lines
float mowerBand = smoothstep(-0.08, 0.08, sin(vWashWorldPos.z * 0.0049087));
float lengthBand = smoothstep(-0.08, 0.08, sin(vWashWorldPos.x * 0.003835));
diffuseColor.rgb *= (0.91 + 0.14 * mowerBand) * (0.97 + 0.05 * lengthBand);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float washEnd = smoothstep(600.0, 5200.0, abs(vWashWorldPos.z));
float washCentre = 1.0 - smoothstep(1400.0, 4200.0, abs(vWashWorldPos.x));
vec3 washColor = vWashWorldPos.z < 0.0 ? uWashBlue : uWashOrange;
totalEmissiveRadiance += diffuseColor.rgb * washColor * washEnd * (0.55 + 0.45 * washCentre) * ${strength.toFixed(3)};`
      );
  };
  material.customProgramCacheKey = () => `team-wash-${strength}`;
  return material;
}

/** Adds a world-position varying for the shader patches below. */
function withWorldPosition(shader: THREE.WebGLProgramParametersWithUniforms, varying: string) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 ${varying};`)
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n${varying} = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );
}

/**
 * Turns a plain crowd mesh into a speckled crowd: every seat-sized cell gets its own
 * shirt colour and a little light of its own, so the stands read at night.
 */
export function withCrowdSpeckle(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    withWorldPosition(shader, 'vCrowdWorldPos');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrowdWorldPos;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 crowdCell = floor(vCrowdWorldPos / 70.0);
float crowdHash = fract(sin(dot(crowdCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
vec3 crowdShirt = 0.55 + 0.45 * cos(6.2831 * (crowdHash + vec3(0.0, 0.33, 0.67)));
diffuseColor.rgb *= crowdShirt;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= crowdShirt;'
      );
  };
  material.customProgramCacheKey = () => 'crowd-speckle';
  return material;
}

/**
 * Lights a material in its end's team colour: blue towards -Z, orange towards +Z, with
 * a violet blend across the middle.
 */
export function withTeamSideGlow(material: THREE.MeshStandardMaterial, strength: number): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSideBlue = { value: BLUE_LIGHT };
    shader.uniforms.uSideOrange = { value: ORANGE_LIGHT };
    withWorldPosition(shader, 'vSideWorldPos');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSideWorldPos;\nuniform vec3 uSideBlue;\nuniform vec3 uSideOrange;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
vec3 sideColor = mix(uSideBlue, uSideOrange, smoothstep(-6000.0, 6000.0, vSideWorldPos.z));
totalEmissiveRadiance += sideColor * ${strength.toFixed(3)};`
      );
  };
  material.customProgramCacheKey = () => `team-side-glow-${strength}`;
  return material;
}
