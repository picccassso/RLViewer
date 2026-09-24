import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
  BLUE_LIGHT,
  ORANGE_LIGHT,
  createArenaEnvironment,
  createNightSkyTexture,
  withCrowdSpeckle,
  withTeamLightWash,
  withTeamSideGlow,
} from './ArenaAtmosphere';

export const FIELD_WIDTH = 8192;   // X: -4096 to +4096
export const FIELD_LENGTH = 10240; // Z: -5120 to +5120
export const FIELD_CEILING = 2044; // Y: 0 to 2044
export const CORNER_SLANT = 8064;  // Length where 45 deg corners begin
export const GOAL_WIDTH = 1785.51;
export const GOAL_HEIGHT = 642.775;
export const GOAL_DEPTH = 880;

/** Radius of the see-through cone around the followed car, in uu. */
const SIGHTLINE_CAR_RADIUS = 110;
/** Trim this close to the car centre is never cut away, so the surface it drives on stays. */
const SIGHTLINE_CAR_CLEARANCE = 70;

/**
 * The pitch is a stack of coplanar layers: team colour and turf at the bottom, dark hex
 * tiles whose see-through seams let the team colour glow through, then line decals. Each
 * layer gets its own depth offset and draw order so they never z-fight.
 */
const FLOOR_LAYERS: Record<string, number> = {
  Sol_Hexagone: 1,
  Sol_Trait_T0: 2,
  Sol_Trait_T1: 2,
  Detail_Milieu: 2,
  Hexagone_T0: 2,
  Hexagone_T1: 2,
  Blanc: 3,
};

function floorLayer(material: THREE.Material): number {
  return FLOOR_LAYERS[material.name.replace(/\.\d+$/, '')] ?? 0;
}

/** Stadium meshes flatter than this are pitch surface and receive shadows. */
const FLOOR_MAX_HEIGHT = 200;

/** Glass walls and hexagon overlays are already see-through; they are left alone. */
const SEE_THROUGH_MATERIAL = /^(Vitre|Hexagone_T[01])$/i;

/** Night-time materials for the stadium surroundings model, picked by mesh name. */
function createSurroundingsMaterials() {
  const standard = (color: number, roughness: number, metalness: number, emissive = 0x000000, emissiveIntensity = 1) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });

  const structure = standard(0x1b2036, 0.75, 0.25);
  const seats = standard(0x2a2f52, 0.8, 0.1);
  const marble = standard(0x3b3e4c, 0.6, 0.2);
  const gold = standard(0xffb347, 0.35, 1);
  const grass = standard(0x1d3a22, 0.95, 0);
  const water = standard(0x0c1a3a, 0.1, 0.6);
  const crowd = withCrowdSpeckle(standard(0x6a6f8a, 0.9, 0, 0x2a2f45));
  // LED banners, ads and the lit band round the roof glow in their end's team colour.
  const teamLit = withTeamSideGlow(standard(0x10131f, 0.5, 0.2), 0.6);
  const lamps = standard(0xfff1dc, 0.5, 0, 0xfff1dc, 1.5);
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fb4ff,
    roughness: 0.1,
    metalness: 0.6,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return {
    pick(meshName: string, materialName: string): THREE.Material | null {
      if (/Crowd/.test(meshName)) return crowd;
      if (/Banners|ads_01|plaque|Stadium_Top/.test(meshName)) return teamLit;
      if (/Statue_Lights/.test(meshName)) return lamps;
      if (/Seats/.test(meshName)) return seats;
      if (/Ground_Grass|Planter/.test(meshName)) return grass;
      if (/Water/.test(meshName)) return water;
      if (/Glass$|Base_Glass/.test(meshName)) return glass;
      if (/Statue_Gold/.test(materialName)) return gold;
      if (/Marbre/.test(materialName) || /Statue/.test(meshName)) return marble;
      return structure;
    },
  };
}

export class StadiumManager {
  private scene: THREE.Scene;
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private stadiumGroup: THREE.Group;
  private proceduralFieldGroup: THREE.Group;
  private lightsGroup: THREE.Group;
  private surroundingsGroup: THREE.Group;
  private isDisposed: boolean = false;
  private maxAnisotropy = 1;
  private skyTexture: THREE.Texture | null = null;
  private environment: THREE.Texture | null = null;
  // Shared by every stadium trim material: the camera-to-car sightline to keep clear.
  private sightlineUniforms = {
    uSightFrom: { value: new THREE.Vector3() },
    uSightTo: { value: new THREE.Vector3() },
    uSightActive: { value: 0 },
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.stadiumGroup = new THREE.Group();
    this.proceduralFieldGroup = new THREE.Group();
    this.lightsGroup = new THREE.Group();
    this.surroundingsGroup = new THREE.Group();

    this.scene.add(this.stadiumGroup);
    this.scene.add(this.proceduralFieldGroup);
    this.scene.add(this.lightsGroup);
    this.scene.add(this.surroundingsGroup);

    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.setupLighting();
    this.setupProceduralArena();
    this.applyNightSky();
    this.loadStadiumGLB();
    this.loadSurroundingsGLB();
  }

  private setupLighting() {
    // Cool night sky above, warm turf bounce below.
    const hemiLight = new THREE.HemisphereLight(0xb8c8ff, 0x2c4a2a, 0.55);
    this.lightsGroup.add(hemiLight);

    // Floodlight key: nearly overhead so cars and the ball cast short, readable shadows.
    const floodlight = new THREE.DirectionalLight(0xfff1dc, 1.9);
    floodlight.position.set(1400, 6000, 900);
    floodlight.castShadow = true;
    floodlight.shadow.mapSize.set(2048, 2048);
    const shadowCam = floodlight.shadow.camera;
    shadowCam.left = -5600;
    shadowCam.right = 5600;
    shadowCam.top = 6400;
    shadowCam.bottom = -6400;
    shadowCam.near = 1000;
    shadowCam.far = 9000;
    floodlight.shadow.bias = -0.0004;
    floodlight.shadow.normalBias = 2;
    floodlight.shadow.radius = 3;
    this.lightsGroup.add(floodlight, floodlight.target);

    // Team rim lights: each goal washes its colour onto whatever faces it.
    const blueRim = new THREE.DirectionalLight(BLUE_LIGHT, 1.4);
    blueRim.position.set(-800, 1400, -6000);
    const orangeRim = new THREE.DirectionalLight(ORANGE_LIGHT, 1.4);
    orangeRim.position.set(800, 1400, 6000);
    this.lightsGroup.add(blueRim, blueRim.target, orangeRim, orangeRim.target);
  }

  private applyNightSky() {
    const sky = createNightSkyTexture();
    this.scene.background = sky ?? new THREE.Color(0x0c1140);
    this.skyTexture = sky;
  }

  /** Builds the stadium reflection environment. Needs the renderer, so the canvas calls it. */
  public initEnvironment(renderer: THREE.WebGLRenderer) {
    // The pitch is mostly seen at grazing angles; without anisotropic filtering its lines smear.
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    this.environment?.dispose();
    this.environment = createArenaEnvironment(renderer);
    this.scene.environment = this.environment;
  }

  /**
   * Retunes the stadium model's materials for the floodlit look: non-metallic turf that
   * catches the light, glowing team trims, LED ad boards and goal frames.
   */
  private gradeStadiumMaterial(mat: THREE.MeshStandardMaterial) {
    const team = /_T0$/.test(mat.name) ? BLUE_LIGHT : /_T1$/.test(mat.name) ? ORANGE_LIGHT : null;
    for (const texture of [mat.map, mat.emissiveMap]) {
      if (texture) texture.anisotropy = this.maxAnisotropy;
    }
    switch (mat.name.replace(/\.\d+$/, '')) {
      case 'Herbe':
        mat.metalness = 0;
        mat.roughness = 0.9;
        // Kept a notch darker than the cars, and only lightly reflective, so they stand out on it.
        mat.color.setRGB(0.36, 0.6, 0.33);
        mat.envMapIntensity = 0.5;
        withTeamLightWash(mat, 0.3);
        break;
      case 'Sol_Hexagone':
      case 'Detail_Milieu':
      case 'Centre':
        mat.metalness = 0.15;
        break;
      case 'Sol_T1':
      case 'Goutière':
        mat.metalness = 0.3;
        break;
      case 'bannière_pub':
        // LED advertising boards.
        mat.metalness = 0;
        mat.emissive.setRGB(1, 1, 1);
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = 0.9;
        break;
      case 'Metal':
        mat.color.setRGB(0.08, 0.085, 0.1);
        mat.roughness = 0.4;
        break;
      case 'Hexagone_T0':
      case 'Hexagone_T1':
        // Dome panels: a faint team-coloured glow instead of a mirror.
        mat.metalness = 0.2;
        mat.emissive.copy(team!);
        mat.emissiveIntensity = 0.35;
        mat.transparent = true;
        mat.opacity = 0.3;
        mat.depthWrite = false;
        break;
      case 'Couleur_T0':
      case 'Couleur_T1':
        mat.emissive.copy(team!);
        mat.emissiveIntensity = 0.35;
        break;
      case 'Cage_T0':
      case 'Cage_T1':
        mat.emissiveIntensity = 2.2;
        break;
      case 'Sol_Trait_T0':
      case 'Sol_Trait_T1':
        // Team lines on the pitch: dimmed so they don't compete with same-team cars driving over
        // them. At grazing angles the floodlight reflections turned them a glowing lavender.
        mat.color.multiplyScalar(0.45);
        mat.roughness = 0.9;
        mat.envMapIntensity = 0.3;
        mat.emissive.copy(team!);
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = 0.1;
        break;
      case 'dégradé_transparent_T0':
      case 'dégradé_transparent_T1':
        // Glow bands running round the walls.
        mat.emissive.copy(team!);
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = 1.4;
        break;
    }
    const layer = floorLayer(mat);
    if (layer) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -layer;
      mat.polygonOffsetUnits = -layer * 2;
    }
    mat.needsUpdate = true;
  }

  /**
   * Builds procedural accurate pitch turf, line markings, and goal nets
   * to guarantee instant photorealistic rendering.
   */
  private setupProceduralArena() {
    // 1. Turf Canvas Texture with mower stripes and subtle grass noise
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas) {
      canvas.width = 2048;
      canvas.height = 2048;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Base green turf
        ctx.fillStyle = '#143820';
        ctx.fillRect(0, 0, 2048, 2048);

        // Alternating lawn-mower stripes across length
        const stripeHeight = 2048 / 16;
        for (let i = 0; i < 16; i++) {
          ctx.fillStyle = i % 2 === 0 ? 'rgba(30, 80, 45, 0.4)' : 'rgba(15, 50, 28, 0.4)';
          ctx.fillRect(0, i * stripeHeight, 2048, stripeHeight);
        }

        // Hexagon pattern overlay (classic Rocket League turf texture)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 2;
        const hexSize = 32;
        const hexH = hexSize * Math.sqrt(3);
        for (let y = 0; y < 2048; y += hexH) {
          for (let x = 0; x < 2048; x += hexSize * 3) {
            ctx.beginPath();
            for (let a = 0; a < 6; a++) {
              const angle = (a * Math.PI) / 3;
              const hx = x + hexSize * Math.cos(angle);
              const hy = y + hexSize * Math.sin(angle);
              if (a === 0) ctx.moveTo(hx, hy);
              else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }

        // High-contrast field lines (white)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 14;

        // Outer boundary box
        ctx.strokeRect(40, 40, 2048 - 80, 2048 - 80);

        // Midfield line
        ctx.beginPath();
        ctx.moveTo(40, 1024);
        ctx.lineTo(2048 - 40, 1024);
        ctx.stroke();

        // Center circle
        ctx.beginPath();
        ctx.arc(1024, 1024, 200, 0, Math.PI * 2);
        ctx.stroke();

        // Center spot
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(1024, 1024, 16, 0, Math.PI * 2);
        ctx.fill();

        // Goal box penalty areas
        // Blue side (top)
        ctx.strokeRect(1024 - 300, 40, 600, 250);
        // Orange side (bottom)
        ctx.strokeRect(1024 - 300, 2048 - 290, 600, 250);
      }
    }

    const turfTexture = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (turfTexture) {
      turfTexture.wrapS = THREE.ClampToEdgeWrapping;
      turfTexture.wrapT = THREE.ClampToEdgeWrapping;
    }

    const turfGeo = new THREE.PlaneGeometry(FIELD_WIDTH, FIELD_LENGTH);
    const turfMat = new THREE.MeshStandardMaterial({
      map: turfTexture,
      roughness: 0.85,
      metalness: 0.05,
    });

    const turfMesh = new THREE.Mesh(turfGeo, turfMat);
    turfMesh.rotation.x = -Math.PI / 2;
    turfMesh.receiveShadow = true;
    turfMesh.position.y = 0;
    this.proceduralFieldGroup.add(turfMesh);

    // 2. Accurate Octagonal Arena Wall Framing
    // Width 8192, Length 10240, Slanted corners start at length = 4032, width = 3072
    const wallHeight = FIELD_CEILING;
    const wallThickness = 60;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1a2639,
      roughness: 0.3,
      metalness: 0.7,
      transparent: true,
      opacity: 0.45,
    });

    // Create corner meshes & straight wall meshes
    // Straight side walls (X = +/- 4096)
    const sideWallGeo = new THREE.BoxGeometry(wallThickness, wallHeight, 8064);
    const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
    leftWall.position.set(-FIELD_WIDTH / 2, wallHeight / 2, 0);
    this.proceduralFieldGroup.add(leftWall);

    const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
    rightWall.position.set(FIELD_WIDTH / 2, wallHeight / 2, 0);
    this.proceduralFieldGroup.add(rightWall);

    // End walls with Goal cutouts (Z = +/- 5120)
    // Left and right segments of each end wall
    const endSegmentWidth = (FIELD_WIDTH - GOAL_WIDTH) / 2;
    const endWallGeo = new THREE.BoxGeometry(endSegmentWidth, wallHeight, wallThickness);

    // Blue back wall (-Z)
    const blueBackL = new THREE.Mesh(endWallGeo, wallMat);
    blueBackL.position.set(-FIELD_WIDTH / 2 + endSegmentWidth / 2, wallHeight / 2, -FIELD_LENGTH / 2);
    const blueBackR = new THREE.Mesh(endWallGeo, wallMat);
    blueBackR.position.set(FIELD_WIDTH / 2 - endSegmentWidth / 2, wallHeight / 2, -FIELD_LENGTH / 2);
    this.proceduralFieldGroup.add(blueBackL, blueBackR);

    // Orange back wall (+Z)
    const orangeBackL = new THREE.Mesh(endWallGeo, wallMat);
    orangeBackL.position.set(-FIELD_WIDTH / 2 + endSegmentWidth / 2, wallHeight / 2, FIELD_LENGTH / 2);
    const orangeBackR = new THREE.Mesh(endWallGeo, wallMat);
    orangeBackR.position.set(FIELD_WIDTH / 2 - endSegmentWidth / 2, wallHeight / 2, FIELD_LENGTH / 2);
    this.proceduralFieldGroup.add(orangeBackL, orangeBackR);

    // Header walls above goals
    const goalHeaderGeo = new THREE.BoxGeometry(GOAL_WIDTH, wallHeight - GOAL_HEIGHT, wallThickness);
    const blueHeader = new THREE.Mesh(goalHeaderGeo, wallMat);
    blueHeader.position.set(0, GOAL_HEIGHT + (wallHeight - GOAL_HEIGHT) / 2, -FIELD_LENGTH / 2);
    const orangeHeader = new THREE.Mesh(goalHeaderGeo, wallMat);
    orangeHeader.position.set(0, GOAL_HEIGHT + (wallHeight - GOAL_HEIGHT) / 2, FIELD_LENGTH / 2);
    this.proceduralFieldGroup.add(blueHeader, orangeHeader);

    // 3. Glowing Goal Nets
    this.createGoalNet(-1); // Blue (-Z)
    this.createGoalNet(1);  // Orange (+Z)

    // 4. Boundary Neon Light Ribbons
    this.createArenaPerimeterGlow();
  }

  private createGoalNet(direction: -1 | 1) {
    const isBlue = direction === -1;
    const zPos = (FIELD_LENGTH / 2) * direction;
    const teamColor = isBlue ? 0x0088ff : 0xff6600;
    const glowColor = isBlue ? 0x38bdf8 : 0xfb923c;

    const netGroup = new THREE.Group();

    // Goal Post Framework
    const postRadius = 14;
    const postMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.9,
      emissive: teamColor,
      emissiveIntensity: 0.6,
    });

    // Crossbar
    const crossbarGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_WIDTH, 16);
    const crossbar = new THREE.Mesh(crossbarGeo, postMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, GOAL_HEIGHT, zPos);
    netGroup.add(crossbar);

    // Left & Right upright posts
    const uprightGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HEIGHT, 16);
    const leftPost = new THREE.Mesh(uprightGeo, postMat);
    leftPost.position.set(-GOAL_WIDTH / 2, GOAL_HEIGHT / 2, zPos);
    const rightPost = new THREE.Mesh(uprightGeo, postMat);
    rightPost.position.set(GOAL_WIDTH / 2, GOAL_HEIGHT / 2, zPos);
    netGroup.add(leftPost, rightPost);

    // Glowing Net Box (inside goal)
    const netGeo = new THREE.BoxGeometry(GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH);
    const netMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      emissive: glowColor,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
      side: THREE.DoubleSide,
    });
    const netMesh = new THREE.Mesh(netGeo, netMat);
    netMesh.position.set(0, GOAL_HEIGHT / 2, zPos + (GOAL_DEPTH / 2) * direction);
    netGroup.add(netMesh);

    this.proceduralFieldGroup.add(netGroup);
  }

  private createArenaPerimeterGlow() {
    // Glowing neon lines around the pitch edges
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 3,
      transparent: true,
      opacity: 0.7,
    });

    const halfW = FIELD_WIDTH / 2;
    const halfL = FIELD_LENGTH / 2;
    const cornerStartL = CORNER_SLANT / 2;
    const cornerStartW = halfW - (halfL - cornerStartL);

    // 8-point octagon perimeter
    const points = [
      new THREE.Vector3(-cornerStartW, 4, -halfL),
      new THREE.Vector3(cornerStartW, 4, -halfL),
      new THREE.Vector3(halfW, 4, -cornerStartL),
      new THREE.Vector3(halfW, 4, cornerStartL),
      new THREE.Vector3(cornerStartW, 4, halfL),
      new THREE.Vector3(-cornerStartW, 4, halfL),
      new THREE.Vector3(-halfW, 4, cornerStartL),
      new THREE.Vector3(-halfW, 4, -cornerStartL),
      new THREE.Vector3(-cornerStartW, 4, -halfL), // close loop
    ];

    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(lineGeo, lineMat);
    this.proceduralFieldGroup.add(line);
  }

  private async loadStadiumGLB() {
    try {
      const gltf = await this.gltfLoader.loadAsync('/models/stadium/stadium.glb');
      if (this.isDisposed) return;
      const model = gltf.scene;

      model.updateMatrixWorld(true);
      const sightlineMaterials = new Map<THREE.Material, THREE.Material>();
      const graded = new Set<THREE.Material>();
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;

          const height = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).y;
          // Only the flat pitch catches the floodlight shadows; filtering them on walls and dome costs for nothing.
          mesh.receiveShadow = height < FLOOR_MAX_HEIGHT;
          if (!Array.isArray(mesh.material)) mesh.renderOrder = floorLayer(mesh.material);
          const source = mesh.material as THREE.MeshStandardMaterial;
          if (!Array.isArray(mesh.material) && source.isMeshStandardMaterial && !graded.has(source)) {
            graded.add(source);
            this.gradeStadiumMaterial(source);
          }

          // The POV camera passes through the arena walls like in Rocket League, so
          // trim outside the pitch (ad boards, rails, gutters) must not hide the car.
          // Flat floor pieces are skipped: the car may be sitting on them.
          const mat = mesh.material as THREE.Material;
          if (!Array.isArray(mesh.material) && height >= 20 && !SEE_THROUGH_MATERIAL.test(mat.name)) {
            let patched = sightlineMaterials.get(mat);
            if (!patched) {
              patched = this.withSightlineCutout(mat);
              sightlineMaterials.set(mat, patched);
            }
            mesh.material = patched;
          }
        }
      });

      if (this.isDisposed) return;
      this.stadiumGroup.add(model);
      // Hide duplicate procedural field to completely prevent z-fighting
      this.proceduralFieldGroup.visible = false;
      console.log('[StadiumManager] Stadium GLB mesh loaded successfully');
    } catch (err) {
      console.warn('[StadiumManager] GLB stadium load error (falling back to high-detail procedural):', err);
      this.proceduralFieldGroup.visible = true;
    }
  }

  /**
   * Loads the stands, crowd and grounds around the pitch, seen through the glass walls
   * and dome like the stadium in Rocket League. The model is untextured, so its
   * materials are assigned per mesh for the floodlit night look.
   */
  private async loadSurroundingsGLB() {
    try {
      const gltf = await this.gltfLoader.loadAsync('/models/stadium/arene.glb');
      if (this.isDisposed) return;
      const materials = createSurroundingsMaterials();
      gltf.scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = materials.pick(mesh.name, (mesh.material as THREE.Material).name);
        if (material) mesh.material = material;
      });
      this.surroundingsGroup.add(gltf.scene);
    } catch (err) {
      console.warn('[StadiumManager] Stadium surroundings failed to load:', err);
    }
  }

  /**
   * Keeps the line of sight from `from` (the camera) to `to` (the followed car) clear of
   * stadium trim. Pass a null target to disable.
   */
  public setSightline(from: THREE.Vector3, to: THREE.Vector3 | null) {
    this.sightlineUniforms.uSightActive.value = to ? 1 : 0;
    if (!to) return;
    this.sightlineUniforms.uSightFrom.value.copy(from);
    this.sightlineUniforms.uSightTo.value.copy(to);
  }

  /**
   * Copy of `material` that dithers away fragments inside a cone from the camera to the
   * followed car, stopping just short of the car.
   */
  private withSightlineCutout(material: THREE.Material): THREE.Material {
    const patched = material.clone();
    patched.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.sightlineUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSightWorldPos;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvSightWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vSightWorldPos;
uniform vec3 uSightFrom;
uniform vec3 uSightTo;
uniform float uSightActive;`
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
if (uSightActive > 0.5) {
  vec3 sight = uSightTo - uSightFrom;
  float sightLength = max(length(sight), 1.0);
  float along = dot(vSightWorldPos - uSightFrom, sight) / (sightLength * sightLength);
  float radius = ${SIGHTLINE_CAR_RADIUS.toFixed(1)} * clamp(along, 0.0, 1.0);
  float offAxis = length(vSightWorldPos - (uSightFrom + sight * along));
  float cutoff = 1.0 - ${SIGHTLINE_CAR_CLEARANCE.toFixed(1)} / sightLength;
  float cut = (1.0 - smoothstep(radius * 0.6, radius, offAxis))
    * step(0.0, along) * (1.0 - smoothstep(cutoff - 0.1, cutoff, along));
  // Screen-door dither keeps the cut-out sorted correctly without transparency.
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (cut * 0.9 > noise) discard;
}`
        );
    };
    return patched;
  }

  public dispose() {
    this.isDisposed = true;
    this.scene.remove(this.stadiumGroup);
    this.scene.remove(this.proceduralFieldGroup);
    this.scene.remove(this.lightsGroup);
    this.scene.remove(this.surroundingsGroup);
    if (this.scene.background === this.skyTexture) this.scene.background = null;
    if (this.scene.environment === this.environment) this.scene.environment = null;
    this.skyTexture?.dispose();
    this.environment?.dispose();
    this.dracoLoader.dispose();
  }
}
