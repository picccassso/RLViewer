import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
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
  compact?: boolean;
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
  compact = false,
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
      className={`w-full bg-slate-950/95 border-t border-white/10 select-none flex flex-col ${
        compact ? 'px-2.5 pt-5 pb-1 gap-1' : 'px-3 pt-7 pb-2 gap-1.5'
      }`}
      style={{
        paddingBottom: compact ? 'max(6px, env(safe-area-inset-bottom))' : 'max(8px, env(safe-area-inset-bottom))',
        paddingLeft: compact ? 'max(10px, env(safe-area-inset-left))' : 'max(12px, env(safe-area-inset-left))',
        paddingRight: compact ? 'max(10px, env(safe-area-inset-right))' : 'max(12px, env(safe-area-inset-right))',
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
        className="relative w-full h-4 py-0.5 flex items-center cursor-pointer group touch-none"
      >
        {/* Track Background */}
        <div className="w-full h-1 bg-white/10 overflow-hidden">
          <div
            className="h-full bg-slate-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Hover Time Tooltip */}
        {hoverTime !== null && (
          <div
            className="absolute -top-7 transform -translate-x-1/2 ui-panel px-2 py-0.5 text-[10px] font-mono text-white pointer-events-none z-20"
            style={{ left: `${hoverPos}px` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}

        {/* Goal and save icons above the track, as in the game's replay timeline */}
        {markerGroups.map((group) => (
          <div
            key={group.marks[0].frame}
            className="absolute bottom-full transform -translate-x-1/2 flex flex-col items-center z-10"
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
                  className="relative group/marker cursor-pointer transition-transform hover:scale-125"
                  aria-label={`${tm.description} at ${formatTime(tm.time)}`}
                >
                  {tm.type === 'goal' ? <GoalIcon team={tm.team} /> : <SaveIcon team={tm.team} />}

                  {/* Marker Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/marker:flex ui-panel px-2 py-1 text-[10px] font-medium text-white whitespace-nowrap z-30 flex-col items-center">
                    <span>{tm.description}</span>
                    <span className="text-[9px] text-slate-400 font-mono">{formatTime(tm.time)}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="w-px h-1 bg-white/30" />
          </div>
        ))}

        {/* Playhead thumb */}
        <div
          className="absolute w-1 h-3 bg-white transform -translate-x-1/2 pointer-events-none"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* 2. Playback Controls Bar */}
      <div className={`flex items-center justify-between text-slate-300 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {/* Left: Step Controls & Play/Pause */}
        <div className={`flex items-center ${compact ? 'gap-1' : 'gap-1.5 md:gap-2'}`}>
          {/* Step Back 1s */}
          <button
            onClick={() => onSeekTime(Math.max(0, currentTime - SKIP_SECONDS))}
            className={`ui-button flex items-center gap-0.5 ${
              compact ? 'px-1 py-1 text-[9px]' : 'px-1.5 py-1.5 text-[10px]'
            } font-medium tabular-nums`}
            title={`Back ${SKIP_SECONDS} seconds`}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
          >
            <ArrowLeft size={compact ? 13 : 14} />
            <span>{SKIP_SECONDS}s</span>
          </button>

          {/* Step Back 1 Frame */}
          <button
            onClick={() => onStepFrame(-1)}
            className={`ui-button ${compact ? 'p-1' : 'p-1.5'}`}
            title="Step Back 1 Frame"
          >
            <ChevronLeft size={compact ? 14 : 16} />
          </button>

          {/* Play / Pause Primary Button */}
          <button
            onClick={onTogglePlay}
            className={`ui-button ui-button-active ${
              compact ? 'px-2.5 py-1 text-[9px]' : 'px-3 py-1.5 text-[10px]'
            } text-white font-medium flex items-center gap-1.5`}
          >
            {isPlaying ? <Pause size={compact ? 13 : 14} /> : <Play size={compact ? 13 : 14} />}
            <span className="uppercase tracking-wide">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={() => onStepFrame(1)}
            className={`ui-button ${compact ? 'p-1' : 'p-1.5'}`}
            title="Step Forward 1 Frame"
          >
            <ChevronRight size={compact ? 14 : 16} />
          </button>

          {/* Step Forward 1s */}
          <button
            onClick={() => onSeekTime(Math.min(duration, currentTime + SKIP_SECONDS))}
            className={`ui-button flex items-center gap-0.5 ${
              compact ? 'px-1 py-1 text-[9px]' : 'px-1.5 py-1.5 text-[10px]'
            } font-medium tabular-nums`}
            title={`Forward ${SKIP_SECONDS} seconds`}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
          >
            <span>{SKIP_SECONDS}s</span>
            <ArrowRight size={compact ? 13 : 14} />
          </button>
        </div>

        {/* Center: Match Time & Frame Display */}
        <div className={`flex items-center font-mono ${compact ? 'gap-1.5 text-[10px]' : 'gap-2 text-[11px]'}`}>
          <span className="text-white font-medium tabular-nums">
            {formatTime(currentTime)}
          </span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-500 tabular-nums">{formatTime(duration)}</span>
          <span className="hidden sm:inline-block text-[9px] text-slate-600 ml-2 border-l border-white/10 pl-2">
            Frame {currentFrame} / {totalFrames}
          </span>
        </div>

        {/* Right: Sound and playback speed */}
        <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
          <button type="button" onClick={onToggleMute} className={`ui-button ${compact ? 'p-1' : 'p-1.5'} flex items-center gap-1`}
            title={audioLabel} aria-label={audioLabel} aria-pressed={muted}
            disabled={audioStatus === 'unavailable'}>
            {muted || volume === 0 || audioStatus !== 'ready' ? (
              <VolumeX size={compact ? 14 : 15} />
            ) : (
              <Volume2 size={compact ? 14 : 15} />
            )}
            {audioStatus === 'locked' && <span className={compact ? 'text-[9px]' : 'text-[10px]'}>Enable sound</span>}
          </button>
          <input type="range" min="0" max="100" step="1" value={Math.round(volume * 100)}
            onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
            aria-label="Sound volume" title={`Volume ${Math.round(volume * 100)}%`}
            disabled={audioStatus === 'unavailable'} className="hidden md:block w-16 accent-slate-300" />
          <div className="flex items-center gap-0.5 border border-white/10 rounded p-0.5">
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => onChangeSpeed(s)}
                className={`${
                  compact ? 'px-1 py-0.5 text-[8px]' : 'px-1.5 py-0.5 text-[9px]'
                } rounded-sm font-mono transition-colors ${
                  playbackSpeed === s
                    ? 'bg-white/10 text-white'
                    : 'text-slate-600 hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Fullscreen button */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`ui-button ${compact ? 'p-1' : 'p-1.5'} flex items-center justify-center text-slate-300 hover:text-white`}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize size={compact ? 14 : 15} />
              ) : (
                <Maximize size={compact ? 14 : 15} />
              )}
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
