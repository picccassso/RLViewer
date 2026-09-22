import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ParsedReplayData, FrameState } from '../types/replay';
import { unpackFrame } from '../math/frameUnpacker';
import { StadiumManager } from './StadiumManager';
import { BoostPadManager } from './BoostPadManager';
import { BallManager } from './BallManager';
import { CarManager } from './CarManager';
import { CameraSuite, CameraMode } from '../camera/CameraSuite';
import { CameraSettings } from '../math/cameraMath';

interface ReplayVisualizerCanvasProps {
  replayData: ParsedReplayData | null;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  cameraMode: CameraMode;
  activePlayerIndex: number;
  isBallCam: boolean;
  cameraSettings: CameraSettings;
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
  isBallCam,
  cameraSettings,
  onTimeUpdate,
  onSelectPlayer,
  onTogglePlay,
  onToggleBallCam,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // References to three.js scene managers
  const managersRef = useRef<{
    renderer: THREE.WebGLRenderer;
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
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // 2. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060913);

    // 3. Subsystem Managers
    const cameraSuite = new CameraSuite(canvas, width / height);
    const stadium = new StadiumManager(scene);
    const boostPads = new BoostPadManager(scene);
    const ball = new BallManager(scene);
    const cars = new CarManager(scene);

    managersRef.current = {
      renderer,
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
      managersRef.current.cameraSuite.handleResize(newW, newH);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cameraSuite.dispose();
      stadium.dispose();
      boostPads.dispose();
      ball.dispose();
      cars.dispose();
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
    cameraSuite.setBallCam(isBallCam);
    cameraSuite.applySettings(cameraSettings);
  }, [cameraMode, activePlayerIndex, isBallCam, cameraSettings]);

  // Sync currentTime when seeking
  useEffect(() => {
    if (managersRef.current) {
      const diff = Math.abs(managersRef.current.clockTime - currentTime);
      // Only sync when paused or if user seeked (>80ms difference)
      // to avoid feedback jitter from delayed React state during continuous playback
      if (!isPlaying || diff > 0.08) {
        managersRef.current.clockTime = currentTime;
        if (diff > 0.4) {
          managersRef.current.ball.resetTrail();
        }
      }
    }
  }, [currentTime, isPlaying]);

  // Render & Playback Loop
  useEffect(() => {
    let animId: number;

    const renderLoop = (now: number) => {
      animId = requestAnimationFrame(renderLoop);
      if (!managersRef.current || !replayData) return;

      const { renderer, scene, cameraSuite, boostPads, ball, cars } = managersRef.current;
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
      const fps = replayData.frameRate || 30;
      const exactFrame = matchTime * fps;
      const frameA = Math.floor(exactFrame);
      const frameB = Math.min(frameA + 1, replayData.totalFrames - 1);
      const alpha = exactFrame - frameA;

      // Unpack smooth interpolated frame state
      const frameState = unpackFrame(replayData, frameA, frameB, alpha);

      // Update 3D entities
      ball.update(frameState.ball.position, frameState.ball.rotation);
      cars.updateCars(frameState);
      boostPads.updateStates(frameState.boostPadsAvailable, delta);

      // Update Camera
      cameraSuite.update(frameState, delta);

      // Render
      renderer.render(scene, cameraSuite.camera);

      // Callback to React HUD
      onTimeUpdate(matchTime, frameState.frameIndex, frameState);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [replayData, isPlaying, playbackSpeed, onTimeUpdate]);

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
