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
  MoreHorizontal,
  Check,
} from 'lucide-react';
import { ParsedReplayData, FrameState } from '../../types/replay';
import { CameraMode } from '../../camera/CameraSuite';
import { carDisplayName } from '../../scene/carBodies';
import { RLViewerLogo } from '../RLViewerLogo';
import { Scoreboard } from '../Scoreboard';
import { TacticalMinimap } from '../TacticalMinimap';
import { groupTimelineMarks, GoalIcon, SaveIcon } from '../PlaybackTimeline';
import type { AudioStatus } from '../../audio/ReplayAudio';

/** Seconds the skip buttons jump. */
const SKIP_SECONDS = 5;
/** How long the controls stay up while playing before fading out. */
const AUTO_HIDE_MS = 3500;

const CAMERA_MODES: { mode: CameraMode; label: string; description: string; Icon: typeof Camera }[] = [
  { mode: 'pov', label: 'Player', description: "Behind the selected player's car", Icon: Camera },
  { mode: 'director', label: 'Director', description: 'Follows the action like a broadcast', Icon: Video },
  { mode: 'free', label: 'Free', description: 'Drag to fly the camera anywhere', Icon: Compass },
  { mode: 'tactical', label: 'Overhead', description: 'Top-down view of the whole pitch', Icon: MapPin },
];

/** Compact circular boost gauge for the player card. */
const MobileBoostGauge: React.FC<{ boost: number }> = ({ boost }) => {
  const amount = Math.min(Math.max(Math.round(boost), 0), 100);
  const size = 48;
  const centre = size / 2;
  const radius = 19;
  const strokeWidth = 4;
  const circumference = 2 * Math.PI * radius;
  const filled = (amount / 100) * circumference;

  return (
    <div className="relative select-none shrink-0" style={{ width: size, height: size }} aria-label={`Boost ${amount}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <defs>
          <linearGradient id="m-boost-fill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ff6a00" />
            <stop offset="100%" stopColor="#ffd23f" />
          </linearGradient>
        </defs>
        <circle cx={centre} cy={centre} r={radius} fill="rgb(0 0 0 / 0.35)" stroke="rgb(255 255 255 / 0.1)" strokeWidth={strokeWidth} />
        {/* Fills clockwise from 6 o'clock */}
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="url(#m-boost-fill)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(90 ${centre} ${centre})`}
          style={{ filter: amount > 0 ? 'drop-shadow(0 0 3px rgb(255 140 0 / 0.7))' : undefined }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-numeric text-[16px] font-bold italic leading-none tabular-nums ${amount > 0 ? 'text-white' : 'text-slate-500'}`}
        >
          {amount}
        </span>
        <span className="mt-px font-display text-[7px] font-bold uppercase tracking-[0.15em] text-amber-300/80">Boost</span>
      </div>
    </div>
  );
};

/** Centred dialog used for the camera, player and menu sheets. */
const Sheet: React.FC<{ title: string; onClose: () => void; className?: string; children: React.ReactNode }> = ({
  title,
  onClose,
  className = 'max-w-sm',
  children,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto"
    onClick={onClose}
  >
    <div
      className={`hud-panel rounded-2xl w-full ${className} max-h-[88dvh] overflow-y-auto p-4`}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[17px] font-bold text-white">{title}</h3>
        <button type="button" onClick={onClose} className="hud-btn h-8 w-8 -mr-1.5 bg-white/5" aria-label={`Close ${title}`}>
          <X size={16} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

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

  // Sheets and the map
  const [showCameraSheet, setShowCameraSheet] = useState(false);
  const [showPlayerSheet, setShowPlayerSheet] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

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
  const activeCamera = CAMERA_MODES.find((c) => c.mode === cameraMode) ?? CAMERA_MODES[0];
  const isSoundOff = audioSettings.muted || audioSettings.volume === 0 || audioStatus !== 'ready';

  const formatTime = (secs: number) => {
    const mins = Math.floor(Math.max(0, secs) / 60);
    const s = Math.floor(Math.max(0, secs) % 60);
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Auto-hide controls while playing after a few seconds without a touch
  useEffect(() => {
    if (!isPlaying || showCameraSheet || showPlayerSheet || showMap || showMenu) {
      setIsControlsVisible(true);
      return;
    }

    let timer: number;
    const resetTimer = () => {
      setIsControlsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIsControlsVisible(false), AUTO_HIDE_MS);
    };

    resetTimer();

    window.addEventListener('pointerdown', resetTimer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', resetTimer);
    };
  }, [isPlaying, showCameraSheet, showPlayerSheet, showMap, showMenu]);

  // Tap-to-toggle HUD when tapping outside controls
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
      onSeekTime((clickX / rect.width) * duration);
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
    onSelectPlayer((activePlayerIndex - 1 + players.length) % players.length);
  };

  const handleNextPlayer = () => {
    if (players.length === 0) return;
    onSelectPlayer((activePlayerIndex + 1) % players.length);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const markerGroups = useMemo(
    () => groupTimelineMarks(replayData.tickMarks, duration),
    [replayData.tickMarks, duration]
  );

  // Hidden controls are made invisible too, so their buttons can't be tapped by accident.
  const fade = `transition-[opacity,visibility] duration-300 ${isControlsVisible ? 'visible opacity-100' : 'invisible opacity-0'}`;

  return (
    <div
      className="fixed inset-0 pointer-events-none select-none z-20"
      onPointerDown={handleContainerPointerDown}
      onPointerUp={handleContainerPointerUp}
    >
      {/* 1. TOP BAR: logo, score, sound and menu */}
      <div
        className={`absolute inset-x-0 top-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 ${fade}`}
        style={{
          top: 'max(8px, env(safe-area-inset-top))',
          paddingLeft: 'max(10px, env(safe-area-inset-left))',
          paddingRight: 'max(10px, env(safe-area-inset-right))',
        }}
      >
        <div className="hud-panel justify-self-start flex h-9 w-9 items-center justify-center rounded-full">
          <RLViewerLogo size={20} />
        </div>

        <div className="pointer-events-auto">
          <Scoreboard frameState={frameState} teamScores={liveTeamScores} compact />
        </div>

        <div className="justify-self-end flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={onToggleMute}
            className={`hud-panel hud-btn h-9 rounded-full ${
              audioStatus === 'locked' ? 'px-3 text-[12px] text-cyan-200' : 'w-9'
            }`}
            title={isSoundOff ? 'Turn sound on' : 'Mute'}
            aria-label={isSoundOff ? 'Turn sound on' : 'Mute'}
            disabled={audioStatus === 'unavailable'}
          >
            {isSoundOff ? <VolumeX size={16} /> : <Volume2 size={16} />}
            {audioStatus === 'locked' && <span>Sound</span>}
          </button>
          <button
            type="button"
            onClick={() => setShowMenu(true)}
            className="hud-panel hud-btn h-9 w-9 rounded-full"
            title="Menu"
            aria-label="Menu"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* 2. BOTTOM: map and player card sit on top of the dock, so nothing overlaps */}
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col gap-2 ${fade}`}
        style={{
          paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
          paddingLeft: 'max(10px, env(safe-area-inset-left))',
          paddingRight: 'max(10px, env(safe-area-inset-right))',
        }}
      >
        <div className="flex items-end justify-between gap-2">
          <div className="pointer-events-auto">
            {showMap && (
              <TacticalMinimap
                frameState={frameState}
                boostPads={replayData.boostPads}
                activePlayerIndex={activePlayerIndex}
                onSelectPlayer={onSelectPlayer}
                defaultCollapsed={false}
                onClose={() => setShowMap(false)}
              />
            )}
          </div>

          {/* Player card: who you're watching, their speed, Ball Cam and boost */}
          <div className="hud-panel relative flex items-center gap-1 overflow-hidden p-1 pl-2 pointer-events-auto">
            <div
              className={`absolute inset-y-0 left-0 w-1 ${
                isBlue ? 'bg-gradient-to-b from-[#5fb0ff] to-[#1672e8]' : 'bg-gradient-to-b from-[#ffa650] to-[#f06a0f]'
              }`}
            />
            <button type="button" onClick={handlePrevPlayer} className="hud-btn h-10 w-7" aria-label="Previous player">
              <ChevronLeft size={18} />
            </button>

            <button
              type="button"
              onClick={() => setShowPlayerSheet(true)}
              className="flex min-w-[96px] max-w-[132px] flex-col items-start rounded-lg px-1.5 py-0.5 text-left active:bg-white/10"
              title="Choose player"
            >
              <span className="flex w-full items-center gap-1">
                <span className="truncate font-display text-[15px] font-bold leading-tight text-white">{playerName}</span>
                <ChevronDown size={13} className="shrink-0 text-slate-500" />
              </span>
              <span className="flex items-baseline gap-1 font-display text-[11px] leading-tight text-slate-400">
                <span className="truncate max-w-[56px]">{carName}</span>
                <span className="text-slate-600">·</span>
                {isSupersonic ? (
                  <span className="font-bold uppercase tracking-wide text-cyan-200">Supersonic</span>
                ) : (
                  <span className="font-numeric tabular-nums text-slate-200">
                    {speedKph}
                    <span className="ml-0.5 font-display text-[9px] text-slate-500">km/h</span>
                  </span>
                )}
              </span>
            </button>

            <button type="button" onClick={handleNextPlayer} className="hud-btn h-10 w-7" aria-label="Next player">
              <ChevronRight size={18} />
            </button>

            <div className="mx-0.5 h-8 w-px bg-white/10" />

            <button
              type="button"
              onClick={onToggleBallCam}
              aria-pressed={isBallCam}
              className={`flex h-10 flex-col items-center justify-center rounded-lg px-2 font-display text-[9px] font-bold uppercase leading-tight tracking-wider transition-colors ${
                isBallCam ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-500 active:bg-white/10'
              }`}
              title="Toggle Ball Cam"
            >
              <span>Ball cam</span>
              <span className={`mt-0.5 text-[10px] ${isBallCam ? 'text-cyan-100' : 'text-slate-400'}`}>
                {isBallCam ? 'On' : 'Off'}
              </span>
            </button>

            <MobileBoostGauge boost={boost} />
          </div>
        </div>

        {/* Dock: timeline and playback controls in one panel */}
        <div className="hud-panel rounded-2xl px-3 pt-5 pb-1.5 pointer-events-auto">
          <div
            ref={scrubberRef}
            onPointerDown={handleScrubberPointerDown}
            onPointerMove={handleScrubberPointerMove}
            onPointerUp={handleScrubberPointerUp}
            onPointerCancel={handleScrubberPointerUp}
            className="relative flex h-5 w-full cursor-pointer items-center touch-none"
          >
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.12]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Goal and save markers above the track; tap to jump there */}
            {markerGroups.map((group) => (
              <button
                key={group.marks[0].frame}
                type="button"
                className="absolute bottom-full -mb-0.5 flex -translate-x-1/2 items-end gap-px"
                style={{ left: `${group.percent}%` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeekTime(group.marks[0].time);
                }}
                aria-label={`${group.marks[0].description} at ${formatTime(group.marks[0].time)}`}
              >
                {group.marks.map((tm) => (
                  <span key={`${tm.type}-${tm.frame}`} className="block scale-[0.85]">
                    {tm.type === 'goal' ? <GoalIcon team={tm.team} /> : <SaveIcon team={tm.team} />}
                  </span>
                ))}
              </button>
            ))}

            <div
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgb(34_211_238/0.35),0_1px_4px_rgb(0_0_0/0.6)]"
              style={{ left: `${progressPercent}%` }}
            />
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            {/* Transport and time */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSeekTime(Math.max(0, currentTime - SKIP_SECONDS))}
                className="hud-btn h-9 w-9 rounded-full"
                aria-label={`Back ${SKIP_SECONDS} seconds`}
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                onClick={onTogglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_0_0_4px_rgb(255_255_255/0.08),0_4px_14px_rgb(0_0_0/0.5)] active:scale-95 transition-transform"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={() => onSeekTime(Math.min(duration, currentTime + SKIP_SECONDS))}
                className="hud-btn h-9 w-9 rounded-full"
                aria-label={`Forward ${SKIP_SECONDS} seconds`}
              >
                <RotateCw size={16} />
              </button>
              <div className="ml-1.5 flex items-baseline gap-1 font-numeric tabular-nums">
                <span className="text-[14px] font-semibold text-white">{formatTime(currentTime)}</span>
                <span className="text-[12px] text-slate-500">/ {formatTime(duration)}</span>
              </div>
            </div>

            {/* View options */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowCameraSheet(true)}
                className="hud-btn h-9 bg-white/[0.06] px-2.5 text-[13px]"
                title="Change camera"
              >
                <activeCamera.Icon size={15} className="text-cyan-300" />
                <span>{activeCamera.label}</span>
                <ChevronDown size={13} className="text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => setShowMap((prev) => !prev)}
                className={`hud-btn h-9 px-2.5 text-[13px] ${showMap ? 'hud-btn-active' : 'bg-white/[0.06]'}`}
                aria-pressed={showMap}
                title="Show the map"
              >
                <Map size={15} />
                <span>Map</span>
              </button>
              <button
                type="button"
                onClick={handleCycleSpeed}
                className="hud-btn h-9 min-w-[44px] bg-white/[0.06] px-2 font-numeric text-[13px]"
                title="Playback speed (tap to change)"
                aria-label={`Playback speed ${playbackSpeed}x`}
              >
                {playbackSpeed}x
              </button>
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="hud-btn h-9 w-9"
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CAMERA SHEET */}
      {showCameraSheet && (
        <Sheet title="Camera" onClose={() => setShowCameraSheet(false)}>
          <div className="grid grid-cols-2 gap-2">
            {CAMERA_MODES.map(({ mode, label, description, Icon }) => {
              const isActive = cameraMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onSetCameraMode(mode);
                    setShowCameraSheet(false);
                  }}
                  className={`relative flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-colors ${
                    isActive
                      ? 'bg-cyan-400/10 ring-1 ring-inset ring-cyan-300/50'
                      : 'bg-white/[0.04] ring-1 ring-inset ring-white/[0.08] active:bg-white/10'
                  }`}
                  aria-pressed={isActive}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={16} className={isActive ? 'text-cyan-300' : 'text-slate-400'} />
                    <span className="font-display text-[15px] font-bold text-white">{label}</span>
                  </span>
                  <span className="text-[12px] leading-snug text-slate-400">{description}</span>
                  {isActive && <Check size={14} className="absolute right-2.5 top-2.5 text-cyan-300" />}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {/* 4. PLAYER SHEET */}
      {showPlayerSheet && (
        <Sheet title="Watch player" onClose={() => setShowPlayerSheet(false)} className="max-w-md">
          <div className="grid grid-cols-2 gap-3">
            {[0, 1].map((team) => (
              <div key={team}>
                <div
                  className={`hud-label mb-2 px-1 text-[10px] ${team === 0 ? 'text-[#7cc0ff]' : 'text-[#ffb070]'}`}
                >
                  {team === 0 ? 'Blue' : 'Orange'}
                </div>
                <div className="flex flex-col gap-1.5">
                  {players.map((p, idx) => {
                    if (p.team !== team) return null;
                    const isSelected = activePlayerIndex === idx;
                    const pBoost = Math.round(frameState?.players[idx]?.boost ?? 0);
                    const accent = team === 0 ? '#1672e8' : '#f06a0f';
                    return (
                      <button
                        key={p.index}
                        type="button"
                        onClick={() => {
                          onSelectPlayer(idx);
                          setShowPlayerSheet(false);
                        }}
                        className={`flex flex-col gap-1.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                          isSelected ? 'text-white' : 'bg-white/[0.04] text-slate-300 active:bg-white/10'
                        }`}
                        style={
                          isSelected
                            ? { background: `${accent}33`, boxShadow: `inset 0 0 0 1px ${accent}` }
                            : { boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.08)' }
                        }
                        aria-pressed={isSelected}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded font-numeric text-[11px] font-bold text-white"
                            style={{ background: accent }}
                          >
                            {idx + 1}
                          </span>
                          <span className="truncate font-display text-[14px] font-semibold">{p.name}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                            <span
                              className="block h-full rounded-full bg-gradient-to-r from-[#ff6a00] to-[#ffd23f]"
                              style={{ width: `${pBoost}%` }}
                            />
                          </span>
                          <span className="w-6 text-right font-numeric text-[10px] tabular-nums text-amber-200/90">{pBoost}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {/* 5. MENU SHEET */}
      {showMenu && (
        <Sheet title="Menu" onClose={() => setShowMenu(false)} className="max-w-xs">
          <div className="flex flex-col gap-1.5">
            {[
              { label: 'Open replay file', Icon: FileCode, action: onOpenFile },
              { label: 'Watch sample match', Icon: Play, action: onLoadSample },
              {
                label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
                Icon: isFullscreen ? Minimize : Maximize,
                action: onToggleFullscreen,
              },
            ].map(({ label, Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  action();
                  setShowMenu(false);
                }}
                className="flex h-11 items-center gap-3 rounded-xl bg-white/[0.04] px-3 font-display text-[15px] font-semibold text-slate-200 ring-1 ring-inset ring-white/[0.08] active:bg-white/10"
              >
                <Icon size={17} className="text-cyan-300" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-1.5 border-t border-white/[0.07] pt-3 text-[12px] text-slate-400">
            <div className="flex justify-between">
              <span>Replay length</span>
              <span className="font-numeric text-slate-200">{formatTime(replayData.duration)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tick rate</span>
              <span className="font-numeric text-slate-200">{Math.round(replayData.frameRate)} Hz</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Tap the pitch to show or hide the controls.</p>
          </div>
        </Sheet>
      )}
    </div>
  );
};
