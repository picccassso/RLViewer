import React from 'react';
import { FrameState } from '../types/replay';

interface PlayerTelemetryProps {
  frameState: FrameState | null;
  activePlayerIndex: number;
  isBallCam: boolean;
  onToggleBallCam: () => void;
}

export const PlayerTelemetry: React.FC<PlayerTelemetryProps> = ({
  frameState,
  activePlayerIndex,
  isBallCam,
  onToggleBallCam,
}) => {
  const player = frameState?.players[activePlayerIndex];
  const boost = player ? Math.round(player.boost) : 0;

  // Speed calculation: Unreal units / sec -> km/h (uu/s * 0.036)
  const vx = player?.velocity.x || 0;
  const vy = player?.velocity.y || 0;
  const vz = player?.velocity.z || 0;
  const speedUu = Math.round(Math.hypot(vx, vy, vz));
  const speedKph = Math.round(speedUu * 0.036);
  const isSupersonic = speedUu >= 2200;

  const isBlue = player?.info.team === 0;

  return (
    <div className="ui-panel flex items-center select-none pointer-events-auto overflow-hidden">
      <div className={`w-0.5 self-stretch ${isBlue ? 'bg-blue-500' : 'bg-orange-500'}`} />

      <div className="px-3 py-2 min-w-[128px] border-r border-white/10">
        <div className="text-xs font-semibold text-white truncate max-w-[120px]">
          {player?.info.name || 'Spectator'}
        </div>
        <div className="text-[9px] text-slate-500 uppercase tracking-[0.12em] mt-0.5">
          {player?.info.car_hitbox_family || 'Octane'}
        </div>
      </div>

      <div className="px-3 py-2 border-r border-white/10 text-right min-w-[72px]">
        <div className="font-mono text-base text-white tabular-nums leading-none">{speedKph}</div>
        <div className="text-[8px] text-slate-500 uppercase mt-1">
          {isSupersonic ? 'supersonic' : 'km/h'}
        </div>
      </div>

      <div className="px-3 py-2 min-w-[92px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Boost</span>
          <span className="font-mono text-sm text-amber-300 tabular-nums">{boost}</span>
        </div>
        <div className="w-16 h-1 bg-white/10 mt-1.5 overflow-hidden">
          <div className="h-full bg-amber-400" style={{ width: `${boost}%` }} />
        </div>
      </div>

      <button
        onClick={onToggleBallCam}
        className={`self-stretch px-2.5 border-l border-white/10 text-[9px] font-medium uppercase tracking-wider transition-colors ${
          isBallCam ? 'text-cyan-300 bg-cyan-400/10' : 'text-slate-500 hover:text-slate-300'
        }`}
        title="Toggle Ball Cam (Space)"
      >
        Ball
      </button>
    </div>
  );
};
