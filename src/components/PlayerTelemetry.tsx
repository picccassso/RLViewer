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
  /** Whether to show the player telemetry strip next to the boost gauge. */
  showCard?: boolean;
}

export const PlayerTelemetry: React.FC<PlayerTelemetryProps> = ({
  frameState,
  activePlayerIndex,
  isBallCam,
  onToggleBallCam,
  showCard = true,
}) => {
  const player = frameState?.players[activePlayerIndex];
  const boost = player?.boost ?? 0;
  const boostActive = player?.boostActive ?? false;

  // Speed calculation: Unreal units / sec -> km/h (uu/s * 0.036)
  const vx = player?.velocity.x || 0;
  const vy = player?.velocity.y || 0;
  const vz = player?.velocity.z || 0;
  const speedUu = Math.round(Math.hypot(vx, vy, vz));
  const speedKph = Math.round(speedUu * 0.036);
  const isSupersonic = player?.supersonic || speedUu >= SUPERSONIC_UU;
  const speedFill = Math.min(speedUu / MAX_SPEED_UU, 1) * 100;

  const isBlue = (player?.info.team ?? 0) === 0;

  return (
    <div className="flex items-end gap-2.5">
      {showCard && (
        <div className="hud-panel relative w-[210px] overflow-hidden select-none">
          {/* Flat team colour stripe */}
          <div
            className={`absolute inset-y-0 left-0 w-1 ${
              isBlue ? 'bg-[#1968cc]' : 'bg-[#d65a12]'
            }`}
          />

          <div className="pl-3.5 pr-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display text-[15px] font-bold leading-tight text-white truncate">
                  {player?.info.name || 'Spectator'}
                </div>
                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {player ? carDisplayName(player.info.car_body_id, player.info.car_hitbox_family) : 'Octane'}
                </div>
              </div>

              <button
                type="button"
                onClick={onToggleBallCam}
                aria-pressed={isBallCam}
                className={`shrink-0 flex items-center gap-1 rounded px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  isBallCam
                    ? 'bg-white/15 text-white'
                    : 'bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle Ball Cam (Space)"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isBallCam ? 'bg-amber-400' : 'bg-slate-600'
                  }`}
                />
                <span>Ball cam</span>
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2.5">
              <div className="flex items-baseline gap-1">
                <span className="font-numeric text-[18px] font-bold leading-none tabular-nums text-white">
                  {speedKph}
                </span>
                <span className="font-display text-[10px] font-semibold uppercase text-slate-400">
                  km/h
                </span>
              </div>
              <div className="flex-1">
                <div className="h-1 overflow-hidden rounded-sm bg-white/10">
                  <div
                    className={`h-full transition-[width] duration-100 ${
                      isSupersonic ? 'bg-amber-400' : 'bg-slate-300'
                    }`}
                    style={{ width: `${speedFill}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <BoostMeter boost={boost} boostActive={boostActive} />
    </div>
  );
};
