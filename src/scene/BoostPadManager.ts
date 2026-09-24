import * as THREE from 'three';
import { ReplayBoostPad } from '../types/replay';

/**
 * Authentic Rocket League boost pads:
 * - Big pads (100% Boost): A circular metallic base plate with a glowing hazard ring
 *   and center disc, and a floating golden boost capsule (~40 uu wide, ~56 uu tall)
 *   gently bobbing at roof height (~70 uu) with dual tilted orbital rings spinning around it.
 * - Small pads (12% Mini Pads): A low-profile metallic rim embedded in the pitch with a
 *   glowing ground disc and a floating glowing chevron hovering at bumper height (~17 uu)
 *   that rotates continuously.
 *
 * When collected, all floating elements (capsule, aura, rings, chevron) vanish completely,
 * and the ground hazard/disc dims to dark inactive metal until the pad respawns.
 */
const PAD_DIMENSIONS = {
  big: {
    baseRadius: 80,
    baseHeight: 8,
    hazardInnerRadius: 56,
    hazardOuterRadius: 74,
    groundDiscRadius: 46,
    capsuleRadius: 20,
    capsuleLength: 16,
    auraRadius: 23,
    auraLength: 17,
    ringRadius: 32,
    ringTube: 1.6,
    coreCenter: 70,
    bobAmplitude: 6,
  },
  small: {
    baseRadius: 28,
    baseHeight: 4,
    discRadius: 20,
    coreCenter: 17,
    bobAmplitude: 2,
  },
} as const;

const ORB_BOB_SPEED = 2.4; // radians per second
const RING_SPIN_SPEED = 1.9;
const CHEVRON_SPIN_SPEED = 2.5;

interface PadInstance {
  pad: ReplayBoostPad;
  isAvailable: boolean;
  bobPhase: number;
  spinPhase: number;
}

interface BigPadGroup {
  pads: PadInstance[];
  base: THREE.InstancedMesh;
  activeHazard: THREE.InstancedMesh;
  inactiveHazard: THREE.InstancedMesh;
  activeGroundDisc: THREE.InstancedMesh;
  inactiveGroundDisc: THREE.InstancedMesh;
  activeCore: THREE.InstancedMesh;
  activeAura: THREE.InstancedMesh;
  activeRing1: THREE.InstancedMesh;
  activeRing2: THREE.InstancedMesh;
}

interface SmallPadGroup {
  pads: PadInstance[];
  base: THREE.InstancedMesh;
  activeDisc: THREE.InstancedMesh;
  inactiveDisc: THREE.InstancedMesh;
  activeChevron: THREE.InstancedMesh;
}

function createChevronGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Stylized Rocket League booster chevron
  shape.moveTo(0, 8.5);
  shape.lineTo(9.5, -1.2);
  shape.lineTo(6, -3.8);
  shape.lineTo(0, 1.8);
  shape.lineTo(-6, -3.8);
  shape.lineTo(-9.5, -1.2);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 3.8,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.9,
    bevelThickness: 0.9,
  });
  geometry.center();
  return geometry;
}

export class BoostPadManager {
  private scene: THREE.Scene;
  private parentGroup: THREE.Group;
  private bigGroup: BigPadGroup | null = null;
  private smallGroup: SmallPadGroup | null = null;
  private dummy = new THREE.Object3D();

  private geometries: Set<THREE.BufferGeometry> = new Set();
  private materials: Set<THREE.Material> = new Set();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.parentGroup = new THREE.Group();
    this.parentGroup.name = 'BoostPadGroup';
    this.scene.add(this.parentGroup);
  }

  private registerGeometry<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.add(geo);
    return geo;
  }

  private registerMaterial<T extends THREE.Material>(mat: T): T {
    this.materials.add(mat);
    return mat;
  }

  public initPads(boostPads: ReplayBoostPad[]) {
    this.clear();

    const bigPads = boostPads.filter((p) => p.size === 'Big');
    const smallPads = boostPads.filter((p) => p.size === 'Small');

    if (bigPads.length > 0) {
      this.initBigPads(bigPads);
    }

    if (smallPads.length > 0) {
      this.initSmallPads(smallPads);
    }
  }

  private initBigPads(pads: ReplayBoostPad[]) {
    const dims = PAD_DIMENSIONS.big;
    const count = pads.length;

    // 1. Shared metallic base plate
    const baseGeo = this.registerGeometry(
      new THREE.CylinderGeometry(dims.baseRadius, dims.baseRadius, dims.baseHeight, 28)
    );
    const darkMetalMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x141a24, metalness: 0.9, roughness: 0.25 })
    );
    const base = new THREE.InstancedMesh(baseGeo, darkMetalMat, count);

    // 2. Active hazard ring on base
    const hazardGeo = this.registerGeometry(
      new THREE.RingGeometry(dims.hazardInnerRadius, dims.hazardOuterRadius, 32)
    );
    hazardGeo.rotateX(-Math.PI / 2);
    const activeHazardMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 1.5,
        roughness: 0.3,
        metalness: 0.6,
        side: THREE.DoubleSide,
      })
    );
    const activeHazard = new THREE.InstancedMesh(hazardGeo, activeHazardMat, count);

    // 3. Inactive (extinguished) hazard ring
    const inactiveHazardMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x1f2530,
        metalness: 0.6,
        roughness: 0.8,
        side: THREE.DoubleSide,
      })
    );
    const inactiveHazard = new THREE.InstancedMesh(hazardGeo, inactiveHazardMat, count);

    // 4. Active center ground disc
    const groundDiscGeo = this.registerGeometry(new THREE.CircleGeometry(dims.groundDiscRadius, 24));
    groundDiscGeo.rotateX(-Math.PI / 2);
    const activeGroundDiscMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.4,
        roughness: 0.4,
        metalness: 0.3,
        side: THREE.DoubleSide,
      })
    );
    const activeGroundDisc = new THREE.InstancedMesh(groundDiscGeo, activeGroundDiscMat, count);

    // 5. Inactive center ground disc
    const inactiveGroundDiscMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x181e28,
        metalness: 0.5,
        roughness: 0.8,
        side: THREE.DoubleSide,
      })
    );
    const inactiveGroundDisc = new THREE.InstancedMesh(groundDiscGeo, inactiveGroundDiscMat, count);

    // 6. Floating golden boost capsule
    const coreGeo = this.registerGeometry(
      new THREE.CapsuleGeometry(dims.capsuleRadius, dims.capsuleLength, 8, 24)
    );
    const activeCoreMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffb800,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.6,
        roughness: 0.2,
        metalness: 0.3,
      })
    );
    const activeCore = new THREE.InstancedMesh(coreGeo, activeCoreMat, count);

    // 7. Outer soft energy envelope
    const auraGeo = this.registerGeometry(
      new THREE.CapsuleGeometry(dims.auraRadius, dims.auraLength, 8, 24)
    );
    const activeAuraMat = this.registerMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffa000,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const activeAura = new THREE.InstancedMesh(auraGeo, activeAuraMat, count);

    // 8 & 9. Dual orbital neon rings
    const ringGeo = this.registerGeometry(
      new THREE.TorusGeometry(dims.ringRadius, dims.ringTube, 12, 32)
    );
    const activeRingMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffd166,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.8,
        roughness: 0.15,
        metalness: 0.8,
      })
    );
    const activeRing1 = new THREE.InstancedMesh(ringGeo, activeRingMat, count);
    const activeRing2 = new THREE.InstancedMesh(ringGeo, activeRingMat, count);

    const meshes = [
      base,
      activeHazard,
      inactiveHazard,
      activeGroundDisc,
      inactiveGroundDisc,
      activeCore,
      activeAura,
      activeRing1,
      activeRing2,
    ];
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.parentGroup.add(mesh);
    }

    // Set static base transforms
    for (let i = 0; i < count; i++) {
      this.dummy.position.set(pads[i].position.x, dims.baseHeight / 2, pads[i].position.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      base.setMatrixAt(i, this.dummy.matrix);
    }
    base.instanceMatrix.needsUpdate = true;

    this.bigGroup = {
      pads: pads.map((pad, idx) => ({
        pad,
        isAvailable: true,
        bobPhase: idx * 1.05,
        spinPhase: idx * 0.75,
      })),
      base,
      activeHazard,
      inactiveHazard,
      activeGroundDisc,
      inactiveGroundDisc,
      activeCore,
      activeAura,
      activeRing1,
      activeRing2,
    };

    this.rebuildBigPads();
  }

  private initSmallPads(pads: ReplayBoostPad[]) {
    const dims = PAD_DIMENSIONS.small;
    const count = pads.length;

    // 1. Shared metallic circular rim
    const baseGeo = this.registerGeometry(
      new THREE.CylinderGeometry(dims.baseRadius, dims.baseRadius, dims.baseHeight, 20)
    );
    const darkMetalMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({ color: 0x141a24, metalness: 0.9, roughness: 0.25 })
    );
    const base = new THREE.InstancedMesh(baseGeo, darkMetalMat, count);

    // 2. Active glowing ground disc
    const discGeo = this.registerGeometry(new THREE.CircleGeometry(dims.discRadius, 18));
    discGeo.rotateX(-Math.PI / 2);
    const activeDiscMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.5,
        roughness: 0.3,
        metalness: 0.6,
        side: THREE.DoubleSide,
      })
    );
    const activeDisc = new THREE.InstancedMesh(discGeo, activeDiscMat, count);

    // 3. Inactive ground disc
    const inactiveDiscMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x1f2530,
        metalness: 0.6,
        roughness: 0.8,
        side: THREE.DoubleSide,
      })
    );
    const inactiveDisc = new THREE.InstancedMesh(discGeo, inactiveDiscMat, count);

    // 4. Floating glowing booster chevron
    const chevronGeo = this.registerGeometry(createChevronGeometry());
    const activeChevronMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.8,
        roughness: 0.2,
        metalness: 0.4,
      })
    );
    const activeChevron = new THREE.InstancedMesh(chevronGeo, activeChevronMat, count);

    const meshes = [base, activeDisc, inactiveDisc, activeChevron];
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.parentGroup.add(mesh);
    }

    // Set static base transforms
    for (let i = 0; i < count; i++) {
      this.dummy.position.set(pads[i].position.x, dims.baseHeight / 2, pads[i].position.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      base.setMatrixAt(i, this.dummy.matrix);
    }
    base.instanceMatrix.needsUpdate = true;

    this.smallGroup = {
      pads: pads.map((pad, idx) => ({
        pad,
        isAvailable: true,
        bobPhase: idx * 0.4,
        spinPhase: idx * 0.9,
      })),
      base,
      activeDisc,
      inactiveDisc,
      activeChevron,
    };

    this.rebuildSmallPads();
  }

  private rebuildBigPads() {
    if (!this.bigGroup) return;

    const {
      pads,
      activeHazard,
      inactiveHazard,
      activeGroundDisc,
      inactiveGroundDisc,
      activeCore,
      activeAura,
      activeRing1,
      activeRing2,
    } = this.bigGroup;
    const dims = PAD_DIMENSIONS.big;

    let activeCount = 0;
    let inactiveCount = 0;

    for (const instance of pads) {
      const { pad, isAvailable, bobPhase, spinPhase } = instance;
      const hazardY = dims.baseHeight + 0.1;
      const discY = dims.baseHeight + 0.15;

      if (isAvailable) {
        const bob = Math.sin(bobPhase) * dims.bobAmplitude;
        const coreY = dims.coreCenter + bob;

        // Ground active hazard ring
        this.dummy.position.set(pad.position.x, hazardY, pad.position.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        activeHazard.setMatrixAt(activeCount, this.dummy.matrix);

        // Ground active center disc
        this.dummy.position.set(pad.position.x, discY, pad.position.z);
        this.dummy.updateMatrix();
        activeGroundDisc.setMatrixAt(activeCount, this.dummy.matrix);

        // Floating golden boost capsule
        this.dummy.position.set(pad.position.x, coreY, pad.position.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        activeCore.setMatrixAt(activeCount, this.dummy.matrix);

        // Soft outer envelope
        activeAura.setMatrixAt(activeCount, this.dummy.matrix);

        // Orbital Ring 1 (tilted ~30 deg, spinning around Y)
        this.dummy.rotation.set(0.52, spinPhase * 1.5, 0, 'YXZ');
        this.dummy.updateMatrix();
        activeRing1.setMatrixAt(activeCount, this.dummy.matrix);

        // Orbital Ring 2 (tilted ~-35 deg & rolled, spinning opposite)
        this.dummy.rotation.set(-0.61, -spinPhase * 1.8, 0.35, 'YXZ');
        this.dummy.updateMatrix();
        activeRing2.setMatrixAt(activeCount, this.dummy.matrix);

        activeCount++;
      } else {
        // Ground inactive hazard ring
        this.dummy.position.set(pad.position.x, hazardY, pad.position.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        inactiveHazard.setMatrixAt(inactiveCount, this.dummy.matrix);

        // Ground inactive center disc
        this.dummy.position.set(pad.position.x, discY, pad.position.z);
        this.dummy.updateMatrix();
        inactiveGroundDisc.setMatrixAt(inactiveCount, this.dummy.matrix);

        inactiveCount++;
      }
    }

    activeHazard.count = activeCount;
    inactiveHazard.count = inactiveCount;
    activeGroundDisc.count = activeCount;
    inactiveGroundDisc.count = inactiveCount;
    activeCore.count = activeCount;
    activeAura.count = activeCount;
    activeRing1.count = activeCount;
    activeRing2.count = activeCount;

    activeHazard.instanceMatrix.needsUpdate = true;
    inactiveHazard.instanceMatrix.needsUpdate = true;
    activeGroundDisc.instanceMatrix.needsUpdate = true;
    inactiveGroundDisc.instanceMatrix.needsUpdate = true;
    activeCore.instanceMatrix.needsUpdate = true;
    activeAura.instanceMatrix.needsUpdate = true;
    activeRing1.instanceMatrix.needsUpdate = true;
    activeRing2.instanceMatrix.needsUpdate = true;
  }

  private rebuildSmallPads() {
    if (!this.smallGroup) return;

    const { pads, activeDisc, inactiveDisc, activeChevron } = this.smallGroup;
    const dims = PAD_DIMENSIONS.small;

    let activeCount = 0;
    let inactiveCount = 0;

    for (const instance of pads) {
      const { pad, isAvailable, bobPhase, spinPhase } = instance;
      const groundY = dims.baseHeight + 0.1;

      if (isAvailable) {
        const bob = Math.sin(bobPhase) * dims.bobAmplitude;
        const iconY = dims.coreCenter + bob;

        // Active ground disc
        this.dummy.position.set(pad.position.x, groundY, pad.position.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        activeDisc.setMatrixAt(activeCount, this.dummy.matrix);

        // Floating rotating chevron icon
        this.dummy.position.set(pad.position.x, iconY, pad.position.z);
        this.dummy.rotation.set(0, spinPhase, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        activeChevron.setMatrixAt(activeCount, this.dummy.matrix);

        activeCount++;
      } else {
        // Inactive ground disc
        this.dummy.position.set(pad.position.x, groundY, pad.position.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        inactiveDisc.setMatrixAt(inactiveCount, this.dummy.matrix);

        inactiveCount++;
      }
    }

    activeDisc.count = activeCount;
    inactiveDisc.count = inactiveCount;
    activeChevron.count = activeCount;

    activeDisc.instanceMatrix.needsUpdate = true;
    inactiveDisc.instanceMatrix.needsUpdate = true;
    activeChevron.instanceMatrix.needsUpdate = true;
  }

  /**
   * Updates pad states from the frame's boost pad availability array,
   * advancing animations (capsule bobbing, orbital rings, chevron rotation).
   */
  public updateStates(availableList: boolean[], deltaTime: number = 0.016) {
    let bigChanged = false;
    let smallChanged = false;

    if (this.bigGroup) {
      for (const instance of this.bigGroup.pads) {
        const available = availableList[instance.pad.index];
        if (available !== undefined && available !== instance.isAvailable) {
          instance.isAvailable = available;
          bigChanged = true;
        }
        if (instance.isAvailable) {
          instance.bobPhase += deltaTime * ORB_BOB_SPEED;
          instance.spinPhase += deltaTime * RING_SPIN_SPEED;
          bigChanged = true;
        }
      }
      if (bigChanged) this.rebuildBigPads();
    }

    if (this.smallGroup) {
      for (const instance of this.smallGroup.pads) {
        const available = availableList[instance.pad.index];
        if (available !== undefined && available !== instance.isAvailable) {
          instance.isAvailable = available;
          smallChanged = true;
        }
        if (instance.isAvailable) {
          instance.bobPhase += deltaTime * ORB_BOB_SPEED;
          instance.spinPhase += deltaTime * CHEVRON_SPIN_SPEED;
          smallChanged = true;
        }
      }
      if (smallChanged) this.rebuildSmallPads();
    }
  }

  public clear() {
    this.parentGroup.clear();

    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries.clear();

    for (const mat of this.materials) {
      mat.dispose();
    }
    this.materials.clear();

    this.bigGroup = null;
    this.smallGroup = null;
  }

  public dispose() {
    this.clear();
    this.scene.remove(this.parentGroup);
  }
}
