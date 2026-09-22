import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Shield,
  Flame,
  Trophy,
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
    <div className="w-full bg-slate-950/85 backdrop-blur-xl border-t border-white/10 px-4 py-2.5 flex flex-col gap-2 select-none shadow-2xl">
      {/* 1. Scrubber Track & Discrete Event Tick Markers */}
      <div
        ref={progressBarRef}
        onClick={handleSeek}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative w-full h-5 flex items-center cursor-pointer group"
      >
        {/* Track Background */}
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden group-hover:h-2.5 transition-all">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-amber-400 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Hover Time Tooltip */}
        {hoverTime !== null && (
          <div
            className="absolute -top-7 transform -translate-x-1/2 bg-slate-900 border border-white/20 px-2 py-0.5 rounded text-[10px] font-mono text-white pointer-events-none shadow-lg z-20"
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
                  className={`w-3 h-3 rounded-full flex items-center justify-center transition-transform hover:scale-150 ${
                    isGoal
                      ? 'bg-amber-400 text-slate-950 shadow-[0_0_8px_#f59e0b]'
                      : isSave
                      ? 'bg-cyan-400 text-slate-950 shadow-[0_0_8px_#06b6d4]'
                      : isDemo
                      ? 'bg-red-500 text-white shadow-[0_0_8px_#ef4444]'
                      : 'bg-white/60 text-slate-900'
                  }`}
                >
                  {isGoal && <Trophy size={8} className="stroke-[3]" />}
                  {isSave && <Shield size={8} className="stroke-[3]" />}
                  {isDemo && <Flame size={8} className="stroke-[3]" />}
                </div>

                {/* Marker Tooltip */}
                <div className="absolute -top-8 hidden group-hover/marker:flex bg-slate-900/95 border border-white/20 px-2 py-1 rounded text-[10px] font-semibold text-white whitespace-nowrap shadow-xl z-30 flex-col items-center">
                  <span>{tm.description || (isGoal ? 'Goal' : isSave ? 'Save' : 'Demo')}</span>
                  <span className="text-[9px] text-slate-400 font-mono">{formatTime(tm.time)}</span>
                </div>
              </div>
            );
          })}

        {/* Playhead thumb */}
        <div
          className="absolute w-3.5 h-3.5 bg-white border-2 border-cyan-400 rounded-full shadow-lg transform -translate-x-1/2 pointer-events-none group-hover:scale-125 transition-transform"
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
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Step Back 1s"
          >
            <RotateCcw size={15} />
          </button>

          {/* Step Back 1 Frame */}
          <button
            onClick={() => onStepFrame(-1)}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Step Back 1 Frame"
          >
            <ChevronLeft size={16} />
          </button>

          {/* Play / Pause Primary Button */}
          <button
            onClick={onTogglePlay}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-1.5 shadow-lg shadow-blue-500/25 transition-all active:scale-95"
          >
            {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" />}
            <span className="font-mono text-xs uppercase">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={() => onStepFrame(1)}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Step Forward 1 Frame"
          >
            <ChevronRight size={16} />
          </button>

          {/* Step Forward 1s */}
          <button
            onClick={() => onSeekTime(Math.min(duration, currentTime + 1.0))}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Step Forward 1s"
          >
            <RotateCw size={15} />
          </button>
        </div>

        {/* Center: Match Time & Frame Display */}
        <div className="flex items-center gap-2 font-mono">
          <span className="text-white font-semibold text-xs md:text-sm">
            {formatTime(currentTime)}
          </span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-400 text-xs md:text-sm">{formatTime(duration)}</span>
          <span className="hidden sm:inline-block text-[11px] text-slate-500 ml-2 border-l border-white/10 pl-2">
            Frame {currentFrame} / {totalFrames}
          </span>
        </div>

        {/* Right: Playback Speed Switcher */}
        <div className="flex items-center gap-1 bg-slate-900/90 border border-white/10 rounded-lg p-0.5">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => onChangeSpeed(s)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-colors ${
                playbackSpeed === s
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
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
