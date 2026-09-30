import React, { useEffect, useState } from 'react';
import { CameraMode } from '../camera/CameraSuite';
import { PlayerInfo } from '../types/replay';
import { CameraSettings } from '../math/cameraMath';
import { Camera, Video, Compass, SlidersHorizontal, Eye, MapPin, X } from 'lucide-react';

interface CameraToolbarProps {
  mode: CameraMode;
  activePlayerIndex: number;
  players: PlayerInfo[];
  cameraSettings: CameraSettings;
  isBallCam: boolean;
  onSetMode: (mode: CameraMode) => void;
  onSelectPlayer: (index: number) => void;
  onToggleBallCam: () => void;
  onUpdateCameraSettings: (settings: Partial<CameraSettings>) => void;
}

const MODES: { mode: CameraMode; label: string; title: string; Icon: typeof Camera }[] = [
  { mode: 'pov', label: 'POV', title: 'Player POV Chase Camera', Icon: Camera },
  { mode: 'director', label: 'Director', title: 'Dynamic Broadcast Spectator Camera', Icon: Video },
  { mode: 'free', label: 'Free', title: 'Free-Fly Orbit Controls', Icon: Compass },
  { mode: 'tactical', label: 'Overhead', title: 'Top-Down Tactical View', Icon: MapPin },
];

const PRESETS: { label: string; title: string; settings: Partial<CameraSettings> }[] = [
  {
    label: 'Default',
    title: 'Standard Rocket League Default Settings',
    settings: { fov: 110, distance: 270, height: 100, angle: -3, stiffness: 0.45, swivel_speed: 5.0, transition_speed: 1.3 },
  },
  {
    label: 'Zen',
    title: "Zen's Competitive Profile",
    settings: { fov: 110, distance: 270, height: 90, angle: -3, stiffness: 0.4, swivel_speed: 4.5, transition_speed: 1.2 },
  },
  {
    label: 'Vatira',
    title: "Vatira's Competitive Profile",
    settings: { fov: 110, distance: 260, height: 90, angle: -4, stiffness: 0.55, swivel_speed: 5.0, transition_speed: 1.3 },
  },
];

type NumericSetting = 'fov' | 'distance' | 'height' | 'angle' | 'stiffness' | 'swivel_speed' | 'transition_speed';

const SLIDERS: {
  key: NumericSetting;
  label: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  format: (value: number) => string;
}[] = [
  { key: 'fov', label: 'FOV', min: 80, max: 110, step: 1, fallback: 110, format: (v) => `${Math.round(v)}°` },
  { key: 'distance', label: 'Distance', min: 100, max: 400, step: 5, fallback: 270, format: (v) => `${Math.round(v)} uu` },
  { key: 'height', label: 'Height', min: 40, max: 200, step: 5, fallback: 100, format: (v) => `${Math.round(v)} uu` },
  { key: 'angle', label: 'Angle', min: -15, max: 0, step: 1, fallback: -3, format: (v) => `${v}°` },
  { key: 'stiffness', label: 'Stiffness', min: 0, max: 1, step: 0.05, fallback: 0.45, format: (v) => v.toFixed(2) },
  { key: 'swivel_speed', label: 'Swivel Speed', min: 1, max: 10, step: 0.2, fallback: 5.0, format: (v) => v.toFixed(1) },
  { key: 'transition_speed', label: 'Transition Speed', min: 1, max: 2, step: 0.1, fallback: 1.3, format: (v) => v.toFixed(1) },
];

export const CameraToolbar: React.FC<CameraToolbarProps> = ({
  mode,
  activePlayerIndex,
  players,
  cameraSettings,
  isBallCam,
  onSetMode,
  onSelectPlayer,
  onToggleBallCam,
  onUpdateCameraSettings,
}) => {
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!showSettings) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showSettings]);

  const teams = [0, 1].map((team) => players.map((p, idx) => ({ p, idx })).filter(({ p }) => p.team === team));

  return (
    <div className="relative pointer-events-auto">
      {/* Camera profile, floating above the toolbar so opening it moves nothing */}
      {showSettings && (
        <div className="hud-panel absolute bottom-full left-0 mb-2 w-[300px] max-h-[calc(100dvh-220px)] overflow-y-auto p-3.5 text-white">
          <div className="flex items-center justify-between">
            <span className="hud-label text-slate-300">Camera profile</span>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="hud-btn h-6 w-6 -mr-1"
              aria-label="Close camera profile"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onUpdateCameraSettings(preset.settings)}
                className="hud-btn h-7 bg-white/5 text-[12px]"
                title={preset.title}
              >
                {preset.label}
              </button>
            ))}
            {players[activePlayerIndex] && (
              <button
                type="button"
                onClick={() => onUpdateCameraSettings(players[activePlayerIndex].camera_settings)}
                className="hud-btn h-7 bg-cyan-400/15 text-[12px] text-cyan-200 hover:bg-cyan-400/25 hover:text-cyan-100"
                title="Reset to selected player recorded settings"
              >
                Player
              </button>
            )}
          </div>

          <div className="mt-3.5 flex flex-col gap-3 border-t border-white/[0.07] pt-3.5">
            {SLIDERS.map(({ key, label, min, max, step, fallback, format }) => {
              const value = cameraSettings[key] ?? fallback;
              const fill = ((value - min) / (max - min)) * 100;
              return (
                <label key={key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-[13px] font-semibold text-slate-300">{label}</span>
                    <span className="font-numeric text-[12px] tabular-nums text-white">{format(value)}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => onUpdateCameraSettings({ [key]: Number(e.target.value) })}
                    className="hud-range"
                    style={{ '--fill': `${fill}%` } as React.CSSProperties}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="hud-panel p-1.5 flex flex-col gap-1.5">
        {/* 1. Camera mode */}
        <div className="flex items-center gap-1.5">
          <div className="hud-segment">
            {MODES.map(({ mode: m, label, title, Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => onSetMode(m)}
                className={`hud-btn h-8 w-9 xl:w-auto xl:px-2.5 text-[12px] uppercase tracking-wider ${mode === m ? 'hud-btn-active' : 'text-slate-400'}`}
                title={title}
                aria-pressed={mode === m}
              >
                <Icon size={14} />
                <span className="hidden xl:inline">{label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onToggleBallCam}
            className={`hud-btn h-8 w-8 ${isBallCam ? 'bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/20 hover:text-cyan-100' : 'text-slate-400'}`}
            title="Toggle Ball Cam [Space]"
            aria-pressed={isBallCam}
          >
            <Eye size={15} />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`hud-btn h-8 w-8 ${showSettings ? 'hud-btn-active' : 'text-slate-400'}`}
            title="Camera Profile Settings"
            aria-expanded={showSettings}
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>

        {/* 2. Player switcher, one row per team */}
        {players.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-1.5">
            {teams.map((members, team) => members.length > 0 && (
              <div key={team} className="flex items-center gap-1">
                {members.map(({ p, idx }) => {
                  const isSelected = activePlayerIndex === idx;
                  const isBlue = team === 0;
                  return (
                    <button
                      key={p.index}
                      type="button"
                      onClick={() => onSelectPlayer(idx)}
                      className={`hud-btn h-7 min-w-0 flex-1 justify-start gap-1.5 pl-1 pr-2 text-[13px] ${
                        isSelected
                          ? isBlue
                            ? 'bg-[#1672e8]/30 text-white ring-1 ring-inset ring-[#3b9cff]/60 hover:bg-[#1672e8]/40'
                            : 'bg-[#f06a0f]/30 text-white ring-1 ring-inset ring-[#ff8a1f]/60 hover:bg-[#f06a0f]/40'
                          : 'text-slate-400'
                      }`}
                      title={`Switch to ${p.name} [Key ${idx + 1}]`}
                      aria-pressed={isSelected}
                    >
                      <span
                        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded font-numeric text-[10px] font-bold text-white ${
                          isBlue ? 'bg-[#1672e8]' : 'bg-[#f06a0f]'
                        } ${isSelected ? '' : 'opacity-60'}`}
                      >
                        {idx + 1}
                      </span>
                      <span className="max-w-[64px] xl:max-w-[88px] truncate">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
