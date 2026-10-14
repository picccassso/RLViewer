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
        className="shrink-0"
      >
        {/* Outer Hexagonal Shield Housing */}
        <polygon
          points="50,12 83,31 83,69 50,88 17,69 17,31"
          fill="#0d1322"
          stroke="#475569"
          strokeWidth="4.5"
        />

        {/* Dual-team Accent Rings (Blue & Orange) */}
        <path
          d="M 28 50 A 22 22 0 0 1 66 34"
          stroke="#1968cc"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M 72 50 A 22 22 0 0 1 34 66"
          stroke="#d65a12"
          strokeWidth="5"
          strokeLinecap="round"
        />

        {/* Center Ball Core */}
        <circle cx="50" cy="50" r="11" fill="#e2e8f0" />
        <circle cx="50" cy="50" r="4.5" fill="#0d1322" />
      </svg>

      {/* Optional Brand Typography */}
      {showText && (
        <div className="flex items-center gap-1.5 leading-none">
          <span className="font-bold tracking-tight text-white font-display text-[15px]">
            RLViewer
          </span>
        </div>
      )}
    </div>
  );
};
