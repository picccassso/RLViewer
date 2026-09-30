import React from 'react';
import { FrameState } from '../types/replay';
import { carDisplayName } from '../scene/carBodies';
import { BoostMeter } from './BoostMeter';

/** Top speed of a car in uu/s; the speed bar is full here. */
const MAX_SPEED_UU = 2300;
/** At or above this a car is supersonic. */
const SUPERSONIC_UU = 2200;

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
  const boost = player?.boost ?? 0;

  // Speed calculation: Unreal units / sec -> km/h (uu/s * 0.036)
  const vx = player?.velocity.x || 0;
  const vy = player?.velocity.y || 0;
  const vz = player?.velocity.z || 0;
  const speedUu = Math.round(Math.hypot(vx, vy, vz));
  const speedKph = Math.round(speedUu * 0.036);
  const isSupersonic = speedUu >= SUPERSONIC_UU;
  const speedFill = Math.min(speedUu / MAX_SPEED_UU, 1) * 100;

  const isBlue = player?.info.team === 0;

  return (
    <div className="flex items-end gap-3">
      <div className="hud-panel relative w-[252px] overflow-hidden select-none">
        {/* Team edge */}
        <div
          className={`absolute inset-y-0 left-0 w-1 ${
            isBlue ? 'bg-gradient-to-b from-[#5fb0ff] to-[#1672e8]' : 'bg-gradient-to-b from-[#ffa650] to-[#f06a0f]'
          }`}
        />

        <div className="pl-4 pr-3 pt-2.5 pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-display text-[17px] font-bold leading-tight text-white truncate">
                {player?.info.name || 'Spectator'}
              </div>
              <div className="hud-label mt-1 text-[10px] text-slate-500">
                {player ? carDisplayName(player.info.car_body_id, player.info.car_hitbox_family) : 'Octane'}
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleBallCam}
              aria-pressed={isBallCam}
              className={`shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                isBallCam
                  ? 'bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-300/40'
                  : 'bg-white/5 text-slate-400 ring-1 ring-white/10 hover:text-slate-200'
              }`}
              title="Toggle Ball Cam (Space)"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isBallCam ? 'bg-cyan-300 shadow-[0_0_6px_rgb(103_232_249)]' : 'bg-slate-600'
                }`}
              />
              Ball cam
            </button>
          </div>

          <div className="mt-2.5 flex items-end gap-3">
            <div className="flex items-baseline gap-1">
              <span className="font-numeric text-[24px] font-bold leading-none tabular-nums text-white">
                {speedKph}
              </span>
              <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                km/h
              </span>
            </div>
            <div className="flex-1 pb-1">
              <div
                className={`mb-1 text-right font-display text-[9px] font-bold uppercase tracking-[0.2em] transition-colors ${
                  isSupersonic ? 'text-cyan-200' : 'text-transparent'
                }`}
              >
                Supersonic
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-100 ${
                    isSupersonic
                      ? 'bg-gradient-to-r from-cyan-400 to-white shadow-[0_0_8px_rgb(103_232_249)]'
                      : 'bg-slate-300/70'
                  }`}
                  style={{ width: `${speedFill}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <BoostMeter boost={boost} />
    </div>
  );
};
