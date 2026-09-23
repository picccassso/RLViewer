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
      <div className="ui-panel p-1 flex items-center gap-0.5">
        {/* POV Cam */}
        <button
          onClick={() => onSetMode('pov')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors ${
            mode === 'pov'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Player POV Chase Camera"
        >
          <Camera size={14} />
          <span>POV</span>
        </button>

        {/* Director Cam */}
        <button
          onClick={() => onSetMode('director')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors ${
            mode === 'director'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Dynamic Broadcast Spectator Camera"
        >
          <Video size={14} />
          <span>DIRECTOR</span>
        </button>

        {/* Free Orbit Cam */}
        <button
          onClick={() => onSetMode('free')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors ${
            mode === 'free'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Free-Fly Orbit Controls"
        >
          <Compass size={14} />
          <span>FREE</span>
        </button>

        {/* Tactical 2D Overhead */}
        <button
          onClick={() => onSetMode('tactical')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors ${
            mode === 'tactical'
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Top-Down Tactical View"
        >
          <MapPin size={14} />
          <span>OVERHEAD</span>
        </button>

        {/* Divider */}
        <div className="w-[1px] h-5 bg-white/10 mx-1" />

        {/* BallCam Toggle Button */}
        <button
          onClick={onToggleBallCam}
          className={`p-1.5 rounded text-[10px] transition-colors ${
            isBallCam
              ? 'bg-cyan-400/10 text-cyan-300'
              : 'text-slate-500 hover:text-white'
          }`}
          title="Toggle Ball Cam [Space]"
        >
          <Eye size={14} />
        </button>

        {/* Camera Settings Slider Toggle */}
        <button
          onClick={() => setShowSettingsModal(!showSettingsModal)}
          className={`p-1.5 rounded text-xs transition-colors ${
            showSettingsModal
              ? 'bg-white/20 text-white'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          title="Camera Profile Settings"
        >
          <Sliders size={14} />
        </button>
      </div>

      {/* 2. Live 6-Player Switcher */}
      {players.length > 0 && (
        <div className="ui-panel p-1 flex items-center gap-0.5 overflow-x-auto max-w-[90vw]">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider px-1.5">
            Players
          </span>

          {players.map((p, idx) => {
            const isSelected = activePlayerIndex === idx;
            const isBlue = p.team === 0;

            return (
              <button
                key={p.index}
                onClick={() => onSelectPlayer(idx)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
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
                  className={`w-1.5 h-1.5 rounded-full ${
                    isBlue ? 'bg-blue-500' : 'bg-orange-500'
                  }`}
                />
                <span className="truncate max-w-[90px]">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 3. Camera Settings Sliders Popover */}
      {showSettingsModal && (
        <div className="ui-panel p-3 w-72 flex flex-col gap-3 text-xs text-white">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="font-medium uppercase tracking-wider text-slate-300 text-[10px]">
              Camera Settings
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Live Profile
            </span>
          </div>

          {/* FOV */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">FOV</span>
              <span>{Math.round(cameraSettings.fov)}°</span>
            </div>
            <input
              type="range"
              min="90"
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
              min="150"
              max="400"
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
              value={cameraSettings.angle}
              onChange={(e) => onUpdateCameraSettings({ angle: Number(e.target.value) })}
              className="accent-blue-500 w-full"
            />
          </div>

          {/* Stiffness */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Stiffness</span>
              <span>{(cameraSettings.stiffness || 0.45).toFixed(2)}</span>
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

          {/* Transition Speed */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Transition Speed</span>
              <span>{(cameraSettings.transition_speed || 1.3).toFixed(1)}</span>
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
