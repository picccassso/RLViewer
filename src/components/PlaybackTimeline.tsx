import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
} from 'lucide-react';
import { ReplayTickMark } from '../types/replay';
import type { AudioStatus } from '../audio/ReplayAudio';

/** How far the skip buttons jump, like the skip in Rocket League's replay viewer. */
const SKIP_SECONDS = 5;

interface PlaybackTimelineProps {
  currentTime: number;
  duration: number;
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  playbackSpeed: number;
  volume: number;
  muted: boolean;
  audioStatus: AudioStatus;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onToggleMute: () => void;
  onChangeVolume: (volume: number) => void;
  tickMarks: ReplayTickMark[];
  onTogglePlay: () => void;
  onSeekTime: (time: number) => void;
  onSeekFrame: (frame: number) => void;
  onChangeSpeed: (speed: number) => void;
  onStepFrame: (deltaFrames: number) => void;
}

export const PlaybackTimeline: React.FC<PlaybackTimelineProps> = ({
  currentTime,
  duration,
  currentFrame,
  totalFrames,
  isPlaying,
  playbackSpeed,
  volume,
  muted,
  audioStatus,
  isFullscreen,
  onToggleFullscreen,
  onToggleMute,
  onChangeVolume,
  tickMarks,
  onTogglePlay,
  onSeekTime,
  onChangeSpeed,
  onStepFrame,
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);

  const formatTime = (secs: number) => {
    const mins = Math.floor(Math.max(0, secs) / 60);
    const s = Math.floor(Math.max(0, secs) % 60);
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const seekFromPointer = (clientX: number) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = clickX / rect.width;
    onSeekTime(ratio * duration);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    seekFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setHoverPos(x);
    setHoverTime((x / rect.width) * duration);
    if (isDraggingRef.current) {
      seekFromPointer(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
    }
    if (e.pointerType === 'touch') {
      setHoverTime(null);
    }
  };

  const handleMouseLeave = () => {
    if (!isDraggingRef.current) {
      setHoverTime(null);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const markerGroups = React.useMemo(
    () => groupTimelineMarks(tickMarks, duration),
    [tickMarks, duration]
  );
  const speeds = [0.25, 0.5, 1.0, 1.5, 2.0];
  const audioLabel = audioStatus === 'unavailable' ? 'Audio unavailable in this browser'
    : audioStatus === 'locked' ? 'Enable sound'
    : muted || volume === 0 ? 'Unmute (M)' : 'Mute (M)';

  return (
    <div
      className="relative w-full select-none flex flex-col gap-1.5 px-4 pt-7 pb-2.5"
      style={{
        paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
        background: 'linear-gradient(180deg, rgb(7 10 20 / 0.82) 0%, rgb(5 7 15 / 0.96) 45%, rgb(4 6 12 / 0.98) 100%)',
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.07), 0 -12px 32px -12px rgb(0 0 0 / 0.6)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      {/* 1. Scrubber Track & Discrete Event Tick Markers */}
      <div
        ref={progressBarRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseLeave={handleMouseLeave}
        className="relative w-full h-4 flex items-center cursor-pointer group touch-none"
      >
        {/* Track */}
        <div className="relative w-full h-1.5 rounded-full bg-white/[0.12] overflow-hidden transition-[height] duration-150 group-hover:h-2">
          {hoverTime !== null && (
            <div
              className="absolute inset-y-0 left-0 bg-white/15"
              style={{ width: `${hoverPos}px` }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Hover Time Tooltip */}
        {hoverTime !== null && (
          <div
            className="absolute -top-8 -translate-x-1/2 hud-panel rounded-md px-2 py-1 font-numeric text-[11px] tabular-nums text-white pointer-events-none z-20"
            style={{ left: `${hoverPos}px` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}

        {/* Goal and save icons above the track, as in the game's replay timeline */}
        {markerGroups.map((group) => (
          <div
            key={group.marks[0].frame}
            className="absolute bottom-full mb-0.5 -translate-x-1/2 flex flex-col items-center z-10"
            style={{ left: `${group.percent}%` }}
          >
            <div className="flex items-end gap-px">
              {group.marks.map((tm) => (
                <button
                  key={`${tm.type}-${tm.frame}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeekTime(tm.time);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="relative group/marker cursor-pointer transition-transform hover:scale-125"
                  aria-label={`${tm.description} at ${formatTime(tm.time)}`}
                >
                  {tm.type === 'goal' ? <GoalIcon team={tm.team} /> : <SaveIcon team={tm.team} />}

                  {/* Marker Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/marker:flex hud-panel rounded-md px-2.5 py-1.5 whitespace-nowrap z-30 flex-col items-center gap-0.5">
                    <span className="font-display text-[12px] font-semibold text-white">{tm.description}</span>
                    <span className="font-numeric text-[10px] text-slate-400">{formatTime(tm.time)}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="w-px h-1.5 bg-white/25" />
          </div>
        ))}

        {/* Playhead thumb */}
        <div
          className="absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white pointer-events-none shadow-[0_0_0_3px_rgb(34_211_238/0.35),0_1px_4px_rgb(0_0_0/0.6)] transition-transform duration-150 group-hover:scale-110"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* 2. Playback Controls Bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-slate-300">
        {/* Left: transport */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSeekTime(Math.max(0, currentTime - SKIP_SECONDS))}
            className="hud-btn h-8 px-2 text-[12px] tabular-nums"
            title={`Back ${SKIP_SECONDS} seconds`}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
          >
            <RotateCcw size={14} />
            <span>{SKIP_SECONDS}s</span>
          </button>

          <button
            onClick={() => onStepFrame(-1)}
            className="hud-btn h-8 w-8"
            title="Step Back 1 Frame"
            aria-label="Step Back 1 Frame"
          >
            <StepBack size={15} />
          </button>

          <button
            onClick={onTogglePlay}
            className="mx-1 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_0_0_4px_rgb(255_255_255/0.08),0_4px_14px_rgb(0_0_0/0.5)] transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            title={isPlaying ? 'Pause (K)' : 'Play (K)'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
          </button>

          <button
            onClick={() => onStepFrame(1)}
            className="hud-btn h-8 w-8"
            title="Step Forward 1 Frame"
            aria-label="Step Forward 1 Frame"
          >
            <StepForward size={15} />
          </button>

          <button
            onClick={() => onSeekTime(Math.min(duration, currentTime + SKIP_SECONDS))}
            className="hud-btn h-8 px-2 text-[12px] tabular-nums"
            title={`Forward ${SKIP_SECONDS} seconds`}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
          >
            <span>{SKIP_SECONDS}s</span>
            <RotateCw size={14} />
          </button>
        </div>

        {/* Center: Match Time & Frame Display */}
        <div className="flex items-baseline gap-2 font-numeric tabular-nums">
          <span className="text-[15px] font-semibold text-white">{formatTime(currentTime)}</span>
          <span className="text-[13px] text-slate-500">/ {formatTime(duration)}</span>
          <span className="hidden lg:inline-block ml-1 border-l border-white/10 pl-3 font-mono text-[10px] text-slate-500">
            Frame {currentFrame} / {totalFrames}
          </span>
        </div>

        {/* Right: Sound, playback speed and fullscreen */}
        <div className="flex items-center justify-end gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleMute}
              className={`hud-btn h-8 ${audioStatus === 'locked' ? 'px-2.5 text-[12px] text-cyan-200 bg-cyan-400/10 hover:bg-cyan-400/20' : 'w-8'}`}
              title={audioLabel}
              aria-label={audioLabel}
              aria-pressed={muted}
              disabled={audioStatus === 'unavailable'}
            >
              {muted || volume === 0 || audioStatus !== 'ready' ? <VolumeX size={15} /> : <Volume2 size={15} />}
              {audioStatus === 'locked' && <span>Enable sound</span>}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(volume * 100)}
              onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
              aria-label="Sound volume"
              title={`Volume ${Math.round(volume * 100)}%`}
              disabled={audioStatus === 'unavailable'}
              className="hud-range hidden md:block w-20"
              style={{ '--fill': `${muted ? 0 : Math.round(volume * 100)}%`, '--accent': '#e2e8f0' } as React.CSSProperties}
            />
          </div>

          <div className="hud-segment">
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => onChangeSpeed(s)}
                className={`hud-btn h-7 px-2 font-numeric text-[11px] font-medium ${
                  playbackSpeed === s ? 'hud-btn-active' : 'text-slate-500'
                }`}
                aria-pressed={playbackSpeed === s}
                title={`Playback speed ${s}x`}
              >
                {s}x
              </button>
            ))}
          </div>

          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="hud-btn h-8 w-8"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** Marks closer than this share of the timeline sit side by side instead of overlapping. */
const MARKER_GROUP_SPAN = 0.012;

export interface MarkerGroup {
  percent: number;
  marks: ReplayTickMark[];
}

/**
 * Only goals and saves appear on the in-game replay timeline. Marks that would
 * overlap are grouped so their icons sit next to each other, centred on the group.
 */
export function groupTimelineMarks(tickMarks: ReplayTickMark[], duration: number): MarkerGroup[] {
  if (duration <= 0) return [];
  const marks = tickMarks
    .filter((tm) => (tm.type === 'goal' || tm.type === 'save') && tm.time >= 0 && tm.time <= duration)
    .sort((a, b) => a.time - b.time);

  const groups: ReplayTickMark[][] = [];
  for (const tm of marks) {
    const last = groups[groups.length - 1];
    if (last && (tm.time - last[last.length - 1].time) / duration < MARKER_GROUP_SPAN) last.push(tm);
    else groups.push([tm]);
  }
  return groups.map((group) => ({
    percent: (group.reduce((sum, tm) => sum + tm.time, 0) / group.length / duration) * 100,
    marks: group,
  }));
}

const TEAM_ICON_COLORS = {
  0: { fill: '#3b82f6', light: '#93c5fd', dark: '#1e3a8a', glow: 'rgba(59,130,246,0.8)' },
  1: { fill: '#f97316', light: '#fdba74', dark: '#7c2d12', glow: 'rgba(249,115,22,0.8)' },
} as const;

/** A small ball with a dark centre panel and seams, shared by both icons. */
const BallFace: React.FC<{ cx: number; cy: number; r: number; team: 0 | 1 }> = ({ cx, cy, r, team }) => {
  const c = TEAM_ICON_COLORS[team];
  const seams = [0, 72, 144, 216, 288].map((deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return (
      <line
        key={deg}
        x1={cx + Math.cos(a) * r * 0.38}
        y1={cy + Math.sin(a) * r * 0.38}
        x2={cx + Math.cos(a) * r}
        y2={cy + Math.sin(a) * r}
        stroke={c.dark}
        strokeWidth={0.8}
      />
    );
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={c.light} stroke={c.dark} strokeWidth={0.8} />
      {seams}
      <circle cx={cx} cy={cy} r={r * 0.38} fill={c.dark} />
    </g>
  );
};

/** Goal: a spiky burst in the scoring team's colour around a ball. */
export const GoalIcon: React.FC<{ team: 0 | 1 }> = ({ team }) => {
  const c = TEAM_ICON_COLORS[team];
  const spikes = 12;
  const points = Array.from({ length: spikes * 2 }, (_, i) => {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? 9.5 : 6.5;
    return `${10 + Math.cos(a) * radius},${10 + Math.sin(a) * radius}`;
  }).join(' ');
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" style={{ filter: `drop-shadow(0 0 3px ${c.glow})` }}>
      <polygon points={points} fill={c.fill} />
      <BallFace cx={10} cy={10} r={5} team={team} />
    </svg>
  );
};

/** Save: a ball in the saving team's colour with a halo above it. */
export const SaveIcon: React.FC<{ team: 0 | 1 }> = ({ team }) => {
  const c = TEAM_ICON_COLORS[team];
  return (
    <svg width={18} height={20} viewBox="0 0 18 20" style={{ filter: `drop-shadow(0 0 3px ${c.glow})` }}>
      <ellipse cx={9} cy={3.5} rx={5.5} ry={2} fill="none" stroke={c.light} strokeWidth={1.4} />
      <BallFace cx={9} cy={12.5} r={6.5} team={team} />
    </svg>
  );
};
