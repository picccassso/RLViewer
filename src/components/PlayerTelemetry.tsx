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

  // Circular boost gauge parameters
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  // Arc spans 270 degrees (0.75 of circle)
  const maxArc = circumference * 0.75;
  const boostOffset = maxArc - (boost / 100) * maxArc;

  const isBlue = player?.info.team === 0;

  return (
    <div className="flex flex-col items-end gap-3 select-none pointer-events-auto">
      {/* Ball Cam Indicator Badge */}
      <button
        onClick={onToggleBallCam}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border backdrop-blur-md transition-all ${
          isBallCam
            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
            : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200'
        }`}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            isBallCam ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'
          }`}
        />
        <span className="text-xs font-bold font-mono tracking-wider">
          BALL CAM
        </span>
        <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/70 font-mono">
          SPACE
        </span>
      </button>

      {/* Main Telemetry Panel */}
      <div className="bg-slate-900/80 backdrop-blur-lg border border-white/10 rounded-2xl p-4 shadow-2xl flex items-center gap-5">
        {/* Speedometer & Player Info */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className={`w-2 h-2 rounded-full ${
                isBlue ? 'bg-blue-500' : 'bg-orange-500'
              }`}
            />
            <span className="text-sm font-bold tracking-wide text-white font-display truncate max-w-[130px]">
              {player?.info.name || 'Spectator'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider mb-2">
            {player?.info.car_hitbox_family || 'Octane'} Hitbox
          </span>

          {/* Speed display */}
          <div className="flex flex-col items-end">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-white">
                {speedKph}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">KM/H</span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {speedUu} UU/S
            </div>
            {isSupersonic && (
              <span className="mt-1 text-[9px] font-bold font-mono tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 rounded animate-pulse">
                SUPERSONIC
              </span>
            )}
          </div>
        </div>

        {/* Circular Boost Gauge */}
        <div className="relative flex items-center justify-center w-28 h-28">
          <svg className="w-full h-full transform -rotate-[135deg]" viewBox="0 0 120 120">
            {/* Background Arc Track */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="transparent"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="10"
              strokeDasharray={`${maxArc} ${circumference}`}
              strokeLinecap="round"
            />
            {/* Active Boost Arc */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="transparent"
              stroke="url(#boostGradient)"
              strokeWidth="10"
              strokeDasharray={`${maxArc} ${circumference}`}
              strokeDashoffset={boostOffset}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-75 ease-out"
            />
            <defs>
              <linearGradient id="boostGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
            </defs>
          </svg>

          {/* Center Digital Boost Value */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`text-3xl font-extrabold font-mono tracking-tighter ${
                boost > 0 ? 'text-amber-400' : 'text-slate-500'
              }`}
            >
              {boost}
            </span>
            <span className="text-[9px] font-bold tracking-widest text-slate-400 font-mono -mt-1">
              BOOST
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
