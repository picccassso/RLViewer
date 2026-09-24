import React from 'react';

interface RLViewerLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export const RLViewerLogo: React.FC<RLViewerLogoProps> = ({
  size = 24,
  showText = false,
  className = '',
}) => {
  return (
    <div className={`inline-flex items-center gap-2 select-none ${className}`}>
      {/* Emblem SVG */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-[0_0_8px_rgba(0,229,255,0.4)]"
      >
        <defs>
          <linearGradient id="logoShieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f0ff" />
            <stop offset="100%" stopColor="#0088ff" />
          </linearGradient>
          <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0d1428" />
            <stop offset="100%" stopColor="#050814" />
          </linearGradient>
        </defs>

        {/* Outer Hexagonal Shield Housing */}
        <polygon
          points="50,12 83,31 83,69 50,88 17,69 17,31"
          fill="url(#logoBgGrad)"
          stroke="url(#logoShieldGrad)"
          strokeWidth="4.5"
        />

        {/* Camera Speed Notch (Left) */}
        <polygon points="17,45 8,36 8,64 17,55" fill="#00f0ff" />

        {/* Dual-team Accent Rings (Rocket League Blue & Orange) */}
        <path
          d="M 28 50 A 22 22 0 0 1 66 34"
          stroke="#00e5ff"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <path
          d="M 72 50 A 22 22 0 0 1 34 66"
          stroke="#ff7700"
          strokeWidth="4.5"
          strokeLinecap="round"
        />

        {/* Camera Core / Ball Aperture */}
        <circle cx="50" cy="50" r="14" fill="#070c1e" stroke="#00e5ff" strokeWidth="2.5" />
        <circle cx="50" cy="50" r="8" fill="#00d4ff" />
        <circle cx="50" cy="50" r="4.2" fill="#03050c" />
        {/* Specular Highlight */}
        <circle cx="47" cy="46" r="2.2" fill="#ffffff" />
      </svg>

      {/* Optional Brand Typography */}
      {showText && (
        <div className="flex items-center gap-1.5 leading-none">
          <span className="font-bold tracking-tight text-white font-rajdhani text-sm">
            RL<span className="text-cyan-400">Viewer</span>
          </span>
          <span className="text-[9px] font-semibold font-mono px-1 py-0.5 rounded bg-cyan-400/10 text-cyan-300 border border-cyan-400/30">
            3D
          </span>
        </div>
      )}
    </div>
  );
};
