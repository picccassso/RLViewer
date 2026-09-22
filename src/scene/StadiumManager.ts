import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export const FIELD_WIDTH = 8192;   // X: -4096 to +4096
export const FIELD_LENGTH = 10240; // Z: -5120 to +5120
export const FIELD_CEILING = 2044; // Y: 0 to 2044
export const CORNER_SLANT = 8064;  // Length where 45 deg corners begin
export const GOAL_WIDTH = 1785.51;
export const GOAL_HEIGHT = 642.775;
export const GOAL_DEPTH = 880;

export class StadiumManager {
  private scene: THREE.Scene;
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private stadiumGroup: THREE.Group;
  private proceduralFieldGroup: THREE.Group;
  private lightsGroup: THREE.Group;
  private isDisposed: boolean = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.stadiumGroup = new THREE.Group();
    this.proceduralFieldGroup = new THREE.Group();
    this.lightsGroup = new THREE.Group();

    this.scene.add(this.stadiumGroup);
    this.scene.add(this.proceduralFieldGroup);
    this.scene.add(this.lightsGroup);

    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.setupLighting();
    this.setupProceduralArena();
    this.loadSkybox();
    this.loadStadiumGLB();
  }

  private setupLighting() {
    // Ambient light for base visibility
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.lightsGroup.add(ambient);

    // Hemisphere light: Sky blue/cyan, ground dark turf
    const hemiLight = new THREE.HemisphereLight(0x60a5fa, 0x064e3b, 0.45);
    this.lightsGroup.add(hemiLight);

    // Main stadium directional light with shadow mapping
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2000, 3500, 2000);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 500;
    dirLight.shadow.camera.far = 8000;
    const d = 5500;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    dirLight.target.position.set(0, 0, 0);
    this.lightsGroup.add(dirLight);
    this.lightsGroup.add(dirLight.target);

    // 4 Stadium floodlights at the corners of the stadium
    const corners = [
      { x: -3500, z: -4500, color: 0x93c5fd }, // Blue side
      { x: 3500, z: -4500, color: 0x93c5fd },  // Blue side
      { x: -3500, z: 4500, color: 0xfed7aa },  // Orange side
      { x: 3500, z: 4500, color: 0xfed7aa },   // Orange side
    ];

    corners.forEach((c) => {
      const flood = new THREE.SpotLight(c.color, 1.8, 8000, Math.PI / 4, 0.5, 1.2);
      flood.position.set(c.x, 2200, c.z);
      flood.target.position.set(c.x * 0.3, 0, c.z * 0.3);
      this.lightsGroup.add(flood);
      this.lightsGroup.add(flood.target);
    });

    // Glowing Goal Lights
    // Blue Goal Light (at -Z = -5120)
    const blueGoalLight = new THREE.PointLight(0x0088ff, 2.5, 2000, 1.5);
    blueGoalLight.position.set(0, GOAL_HEIGHT * 0.6, -FIELD_LENGTH / 2 + 50);
    this.lightsGroup.add(blueGoalLight);

    // Orange Goal Light (at +Z = +5120)
    const orangeGoalLight = new THREE.PointLight(0xff6600, 2.5, 2000, 1.5);
    orangeGoalLight.position.set(0, GOAL_HEIGHT * 0.6, FIELD_LENGTH / 2 - 50);
    this.lightsGroup.add(orangeGoalLight);
  }

  private loadSkybox() {
    try {
      const rgbeLoader = new RGBELoader();
      rgbeLoader.load(
        '/skyboxes/PlanetaryEarth4k.hdr',
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          this.scene.background = texture;
          this.scene.environment = texture;
          this.scene.backgroundBlurriness = 0.3;
        },
        undefined,
        (err) => {
          console.warn('Could not load HDR skybox, using procedural atmosphere:', err);
          this.scene.background = new THREE.Color(0x050811);
        }
      );
    } catch (err) {
      console.warn('Could not load HDR skybox, using procedural atmosphere:', err);
      this.scene.background = new THREE.Color(0x050811);
    }
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

      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.receiveShadow = true;
          mesh.castShadow = true;

          // Preserve materials, tune transparency & depth
          if (mesh.material) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat.name && /Hexagone_T[01]/i.test(mat.name)) {
              mat.transparent = true;
              mat.opacity = 0.35;
              mat.depthWrite = false;
            }
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

  public dispose() {
    this.isDisposed = true;
    this.scene.remove(this.stadiumGroup);
    this.scene.remove(this.proceduralFieldGroup);
    this.scene.remove(this.lightsGroup);
    this.dracoLoader.dispose();
  }
}
