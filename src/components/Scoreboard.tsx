import React from 'react';
import { FrameState } from '../types/replay';

interface ScoreboardProps {
  frameState: FrameState | null;
  teamScores: { team0: number; team1: number };
  blueTeamName?: string;
  orangeTeamName?: string;
  /** Optional goal celebration banner when a goal was just scored. */
  activeGoal?: { description: string; team: 0 | 1; time: number } | null;
  /** Smaller version for phones. */
  compact?: boolean;
}

// Format seconds as M:SS (or +M:SS in overtime)
function formatClock(seconds: number) {
  const abs = Math.abs(seconds);
  const clock = `${Math.floor(abs / 60)}:${(abs % 60).toString().padStart(2, '0')}`;
  return seconds < 0 ? `+${clock}` : clock;
}

/**
 * Clean, flat broadcast-style score bug:
 * Solid team colour blocks, dark score cells, central clock, and a flat goal notification bar.
 */
export const Scoreboard: React.FC<ScoreboardProps> = ({
  frameState,
  teamScores,
  blueTeamName = 'BLUE',
  orangeTeamName = 'ORANGE',
  activeGoal = null,
  compact = false,
}) => {
  const secondsRemaining = frameState ? frameState.secondsRemaining : 300;
  const isOvertime = secondsRemaining <= 0;

  const size = compact
    ? {
        bar: 'h-7',
        team: 'w-[68px] px-2.5 text-[11px]',
        score: 'w-8 text-[17px]',
        clock: 'min-w-[60px] px-2 text-[15px]',
      }
    : {
        bar: 'h-10',
        team: 'w-[100px] px-3 text-[14px]',
        score: 'w-11 text-[23px]',
        clock: 'min-w-[84px] px-3 text-[20px]',
      };

  return (
    <div className="flex flex-col items-center select-none">
      {/* Main Score Bar */}
      <div className={`flex items-stretch ${size.bar} overflow-hidden rounded border border-white/15 bg-[#0a0d16] shadow-md`}>
        {/* Blue Team */}
        <div className={`flex items-center justify-end ${size.team} bg-[#1968cc]`}>
          <span className="font-display font-bold uppercase tracking-[0.08em] text-white">
            {blueTeamName}
          </span>
        </div>

        {/* Blue Score */}
        <div className={`flex items-center justify-center ${size.score} bg-[#101624] border-x border-white/10`}>
          <span className="font-numeric font-bold leading-none tabular-nums text-white">
            {teamScores.team0}
          </span>
        </div>

        {/* Clock */}
        <div className={`flex flex-col items-center justify-center ${size.clock} bg-[#090d16]`}>
          <span
            className={`font-numeric font-bold leading-none tabular-nums ${
              isOvertime ? 'text-amber-300' : 'text-white'
            }`}
          >
            {formatClock(secondsRemaining)}
          </span>
          {isOvertime && !compact && (
            <span className="mt-0.5 font-display text-[8px] font-bold uppercase tracking-[0.18em] text-amber-300">
              OT
            </span>
          )}
        </div>

        {/* Orange Score */}
        <div className={`flex items-center justify-center ${size.score} bg-[#101624] border-x border-white/10`}>
          <span className="font-numeric font-bold leading-none tabular-nums text-white">
            {teamScores.team1}
          </span>
        </div>

        {/* Orange Team */}
        <div className={`flex items-center justify-start ${size.team} bg-[#d65a12]`}>
          <span className="font-display font-bold uppercase tracking-[0.08em] text-white">
            {orangeTeamName}
          </span>
        </div>
      </div>

      {/* Flat Goal Notification Bar */}
      {activeGoal && (
        <div
          key={`${activeGoal.team}-${activeGoal.time}`}
          className="animate-goal-banner pointer-events-none mt-1.5 flex items-center gap-2 rounded border border-white/15 bg-[#0d111a]/95 px-3 py-1 shadow-md"
        >
          <span
            className={`h-2 w-2 rounded-xs ${
              activeGoal.team === 0 ? 'bg-[#1968cc]' : 'bg-[#d65a12]'
            }`}
          />
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.08em] text-white">
            {activeGoal.description}
          </span>
        </div>
      )}
    </div>
  );
};
