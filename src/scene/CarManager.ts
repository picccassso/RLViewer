import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { PlayerInfo, FrameState } from '../types/replay';
import { carModelFor } from './carBodies';
import { flipResetBadgeAt } from '../math/flipReset';

// Octane Hitbox: 118.01 length (X), 36.16 height (Y), 84.20 width (Z)
export const HITBOX_DIMENSIONS: Record<string, { length: number; width: number; height: number }> = {
  Octane: { length: 118.01, width: 84.20, height: 36.16 },
  Dominus: { length: 127.93, width: 83.28, height: 31.30 },
  Breakout: { length: 131.49, width: 80.52, height: 30.15 },
  Plank: { length: 128.82, width: 84.67, height: 29.39 },
  Hybrid: { length: 127.02, width: 82.19, height: 34.16 },
  Merc: { length: 120.72, width: 76.05, height: 41.66 },
};

/** Height of a nameplate's bottom edge above the car, straight up in world space. */
const NAMEPLATE_HEIGHT = 110;

/**
 * Player name label, drawn by the browser over the 3D view (see CSS2DRenderer in the canvas)
 * so it stays crisp and the same readable size at any distance.
 */
function createNameplate(info: PlayerInfo): THREE.Object3D {
  // Without a DOM (unit tests) there is nothing to draw; a bare anchor keeps the placement testable.
  if (typeof document === 'undefined') return new THREE.Object3D();
  const element = document.createElement('div');
  element.className = info.team === 0 ? 'nameplate nameplate-blue' : 'nameplate nameplate-orange';
  element.textContent = info.name;
  const nameplate = new CSS2DObject(element);
  nameplate.center.set(0.5, 1); // anchored at its bottom centre
  return nameplate;
}

/**
 * "FLIP RESET" badge shown for a moment after a player gets one, stacked above the nameplate.
 * Its padding keeps it clear of the nameplate, which shares the same anchor point.
 */
function createFlipResetBadge(info: PlayerInfo): THREE.Object3D {
  if (typeof document === 'undefined') return new THREE.Object3D();
  const element = document.createElement('div');
  element.className = 'flip-reset-anchor';
  const badge = document.createElement('div');
  badge.className = info.team === 0 ? 'flip-reset flip-reset-blue' : 'flip-reset flip-reset-orange';
  badge.textContent = 'Flip reset';
  element.appendChild(badge);
  const object = new CSS2DObject(element);
  object.center.set(0.5, 1);
  object.visible = false;
  return object;
}

const TEAM_PAINT = [new THREE.Color(0x1d6bff), new THREE.Color(0xff5a00)];

/**
 * Car textures are white where the paint goes and grey, black or coloured for trims, lights and glass.
 * Tinting the whole texture turns those details the team colour too, so only the near-white,
 * colourless texels take the paint; that paint also gets a faint glow so cars read against the pitch.
 */
export function applyTeamPaint(mat: THREE.MeshStandardMaterial, team: 0 | 1) {
  const paint = TEAM_PAINT[team];
  mat.roughness = 0.38;
  mat.metalness = 0.2;
  mat.envMapIntensity = 0.8;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.teamPaint = { value: paint };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 teamPaint;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 baseTexel = diffuseColor.rgb;
        float texelLuma = sqrt(dot(baseTexel, vec3(0.2126, 0.7152, 0.0722))); // about sRGB brightness
        float texelChroma = max(max(baseTexel.r, baseTexel.g), baseTexel.b) - min(min(baseTexel.r, baseTexel.g), baseTexel.b);
        float paintMask = smoothstep(0.6, 0.85, texelLuma) * (1.0 - smoothstep(0.05, 0.15, texelChroma));
        diffuseColor.rgb = mix(baseTexel, baseTexel * teamPaint, paintMask);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += teamPaint * paintMask * 0.12;'
      );
  };
  mat.customProgramCacheKey = () => 'team-paint';
}

interface CarEntity {
  info: PlayerInfo;
  group: THREE.Group;
  carMesh: THREE.Object3D;
  /** Lives in world space, not under the car, so it stays above the car however the car rolls. */
  nameplate: THREE.Object3D;
  flipResetBadge: THREE.Object3D;
  boostFlame: THREE.Mesh;
  hitboxWireframe: THREE.LineSegments;
  isModelLoaded: boolean;
}

export class CarManager {
  private scene: THREE.Scene;
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private carsGroup: THREE.Group;
  private carEntities: Map<number, CarEntity> = new Map();
  private modelCache: Map<string, THREE.Group> = new Map();
  private modelPromises: Map<string, Promise<THREE.Group>> = new Map();
  private wheelModelCache: THREE.Group | null = null;
  private wheelModelPromise: Promise<THREE.Group> | null = null;
  private isDisposed: boolean = false;
  private nameplatesVisible: boolean = true;
  private flipResets: number[][] = [];
  private groundShadows: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private shadowTransform = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.carsGroup = new THREE.Group();
    this.scene.add(this.carsGroup);

    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  public initCars(players: PlayerInfo[]) {
    this.clear();

    const shadowSize = 64;
    const shadowPixels = new Uint8Array(shadowSize * shadowSize * 4);
    for (let y = 0; y < shadowSize; y++) {
      for (let x = 0; x < shadowSize; x++) {
        const radius = Math.hypot(x - 31.5, y - 31.5) / 31.5;
        shadowPixels[(y * shadowSize + x) * 4 + 3] = Math.round(90 * Math.max(0, 1 - radius) ** 2);
      }
    }
    const shadowTexture = new THREE.DataTexture(shadowPixels, shadowSize, shadowSize, THREE.RGBAFormat);
    shadowTexture.magFilter = THREE.LinearFilter;
    shadowTexture.minFilter = THREE.LinearFilter;
    shadowTexture.needsUpdate = true;
    this.groundShadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
      players.length
    );
    this.groundShadows.count = 0;
    this.groundShadows.frustumCulled = false;
    this.groundShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carsGroup.add(this.groundShadows);

    for (const player of players) {
      const carGroup = new THREE.Group();
      this.carsGroup.add(carGroup);

      const hitbox = HITBOX_DIMENSIONS[player.car_hitbox_family] || HITBOX_DIMENSIONS.Octane;
      const teamColor = player.team === 0 ? 0x0088ff : 0xff6600;
      const accentColor = player.team === 0 ? 0x38bdf8 : 0xfbbf24;

      // 1. Procedural detailed car chassis
      const chassisGeo = new THREE.BoxGeometry(hitbox.length, hitbox.height, hitbox.width);
      const chassisMat = new THREE.MeshStandardMaterial({
        color: teamColor,
        metalness: 0.8,
        roughness: 0.25,
        emissive: teamColor,
        emissiveIntensity: 0.2,
      });
      const fallbackCar = new THREE.Mesh(chassisGeo, chassisMat);
      fallbackCar.castShadow = true;
      fallbackCar.receiveShadow = true;
      fallbackCar.position.y = hitbox.height / 2;
      carGroup.add(fallbackCar);

      // Cabin / windshield
      const cabinGeo = new THREE.BoxGeometry(hitbox.length * 0.45, hitbox.height * 0.6, hitbox.width * 0.7);
      const cabinMat = new THREE.MeshStandardMaterial({
        color: 0x111827,
        metalness: 0.9,
        roughness: 0.1,
      });
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(-hitbox.length * 0.05, hitbox.height * 0.8, 0);
      carGroup.add(cabin);

      // Hitbox Wireframe
      const wireGeo = new THREE.WireframeGeometry(chassisGeo);
      const wireMat = new THREE.LineBasicMaterial({
        color: accentColor,
        transparent: true,
        opacity: 0.25,
      });
      const hitboxWireframe = new THREE.LineSegments(wireGeo, wireMat);
      hitboxWireframe.position.y = hitbox.height / 2;
      hitboxWireframe.visible = false;
      carGroup.add(hitboxWireframe);

      // Boost Flame Cone behind the car (-X is rear)
      const flameGeo = new THREE.ConeGeometry(14, 50, 16);
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.85,
      });
      const boostFlame = new THREE.Mesh(flameGeo, flameMat);
      boostFlame.rotation.z = Math.PI / 2;
      boostFlame.position.set(-hitbox.length / 2 - 25, hitbox.height / 2, 0);
      boostFlame.visible = false;
      carGroup.add(boostFlame);

      // 2. Nameplate
      const nameplate = createNameplate(player);
      nameplate.visible = this.nameplatesVisible;
      this.carsGroup.add(nameplate);
      const flipResetBadge = createFlipResetBadge(player);
      this.carsGroup.add(flipResetBadge);

      const entity: CarEntity = {
        info: player,
        group: carGroup,
        carMesh: fallbackCar,
        nameplate,
        flipResetBadge,
        boostFlame,
        hitboxWireframe,
        isModelLoaded: false,
      };

      this.carEntities.set(player.index, entity);

      // Async load real GLB model for this car
      this.loadGLBCarModel(player, entity, fallbackCar, cabin);
    }
  }

  private async loadGLBCarModel(
    player: PlayerInfo,
    entity: CarEntity,
    fallbackMesh: THREE.Mesh,
    cabinMesh: THREE.Mesh
  ) {
    const modelName = carModelFor(player.car_body_id, player.car_hitbox_family);
    const path = `/models/cars/${modelName}/${modelName}.glb`;

    try {
      let glbScene: THREE.Group;
      if (this.modelCache.has(path)) {
        glbScene = this.modelCache.get(path)!.clone(true);
      } else {
        if (!this.modelPromises.has(path)) {
          const promise = (async () => {
            try {
              const gltf = await this.gltfLoader.loadAsync(path);
              this.modelCache.set(path, gltf.scene);
              return gltf.scene;
            } catch (err) {
              this.modelPromises.delete(path);
              throw err;
            }
          })();
          this.modelPromises.set(path, promise);
        }
        const cachedModel = await this.modelPromises.get(path)!;
        glbScene = cachedModel.clone(true);
      }

      // If manager is disposed or entity was cleared / re-initialized, abort
      if (this.isDisposed || this.carEntities.get(player.index) !== entity) {
        return;
      }

      // Community / game models are oriented and scaled in meters (1m = 100 uu)
      // Car models natively face +X (matching Unreal's +X forward mapped to Three.js +X).
      glbScene.scale.set(100, 100, 100);
      glbScene.rotation.y = 0; // Front is already +X

      // Load & attach authentic 3D wheels to Wheel_FR, Wheel_FL, Wheel_BR, Wheel_BL bones
      try {
        const wheelModel = await this.getWheelModel();
        // Collect target wheel attachment bones first without modifying tree during traversal
        const wheelBones: THREE.Object3D[] = [];
        glbScene.traverse((child) => {
          if (child.name && /^Wheel_(FR|FL|BR|BL)$/i.test(child.name)) {
            wheelBones.push(child);
          }
        });

        for (const bone of wheelBones) {
          bone.clear();
          const wheelInstance = wheelModel.clone(true);
          bone.add(wheelInstance);
        }
      } catch (wheelErr) {
        console.warn('[CarManager] Could not attach wheels:', wheelErr);
      }

      // Paint the body panels in the team colour and leave the chassis, trims, lights and glass as modelled.
      glbScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.castShadow = true;
          m.receiveShadow = true;
          if (m.material) {
            const mat = (m.material as THREE.MeshStandardMaterial).clone();
            if (/body/i.test(mat.name || '') && !/chassis/i.test(mat.name || '')) {
              applyTeamPaint(mat, player.team);
            }
            m.material = mat;
          }
        }
      });

      // If manager is disposed or entity was cleared while loading wheels/materials, abort
      if (this.isDisposed || this.carEntities.get(player.index) !== entity) {
        return;
      }

      // Swap out fallback box meshes or replace previously loaded custom mesh
      if (entity.isModelLoaded && entity.carMesh !== fallbackMesh) {
        entity.group.remove(entity.carMesh);
      }
      fallbackMesh.visible = false;
      cabinMesh.visible = false;
      entity.group.add(glbScene);
      entity.carMesh = glbScene;
      entity.isModelLoaded = true;
    } catch (err) {
      console.warn('[CarManager] Failed to load GLB car model:', err);
      // Keep procedural chassis
    }
  }

  private async getWheelModel(): Promise<THREE.Group> {
    if (this.wheelModelCache) {
      return this.wheelModelCache.clone(true);
    }
    if (!this.wheelModelPromise) {
      this.wheelModelPromise = (async () => {
        try {
          const gltf = await this.gltfLoader.loadAsync('/models/wheels/Wheel_Boog.glb');
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.wheelModelCache = gltf.scene;
          return this.wheelModelCache;
        } catch (err) {
          this.wheelModelPromise = null;
          throw err;
        }
      })();
    }
    const cached = await this.wheelModelPromise;
    return cached.clone(true);
  }

  public updateCars(frameState: FrameState, activePovPlayerIndex: number | null = null) {
    let shadowCount = 0;
    for (const playerState of frameState.players) {
      const entity = this.carEntities.get(playerState.info.index);
      if (!entity) continue;

      const { isPresent, isDemoed, position, rotation, boostActive } = playerState;

      // Visibility: hidden if absent or demoed
      entity.group.visible = isPresent && !isDemoed;
      // Hide nameplate for the followed POV player so it doesn't obstruct camera view
      const isPovTarget = activePovPlayerIndex !== null && playerState.info.index === activePovPlayerIndex;
      entity.nameplate.visible = entity.group.visible && this.nameplatesVisible && !isPovTarget;
      this.updateFlipResetBadge(entity, frameState.time, isPovTarget);
      if (!entity.group.visible) continue;

      // Position and Rotation
      entity.group.position.set(position.x, position.y, position.z);
      entity.nameplate.position.set(position.x, position.y + NAMEPLATE_HEIGHT, position.z);
      entity.flipResetBadge.position.copy(entity.nameplate.position);
      entity.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

      if (this.groundShadows && position.y < 500) {
        const shadowScale = 1 + Math.max(0, position.y) / 1000;
        this.shadowTransform.position.set(position.x, 3, position.z);
        this.shadowTransform.rotation.set(-Math.PI / 2, 0, 0);
        this.shadowTransform.scale.set(180 * shadowScale, 120 * shadowScale, 1);
        this.shadowTransform.updateMatrix();
        this.groundShadows.setMatrixAt(shadowCount++, this.shadowTransform.matrix);
      }

      // Boost flame
      entity.boostFlame.visible = boostActive;
      if (boostActive) {
        const s = 0.8 + Math.random() * 0.4;
        entity.boostFlame.scale.set(s, s, s);
      }
    }
    if (this.groundShadows) {
      this.groundShadows.count = shadowCount;
      if (shadowCount) this.groundShadows.instanceMatrix.needsUpdate = true;
    }
  }

  /** Playback times of each player's flip resets, indexed like the players passed to initCars. */
  public setFlipResets(flipResets: number[][]) {
    this.flipResets = flipResets;
  }

  private updateFlipResetBadge(entity: CarEntity, time: number, isPovTarget: boolean) {
    const appearance = entity.group.visible && this.nameplatesVisible
      ? flipResetBadgeAt(this.flipResets[entity.info.index] ?? [], time)
      : null;
    entity.flipResetBadge.visible = appearance !== null;
    if (!appearance || !(entity.flipResetBadge instanceof CSS2DObject)) return;

    const element = entity.flipResetBadge.element;
    // The followed POV player has no nameplate, so the badge takes its place.
    element.classList.toggle('flip-reset-anchor-solo', isPovTarget);
    const badge = element.firstElementChild as HTMLElement;
    badge.style.opacity = appearance.opacity.toFixed(3);
    badge.style.transform = `scale(${appearance.scale.toFixed(3)})`;
  }

  public getCarObject(playerIndex: number): THREE.Object3D | null {
    return this.carEntities.get(playerIndex)?.group ?? null;
  }

  public setHitboxVisibility(visible: boolean) {
    this.carEntities.forEach((c) => {
      c.hitboxWireframe.visible = visible;
    });
  }

  public setNameplatesVisible(visible: boolean) {
    this.nameplatesVisible = visible;
    this.carEntities.forEach((car) => {
      car.nameplate.visible = visible;
      if (!visible) car.flipResetBadge.visible = false;
    });
  }

  public clear() {
    if (this.groundShadows) {
      this.carsGroup.remove(this.groundShadows);
      this.groundShadows.dispose();
      this.groundShadows.geometry.dispose();
      this.groundShadows.material.map?.dispose();
      this.groundShadows.material.dispose();
      this.groundShadows = null;
    }
    this.carEntities.forEach((c) => {
      this.carsGroup.remove(c.group);
      this.carsGroup.remove(c.nameplate); // also takes its element out of the page
      this.carsGroup.remove(c.flipResetBadge);
    });
    this.carEntities.clear();
  }

  public dispose() {
    this.isDisposed = true;
    this.clear();
    this.modelCache.clear();
    this.modelPromises.clear();
    this.wheelModelCache = null;
    this.wheelModelPromise = null;
    this.scene.remove(this.carsGroup);
    this.dracoLoader.dispose();
  }
}
