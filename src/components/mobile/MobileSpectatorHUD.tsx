import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Camera,
  Video,
  Compass,
  MapPin,
  Map,
  X,
  FileCode,
  RotateCcw,
  RotateCw,
  MoreVertical,
} from 'lucide-react';
import { ParsedReplayData, FrameState } from '../../types/replay';
import { CameraMode } from '../../camera/CameraSuite';
import { carDisplayName } from '../../scene/carBodies';
import { RLViewerLogo } from '../RLViewerLogo';
import { TacticalMinimap } from '../TacticalMinimap';
import { groupTimelineMarks, GoalIcon, SaveIcon } from '../PlaybackTimeline';
import type { AudioStatus } from '../../audio/ReplayAudio';

/** Compact 46px circular SVG boost gauge embedded directly in the mobile player capsule */
const MobileBoostGauge: React.FC<{ boost: number }> = ({ boost }) => {
  const amount = Math.min(Math.max(Math.round(boost), 0), 100);
  const size = 46;
  const centre = size / 2;
  const radius = 17;
  const strokeWidth = 4;
  const circumference = 2 * Math.PI * radius;
  const filled = (amount / 100) * circumference;

  return (
    <div className="relative select-none shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <defs>
          <radialGradient id="m-boost-disc">
            <stop offset="0%" stopColor="#1e293b" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.95" />
          </radialGradient>
          <linearGradient id="m-boost-fill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ff6a00" />
            <stop offset="100%" stopColor="#ffd23f" />
          </linearGradient>
        </defs>

        <circle
          cx={centre}
          cy={centre}
          r={centre - 1}
          fill="url(#m-boost-disc)"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1}
        />
        {/* Track */}
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
        />
        {/* Fill from 6 o'clock clockwise */}
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="url(#m-boost-fill)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(90 ${centre} ${centre})`}
          style={{ filter: amount > 0 ? 'drop-shadow(0 0 4px rgba(255, 140, 0, 0.8))' : undefined }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`text-[14px] font-bold italic leading-none tabular-nums ${
            amount > 0 ? 'text-white' : 'text-slate-500'
          }`}
          style={{ fontFamily: "'Chakra Petch', sans-serif", textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
        >
          {amount}
        </span>
        <span className="text-[6px] font-bold uppercase tracking-wider text-amber-300/80 -mt-0.5">
          Boost
        </span>
      </div>
    </div>
  );
};

export interface MobileSpectatorHUDProps {
  replayData: ParsedReplayData;
  frameState: FrameState | null;
  currentTime: number;
  currentFrame: number;
  isPlaying: boolean;
  playbackSpeed: number;
  cameraMode: CameraMode;
  activePlayerIndex: number;
  isBallCam: boolean;
  liveTeamScores: { team0: number; team1: number };
  audioSettings: { volume: number; muted: boolean };
  audioStatus: AudioStatus;
  isFullscreen: boolean;
  onTogglePlay: () => void;
  onSeekTime: (time: number) => void;
  onSelectPlayer: (index: number) => void;
  onToggleBallCam: () => void;
  onSetCameraMode: (mode: CameraMode) => void;
  onChangePlaybackSpeed: (speed: number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onLoadSample: () => void;
  onOpenFile: () => void;
}

export const MobileSpectatorHUD: React.FC<MobileSpectatorHUDProps> = ({
  replayData,
  frameState,
  currentTime,
  isPlaying,
  playbackSpeed,
  cameraMode,
  activePlayerIndex,
  isBallCam,
  liveTeamScores,
  audioSettings,
  audioStatus,
  isFullscreen,
  onTogglePlay,
  onSeekTime,
  onSelectPlayer,
  onToggleBallCam,
  onSetCameraMode,
  onChangePlaybackSpeed,
  onToggleMute,
  onToggleFullscreen,
  onLoadSample,
  onOpenFile,
}) => {
  // Controls visibility (cinema mode auto-hide)
  const [isControlsVisible, setIsControlsVisible] = useState(true);

  // Modals & drawers
  const [showCameraDrawer, setShowCameraDrawer] = useState(false);
  const [showPlayerSheet, setShowPlayerSheet] = useState(false);
  const [showRadar, setShowRadar] = useState(false);
  const [showMatchMenu, setShowMatchMenu] = useState(false);

  // Scrubber drag handling
  const scrubberRef = useRef<HTMLDivElement>(null);
  const isDraggingScrubberRef = useRef(false);
  const tapStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const duration = replayData.duration || 1;
  const players = replayData.players || [];
  const activePlayer = frameState?.players[activePlayerIndex];
  const boost = activePlayer?.boost ?? 0;

  // Player telemetry
  const vx = activePlayer?.velocity.x || 0;
  const vy = activePlayer?.velocity.y || 0;
  const vz = activePlayer?.velocity.z || 0;
  const speedUu = Math.round(Math.hypot(vx, vy, vz));
  const speedKph = Math.round(speedUu * 0.036);
  const isSupersonic = speedUu >= 2200;

  const isBlue = (activePlayer?.info.team ?? players[activePlayerIndex]?.team ?? 0) === 0;
  const playerName = activePlayer?.info.name || players[activePlayerIndex]?.name || 'Spectator';
  const carName = activePlayer
    ? carDisplayName(activePlayer.info.car_body_id, activePlayer.info.car_hitbox_family)
    : 'Octane';

  // Clock formatting
  const secondsRemaining = frameState ? frameState.secondsRemaining : 300;
  const isOvertime = secondsRemaining <= 0;
  const formatClock = (seconds: number) => {
    if (seconds < 0) {
      const positiveSec = Math.abs(seconds);
      const mins = Math.floor(positiveSec / 60);
      const secs = positiveSec % 60;
      return `+${mins}:${secs.toString().padStart(2, '0')}`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(Math.max(0, secs) / 60);
    const s = Math.floor(Math.max(0, secs) % 60);
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Auto-hide controls when playing after 3.5s of no interaction
  useEffect(() => {
    if (!isPlaying || showCameraDrawer || showPlayerSheet || showRadar || showMatchMenu) {
      setIsControlsVisible(true);
      return;
    }

    let timer: number;
    const resetTimer = () => {
      setIsControlsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setIsControlsVisible(false);
      }, 3500);
    };

    resetTimer();

    window.addEventListener('pointerdown', resetTimer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', resetTimer);
    };
  }, [isPlaying, showCameraDrawer, showPlayerSheet, showRadar, showMatchMenu]);

  // Tap-to-toggle HUD when clicking outside controls
  const handleContainerPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement)?.closest('button, input, [role="button"], .pointer-events-auto')) return;
    tapStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handleContainerPointerUp = (e: React.PointerEvent) => {
    if (!tapStartRef.current) return;
    const dx = Math.abs(e.clientX - tapStartRef.current.x);
    const dy = Math.abs(e.clientY - tapStartRef.current.y);
    const dt = Date.now() - tapStartRef.current.time;
    tapStartRef.current = null;

    if (dx < 12 && dy < 12 && dt < 350) {
      setIsControlsVisible((prev) => !prev);
    }
  };

  // Scrubber seeking
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const rect = scrubberRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return;
      const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = clickX / rect.width;
      onSeekTime(ratio * duration);
    },
    [duration, onSeekTime]
  );

  const handleScrubberPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingScrubberRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    seekFromPointer(e.clientX);
  };

  const handleScrubberPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingScrubberRef.current) {
      e.stopPropagation();
      seekFromPointer(e.clientX);
    }
  };

  const handleScrubberPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingScrubberRef.current) {
      e.stopPropagation();
      isDraggingScrubberRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
    }
  };

  // Speed cycle
  const speeds = [0.5, 1.0, 1.5, 2.0];
  const handleCycleSpeed = () => {
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = currentIndex === -1 || currentIndex === speeds.length - 1 ? 0 : currentIndex + 1;
    onChangePlaybackSpeed(speeds[nextIndex]);
  };

  // Next / Prev Player
  const handlePrevPlayer = () => {
    if (players.length === 0) return;
    const nextIdx = (activePlayerIndex - 1 + players.length) % players.length;
    onSelectPlayer(nextIdx);
  };

  const handleNextPlayer = () => {
    if (players.length === 0) return;
    const nextIdx = (activePlayerIndex + 1) % players.length;
    onSelectPlayer(nextIdx);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const markerGroups = useMemo(
    () => groupTimelineMarks(replayData.tickMarks, duration),
    [replayData.tickMarks, duration]
  );

  return (
    <div
      className="fixed inset-0 pointer-events-none select-none z-20"
      onPointerDown={handleContainerPointerDown}
      onPointerUp={handleContainerPointerUp}
    >
      {/* 1. TOP BAR */}
      <div
        className={`absolute inset-x-0 top-0 flex items-center justify-between transition-opacity duration-300 pointer-events-none ${
          isControlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          top: 'max(8px, env(safe-area-inset-top))',
          paddingLeft: 'max(10px, env(safe-area-inset-left))',
          paddingRight: 'max(10px, env(safe-area-inset-right))',
        }}
      >
        {/* Left: RLViewer Logo Pill */}
        <div className="ui-panel flex items-center gap-1.5 px-2 py-1 pointer-events-auto bg-slate-950/85 backdrop-blur-md rounded-full border border-white/10 shadow-lg">
          <RLViewerLogo size={18} showText={false} />
          <span className="text-[11px] font-bold text-white tracking-wide pr-1">
            RL<span className="text-cyan-400">Viewer</span>
          </span>
        </div>

        {/* Center: Esports Cyber Scoreboard */}
        <div className="ui-panel flex items-center select-none overflow-hidden pointer-events-auto bg-slate-950/90 backdrop-blur-md border border-white/15 rounded-lg shadow-xl">
          {/* Blue Team */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 border-r border-white/10 bg-blue-600/15">
            <span className="text-[10px] font-bold text-blue-400 tracking-wider">BLUE</span>
            <span className="text-base font-black font-mono text-white leading-none">
              {liveTeamScores.team0}
            </span>
          </div>

          {/* Clock */}
          <div className="flex items-center px-2.5 py-1">
            <span
              className={`text-xs font-black font-mono tabular-nums ${
                isOvertime ? 'text-amber-400 animate-pulse' : 'text-white'
              }`}
            >
              {formatClock(secondsRemaining)}
            </span>
            {isOvertime && (
              <span className="ml-1 text-[8px] font-bold uppercase tracking-wider text-amber-400">
                OT
              </span>
            )}
          </div>

          {/* Orange Team */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 border-l border-white/10 bg-orange-600/15">
            <span className="text-base font-black font-mono text-white leading-none">
              {liveTeamScores.team1}
            </span>
            <span className="text-[10px] font-bold text-orange-400 tracking-wider">ORG</span>
          </div>
        </div>

        {/* Right: Audio & Match Menu */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {/* Mute / Unmute Button */}
          <button
            onClick={onToggleMute}
            className="ui-panel w-8 h-8 flex items-center justify-center bg-slate-950/85 backdrop-blur-md rounded-full border border-white/15 text-slate-300 active:text-white active:bg-slate-900 shadow-lg"
            title={audioSettings.muted ? 'Unmute' : 'Mute'}
            aria-label="Toggle Audio"
          >
            {audioSettings.muted || audioSettings.volume === 0 || audioStatus === 'locked' ? (
              <VolumeX size={15} className="text-amber-400" />
            ) : (
              <Volume2 size={15} />
            )}
          </button>

          {/* Match Options Button */}
          <button
            onClick={() => setShowMatchMenu(true)}
            className="ui-panel w-8 h-8 flex items-center justify-center bg-slate-950/85 backdrop-blur-md rounded-full border border-white/15 text-slate-300 active:text-white active:bg-slate-900 shadow-lg"
            title="Match Options"
            aria-label="Match Options"
          >
            <MoreVertical size={16} />
          </button>
        </div>
      </div>

      {/* 2. FLOATING RADAR OVERLAY (When toggled) */}
      {showRadar && (
        <div
          className="absolute z-30 pointer-events-auto"
          style={{
            bottom: 'calc(max(8px, env(safe-area-inset-bottom)) + 104px)',
            left: 'max(10px, env(safe-area-inset-left))',
          }}
        >
          <div className="ui-panel p-2 flex flex-col gap-1 shadow-2xl border border-white/20 bg-slate-950/95 backdrop-blur-md rounded-xl">
            <div className="flex items-center justify-between pb-1 border-b border-white/10">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Tactical Pitch Radar
              </span>
              <button
                onClick={() => setShowRadar(false)}
                className="p-1 text-slate-400 hover:text-white active:text-white"
                aria-label="Close Radar"
              >
                <X size={14} />
              </button>
            </div>
            <TacticalMinimap
              frameState={frameState}
              activePlayerIndex={activePlayerIndex}
              onSelectPlayer={onSelectPlayer}
              defaultCollapsed={false}
            />
          </div>
        </div>
      )}

      {/* 3. BOTTOM-LEFT: CAMERA & RADAR CAPSULE */}
      <div
        className={`absolute z-20 pointer-events-none transition-opacity duration-300 ${
          isControlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          bottom: 'calc(max(6px, env(safe-area-inset-bottom)) + 60px)',
          left: 'max(10px, env(safe-area-inset-left))',
        }}
      >
        <div className="ui-panel flex items-center gap-1 p-1 bg-slate-950/90 backdrop-blur-md border border-white/15 rounded-xl shadow-xl pointer-events-auto">
          {/* Camera Mode Button */}
          <button
            onClick={() => setShowCameraDrawer(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/5 active:bg-white/15 text-slate-200 transition-colors"
          >
            {cameraMode === 'pov' && <Camera size={13} className="text-cyan-400" />}
            {cameraMode === 'director' && <Video size={13} className="text-emerald-400" />}
            {cameraMode === 'free' && <Compass size={13} className="text-amber-400" />}
            {cameraMode === 'tactical' && <MapPin size={13} className="text-purple-400" />}
            <span className="uppercase text-[10px] font-bold tracking-wider">{cameraMode}</span>
            <ChevronDown size={11} className="text-slate-400" />
          </button>

          {/* Radar Toggle */}
          <button
            onClick={() => setShowRadar((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold tracking-wider transition-colors ${
              showRadar
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
            title="Toggle Pitch Radar"
          >
            <Map size={13} />
            <span>RADAR</span>
          </button>
        </div>
      </div>

      {/* 4. BOTTOM-RIGHT: UNIFIED PLAYER CAPSULE & MINI BOOST */}
      <div
        className={`absolute z-20 pointer-events-none transition-opacity duration-300 ${
          isControlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          bottom: 'calc(max(6px, env(safe-area-inset-bottom)) + 60px)',
          right: 'max(10px, env(safe-area-inset-right))',
        }}
      >
        <div className="ui-panel flex items-center gap-1.5 p-1 bg-slate-950/90 backdrop-blur-md border border-white/15 rounded-xl shadow-xl pointer-events-auto">
          {/* Prev Player Chevron */}
          <button
            onClick={handlePrevPlayer}
            className="w-7 h-10 flex items-center justify-center text-slate-400 active:text-white active:bg-white/10 rounded-lg transition-colors"
            title="Previous Player"
            aria-label="Previous Player"
          >
            <ChevronLeft size={18} />
          </button>

          {/* Player Info - Tapping opens roster selector */}
          <button
            onClick={() => setShowPlayerSheet(true)}
            className="flex flex-col items-start px-1 text-left min-w-[70px] max-w-[110px] active:opacity-70 transition-opacity"
            title="Select Player"
          >
            <div className="flex items-center gap-1 w-full">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isBlue
                    ? 'bg-blue-500 shadow-[0_0_5px_#3b82f6]'
                    : 'bg-orange-500 shadow-[0_0_5px_#f97316]'
                }`}
              />
              <span className="text-xs font-bold text-white truncate w-full">{playerName}</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-slate-400 leading-tight mt-0.5">
              <span className="truncate max-w-[48px]">{carName}</span>
              <span>•</span>
              <span
                className={`font-mono font-semibold ${
                  isSupersonic ? 'text-amber-400 font-bold' : 'text-slate-300'
                }`}
              >
                {isSupersonic ? 'SUPER' : `${speedKph}k`}
              </span>
            </div>
          </button>

          {/* Next Player Chevron */}
          <button
            onClick={handleNextPlayer}
            className="w-7 h-10 flex items-center justify-center text-slate-400 active:text-white active:bg-white/10 rounded-lg transition-colors"
            title="Next Player"
            aria-label="Next Player"
          >
            <ChevronRight size={18} />
          </button>

          <div className="w-px h-6 bg-white/10 my-auto" />

          {/* Ball Cam Toggle */}
          <button
            onClick={onToggleBallCam}
            className={`h-8 px-2 rounded-lg flex items-center justify-center text-[10px] font-bold tracking-wider transition-all ${
              isBallCam
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                : 'bg-white/5 text-slate-400 border border-white/5 hover:text-white'
            }`}
            title="Toggle Ball Cam"
          >
            BALL
          </button>

          {/* Mini Boost Gauge */}
          <MobileBoostGauge boost={boost} />
        </div>
      </div>

      {/* 5. BOTTOM BAR: STREAMLINED MOBILE TIMELINE */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col transition-opacity duration-300 pointer-events-auto bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent border-t border-white/10 ${
          isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          paddingBottom: 'max(6px, env(safe-area-inset-bottom))',
          paddingLeft: 'max(12px, env(safe-area-inset-left))',
          paddingRight: 'max(12px, env(safe-area-inset-right))',
          paddingTop: '6px',
        }}
      >
        {/* Scrubber Track */}
        <div
          ref={scrubberRef}
          onPointerDown={handleScrubberPointerDown}
          onPointerMove={handleScrubberPointerMove}
          onPointerUp={handleScrubberPointerUp}
          onPointerCancel={handleScrubberPointerUp}
          className="relative w-full h-6 flex items-center cursor-pointer touch-none select-none"
        >
          {/* Track line */}
          <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 via-cyan-400 to-white"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Discrete Goal and Save Markers */}
          {markerGroups.map((group) => (
            <div
              key={group.marks[0].frame}
              className="absolute bottom-3 transform -translate-x-1/2 flex items-center z-10 pointer-events-auto"
              style={{ left: `${group.percent}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onSeekTime(group.marks[0].time);
              }}
            >
              <div className="flex items-center gap-0.5">
                {group.marks.map((tm) => (
                  <div key={`${tm.type}-${tm.frame}`} className="transition-transform hover:scale-125">
                    {tm.type === 'goal' ? <GoalIcon team={tm.team} /> : <SaveIcon team={tm.team} />}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Playhead thumb */}
          <div
            className="absolute w-3 h-3 bg-white rounded-full shadow-[0_0_6px_rgba(255,255,255,0.9)] transform -translate-x-1/2 pointer-events-none"
            style={{ left: `${progressPercent}%` }}
          />
        </div>

        {/* Primary Playback Controls Row */}
        <div className="flex items-center justify-between text-slate-300 pt-0.5 pb-1">
          {/* Left: Step Buttons & Play/Pause */}
          <div className="flex items-center gap-2">
            {/* -5s Skip */}
            <button
              onClick={() => onSeekTime(Math.max(0, currentTime - 5))}
              className="ui-button w-8 h-8 flex items-center justify-center rounded-full text-slate-300 active:text-white"
              title="Skip -5s"
              aria-label="Skip Back 5 Seconds"
            >
              <RotateCcw size={14} />
            </button>

            {/* Play / Pause Primary Button */}
            <button
              onClick={onTogglePlay}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-cyan-500 text-slate-950 font-bold shadow-[0_0_12px_rgba(6,182,212,0.6)] active:scale-95 transition-transform"
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
            </button>

            {/* +5s Skip */}
            <button
              onClick={() => onSeekTime(Math.min(duration, currentTime + 5))}
              className="ui-button w-8 h-8 flex items-center justify-center rounded-full text-slate-300 active:text-white"
              title="Skip +5s"
              aria-label="Skip Forward 5 Seconds"
            >
              <RotateCw size={14} />
            </button>
          </div>

          {/* Center: Match Time */}
          <div className="font-mono text-xs font-bold tabular-nums text-slate-200">
            {formatTime(currentTime)} <span className="text-slate-500 font-normal">/</span> {formatTime(duration)}
          </div>

          {/* Right: Speed & Fullscreen */}
          <div className="flex items-center gap-1.5">
            {/* Speed Cycle Button */}
            <button
              onClick={handleCycleSpeed}
              className="ui-button px-2 h-7 flex items-center justify-center text-[10px] font-bold font-mono text-slate-300 active:text-white rounded"
              title="Playback Speed"
            >
              {playbackSpeed}x
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={onToggleFullscreen}
              className="ui-button w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 active:text-white"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
          </div>
        </div>
      </div>

      {/* 6. CAMERA DRAWER MODAL */}
      {showCameraDrawer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto"
          onClick={() => setShowCameraDrawer(false)}
        >
          <div
            className="ui-panel w-full max-w-sm p-4 bg-slate-950/95 border border-white/20 shadow-2xl rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Camera View</h3>
              <button
                onClick={() => setShowCameraDrawer(false)}
                className="p-1 text-slate-400 hover:text-white"
                aria-label="Close Camera Menu"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              {/* POV */}
              <button
                onClick={() => {
                  onSetCameraMode('pov');
                  setShowCameraDrawer(false);
                }}
                className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                  cameraMode === 'pov'
                    ? 'border-cyan-500/60 bg-cyan-950/40 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300 active:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Camera size={15} className={cameraMode === 'pov' ? 'text-cyan-400' : 'text-slate-400'} />
                  <span className="text-xs font-bold">POV Cam</span>
                </div>
                <span className="text-[9px] text-slate-400 leading-tight">Follow player chase cam</span>
              </button>

              {/* DIRECTOR */}
              <button
                onClick={() => {
                  onSetCameraMode('director');
                  setShowCameraDrawer(false);
                }}
                className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                  cameraMode === 'director'
                    ? 'border-emerald-500/60 bg-emerald-950/40 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300 active:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Video size={15} className={cameraMode === 'director' ? 'text-emerald-400' : 'text-slate-400'} />
                  <span className="text-xs font-bold">Director</span>
                </div>
                <span className="text-[9px] text-slate-400 leading-tight">Dynamic broadcast camera</span>
              </button>

              {/* FREE */}
              <button
                onClick={() => {
                  onSetCameraMode('free');
                  setShowCameraDrawer(false);
                }}
                className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                  cameraMode === 'free'
                    ? 'border-amber-500/60 bg-amber-950/40 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300 active:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Compass size={15} className={cameraMode === 'free' ? 'text-amber-400' : 'text-slate-400'} />
                  <span className="text-xs font-bold">Free Orbit</span>
                </div>
                <span className="text-[9px] text-slate-400 leading-tight">Swipe to fly anywhere</span>
              </button>

              {/* OVERHEAD */}
              <button
                onClick={() => {
                  onSetCameraMode('tactical');
                  setShowCameraDrawer(false);
                }}
                className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                  cameraMode === 'tactical'
                    ? 'border-purple-500/60 bg-purple-950/40 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300 active:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <MapPin size={15} className={cameraMode === 'tactical' ? 'text-purple-400' : 'text-slate-400'} />
                  <span className="text-xs font-bold">Overhead</span>
                </div>
                <span className="text-[9px] text-slate-400 leading-tight">Top-down pitch perspective</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. PLAYER ROSTER SELECTION SHEET */}
      {showPlayerSheet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto"
          onClick={() => setShowPlayerSheet(false)}
        >
          <div
            className="ui-panel w-full max-w-md p-4 bg-slate-950/95 border border-white/20 shadow-2xl rounded-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Switch Player</h3>
              <button
                onClick={() => setShowPlayerSheet(false)}
                className="p-1 text-slate-400 hover:text-white"
                aria-label="Close Player Roster"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              {/* Blue Team */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1.5 px-1">
                  Blue Team
                </div>
                <div className="flex flex-col gap-1.5">
                  {players.map((p, idx) => {
                    if (p.team !== 0) return null;
                    const isSelected = activePlayerIndex === idx;
                    const liveP = frameState?.players[idx];
                    const pBoost = liveP?.boost ?? 0;
                    return (
                      <button
                        key={p.index}
                        onClick={() => {
                          onSelectPlayer(idx);
                          setShowPlayerSheet(false);
                        }}
                        className={`flex items-center justify-between p-2 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-600/20 text-white font-bold'
                            : 'border-white/10 bg-white/5 text-slate-300 active:bg-white/15'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                          <span className="text-xs truncate">{p.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-amber-300 shrink-0 ml-1">
                          ⚡{Math.round(pBoost)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Orange Team */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-1.5 px-1">
                  Orange Team
                </div>
                <div className="flex flex-col gap-1.5">
                  {players.map((p, idx) => {
                    if (p.team !== 1) return null;
                    const isSelected = activePlayerIndex === idx;
                    const liveP = frameState?.players[idx];
                    const pBoost = liveP?.boost ?? 0;
                    return (
                      <button
                        key={p.index}
                        onClick={() => {
                          onSelectPlayer(idx);
                          setShowPlayerSheet(false);
                        }}
                        className={`flex items-center justify-between p-2 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-orange-500 bg-orange-600/20 text-white font-bold'
                            : 'border-white/10 bg-white/5 text-slate-300 active:bg-white/15'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                          <span className="text-xs truncate">{p.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-amber-300 shrink-0 ml-1">
                          ⚡{Math.round(pBoost)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8. MATCH MENU DRAWER */}
      {showMatchMenu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto"
          onClick={() => setShowMatchMenu(false)}
        >
          <div
            className="ui-panel w-full max-w-xs p-4 bg-slate-950/95 border border-white/20 shadow-2xl rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <RLViewerLogo size={20} showText={false} />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Options</h3>
              </div>
              <button
                onClick={() => setShowMatchMenu(false)}
                className="p-1 text-slate-400 hover:text-white"
                aria-label="Close Options"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-2 mt-3">
              <button
                onClick={() => {
                  onOpenFile();
                  setShowMatchMenu(false);
                }}
                className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-slate-200 active:bg-white/15"
              >
                <FileCode size={16} className="text-cyan-400" />
                <span>Open .replay File</span>
              </button>

              <button
                onClick={() => {
                  onLoadSample();
                  setShowMatchMenu(false);
                }}
                className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-slate-200 active:bg-white/15"
              >
                <Play size={16} className="text-emerald-400" />
                <span>Load Sample Match</span>
              </button>

              <button
                onClick={() => {
                  onToggleFullscreen();
                  setShowMatchMenu(false);
                }}
                className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-slate-200 active:bg-white/15"
              >
                {isFullscreen ? (
                  <Minimize size={16} className="text-amber-400" />
                ) : (
                  <Maximize size={16} className="text-amber-400" />
                )}
                <span>{isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}</span>
              </button>
            </div>

            <div className="mt-4 pt-3 border-t border-white/10 text-[10px] text-slate-400 flex flex-col gap-1">
              <div className="flex justify-between">
                <span>Duration</span>
                <span className="font-mono text-slate-300">
                  {Math.floor(replayData.duration / 60)}:
                  {(Math.floor(replayData.duration) % 60).toString().padStart(2, '0')}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tick Rate</span>
                <span className="font-mono text-slate-300">{Math.round(replayData.frameRate)} Hz</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
