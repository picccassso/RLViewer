import React, { useState } from 'react';
import { CameraMode } from '../camera/CameraSuite';
import { PlayerInfo } from '../types/replay';
import { CameraSettings } from '../math/cameraMath';
import {
  Camera,
  Video,
  Compass,
  Sliders,
  Eye,
  MapPin,
} from 'lucide-react';

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
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 pointer-events-auto">
      {/* 1. Camera Mode Toolbar */}
      <div className="ui-panel p-0.5 sm:p-1 flex items-center gap-0.5 overflow-x-auto no-scrollbar max-w-full">
        {/* POV Cam */}
        <button
          onClick={() => onSetMode('pov')}
          className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded text-[9px] sm:text-[10px] font-medium transition-colors ${
            mode === 'pov'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Player POV Chase Camera"
        >
          <Camera size={13} />
          <span>POV</span>
        </button>

        {/* Director Cam */}
        <button
          onClick={() => onSetMode('director')}
          className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded text-[9px] sm:text-[10px] font-medium transition-colors ${
            mode === 'director'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Dynamic Broadcast Spectator Camera"
        >
          <Video size={13} />
          <span>DIRECTOR</span>
        </button>

        {/* Free Orbit Cam */}
        <button
          onClick={() => onSetMode('free')}
          className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded text-[9px] sm:text-[10px] font-medium transition-colors ${
            mode === 'free'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Free-Fly Orbit Controls"
        >
          <Compass size={13} />
          <span>FREE</span>
        </button>

        {/* Tactical 2D Overhead */}
        <button
          onClick={() => onSetMode('tactical')}
          className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded text-[9px] sm:text-[10px] font-medium transition-colors ${
            mode === 'tactical'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Top-Down Tactical View"
        >
          <MapPin size={13} />
          <span className="hidden sm:inline">OVERHEAD</span>
          <span className="sm:hidden">TOP</span>
        </button>

        {/* Divider */}
        <div className="w-[1px] h-4 bg-white/10 mx-0.5" />

        {/* BallCam Toggle Button */}
        <button
          onClick={onToggleBallCam}
          className={`p-1 sm:p-1.5 rounded text-[9px] sm:text-[10px] transition-colors ${
            isBallCam
              ? 'bg-cyan-400/10 text-cyan-300'
              : 'text-slate-500 hover:text-white'
          }`}
          title="Toggle Ball Cam [Space]"
        >
          <Eye size={13} />
        </button>

        {/* Camera Settings Slider Toggle */}
        <button
          onClick={() => setShowSettingsModal(!showSettingsModal)}
          className={`p-1 sm:p-1.5 rounded text-xs transition-colors ${
            showSettingsModal
              ? 'bg-white/20 text-white'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          title="Camera Profile Settings"
        >
          <Sliders size={13} />
        </button>
      </div>

      {/* 2. Live 6-Player Switcher */}
      {players.length > 0 && (
        <div className="ui-panel p-0.5 sm:p-1 flex items-center gap-0.5 overflow-x-auto no-scrollbar max-w-full">
          <span className="text-[8px] sm:text-[9px] text-slate-600 uppercase tracking-wider px-1">
            Players
          </span>

          {players.map((p, idx) => {
            const isSelected = activePlayerIndex === idx;
            const isBlue = p.team === 0;

            return (
              <button
                key={p.index}
                onClick={() => onSelectPlayer(idx)}
                className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[9px] sm:text-[10px] font-medium transition-colors shrink-0 ${
                  isSelected
                    ? isBlue
                      ? 'bg-blue-500/15 text-blue-200'
                      : 'bg-orange-500/15 text-orange-200'
                    : isBlue
                    ? 'text-slate-500 hover:text-blue-200 hover:bg-white/5'
                    : 'text-slate-500 hover:text-orange-200 hover:bg-white/5'
                }`}
                title={`Switch to ${p.name} [Key ${idx + 1}]`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isBlue ? 'bg-blue-500' : 'bg-orange-500'
                  }`}
                />
                <span className="truncate max-w-[60px] sm:max-w-[90px]">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 3. Camera Settings Sliders Popover */}
      {showSettingsModal && (
        <div className="ui-panel p-3 w-80 flex flex-col gap-3 text-xs text-white max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="font-medium uppercase tracking-wider text-slate-300 text-[10px]">
              Camera Profile Settings
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Live Profile
            </span>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-col gap-1.5 pb-2 border-b border-white/10">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
              Presets
            </span>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() =>
                  onUpdateCameraSettings({
                    fov: 110,
                    distance: 270,
                    height: 100,
                    angle: -3,
                    stiffness: 0.45,
                    swivel_speed: 5.0,
                    transition_speed: 1.3,
                  })
                }
                className="px-1.5 py-1 rounded bg-white/5 hover:bg-white/15 text-[10px] text-slate-200 transition-colors text-center"
                title="Standard Rocket League Default Settings"
              >
                Default
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateCameraSettings({
                    fov: 110,
                    distance: 270,
                    height: 90,
                    angle: -3,
                    stiffness: 0.4,
                    swivel_speed: 4.5,
                    transition_speed: 1.2,
                  })
                }
                className="px-1.5 py-1 rounded bg-white/5 hover:bg-white/15 text-[10px] text-slate-200 transition-colors text-center"
                title="Zen's Competitive Profile"
              >
                Zen
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateCameraSettings({
                    fov: 110,
                    distance: 260,
                    height: 90,
                    angle: -4,
                    stiffness: 0.55,
                    swivel_speed: 5.0,
                    transition_speed: 1.3,
                  })
                }
                className="px-1.5 py-1 rounded bg-white/5 hover:bg-white/15 text-[10px] text-slate-200 transition-colors text-center"
                title="Vatira's Competitive Profile"
              >
                Vatira
              </button>
              {players[activePlayerIndex] && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateCameraSettings(players[activePlayerIndex].camera_settings)
                  }
                  className="px-1.5 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 text-[10px] transition-colors text-center font-medium"
                  title="Reset to selected player recorded settings"
                >
                  Player
                </button>
              )}
            </div>
          </div>

          {/* FOV */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">FOV</span>
              <span>{Math.round(cameraSettings.fov)}°</span>
            </div>
            <input
              type="range"
              min="80"
              max="110"
              value={cameraSettings.fov}
              onChange={(e) => onUpdateCameraSettings({ fov: Number(e.target.value) })}
              className="accent-blue-500 w-full"
            />
          </div>

          {/* Distance */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Distance</span>
              <span>{Math.round(cameraSettings.distance)} uu</span>
            </div>
            <input
              type="range"
              min="100"
              max="400"
              step="5"
              value={cameraSettings.distance}
              onChange={(e) => onUpdateCameraSettings({ distance: Number(e.target.value) })}
              className="accent-blue-500 w-full"
            />
          </div>

          {/* Height */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Height</span>
              <span>{Math.round(cameraSettings.height)} uu</span>
            </div>
            <input
              type="range"
              min="40"
              max="200"
              step="5"
              value={cameraSettings.height}
              onChange={(e) => onUpdateCameraSettings({ height: Number(e.target.value) })}
              className="accent-blue-500 w-full"
            />
          </div>

          {/* Angle */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Angle (Pitch)</span>
              <span>{cameraSettings.angle}°</span>
            </div>
            <input
              type="range"
              min="-15"
              max="0"
              step="1"
              value={cameraSettings.angle}
              onChange={(e) => onUpdateCameraSettings({ angle: Number(e.target.value) })}
              className="accent-blue-500 w-full"
            />
          </div>

          {/* Stiffness */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Stiffness</span>
              <span>{(cameraSettings.stiffness ?? 0.45).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={cameraSettings.stiffness}
              onChange={(e) => onUpdateCameraSettings({ stiffness: Number(e.target.value) })}
              className="accent-blue-500 w-full"
            />
          </div>

          {/* Swivel Speed */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Swivel Speed</span>
              <span>{(cameraSettings.swivel_speed ?? 5.0).toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="10.0"
              step="0.2"
              value={cameraSettings.swivel_speed ?? 5.0}
              onChange={(e) =>
                onUpdateCameraSettings({ swivel_speed: Number(e.target.value) })
              }
              className="accent-blue-500 w-full"
            />
          </div>

          {/* Transition Speed */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Transition Speed</span>
              <span>{(cameraSettings.transition_speed ?? 1.3).toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="2.0"
              step="0.1"
              value={cameraSettings.transition_speed}
              onChange={(e) =>
                onUpdateCameraSettings({ transition_speed: Number(e.target.value) })
              }
              className="accent-blue-500 w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
};
