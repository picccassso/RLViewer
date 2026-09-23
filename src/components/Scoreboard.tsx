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
    <div className="ui-panel flex items-stretch select-none overflow-hidden">
      {/* Blue Team Score */}
      <div className="flex items-center border-l-2 border-blue-500 px-3 py-1.5 text-white min-w-[92px] justify-between">
        <span className="font-medium tracking-wide text-[11px] text-blue-300">
          {blueTeamName}
        </span>
        <span className="text-xl font-semibold font-mono ml-3 text-white">
          {teamScores.team0}
        </span>
      </div>

      {/* Center Clock */}
      <div className="flex flex-col items-center justify-center border-x border-white/10 px-4 py-1 min-w-[82px]">
        <span className="uppercase font-mono tracking-[0.14em] text-slate-500 text-[8px]">
          {isOvertime ? 'OVERTIME' : 'TIME'}
        </span>
        <span
          className={`text-lg font-semibold font-mono tabular-nums ${
            isOvertime ? 'text-amber-300' : 'text-white'
          }`}
        >
          {formatClock(secondsRemaining)}
        </span>
      </div>

      {/* Orange Team Score */}
      <div className="flex items-center border-r-2 border-orange-500 px-3 py-1.5 text-white min-w-[92px] justify-between">
        <span className="text-xl font-semibold font-mono mr-3 text-white">
          {teamScores.team1}
        </span>
        <span className="font-medium tracking-wide text-[11px] text-orange-300">
          {orangeTeamName}
        </span>
      </div>
    </div>
  );
};
