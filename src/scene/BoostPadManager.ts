import * as THREE from 'three';
import { ReplayBoostPad } from '../types/replay';

interface PadInstance {
  pad: ReplayBoostPad;
  isAvailable: boolean;
  rotation: number;
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

      const radius = isBig ? 140 : 55;
      const height = isBig ? 12 : 5;
      const base = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(radius, radius, height, 24),
        new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 }),
        pads.length
      );

      const coreGeometry = isBig
        ? new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 45, 24)
        : new THREE.CylinderGeometry(radius * 0.75, radius * 0.75, height + 1, 16);
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
        pads: pads.map((pad) => ({ pad, isAvailable: true, rotation: 0 })),
        base,
        activeCore,
        inactiveCore,
      };
      this.batches.push(batch);

      for (let i = 0; i < pads.length; i++) {
        this.setInstanceTransform(base, i, pads[i], height / 2, 0);
      }
      base.instanceMatrix.needsUpdate = true;
      this.rebuildCores(batch);
    }
  }

  private setInstanceTransform(
    mesh: THREE.InstancedMesh,
    index: number,
    pad: ReplayBoostPad,
    height: number,
    rotation: number
  ) {
    this.dummy.position.set(pad.position.x, height, pad.position.z);
    this.dummy.rotation.set(0, rotation, 0);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private rebuildCores(batch: PadBatch, updateInactive = true) {
    const coreHeight = batch.isBig ? 35 : 3;
    let activeCount = 0;
    let inactiveCount = 0;

    for (const instance of batch.pads) {
      const mesh = instance.isAvailable ? batch.activeCore : batch.inactiveCore;
      const index = instance.isAvailable ? activeCount++ : inactiveCount++;
      if (instance.isAvailable || updateInactive) {
        this.setInstanceTransform(mesh, index, instance.pad, coreHeight, instance.rotation);
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
          instance.rotation += deltaTime * 1.5;
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
