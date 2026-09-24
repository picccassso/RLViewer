import * as THREE from 'three';

/** Team light colours, shared by the sky, the reflection environment and the rim lights. */
export const BLUE_LIGHT = new THREE.Color(0x2f7bff);
export const ORANGE_LIGHT = new THREE.Color(0xff7a1f);

/**
 * Equirectangular night sky: deep indigo zenith, a violet horizon band, the blue team's
 * glow behind the -Z goal and the orange team's behind +Z, plus a star field.
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
  sky.addColorStop(0.0, '#04051a');
  sky.addColorStop(0.28, '#0c1140');
  sky.addColorStop(0.44, '#2a1d66');
  sky.addColorStop(0.5, '#4a2a7a');
  sky.addColorStop(0.56, '#1a1236');
  sky.addColorStop(1.0, '#07060f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Stars, denser and brighter towards the zenith.
  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1800; i++) {
    const v = Math.pow(rand(), 1.6) * 0.47;
    const x = rand() * w;
    const y = v * h;
    const size = rand() < 0.05 ? 1.1 : 0.55;
    ctx.globalAlpha = (0.25 + rand() * 0.6) * (1 - v * 1.6);
    ctx.fillStyle = rand() < 0.15 ? '#cfe0ff' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Team glows on the horizon. With Three's equirect mapping, u = 0.25 faces -Z and 0.75 faces +Z.
  const glow = (u: number, rgb: string) => {
    const cx = u * w;
    const cy = h * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.22);
    g.addColorStop(0, `rgba(${rgb}, 0.75)`);
    g.addColorStop(0.35, `rgba(${rgb}, 0.28)`);
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
  glow(0.25, '40, 120, 255');
  glow(0.75, '255, 110, 30');

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
 * Tints a floor material with the pool of team light spilling out of each goal: blue
 * towards -Z, orange towards +Z, fading out before midfield.
 */
export function withTeamLightWash(material: THREE.Material, strength: number): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWashBlue = { value: BLUE_LIGHT };
    shader.uniforms.uWashOrange = { value: ORANGE_LIGHT };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWashWorldPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWashWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWashWorldPos;\nuniform vec3 uWashBlue;\nuniform vec3 uWashOrange;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float washEnd = smoothstep(800.0, 5200.0, abs(vWashWorldPos.z));
float washCentre = 1.0 - smoothstep(1500.0, 4200.0, abs(vWashWorldPos.x));
vec3 washColor = vWashWorldPos.z < 0.0 ? uWashBlue : uWashOrange;
totalEmissiveRadiance += diffuseColor.rgb * washColor * washEnd * (0.55 + 0.45 * washCentre) * ${strength.toFixed(3)};`
      );
  };
  material.customProgramCacheKey = () => `team-wash-${strength}`;
  return material;
}
