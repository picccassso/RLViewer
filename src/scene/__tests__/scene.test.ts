import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CarManager, applyTeamPaint } from '../CarManager';
import { carModelFor, carDisplayName } from '../carBodies';
import { StadiumManager } from '../StadiumManager';
import { BallManager, BALL_RADIUS } from '../BallManager';
import { BoostPadManager } from '../BoostPadManager';
import { CameraSuite } from '../../camera/CameraSuite';
import { PlayerInfo, FrameState } from '../../types/replay';
import { DEFAULT_CAMERA_SETTINGS } from '../../math/cameraMath';
import { FLOATS_PER_BALL, FLOATS_PER_PLAYER, MAX_PLAYERS, ParsedReplayData, TOTAL_FLOATS_PER_FRAME } from '../../types/replay';
import { unpackFrame } from '../../math/frameUnpacker';

function createMockPlayers(): PlayerInfo[] {
  return [
    {
      index: 0,
      id: 'p0',
      name: 'Blue Striker',
      team: 0,
      car_body_id: 23,
      car_hitbox_family: 'Octane',
      camera_settings: { ...DEFAULT_CAMERA_SETTINGS },
    },
    {
      index: 1,
      id: 'p1',
      name: 'Orange Defender',
      team: 1,
      car_body_id: 403,
      car_hitbox_family: 'Dominus',
      camera_settings: { ...DEFAULT_CAMERA_SETTINGS },
    },
    {
      index: 2,
      id: 'p2',
      name: 'Blue Wing',
      team: 0,
      car_body_id: 1171,
      car_hitbox_family: 'Fennec',
      camera_settings: { ...DEFAULT_CAMERA_SETTINGS },
    },
  ];
}

function createMockFrameState(): FrameState {
  return {
    frameIndex: 100,
    time: 3.33,
    secondsRemaining: 296,
    ball: {
      position: { x: 100, y: 350, z: -200 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 50, y: 120, z: -80 },
    },
    players: [
      {
        info: {
          index: 0,
          id: 'p0',
          name: 'Blue Striker',
          team: 0,
          car_body_id: 23,
          car_hitbox_family: 'Octane',
          camera_settings: { ...DEFAULT_CAMERA_SETTINGS },
        },
        isPresent: true,
        isDemoed: false,
        ballCamActive: true,
        position: { x: 120, y: 17, z: -600 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 1000, y: 0, z: 200 },
        boost: 85,
        boostActive: true,
        powerslideActive: false,
        jumpActive: false,
        dodgeActive: false,
        supersonic: false,
      },
      {
        info: {
          index: 1,
          id: 'p1',
          name: 'Orange Defender',
          team: 1,
          car_body_id: 403,
          car_hitbox_family: 'Dominus',
          camera_settings: { ...DEFAULT_CAMERA_SETTINGS },
        },
        isPresent: true,
        isDemoed: false,
        ballCamActive: false,
        position: { x: -300, y: 17, z: 2000 },
        rotation: { x: 0, y: 0.707, z: 0, w: 0.707 },
        velocity: { x: 400, y: 0, z: -1200 },
        boost: 33,
        boostActive: false,
        powerslideActive: false,
        jumpActive: false,
        dodgeActive: false,
        supersonic: false,
      },
    ],
    boostPadsAvailable: Array.from({ length: 34 }, (_, i) => i % 3 !== 0),
  };
}

function createSimulatedCarGLTF(carName: string) {
  const carScene = new THREE.Group();
  carScene.name = carName;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(100, 30, 80),
    new THREE.MeshStandardMaterial({ name: carName + '_Body' })
  );
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(100, 10, 80),
    new THREE.MeshStandardMaterial({ name: carName + '_Chassis' })
  );
  const wheelFR = new THREE.Group();
  wheelFR.name = 'Wheel_FR';
  const wheelFL = new THREE.Group();
  wheelFL.name = 'Wheel_FL';
  const wheelBR = new THREE.Group();
  wheelBR.name = 'Wheel_BR';
  const wheelBL = new THREE.Group();
  wheelBL.name = 'Wheel_BL';
  carScene.add(body, chassis, wheelFR, wheelFL, wheelBR, wheelBL);
  return { scene: carScene };
}

function createSimulatedWheelGLTF() {
  const wheelScene = new THREE.Group();
  wheelScene.name = 'Wheel_Boog_Root';
  const pneu = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 10),
    new THREE.MeshStandardMaterial({ name: 'Wheel_Boog_Pneu' })
  );
  pneu.name = 'Wheel_Boog_Pneu';
  const jante = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 10, 10),
    new THREE.MeshStandardMaterial({ name: 'Wheel_Boog_Jante' })
  );
  jante.name = 'Wheel_Boog_Jante';
  wheelScene.add(pneu, jante);
  return { scene: wheelScene };
}

describe('Scene Graph & Manager Integrity Verification', () => {
  it('CarManager: rolls mirrored wheel mounts at their own radii without moving the axles', async () => {
    const manager = new CarManager(new THREE.Scene());
    (manager as any).gltfLoader.loadAsync = async (url: string) => {
      if (url.includes('Wheel_Boog')) {
        const scene = new THREE.Group();
        const geometry = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 24);
        geometry.rotateX(Math.PI / 2);
        scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
        return { scene };
      }
      const model = createSimulatedCarGLTF('Octane');
      model.scene.traverse((object) => {
        if (!/^Wheel_(FR|FL|BR|BL)$/.test(object.name)) return;
        object.position.set(object.name.includes('_F') ? 0.5 : -0.35, -0.05, object.name.endsWith('L') ? -0.3 : 0.3);
        object.scale.setScalar(object.name.includes('_F') ? 0.75 : 0.84);
        if (object.name.endsWith('L')) object.rotation.y = Math.PI;
      });
      return model;
    };
    const players = [createMockPlayers()[0]];
    manager.initCars(players);
    const framesBuffer = new Float32Array(3 * TOTAL_FLOATS_PER_FRAME);
    for (let f = 0; f < 3; f++) {
      const o = f * TOTAL_FLOATS_PER_FRAME;
      framesBuffer.set([f * 15, 17, 0, 0, 0, 0, 1, 300, 0, 0, 0, 1], o + FLOATS_PER_BALL);
      framesBuffer[o + FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER] = f * 0.05;
    }
    const data: ParsedReplayData = { framesBuffer, players, totalFrames: 3, duration: 0.1, frameRate: 20,
      boostPads: [], tickMarks: [], teamScores: { team0: 0, team1: 0 }, ballTouches: [], flipResets: [], demolitions: [] };
    manager.setReplay(data);
    manager.updateCars(unpackFrame(data, 1));
    // A model finishing its async load while paused still gets the current wheel phase.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const entity = (manager as any).carEntities.get(0);
    expect(entity.wheels).toHaveLength(4);
    const right = entity.carMesh.getObjectByName('Wheel_FR') as THREE.Object3D;
    const left = entity.carMesh.getObjectByName('Wheel_FL') as THREE.Object3D;
    const rear = entity.carMesh.getObjectByName('Wheel_BR') as THREE.Object3D;
    expect(right.children[0].rotation.z).toBeCloseTo(-15 / 12, 4);
    expect(left.children[0].rotation.z).toBeCloseTo(15 / 12, 4);
    expect(rear.children[0].rotation.z).toBeCloseTo(-15 / 13.44, 4);
    expect(right.position.toArray()).toEqual([0.5, -0.05, 0.3]);
    const paused = right.children[0].quaternion.clone();
    manager.updateCars(unpackFrame(data, 1));
    expect(right.children[0].quaternion.equals(paused)).toBe(true);
    manager.updateCars(unpackFrame(data, 2));
    expect(right.children[0].quaternion.equals(paused)).toBe(false);
    manager.updateCars(unpackFrame(data, 1));
    expect(right.children[0].quaternion.equals(paused)).toBe(true);
    manager.dispose();
  });

  it('CarManager: attaches wheels to exact wheel bones without recursion or cycles', () => {
    const scene = new THREE.Scene();
    const carManager = new CarManager(scene);

    const players = createMockPlayers();
    carManager.initCars(players);

    // Verify initial procedural objects are attached
    expect(carManager.getCarObject(0)).not.toBeNull();
    expect(carManager.getCarObject(1)).not.toBeNull();
    expect(carManager.getCarObject(2)).not.toBeNull();

    // Verify updateMatrixWorld runs without recursion or error on procedural setup
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Simulate the exact GLB car and wheel model hierarchy that previously caused infinite recursion:
    // A car model with Wheel_FR, Wheel_FL, Wheel_BR, Wheel_BL bones
    const simulatedCarModel = new THREE.Group();
    simulatedCarModel.name = 'SimulatedOctane';
    const wheelFR = new THREE.Group();
    wheelFR.name = 'Wheel_FR';
    const wheelFL = new THREE.Group();
    wheelFL.name = 'Wheel_FL';
    const wheelBR = new THREE.Group();
    wheelBR.name = 'Wheel_BR';
    const wheelBL = new THREE.Group();
    wheelBL.name = 'Wheel_BL';
    simulatedCarModel.add(wheelFR, wheelFL, wheelBR, wheelBL);

    // A wheel model whose children names also start with "Wheel_" (Wheel_Boog_Pneu, Wheel_Boog_Jante)
    const simulatedWheelModel = new THREE.Group();
    simulatedWheelModel.name = 'Wheel_Boog_Root';
    const pneu = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
    pneu.name = 'Wheel_Boog_Pneu';
    const jante = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8));
    jante.name = 'Wheel_Boog_Jante';
    simulatedWheelModel.add(pneu, jante);

    // Collect bones safely as implemented in CarManager
    const wheelBones: THREE.Object3D[] = [];
    simulatedCarModel.traverse((child) => {
      if (child.name && /^Wheel_(FR|FL|BR|BL)$/i.test(child.name)) {
        wheelBones.push(child);
      }
    });

    expect(wheelBones.length).toBe(4);

    for (const bone of wheelBones) {
      bone.clear();
      const wheelInstance = simulatedWheelModel.clone(true);
      bone.add(wheelInstance);
    }

    // Attach to player 0 car group
    const p0Car = carManager.getCarObject(0)!;
    p0Car.add(simulatedCarModel);

    // Verify that updateMatrixWorld executes cleanly with ZERO recursion error
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Verify depth and bone hierarchy
    expect(wheelFR.children.length).toBe(1);
    expect(wheelFR.children[0].name).toBe('Wheel_Boog_Root');
    expect(wheelFR.children[0].children.length).toBe(2);

    // Update cars with live frame
    const frameState = createMockFrameState();
    carManager.updateCars(frameState);

    // Re-verify updateMatrixWorld after frame transform updates
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Clean up
    carManager.dispose();
  });

  it('Proves naive startsWith("Wheel_") traversal causes recursive explosion whereas exact bone filter prevents it', () => {
    // 1. Simulate the previous bug: adding clones during in-flight traversal matching startsWith('Wheel_')
    const buggyCar = new THREE.Group();
    const wheelFR = new THREE.Group();
    wheelFR.name = 'Wheel_FR';
    buggyCar.add(wheelFR);

    const wheelModel = createSimulatedWheelGLTF().scene;

    // Simulate old naive logic with an iteration cap to safely demonstrate the infinite recursion
    let addedCount = 0;
    const maxIterations = 200;
    try {
      buggyCar.traverse((child) => {
        if (child.name && child.name.startsWith('Wheel_')) {
          addedCount++;
          if (addedCount > maxIterations) {
            throw new Error('Infinite recursion detected in naive traversal: count exceeded ' + maxIterations);
          }
          child.add(wheelModel.clone(true));
        }
      });
    } catch (err: any) {
      expect(err.message).toContain('Infinite recursion detected');
    }
    expect(addedCount).toBeGreaterThan(maxIterations);

    // 2. Fixed logic: filtering exact bone names and collecting before modifying scene tree
    const safeCar = new THREE.Group();
    const safeWheelFR = new THREE.Group();
    safeWheelFR.name = 'Wheel_FR';
    safeCar.add(safeWheelFR);

    const collectedBones: THREE.Object3D[] = [];
    safeCar.traverse((child) => {
      if (child.name && /^Wheel_(FR|FL|BR|BL)$/i.test(child.name)) {
        collectedBones.push(child);
      }
    });

    expect(collectedBones.length).toBe(1);
    for (const bone of collectedBones) {
      bone.clear();
      bone.add(wheelModel.clone(true));
    }

    // Now re-traverse safeCar: no bone matches /^Wheel_(FR|FL|BR|BL)$/ inside the attached wheel
    const secondPassBones: THREE.Object3D[] = [];
    safeCar.traverse((child) => {
      if (child.name && /^Wheel_(FR|FL|BR|BL)$/i.test(child.name)) {
        secondPassBones.push(child);
      }
    });
    // Exactly 1 attachment bone exists; its children (Wheel_Boog_Pneu, Wheel_Boog_Jante) are NOT matched
    expect(secondPassBones.length).toBe(1);
  });

  it('CarManager: verifies async model loading, wheel bone attachment, and deduplication through CarManager', async () => {
    const scene = new THREE.Scene();
    const carManager = new CarManager(scene);

    // Mock gltfLoader to return simulated models directly through CarManager's async loading pipeline
    (carManager as any).gltfLoader.loadAsync = async (url: string) => {
      if (url.includes('Wheel_Boog')) {
        return createSimulatedWheelGLTF();
      }
      return createSimulatedCarGLTF('Octane');
    };

    const players = createMockPlayers();
    carManager.initCars(players);

    // Allow async load promises to resolve
    await new Promise((r) => setTimeout(r, 60));

    // Verify all 3 entities have models loaded
    for (let i = 0; i < 3; i++) {
      const entity = (carManager as any).carEntities.get(i);
      expect(entity).toBeDefined();
      expect(entity.isModelLoaded).toBe(true);

      // Verify 4 wheel bones each have exactly 1 wheel instance attached
      const bones: THREE.Object3D[] = [];
      entity.carMesh.traverse((child: THREE.Object3D) => {
        if (child.name && /^Wheel_(FR|FL|BR|BL)$/i.test(child.name)) {
          bones.push(child);
        }
      });
      expect(bones.length).toBe(4);
      for (const b of bones) {
        expect(b.children.length).toBe(1);
        expect(b.children[0].name).toBe('Wheel_Boog_Root');
      }
    }

    // Verify updateMatrixWorld runs cleanly with 0 errors
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Re-initializing cars with new player list must clean up previous meshes without duplicate stacking
    carManager.initCars(players);
    await new Promise((r) => setTimeout(r, 60));
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    carManager.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('CarManager: supports all 7 car body types and attaches wheels cleanly', async () => {
    const scene = new THREE.Scene();
    const carManager = new CarManager(scene);

    (carManager as any).gltfLoader.loadAsync = async (url: string) => {
      if (url.includes('Wheel_Boog')) {
        return createSimulatedWheelGLTF();
      }
      const match = url.match(/\/cars\/([^/]+)\//);
      const name = match ? match[1] : 'octane';
      return createSimulatedCarGLTF(name);
    };

    const families = ['Octane', 'Dominus', 'Breakout', 'Plank', 'Hybrid', 'Merc', 'Fennec'];
    const players: PlayerInfo[] = families.map((fam, idx) => ({
      index: idx,
      id: `p${idx}`,
      name: `Player_${fam}`,
      team: (idx % 2 === 0 ? 0 : 1) as 0 | 1,
      car_body_id: idx * 10,
      car_hitbox_family: fam,
      camera_settings: { ...DEFAULT_CAMERA_SETTINGS },
    }));

    carManager.initCars(players);
    await new Promise((r) => setTimeout(r, 60));

    for (let i = 0; i < players.length; i++) {
      const entity = (carManager as any).carEntities.get(i);
      expect(entity).toBeDefined();
      expect(entity.isModelLoaded).toBe(true);
    }

    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Verify no cycles
    function verify(root: THREE.Object3D, set = new Set(), depth = 0) {
      expect(depth).toBeLessThan(30);
      expect(set.has(root)).toBe(false);
      set.add(root);
      for (const c of root.children) verify(c, set, depth + 1);
      set.delete(root);
    }
    verify(scene);

    carManager.dispose();
  });

  it('carModelFor: picks the car by body id, falling back to its hitbox family', () => {
    // The Fennec shares the Octane hitbox, so its family alone would draw it as an Octane
    expect(carModelFor(4284, 'Octane')).toBe('fennec');
    expect(carDisplayName(4284, 'Octane')).toBe('Fennec');
    expect(carModelFor(23, 'Octane')).toBe('octane');
    expect(carModelFor(1018, 'Dominus')).toBe('dominus');
    // Cars without a model of their own use one with the same hitbox
    expect(carModelFor(99999, 'Plank')).toBe('mantis');
    expect(carModelFor(99999, 'Hybrid')).toBe('x-devil');
    expect(carModelFor(99999, 'Breakout')).toBe('breakout');
    expect(carModelFor(0, '')).toBe('octane');
    expect(carDisplayName(99999, 'Plank')).toBe('Plank');
  });

  it('CarManager: loads the Fennec model for a Fennec even though it has an Octane hitbox', async () => {
    const scene = new THREE.Scene();
    const carManager = new CarManager(scene);
    const requested: string[] = [];
    (carManager as any).gltfLoader.loadAsync = async (url: string) => {
      requested.push(url);
      return url.includes('Wheel_Boog') ? createSimulatedWheelGLTF() : createSimulatedCarGLTF('fennec');
    };
    carManager.initCars([
      { ...createMockPlayers()[0], car_body_id: 4284, car_hitbox_family: 'Octane' },
    ]);
    await new Promise((r) => setTimeout(r, 60));
    expect(requested).toContain('/models/cars/fennec/fennec.glb');
    expect(requested).not.toContain('/models/cars/octane/octane.glb');
    carManager.dispose();
  });

  it('applyTeamPaint: patches the paint mask into the standard material shader', () => {
    const mat = new THREE.MeshStandardMaterial({ name: 'Octane_Body' });
    applyTeamPaint(mat, 1);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
    };
    mat.onBeforeCompile(shader as any, undefined as any);
    expect(shader.uniforms.teamPaint.value).toBeInstanceOf(THREE.Color);
    expect(shader.fragmentShader).toContain('uniform vec3 teamPaint;');
    expect(shader.fragmentShader).toContain('float paintMask =');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += teamPaint * paintMask');
    // The mask is declared before the emissive term uses it
    expect(shader.fragmentShader.indexOf('float paintMask =')).toBeLessThan(
      shader.fragmentShader.indexOf('teamPaint * paintMask')
    );
  });

  it('StadiumManager: constructs arena, lights, targets, and cleans up without cycles', () => {
    const scene = new THREE.Scene();
    const stadium = new StadiumManager(scene);

    const lightsGroup = (stadium as any).lightsGroup as THREE.Group;
    expect(lightsGroup).toBeDefined();

    // Verify directional light and its target are both in lightsGroup
    const dirLight = lightsGroup.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(dirLight).toBeDefined();
    expect(lightsGroup.children).toContain(dirLight.target);
    expect(lightsGroup.children.some((light) => light instanceof THREE.PointLight || light instanceof THREE.SpotLight)).toBe(false);

    // Verify updateMatrixWorld executes cleanly across lights and turf
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Verify scene children include stadium, procedural field, lights and surroundings groups
    expect(scene.children.length).toBe(4);

    // Verify disposal removes groups from the scene
    stadium.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('BallManager: updates positions, indicators, trails, and disposes cleanly', () => {
    const scene = new THREE.Scene();
    const ball = new BallManager(scene);

    // Test grounded update
    ball.update({ x: 0, y: BALL_RADIUS, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Test airborne update (activates indicator and ground line)
    ball.update({ x: 500, y: 800, z: -1200 }, { x: 0, y: 0.707, z: 0, w: 0.707 });
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Dispose
    ball.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('BoostPadManager: initializes pads and updates states cleanly', () => {
    const scene = new THREE.Scene();
    const boostPads = new BoostPadManager(scene);

    const mockPads = Array.from({ length: 34 }, (_, i) => ({
      index: i,
      pad_id: `pad_${i}`,
      size: (i < 6 ? 'Big' : 'Small') as 'Big' | 'Small',
      position: { x: (i - 17) * 200, y: 0, z: (i - 17) * 250 },
    }));

    boostPads.initPads(mockPads);
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();
    const padBatches = scene.children[0].children as THREE.InstancedMesh[];
    expect(padBatches).toHaveLength(6);
    expect(padBatches.map((batch) => batch.count)).toEqual([6, 6, 0, 28, 28, 0]);
    const firstPadMatrix = new THREE.Matrix4();
    padBatches[0].getMatrixAt(0, firstPadMatrix);
    expect(firstPadMatrix.elements[12]).toBe(mockPads[0].position.x);
    expect(firstPadMatrix.elements[13]).toBe(4);
    expect(firstPadMatrix.elements[14]).toBe(mockPads[0].position.z);
    const firstOrbMatrix = new THREE.Matrix4();
    padBatches[1].getMatrixAt(0, firstOrbMatrix);
    expect(firstOrbMatrix.elements[13]).toBeGreaterThanOrEqual(64);
    expect(firstOrbMatrix.elements[13]).toBeLessThanOrEqual(76);
    let localLights = 0;
    scene.traverse((object) => {
      if (object instanceof THREE.PointLight) localLights++;
    });
    expect(localLights).toBe(0);

    const availability = Array.from({ length: 34 }, (_, i) => i % 2 === 0);
    boostPads.updateStates(availability, 0.016);
    expect(padBatches.map((batch) => batch.count)).toEqual([6, 3, 3, 28, 14, 14]);
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    boostPads.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('CameraSuite: handles camera updates and disposes OrbitControls', () => {
    const mockDomElement = {
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      getRootNode: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
    } as unknown as HTMLElement;

    const suite = new CameraSuite(mockDomElement, 16 / 9);
    const frameState = createMockFrameState();

    // Test all modes
    suite.setMode('pov');
    suite.update(frameState, 0.016);

    suite.setMode('director');
    suite.update(frameState, 0.016);

    suite.setMode('tactical');
    suite.update(frameState, 0.016);

    suite.setMode('free');
    suite.update(frameState, 0.016);

    expect(suite.camera.position.lengthSq()).toBeGreaterThan(0);

    // Verify dispose does not throw
    expect(() => suite.dispose()).not.toThrow();
  });

  it('End-to-End: Full scene integration with cycle-detection traversal', () => {
    const scene = new THREE.Scene();
    const stadium = new StadiumManager(scene);
    const boostPads = new BoostPadManager(scene);
    const ball = new BallManager(scene);
    const cars = new CarManager(scene);

    const mockDomElement = {
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      getRootNode: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
    } as unknown as HTMLElement;
    const cameraSuite = new CameraSuite(mockDomElement, 16 / 9);

    const players = createMockPlayers();
    cars.initCars(players);

    const mockPads = Array.from({ length: 34 }, (_, i) => ({
      index: i,
      pad_id: `pad_${i}`,
      size: (i < 6 ? 'Big' : 'Small') as 'Big' | 'Small',
      position: { x: (i - 17) * 200, y: 0, z: (i - 17) * 250 },
    }));
    boostPads.initPads(mockPads);

    const frameState = createMockFrameState();
    ball.update(frameState.ball.position, frameState.ball.rotation);
    cars.updateCars(frameState);
    const groundShadows = (cars as any).groundShadows as THREE.InstancedMesh;
    expect(groundShadows.count).toBe(2);
    const firstShadowMatrix = new THREE.Matrix4();
    groundShadows.getMatrixAt(0, firstShadowMatrix);
    expect(firstShadowMatrix.elements[12]).toBe(frameState.players[0].position.x);
    expect(firstShadowMatrix.elements[13]).toBe(3);
    expect(firstShadowMatrix.elements[14]).toBe(frameState.players[0].position.z);
    frameState.players[0].position.y = 600;
    cars.updateCars(frameState);
    expect(groundShadows.count).toBe(1);
    boostPads.updateStates(frameState.boostPadsAvailable, 0.016);
    cameraSuite.update(frameState, 0.016);

    // Run matrix world update
    expect(() => scene.updateMatrixWorld(true)).not.toThrow();

    // Deep cycle detection: traverse every path in the scene graph
    function verifyNoCycles(root: THREE.Object3D, ancestors: Set<THREE.Object3D> = new Set(), depth = 0) {
      expect(depth).toBeLessThan(50); // Tree depth must remain healthy and shallow
      expect(ancestors.has(root)).toBe(false); // An object cannot be its own ancestor

      ancestors.add(root);
      for (const child of root.children) {
        verifyNoCycles(child, ancestors, depth + 1);
      }
      ancestors.delete(root);
    }

    verifyNoCycles(scene);

    // Cleanup
    cameraSuite.dispose();
    stadium.dispose();
    boostPads.dispose();
    ball.dispose();
    cars.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('CarManager: keeps nameplates straight above their cars however the car is rotated', () => {
    const scene = new THREE.Scene();
    const cars = new CarManager(scene);
    cars.initCars(createMockPlayers());

    const frameState = createMockFrameState();
    const car = frameState.players[0];
    // Upside down, e.g. driving on the ceiling or mid-flip
    car.rotation = { x: 1, y: 0, z: 0, w: 0 };
    cars.updateCars(frameState);

    const nameplate = (cars as any).carEntities.get(0).nameplate as THREE.Object3D;
    expect(nameplate.parent).not.toBe(cars.getCarObject(0));
    nameplate.updateWorldMatrix(true, false);
    const world = new THREE.Vector3().setFromMatrixPosition(nameplate.matrixWorld);
    expect(world.x).toBeCloseTo(car.position.x);
    expect(world.z).toBeCloseTo(car.position.z);
    expect(world.y).toBeGreaterThan(car.position.y + 50);

    cars.dispose();
  });

  it('CarManager: hides and restores all in-world nameplates with the HUD', () => {
    const scene = new THREE.Scene();
    const cars = new CarManager(scene);
    const players = createMockPlayers();
    cars.initCars(players);
    const nameplateOf = (index: number) => (cars as any).carEntities.get(index).nameplate as THREE.Object3D;

    cars.setNameplatesVisible(false);
    for (const player of players) {
      expect(nameplateOf(player.index).visible).toBe(false);
    }

    cars.setNameplatesVisible(true);
    for (const player of players) {
      expect(nameplateOf(player.index).visible).toBe(true);
    }

    cars.dispose();
  });

  it('CarManager: hides the followed POV player nameplate while keeping other players nameplates visible', () => {
    const scene = new THREE.Scene();
    const cars = new CarManager(scene);
    const players = createMockPlayers();
    cars.initCars(players);

    const frameState = createMockFrameState();

    // Following player 0 in POV:
    cars.updateCars(frameState, 0);

    const nameplate0 = (cars as any).carEntities.get(0).nameplate as THREE.Object3D;
    // Player 0 nameplate must be hidden so it doesn't block the camera view
    expect(nameplate0?.visible).toBe(false);

    const nameplate1 = (cars as any).carEntities.get(1).nameplate as THREE.Object3D;
    // Player 1 nameplate must remain visible
    expect(nameplate1?.visible).toBe(true);

    // Switch POV to player 1:
    cars.updateCars(frameState, 1);
    expect(nameplate0?.visible).toBe(true);
    expect(nameplate1?.visible).toBe(false);

    // Non-POV mode (activePovPlayerIndex = null):
    cars.updateCars(frameState, null);
    expect(nameplate0?.visible).toBe(true);
    expect(nameplate1?.visible).toBe(true);

    cars.dispose();
  });
});
