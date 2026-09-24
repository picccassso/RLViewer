import * as THREE from 'three';
import { ReplayBoostPad } from '../types/replay';

// Visual sizes in uu, scaled against the car (Octane ~118 long, ~84 wide): a car parked on a
// big pad covers most of it, and a small pad disappears under the car. These are the drawn
// shapes, not the pickup hitboxes (radius 208 / 144), which are much larger.
// A big pad's core is an orb floating about roof height that bobs gently; a small pad's is a
// flat glowing puck set into the base.
const PAD_DIMENSIONS = {
  big: { baseRadius: 80, baseHeight: 8, coreRadius: 36, coreCenter: 70, bobAmplitude: 6 },
  small: { baseRadius: 28, baseHeight: 4, coreRadius: 21, coreCenter: 2.5, bobAmplitude: 0 },
} as const;
const SMALL_CORE_HEIGHT = 5;
const ORB_BOB_SPEED = 2.5; // radians per second

interface PadInstance {
  pad: ReplayBoostPad;
  isAvailable: boolean;
  bobPhase: number;
}

interface PadBatch {
  isBig: boolean;
  pads: PadInstance[];
  base: THREE.InstancedMesh;
  activeCore: THREE.InstancedMesh;
  inactiveCore: THREE.InstancedMesh;
}

export class BoostPadManager {
  private scene: THREE.Scene;
  private parentGroup: THREE.Group;
  private batches: PadBatch[] = [];
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.parentGroup = new THREE.Group();
    this.scene.add(this.parentGroup);
  }

  public initPads(boostPads: ReplayBoostPad[]) {
    this.clear();

    for (const isBig of [true, false]) {
      const pads = boostPads.filter((pad) => (pad.size === 'Big') === isBig);
      if (pads.length === 0) continue;

      const dims = isBig ? PAD_DIMENSIONS.big : PAD_DIMENSIONS.small;
      const base = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(dims.baseRadius, dims.baseRadius, dims.baseHeight, 24),
        new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 }),
        pads.length
      );

      const coreGeometry = isBig
        ? new THREE.SphereGeometry(dims.coreRadius, 24, 16)
        : new THREE.CylinderGeometry(dims.coreRadius, dims.coreRadius, SMALL_CORE_HEIGHT, 16);
      const activeCore = new THREE.InstancedMesh(
        coreGeometry,
        new THREE.MeshStandardMaterial({
          color: isBig ? 0xf59e0b : 0xfbbf24,
          emissive: isBig ? 0xd97706 : 0xf59e0b,
          emissiveIntensity: isBig ? 1.2 : 0.9,
          transparent: true,
          opacity: 0.9,
        }),
        pads.length
      );
      const inactiveCore = new THREE.InstancedMesh(
        coreGeometry,
        new THREE.MeshStandardMaterial({
          color: 0x374151,
          transparent: true,
          opacity: 0.25,
        }),
        pads.length
      );

      for (const mesh of [base, activeCore, inactiveCore]) {
        // Pads span the field, so culling a whole batch would hide visible pads.
        mesh.frustumCulled = false;
        this.parentGroup.add(mesh);
      }
      activeCore.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const batch: PadBatch = {
        isBig,
        // Offset each orb's phase so the big pads don't bob in lockstep.
        pads: pads.map((pad) => ({ pad, isAvailable: true, bobPhase: pad.index })),
        base,
        activeCore,
        inactiveCore,
      };
      this.batches.push(batch);

      for (let i = 0; i < pads.length; i++) {
        this.setInstanceTransform(base, i, pads[i], dims.baseHeight / 2);
      }
      base.instanceMatrix.needsUpdate = true;
      this.rebuildCores(batch);
    }
  }

  private setInstanceTransform(
    mesh: THREE.InstancedMesh,
    index: number,
    pad: ReplayBoostPad,
    height: number
  ) {
    this.dummy.position.set(pad.position.x, height, pad.position.z);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private rebuildCores(batch: PadBatch, updateInactive = true) {
    const dims = batch.isBig ? PAD_DIMENSIONS.big : PAD_DIMENSIONS.small;
    let activeCount = 0;
    let inactiveCount = 0;

    for (const instance of batch.pads) {
      const mesh = instance.isAvailable ? batch.activeCore : batch.inactiveCore;
      const index = instance.isAvailable ? activeCount++ : inactiveCount++;
      if (instance.isAvailable) {
        const bob = Math.sin(instance.bobPhase) * dims.bobAmplitude;
        this.setInstanceTransform(mesh, index, instance.pad, dims.coreCenter + bob);
      } else if (updateInactive) {
        this.setInstanceTransform(mesh, index, instance.pad, dims.coreCenter);
      }
    }

    batch.activeCore.count = activeCount;
    batch.inactiveCore.count = inactiveCount;
    batch.activeCore.instanceMatrix.needsUpdate = true;
    if (updateInactive) batch.inactiveCore.instanceMatrix.needsUpdate = true;
  }

  /** Updates pad batches when pickups become available or enter cooldown. */
  public updateStates(availableList: boolean[], deltaTime: number = 0.016) {
    for (const batch of this.batches) {
      let changed = false;
      let hasActiveBigPad = false;
      for (const instance of batch.pads) {
        const available = availableList[instance.pad.index];
        if (available !== undefined && available !== instance.isAvailable) {
          instance.isAvailable = available;
          changed = true;
        }
        if (batch.isBig && instance.isAvailable) {
          instance.bobPhase += deltaTime * ORB_BOB_SPEED;
          hasActiveBigPad = true;
        }
      }
      if (changed || hasActiveBigPad) this.rebuildCores(batch, changed);
    }
  }

  public clear() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const batch of this.batches) {
      for (const mesh of [batch.base, batch.activeCore, batch.inactiveCore]) {
        this.parentGroup.remove(mesh);
        mesh.dispose();
        geometries.add(mesh.geometry);
        materials.add(mesh.material as THREE.Material);
      }
    }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.batches = [];
  }

  public dispose() {
    this.clear();
    this.scene.remove(this.parentGroup);
  }
}
