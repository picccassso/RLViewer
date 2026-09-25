import React from 'react';
import { RLViewerLogo } from './RLViewerLogo';
import { Compass } from 'lucide-react';

interface OrientationLockOverlayProps {
  isVisible: boolean;
}

export const OrientationLockOverlay: React.FC<OrientationLockOverlayProps> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#05070d]/95 backdrop-blur-xl p-6 select-none transition-opacity duration-300"
      style={{
        paddingTop: 'max(24px, env(safe-area-inset-top))',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(24px, env(safe-area-inset-left))',
        paddingRight: 'max(24px, env(safe-area-inset-right))',
      }}
    >
      {/* Background cyber ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] bg-cyan-500/10 rounded-full blur-[100px] animate-pulse-ring" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] h-[240px] bg-blue-600/15 rounded-full blur-[80px]" />
      </div>

      {/* Main card */}
      <div className="relative z-10 flex flex-col items-center max-w-sm text-center">
        {/* Header Branding */}
        <div className="flex items-center gap-2 mb-6 px-3 py-1 rounded-full border border-white/10 bg-slate-900/60 backdrop-blur-md">
          <RLViewerLogo size={20} showText={false} />
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-300">
            RL<span className="text-cyan-400">Viewer</span>
          </span>
          <span className="w-1 h-1 rounded-full bg-cyan-400" />
          <span className="text-[10px] font-mono text-cyan-400 font-medium">3D ARENA</span>
        </div>

        {/* Animated Phone Rotation Illustration */}
        <div className="relative w-44 h-44 mb-6 flex items-center justify-center">
          {/* Circular Rotation Guide Track */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 176 176">
            <defs>
              <linearGradient id="trackGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            {/* Guide circle arc */}
            <circle
              cx="88"
              cy="88"
              r="76"
              fill="none"
              stroke="url(#trackGradient)"
              strokeWidth="1.5"
              strokeDasharray="8 6"
              className="opacity-40"
            />
            {/* Arrowhead showing counter-clockwise rotation */}
            <polygon
              points="88,6 94,14 82,14"
              fill="#38bdf8"
              transform="rotate(-40 88 88)"
              className="drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]"
            />
          </svg>

          {/* Rotating Phone Body */}
          <div className="animate-rotate-device flex items-center justify-center drop-shadow-[0_0_24px_rgba(56,189,248,0.35)]">
            <svg width="68" height="114" viewBox="0 0 68 114" fill="none">
              {/* Outer phone chassis */}
              <rect
                x="1.5"
                y="1.5"
                width="65"
                height="111"
                rx="14"
                fill="#0d1424"
                stroke="#38bdf8"
                strokeWidth="2"
              />
              {/* Screen Bezel */}
              <rect
                x="5"
                y="9"
                width="58"
                height="96"
                rx="8"
                fill="#060913"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />
              {/* Speaker notch / dynamic island */}
              <rect x="25" y="4" width="18" height="3" rx="1.5" fill="#38bdf8" className="opacity-75" />
              {/* Pitch center line & circle inside phone display */}
              <line x1="5" y1="57" x2="63" y2="57" stroke="rgba(56,189,248,0.25)" strokeWidth="1" strokeDasharray="2 2" />
              <circle cx="34" cy="57" r="10" stroke="rgba(56,189,248,0.35)" strokeWidth="1" fill="none" />
              {/* Glowing ball symbol in center */}
              <circle cx="34" cy="57" r="4" fill="#38bdf8" className="drop-shadow-[0_0_4px_#38bdf8]" />
              {/* Home indicator bar at bottom */}
              <rect x="24" y="100" width="20" height="2" rx="1" fill="rgba(255,255,255,0.3)" />
            </svg>
          </div>
        </div>

        {/* Text Guidance */}
        <h2 className="text-xl sm:text-2xl font-bold uppercase tracking-[0.16em] text-white font-display">
          Rotate To <span className="text-cyan-400">Landscape</span>
        </h2>
        
        <p className="mt-2 text-xs sm:text-sm text-slate-400 max-w-xs leading-relaxed font-medium">
          RL Visualiser is designed for widescreen viewing. Rotate your device horizontally for the stadium pitch and HUD.
        </p>

        {/* Feature Highlights */}
        <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-slate-500 font-mono uppercase tracking-wider">
          <div className="flex items-center gap-1.5">
            <Compass size={12} className="text-cyan-400" />
            <span>Full 3D Pitch</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-slate-700" />
          <span>Widescreen HUD</span>
          <div className="w-1 h-1 rounded-full bg-slate-700" />
          <span>Touch Scrubbing</span>
        </div>
      </div>
    </div>
  );
};
