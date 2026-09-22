import * as THREE from 'three';
import { ReplayBoostPad } from '../types/replay';

interface PadMeshGroup {
  pad: ReplayBoostPad;
  group: THREE.Group;
  baseMesh: THREE.Mesh;
  coreMesh: THREE.Mesh;
  light?: THREE.PointLight;
  isAvailable: boolean;
}

export class BoostPadManager {
  private scene: THREE.Scene;
  private padMeshes: Map<number, PadMeshGroup> = new Map();
  private parentGroup: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.parentGroup = new THREE.Group();
    this.scene.add(this.parentGroup);
  }

  public initPads(boostPads: ReplayBoostPad[]) {
    this.clear();

    for (const pad of boostPads) {
      const isBig = pad.size === 'Big';
      const padGroup = new THREE.Group();
      padGroup.position.set(pad.position.x, 0, pad.position.z);

      // Base ring geometry
      const baseRadius = isBig ? 140 : 55;
      const baseHeight = isBig ? 12 : 5;
      const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 24);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        metalness: 0.8,
        roughness: 0.3,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = baseHeight / 2;
      padGroup.add(baseMesh);

      // Glowing core / pickup pill
      let coreMesh: THREE.Mesh;
      let light: THREE.PointLight | undefined;

      if (isBig) {
        // Big Boost: floating glowing orb / cylinder
        const coreGeo = new THREE.CylinderGeometry(baseRadius * 0.7, baseRadius * 0.7, 45, 24);
        const coreMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xd97706,
          emissiveIntensity: 1.2,
          transparent: true,
          opacity: 0.85,
        });
        coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.position.y = 35;
        padGroup.add(coreMesh);

        // Ambient point light
        light = new THREE.PointLight(0xf59e0b, 1.5, 450, 1.2);
        light.position.set(0, 50, 0);
        padGroup.add(light);
      } else {
        // Small pad: flat glowing disc
        const coreGeo = new THREE.CylinderGeometry(baseRadius * 0.75, baseRadius * 0.75, baseHeight + 1, 16);
        const coreMat = new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          emissive: 0xf59e0b,
          emissiveIntensity: 0.9,
          transparent: true,
          opacity: 0.9,
        });
        coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.position.y = baseHeight / 2 + 0.5;
        padGroup.add(coreMesh);
      }

      this.parentGroup.add(padGroup);
      this.padMeshes.set(pad.index, {
        pad,
        group: padGroup,
        baseMesh,
        coreMesh,
        light,
        isAvailable: true,
      });
    }
  }

  /**
   * Updates boost pad visual states (glowing vs dimmed) based on live frame bitmasks.
   */
  public updateStates(availableList: boolean[], deltaTime: number = 0.016) {
    for (let i = 0; i < availableList.length; i++) {
      const padGroup = this.padMeshes.get(i);
      if (!padGroup) continue;

      const isAvailable = availableList[i];
      if (padGroup.isAvailable !== isAvailable) {
        padGroup.isAvailable = isAvailable;
        const mat = padGroup.coreMesh.material as THREE.MeshStandardMaterial;

        if (isAvailable) {
          mat.color.setHex(padGroup.pad.size === 'Big' ? 0xf59e0b : 0xfbbf24);
          mat.emissive.setHex(padGroup.pad.size === 'Big' ? 0xd97706 : 0xf59e0b);
          mat.emissiveIntensity = padGroup.pad.size === 'Big' ? 1.2 : 0.9;
          mat.opacity = 0.9;
          if (padGroup.light) padGroup.light.intensity = 1.5;
        } else {
          // Dimmed cooldown state
          mat.color.setHex(0x374151);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
          mat.opacity = 0.25;
          if (padGroup.light) padGroup.light.intensity = 0;
        }
      }

      // Gentle floating animation for big pads when active
      if (padGroup.isAvailable && padGroup.pad.size === 'Big') {
        padGroup.coreMesh.rotation.y += deltaTime * 1.5;
      }
    }
  }

  public clear() {
    this.padMeshes.forEach((item) => {
      this.parentGroup.remove(item.group);
      item.baseMesh.geometry.dispose();
      (item.baseMesh.material as THREE.Material).dispose();
      item.coreMesh.geometry.dispose();
      (item.coreMesh.material as THREE.Material).dispose();
      if (item.light) item.light.dispose();
    });
    this.padMeshes.clear();
  }

  public dispose() {
    this.clear();
    this.scene.remove(this.parentGroup);
  }
}
