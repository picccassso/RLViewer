import React from 'react';

const SIZE = 116;
const CENTRE = SIZE / 2;
const RING_RADIUS = 46;
const RING_WIDTH = 9;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** 10 segment notches every 36 degrees. */
const NOTCHES = Array.from({ length: 10 }, (_, i) => (i / 10) * 360);

/**
 * Simple, flat circular boost gauge:
 * Solid dark disc, 10-segment flat amber-orange arc, and clean numerals.
 */
export const BoostMeter: React.FC<{ boost: number; boostActive?: boolean }> = ({
  boost,
}) => {
  const amount = Math.min(Math.max(Math.round(boost), 0), 100);
  const filled = (amount / 100) * CIRCUMFERENCE;

  return (
    <div
      className="relative select-none rounded-full shadow-md"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0">
        {/* Flat dark disc */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={CENTRE - 1}
          fill="rgb(12 16 25 / 0.92)"
          stroke="rgb(255 255 255 / 0.1)"
          strokeWidth={1}
        />

        {/* Unfilled track */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RING_RADIUS}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth={RING_WIDTH}
        />

        {/* Filled boost arc (starts at 6 o'clock clockwise) */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RING_RADIUS}
          fill="none"
          stroke={amount > 66 ? '#ea580c' : '#f59e0b'}
          strokeWidth={RING_WIDTH}
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          transform={`rotate(90 ${CENTRE} ${CENTRE})`}
        />

        {/* 10 segment notches */}
        {NOTCHES.map((angle) => (
          <line
            key={angle}
            x1={CENTRE}
            y1={CENTRE + RING_RADIUS - RING_WIDTH / 2 - 1}
            x2={CENTRE}
            y2={CENTRE + RING_RADIUS + RING_WIDTH / 2 + 1}
            stroke="#0c1019"
            strokeWidth={2}
            transform={`rotate(${angle} ${CENTRE} ${CENTRE})`}
          />
        ))}
      </svg>

      {/* Center Readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-numeric text-[36px] font-bold leading-none tabular-nums ${
            amount > 0 ? 'text-white' : 'text-slate-500'
          }`}
        >
          {amount}
        </span>
        <span className="mt-0.5 font-display text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">
          Boost
        </span>
      </div>
    </div>
  );
};
