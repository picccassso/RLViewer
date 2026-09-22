import React from 'react';
import { FrameState } from '../types/replay';

interface ScoreboardProps {
  frameState: FrameState | null;
  teamScores: { team0: number; team1: number };
  blueTeamName?: string;
  orangeTeamName?: string;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
  frameState,
  teamScores,
  blueTeamName = 'BLUE',
  orangeTeamName = 'ORANGE',
}) => {
  const secondsRemaining = frameState ? frameState.secondsRemaining : 300;
  const isOvertime = secondsRemaining <= 0;

  // Format seconds as MM:SS (or +MM:SS if overtime)
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

  return (
    <div className="flex items-center select-none shadow-2xl">
      {/* Blue Team Score */}
      <div className="flex items-center bg-gradient-to-r from-blue-700 to-blue-600 border-y border-l border-blue-400/40 rounded-l-xl px-4 py-2 text-white min-w-[130px] justify-between shadow-[0_0_15px_rgba(0,136,255,0.4)]">
        <span className="font-bold tracking-wider text-sm md:text-base font-display drop-shadow">
          {blueTeamName}
        </span>
        <span className="text-2xl md:text-3xl font-bold font-mono ml-3 text-white drop-shadow">
          {teamScores.team0}
        </span>
      </div>

      {/* Center Clock */}
      <div className="flex flex-col items-center justify-center bg-slate-950/90 border-y border-white/20 px-5 py-1.5 min-w-[95px] backdrop-blur-md">
        <span className="text-xs uppercase font-mono tracking-widest text-slate-400 text-[10px]">
          {isOvertime ? 'OVERTIME' : 'TIME'}
        </span>
        <span
          className={`text-xl md:text-2xl font-bold font-mono tracking-tight ${
            isOvertime ? 'text-amber-400 animate-pulse' : 'text-white'
          }`}
        >
          {formatClock(secondsRemaining)}
        </span>
      </div>

      {/* Orange Team Score */}
      <div className="flex items-center bg-gradient-to-r from-orange-600 to-orange-700 border-y border-r border-orange-400/40 rounded-r-xl px-4 py-2 text-white min-w-[130px] justify-between shadow-[0_0_15px_rgba(255,102,0,0.4)]">
        <span className="text-2xl md:text-3xl font-bold font-mono mr-3 text-white drop-shadow">
          {teamScores.team1}
        </span>
        <span className="font-bold tracking-wider text-sm md:text-base font-display drop-shadow">
          {orangeTeamName}
        </span>
      </div>
    </div>
  );
};
