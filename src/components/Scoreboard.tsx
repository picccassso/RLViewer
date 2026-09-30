import React from 'react';
import { FrameState } from '../types/replay';

interface ScoreboardProps {
  frameState: FrameState | null;
  teamScores: { team0: number; team1: number };
  blueTeamName?: string;
  orangeTeamName?: string;
}

// Format seconds as M:SS (or +M:SS in overtime)
function formatClock(seconds: number) {
  const abs = Math.abs(seconds);
  const clock = `${Math.floor(abs / 60)}:${(abs % 60).toString().padStart(2, '0')}`;
  return seconds < 0 ? `+${clock}` : clock;
}

/** Broadcast-style score bug: team name, score, clock, score, team name. */
export const Scoreboard: React.FC<ScoreboardProps> = ({
  frameState,
  teamScores,
  blueTeamName = 'BLUE',
  orangeTeamName = 'ORANGE',
}) => {
  const secondsRemaining = frameState ? frameState.secondsRemaining : 300;
  const isOvertime = secondsRemaining <= 0;

  return (
    <div className="flex items-stretch h-11 select-none rounded-xl overflow-hidden shadow-[0_10px_30px_-8px_rgb(0_0_0/0.7),0_2px_6px_rgb(0_0_0/0.4)] ring-1 ring-white/10">
      {/* Blue */}
      <div className="flex items-center justify-end w-[108px] px-3.5 bg-gradient-to-r from-[#0b3d8c] to-[#1672e8]">
        <span className="font-display text-[15px] font-bold tracking-[0.12em] text-white drop-shadow">
          {blueTeamName}
        </span>
      </div>
      <div className="flex items-center justify-center w-12 bg-[#0a1a33] border-b-2 border-[#3b9cff]">
        <span className="font-numeric text-[26px] font-bold leading-none tabular-nums text-white">
          {teamScores.team0}
        </span>
      </div>

      {/* Clock */}
      <div className="flex flex-col items-center justify-center min-w-[92px] px-3 py-1 bg-[#070b16]/95 backdrop-blur-md">
        <span
          className={`font-numeric text-[22px] font-bold leading-none tabular-nums ${
            isOvertime ? 'text-amber-300' : 'text-white'
          }`}
        >
          {formatClock(secondsRemaining)}
        </span>
        {isOvertime && (
          <span className="mt-0.5 font-display text-[9px] font-bold uppercase tracking-[0.22em] text-amber-300/80">
            Overtime
          </span>
        )}
      </div>

      {/* Orange */}
      <div className="flex items-center justify-center w-12 bg-[#2a1405] border-b-2 border-[#ff8a1f]">
        <span className="font-numeric text-[26px] font-bold leading-none tabular-nums text-white">
          {teamScores.team1}
        </span>
      </div>
      <div className="flex items-center justify-start w-[108px] px-3.5 bg-gradient-to-l from-[#8a3a05] to-[#f06a0f]">
        <span className="font-display text-[15px] font-bold tracking-[0.12em] text-white drop-shadow">
          {orangeTeamName}
        </span>
      </div>
    </div>
  );
};
