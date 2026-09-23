import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { ReplayTickMark } from '../types/replay';

interface PlaybackTimelineProps {
  currentTime: number;
  duration: number;
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  playbackSpeed: number;
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
  tickMarks,
  onTogglePlay,
  onSeekTime,
  onChangeSpeed,
  onStepFrame,
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);

  const formatTime = (secs: number) => {
    const mins = Math.floor(Math.max(0, secs) / 60);
    const s = Math.floor(Math.max(0, secs) % 60);
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = clickX / rect.width;
    onSeekTime(ratio * duration);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setHoverPos(x);
    setHoverTime((x / rect.width) * duration);
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const speeds = [0.25, 0.5, 1.0, 1.5, 2.0];

  return (
    <div className="w-full bg-slate-950/95 border-t border-white/10 px-3 py-2 flex flex-col gap-1.5 select-none">
      {/* 1. Scrubber Track & Discrete Event Tick Markers */}
      <div
        ref={progressBarRef}
        onClick={handleSeek}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative w-full h-3 flex items-center cursor-pointer group"
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

        {/* Discrete Event Tick Markers (Goals, Saves, Demolishes) */}
        {duration > 0 &&
          tickMarks.map((tm, idx) => {
            const markerPercent = (tm.time / duration) * 100;
            if (markerPercent < 0 || markerPercent > 100) return null;

            const isGoal = tm.type === 'goal';
            const isSave = tm.type === 'save';
            const isDemo = tm.type === 'demolish';

            return (
              <div
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeekTime(tm.time);
                }}
                className="absolute transform -translate-x-1/2 flex items-center justify-center cursor-pointer z-10 group/marker"
                style={{ left: `${markerPercent}%` }}
              >
                <div
                  className={`w-0.5 h-3 ${
                    isGoal
                      ? 'bg-amber-400'
                      : isSave
                      ? 'bg-cyan-400'
                      : isDemo
                      ? 'bg-red-400'
                      : 'bg-white/50'
                  }`}
                />

                {/* Marker Tooltip */}
                <div className="absolute -top-8 hidden group-hover/marker:flex ui-panel px-2 py-1 text-[10px] font-medium text-white whitespace-nowrap z-30 flex-col items-center">
                  <span>{tm.description || (isGoal ? 'Goal' : isSave ? 'Save' : 'Demo')}</span>
                  <span className="text-[9px] text-slate-400 font-mono">{formatTime(tm.time)}</span>
                </div>
              </div>
            );
          })}

        {/* Playhead thumb */}
        <div
          className="absolute w-1 h-3 bg-white transform -translate-x-1/2 pointer-events-none"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* 2. Playback Controls Bar */}
      <div className="flex items-center justify-between text-xs text-slate-300">
        {/* Left: Step Controls & Play/Pause */}
        <div className="flex items-center gap-1.5 md:gap-2">
          {/* Step Back 1s */}
          <button
            onClick={() => onSeekTime(Math.max(0, currentTime - 1.0))}
            className="ui-button p-1.5"
            title="Step Back 1s"
          >
            <RotateCcw size={15} />
          </button>

          {/* Step Back 1 Frame */}
          <button
            onClick={() => onStepFrame(-1)}
            className="ui-button p-1.5"
            title="Step Back 1 Frame"
          >
            <ChevronLeft size={16} />
          </button>

          {/* Play / Pause Primary Button */}
          <button
            onClick={onTogglePlay}
            className="ui-button ui-button-active px-3 py-1.5 text-white font-medium flex items-center gap-1.5"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            <span className="text-[10px] uppercase tracking-wide">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={() => onStepFrame(1)}
            className="ui-button p-1.5"
            title="Step Forward 1 Frame"
          >
            <ChevronRight size={16} />
          </button>

          {/* Step Forward 1s */}
          <button
            onClick={() => onSeekTime(Math.min(duration, currentTime + 1.0))}
            className="ui-button p-1.5"
            title="Step Forward 1s"
          >
            <RotateCw size={15} />
          </button>
        </div>

        {/* Center: Match Time & Frame Display */}
        <div className="flex items-center gap-2 font-mono">
          <span className="text-white font-medium text-[11px] tabular-nums">
            {formatTime(currentTime)}
          </span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-500 text-[11px] tabular-nums">{formatTime(duration)}</span>
          <span className="hidden sm:inline-block text-[9px] text-slate-600 ml-2 border-l border-white/10 pl-2">
            Frame {currentFrame} / {totalFrames}
          </span>
        </div>

        {/* Right: Playback Speed Switcher */}
        <div className="flex items-center gap-0.5 border border-white/10 rounded p-0.5">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => onChangeSpeed(s)}
              className={`px-1.5 py-0.5 rounded-sm text-[9px] font-mono transition-colors ${
                playbackSpeed === s
                  ? 'bg-white/10 text-white'
                  : 'text-slate-600 hover:text-white'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
