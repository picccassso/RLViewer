import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ParsedReplayData, FrameState } from '../types/replay';
import { getFrameSampleAtTime, unpackFrame } from '../math/frameUnpacker';
import { StadiumManager } from './StadiumManager';
import { PostProcessing } from './PostProcessing';
import { BoostPadManager } from './BoostPadManager';
import { BallManager } from './BallManager';
import { CarManager } from './CarManager';
import { CameraSuite, CameraMode } from '../camera/CameraSuite';
import { CameraSettings } from '../math/cameraMath';

/**
 * Playback draws at most ~60 fps: replays are recorded at ~30 Hz and interpolated, so faster
 * screens only burn power. A frame is drawn once 80% of a 60 fps interval has passed, which
 * gives 120 Hz screens every other refresh without dropping 144 Hz screens to 48 fps.
 */
const MIN_FRAME_MS = (1000 / 60) * 0.8;
/** How long a paused replay keeps drawing after something changes, so camera smoothing settles. */
const PAUSED_SETTLE_MS = 2000;
/** Retina screens render at 1.5x and are upscaled: slightly softer, ~45% fewer pixels to shade. */
const MAX_PIXEL_RATIO = 1.5;

interface ReplayVisualizerCanvasProps {
  replayData: ParsedReplayData | null;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  cameraMode: CameraMode;
  activePlayerIndex: number;
  ballCamOverride: boolean | null;
  cameraSettings: CameraSettings;
  seekTarget?: { time: number; id: number } | null;
  showHud: boolean;
  onTimeUpdate: (time: number, frameIndex: number, state: FrameState) => void;
  onSelectPlayer: (index: number) => void;
  onTogglePlay: () => void;
  onToggleBallCam: () => void;
}

export const ReplayVisualizerCanvas: React.FC<ReplayVisualizerCanvasProps> = ({
  replayData,
  currentTime,
  isPlaying,
  playbackSpeed,
  cameraMode,
  activePlayerIndex,
  ballCamOverride,
  cameraSettings,
  seekTarget,
  showHud,
  onTimeUpdate,
  onSelectPlayer,
  onTogglePlay,
  onToggleBallCam,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastHudUpdateRef = useRef<number>(0);
  const appliedSeekRef = useRef<{ time: number; id: number } | null>(null);
  // Keeps a paused replay drawing for a moment after a change; set by the render loop.
  const wakeRef = useRef<() => void>(() => {});

  // References to three.js scene managers
  const managersRef = useRef<{
    renderer: THREE.WebGLRenderer;
    postProcessing: PostProcessing;
    labelRenderer: CSS2DRenderer;
    scene: THREE.Scene;
    stadium: StadiumManager;
    boostPads: BoostPadManager;
    ball: BallManager;
    cars: CarManager;
    cameraSuite: CameraSuite;
    lastTime: number;
    clockTime: number;
  } | null>(null);

  // Initialize Three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      // Anti-aliasing happens in the post-processing scene target; the canvas only gets a fullscreen quad.
      antialias: false,
      // No 'high-performance': on dual-GPU laptops it forces the hot discrete GPU on.
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const postProcessing = new PostProcessing(renderer, width, height);
    // Player nameplates are HTML laid over the canvas, under the HUD panels.
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '0' });
    container.appendChild(labelRenderer.domElement);

    // 2. Scene
    const scene = new THREE.Scene();

    // 3. Subsystem Managers
    const cameraSuite = new CameraSuite(canvas, width / height);
    // Free camera drags and their damping redraw a paused replay.
    const wakeOnCameraChange = () => wakeRef.current();
    cameraSuite.controls.addEventListener('change', wakeOnCameraChange);
    (window as any).__TMP_DEBUG = { scene, renderer, cameraSuite, postProcessing };
    const stadium = new StadiumManager(scene);
    stadium.initEnvironment(renderer);
    const boostPads = new BoostPadManager(scene);
    const ball = new BallManager(scene);
    const cars = new CarManager(scene);

    managersRef.current = {
      renderer,
      postProcessing,
      labelRenderer,
      scene,
      stadium,
      boostPads,
      ball,
      cars,
      cameraSuite,
      lastTime: performance.now(),
      clockTime: 0,
    };

    // Resize listener
    const handleResize = () => {
      if (!container || !managersRef.current) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      managersRef.current.renderer.setSize(newW, newH);
      managersRef.current.postProcessing.setSize(newW, newH);
      managersRef.current.labelRenderer.setSize(newW, newH);
      managersRef.current.cameraSuite.handleResize(newW, newH);
      wakeRef.current();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cameraSuite.controls.removeEventListener('change', wakeOnCameraChange);
      cameraSuite.dispose();
      stadium.dispose();
      boostPads.dispose();
      ball.dispose();
      cars.dispose();
      postProcessing.dispose();
      labelRenderer.domElement.remove();
      renderer.dispose();
      managersRef.current = null;
    };
  }, []);

  // Update entities when replayData changes
  useEffect(() => {
    if (!replayData || !managersRef.current) return;

    const { boostPads, cars, ball } = managersRef.current;
    boostPads.initPads(replayData.boostPads);
    cars.initCars(replayData.players);
    ball.resetTrail();

    // Reset clock
    managersRef.current.clockTime = 0;
  }, [replayData]);

  // Sync external camera settings & mode
  useEffect(() => {
    if (!managersRef.current) return;
    const { cameraSuite } = managersRef.current;
    cameraSuite.setMode(cameraMode);
    cameraSuite.setPlayer(activePlayerIndex);
    // null means reproduce the selected player's recorded Ball Cam changes.
    cameraSuite.setBallCam(ballCamOverride);
    cameraSuite.applySettings(cameraSettings);
    wakeRef.current();
  }, [cameraMode, activePlayerIndex, ballCamOverride, cameraSettings]);

  useEffect(() => {
    managersRef.current?.cars.setNameplatesVisible(showHud);
    wakeRef.current();
  }, [showHud]);

  // Apply explicit user seek actions (timeline scrubbing, clicking event marks, frame stepping).
  // Each seek applies once: this effect also re-runs on pause, camera and player changes,
  // which must not rewind the clock to the last seek.
  useEffect(() => {
    if (!managersRef.current || !seekTarget || seekTarget === appliedSeekRef.current) return;
    appliedSeekRef.current = seekTarget;

    const diff = Math.abs(managersRef.current.clockTime - seekTarget.time);
    managersRef.current.clockTime = seekTarget.time;
    if (diff > 0.4) {
      managersRef.current.ball.resetTrail();
      managersRef.current.cameraSuite.snap();
    }

    // When paused, immediately unpack and render the target frame for snappy feedback
    if (!isPlaying && replayData) {
      const { postProcessing, labelRenderer, scene, stadium, cameraSuite, boostPads, ball, cars } = managersRef.current;
      const { frameA, frameB, alpha } = getFrameSampleAtTime(replayData, seekTarget.time);

      const frameState = unpackFrame(replayData, frameA, frameB, alpha);
      const activePov = cameraMode === 'pov' ? activePlayerIndex : null;
      ball.update(frameState.ball.position, frameState.ball.rotation);
      cars.updateCars(frameState, activePov);
      boostPads.updateStates(frameState.boostPadsAvailable, 0.016);
      cameraSuite.update(frameState, 0.016);
      stadium.setSightline(cameraSuite.camera.position, cameraSuite.followTarget);
      postProcessing.render(scene, cameraSuite.camera);
      labelRenderer.render(scene, cameraSuite.camera);

      onTimeUpdate(seekTarget.time, frameState.frameIndex, frameState);
    }
    wakeRef.current();
  }, [seekTarget, isPlaying, replayData, cameraMode, activePlayerIndex, onTimeUpdate]);

  // Render & Playback Loop. While paused the loop stops entirely once the picture has
  // settled, and wakeRef restarts it when something changes.
  useEffect(() => {
    let animId = 0;
    let awakeUntil = 0;

    const renderLoop = (now: number) => {
      animId = 0;
      if (!managersRef.current || !replayData) return;
      if (!isPlaying && now > awakeUntil) return;
      animId = requestAnimationFrame(renderLoop);
      if (now - managersRef.current.lastTime < MIN_FRAME_MS) return;

      const { postProcessing, labelRenderer, scene, stadium, cameraSuite, boostPads, ball, cars } = managersRef.current;
      const delta = Math.min((now - managersRef.current.lastTime) / 1000, 0.1);
      managersRef.current.lastTime = now;

      // Advance match time when playing
      if (isPlaying) {
        managersRef.current.clockTime += delta * playbackSpeed;
        if (managersRef.current.clockTime > replayData.duration) {
          managersRef.current.clockTime = 0; // loop match
        }
      }

      const matchTime = managersRef.current.clockTime;
      const { frameA, frameB, alpha } = getFrameSampleAtTime(replayData, matchTime);

      // Unpack smooth interpolated frame state
      const frameState = unpackFrame(replayData, frameA, frameB, alpha);

      // Update 3D entities
      const activePov = cameraMode === 'pov' ? activePlayerIndex : null;
      ball.update(frameState.ball.position, frameState.ball.rotation);
      cars.updateCars(frameState, activePov);
      boostPads.updateStates(frameState.boostPadsAvailable, delta);

      // Update Camera
      cameraSuite.update(frameState, delta);
      stadium.setSightline(cameraSuite.camera.position, cameraSuite.followTarget);

      // Render
      postProcessing.render(scene, cameraSuite.camera);
      labelRenderer.render(scene, cameraSuite.camera);

      // Callback to React HUD throttled to ~30 FPS during playback
      // to keep the Three.js 60-144 FPS render loop buttery smooth
      const nowMs = performance.now();
      if (!isPlaying || nowMs - lastHudUpdateRef.current >= 33) {
        lastHudUpdateRef.current = nowMs;
        onTimeUpdate(matchTime, frameState.frameIndex, frameState);
      }
    };

    const wake = () => {
      awakeUntil = performance.now() + PAUSED_SETTLE_MS;
      if (animId) return;
      // Measure the first frame from now, not from whenever the loop last stopped.
      if (managersRef.current) managersRef.current.lastTime = performance.now() - MIN_FRAME_MS;
      animId = requestAnimationFrame(renderLoop);
    };
    wakeRef.current = wake;
    wake();
    return () => {
      cancelAnimationFrame(animId);
      wakeRef.current = () => {};
    };
  }, [replayData, isPlaying, playbackSpeed, cameraMode, activePlayerIndex, onTimeUpdate]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when focused in inputs
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        onToggleBallCam();
      } else if (e.code === 'KeyK') {
        e.preventDefault();
        onTogglePlay();
      } else if (e.code >= 'Digit1' && e.code <= 'Digit6') {
        const playerNum = parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (replayData && playerNum < replayData.players.length) {
          onSelectPlayer(playerNum);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [replayData, onTogglePlay, onToggleBallCam, onSelectPlayer]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
