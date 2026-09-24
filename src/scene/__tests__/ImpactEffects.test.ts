import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ImpactEffects } from '../ImpactEffects';
import { FrameState, ParsedReplayData } from '../../types/replay';

function createDummyReplayData(): ParsedReplayData {
  return {
    totalFrames: 10,
    duration: 1.0,
    frameRate: 30,
    players: [],
    boostPads: [],
    tickMarks: [],
    teamScores: { team0: 0, team1: 0 },
    flipResets: [],
    ballTouches: [
      { time: 0.1, team: 0, flip: false },
    ],
    demolitions: [],
    framesBuffer: new Float32Array(10 * 300),
  };
}

describe('ImpactEffects', () => {
  it('initializes with double-sided additive shader material and faces streaks towards camera', () => {
    const scene = new THREE.Scene();
    const impacts = new ImpactEffects(scene);

    const mesh = (impacts as any).mesh as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
    expect(mesh).toBeDefined();
    expect(mesh.material.side).toBe(THREE.DoubleSide);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.blending).toBe(THREE.AdditiveBlending);
    expect(mesh.frustumCulled).toBe(false);

    // Verify streak cross product faces the camera: cross(toCamera, along)
    expect(mesh.material.vertexShader).toContain('cross(toCamera, along)');
    expect(mesh.material.vertexShader).not.toContain('cross(along, toCamera)');

    impacts.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('updates instance attributes and sets visibility when impacts or sparks occur', () => {
    const scene = new THREE.Scene();
    const impacts = new ImpactEffects(scene);
    const replay = createDummyReplayData();
    impacts.setReplay(replay);

    const frameState: FrameState = {
      frameIndex: 3,
      time: 0.12,
      secondsRemaining: 300,
      ball: {
        position: { x: 0, y: 100, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 0, y: 0, z: 0 },
      },
      players: [],
      boostPadsAvailable: [],
    };

    const mesh = (impacts as any).mesh as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

    // At time 0.12 (0.02s after touch at 0.1), contact hit and sparks should emit instances
    impacts.update(frameState);
    expect(mesh.geometry.instanceCount).toBeGreaterThan(0);
    expect(mesh.visible).toBe(true);

    // Far later after sparks and hit effect fade out
    frameState.time = 5.0;
    impacts.update(frameState);
    expect(mesh.geometry.instanceCount).toBe(0);
    expect(mesh.visible).toBe(false);

    impacts.dispose();
  });
});
