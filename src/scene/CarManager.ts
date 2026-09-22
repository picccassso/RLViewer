import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PlayerInfo, FrameState } from '../types/replay';

// Octane Hitbox: 118.01 length (X), 36.16 height (Y), 84.20 width (Z)
export const HITBOX_DIMENSIONS: Record<string, { length: number; width: number; height: number }> = {
  Octane: { length: 118.01, width: 84.20, height: 36.16 },
  Dominus: { length: 127.93, width: 83.28, height: 31.30 },
  Breakout: { length: 131.49, width: 80.52, height: 30.15 },
  Plank: { length: 128.82, width: 84.67, height: 29.39 },
  Hybrid: { length: 127.02, width: 82.19, height: 34.16 },
  Merc: { length: 120.72, width: 76.05, height: 41.66 },
};

interface CarEntity {
  info: PlayerInfo;
  group: THREE.Group;
  carMesh: THREE.Object3D;
  nameplate: THREE.Sprite;
  nameplateCanvas: HTMLCanvasElement;
  boostFlame: THREE.Mesh;
  hitboxWireframe: THREE.LineSegments;
  isModelLoaded: boolean;
  lastDrawnBoost: number;
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

      // 2. Floating 3D Nameplate Sprite with Player Name and Live Boost Pill
      const nameplateCanvas =
        typeof document !== 'undefined'
          ? document.createElement('canvas')
          : ({ width: 512, height: 128, getContext: () => null } as unknown as HTMLCanvasElement);
      nameplateCanvas.width = 512;
      nameplateCanvas.height = 128;
      const nameplateTexture = new THREE.CanvasTexture(nameplateCanvas);
      const nameplateMat = new THREE.SpriteMaterial({
        map: nameplateTexture,
        transparent: true,
        depthTest: false,
      });
      const nameplate = new THREE.Sprite(nameplateMat);
      nameplate.scale.set(160, 40, 1);
      nameplate.position.set(0, hitbox.height + 75, 0);
      carGroup.add(nameplate);

      const entity: CarEntity = {
        info: player,
        group: carGroup,
        carMesh: fallbackCar,
        nameplate,
        nameplateCanvas,
        boostFlame,
        hitboxWireframe,
        isModelLoaded: false,
        lastDrawnBoost: -1,
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
    const hitboxFamily = (player.car_hitbox_family || 'Octane').toLowerCase();
    const modelName = hitboxFamily.includes('fennec')
      ? 'fennec'
      : hitboxFamily.includes('dominus')
      ? 'dominus'
      : hitboxFamily.includes('breakout')
      ? 'breakout'
      : hitboxFamily.includes('merc')
      ? 'merc'
      : (hitboxFamily.includes('mantis') || hitboxFamily.includes('plank'))
      ? 'mantis'
      : (hitboxFamily.includes('x-devil') || hitboxFamily.includes('hybrid'))
      ? 'x-devil'
      : 'octane';

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

      // Recolor car paint according to team
      const teamColor = player.team === 0 ? 0x0088ff : 0xff6600;
      glbScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.castShadow = true;
          m.receiveShadow = true;
          if (m.material) {
            const mat = (m.material as THREE.MeshStandardMaterial).clone();
            if (/chassis|body|paint|car/i.test(mat.name || '')) {
              mat.color.setHex(teamColor);
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

  public updateCars(frameState: FrameState) {
    for (const playerState of frameState.players) {
      const entity = this.carEntities.get(playerState.info.index);
      if (!entity) continue;

      const { isPresent, isDemoed, position, rotation, boost, boostActive } = playerState;

      // Visibility: hidden if absent or demoed
      entity.group.visible = isPresent && !isDemoed;
      if (!entity.group.visible) continue;

      // Position and Rotation
      entity.group.position.set(position.x, position.y, position.z);
      entity.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

      // Boost flame
      entity.boostFlame.visible = boostActive;
      if (boostActive) {
        const s = 0.8 + Math.random() * 0.4;
        entity.boostFlame.scale.set(s, s, s);
      }

      // Update Floating Nameplate
      this.drawNameplate(entity, playerState.info, boost);
    }
  }

  private drawNameplate(entity: CarEntity, info: PlayerInfo, boost: number) {
    const roundedBoost = Math.round(boost);
    if (entity.lastDrawnBoost === roundedBoost) {
      return;
    }
    entity.lastDrawnBoost = roundedBoost;

    const canvas = entity.nameplateCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 512, 128);

    const isBlue = info.team === 0;
    const teamBadgeColor = isBlue ? '#0088ff' : '#ff6600';
    const bgColor = 'rgba(10, 15, 26, 0.85)';

    // Rounded background pill
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(16, 16, 480, 96, 24);
    ctx.fill();

    // Border
    ctx.strokeStyle = teamBadgeColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Team color bar
    ctx.fillStyle = teamBadgeColor;
    ctx.beginPath();
    ctx.roundRect(24, 24, 16, 80, 8);
    ctx.fill();

    // Player Name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Rajdhani, sans-serif';
    ctx.fillText(info.name, 56, 62);

    // Boost Pill background
    const boostX = 350;
    const boostW = 130;
    const boostH = 40;
    const boostY = 44;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.roundRect(boostX, boostY, boostW, boostH, 8);
    ctx.fill();

    // Boost Fill
    const fillW = Math.max(0, Math.min(boost / 100, 1)) * (boostW - 4);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.roundRect(boostX + 2, boostY + 2, fillW, boostH - 4, 6);
    ctx.fill();

    // Boost Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Rajdhani, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(boost)}`, boostX + boostW / 2, boostY + 30);
    ctx.textAlign = 'left';

    entity.nameplate.material.map!.needsUpdate = true;
  }

  public getCarObject(playerIndex: number): THREE.Object3D | null {
    return this.carEntities.get(playerIndex)?.group ?? null;
  }

  public setHitboxVisibility(visible: boolean) {
    this.carEntities.forEach((c) => {
      c.hitboxWireframe.visible = visible;
    });
  }

  public clear() {
    this.carEntities.forEach((c) => {
      this.carsGroup.remove(c.group);
      c.nameplate.material.dispose();
      c.nameplate.material.map?.dispose();
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
