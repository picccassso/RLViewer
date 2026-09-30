import React from 'react';

const SIZE = 132;
const CENTRE = SIZE / 2;
const RING_RADIUS = 54;
const RING_WIDTH = 11;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Notches every 10 boost, like the in-game meter's segments. */
const NOTCHES = Array.from({ length: 10 }, (_, i) => (i / 10) * 360);

/**
 * The in-game boost gauge: the amount in the middle of a ring that fills clockwise
 * from the bottom as boost goes from 0 to 100.
 */
export const BoostMeter: React.FC<{ boost: number }> = ({ boost }) => {
  const amount = Math.min(Math.max(Math.round(boost), 0), 100);
  const filled = (amount / 100) * CIRCUMFERENCE;

  return (
    <div
      className="relative select-none rounded-full shadow-[0_10px_30px_-6px_rgb(0_0_0/0.75)]"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0">
        <defs>
          <radialGradient id="boost-meter-disc">
            <stop offset="0%" stopColor="#1a2238" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#060914" stopOpacity="0.96" />
          </radialGradient>
          <linearGradient id="boost-meter-fill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ff6a00" />
            <stop offset="100%" stopColor="#ffd23f" />
          </linearGradient>
        </defs>

        <circle cx={CENTRE} cy={CENTRE} r={CENTRE - 1} fill="url(#boost-meter-disc)" stroke="rgb(255 255 255 / 0.1)" />
        <circle cx={CENTRE} cy={CENTRE} r={RING_RADIUS - RING_WIDTH / 2 - 4} fill="none" stroke="rgb(255 255 255 / 0.06)" />
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RING_RADIUS}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth={RING_WIDTH}
        />
        {/* Starts at 6 o'clock: the circle's own start is 3 o'clock, so turn it a quarter. */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RING_RADIUS}
          fill="none"
          stroke="url(#boost-meter-fill)"
          strokeWidth={RING_WIDTH}
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          transform={`rotate(90 ${CENTRE} ${CENTRE})`}
          style={{ filter: amount > 0 ? 'drop-shadow(0 0 4px rgb(255 140 0 / 0.7))' : undefined }}
        />
        {NOTCHES.map((angle) => (
          <line
            key={angle}
            x1={CENTRE}
            y1={CENTRE + RING_RADIUS - RING_WIDTH / 2 - 1}
            x2={CENTRE}
            y2={CENTRE + RING_RADIUS + RING_WIDTH / 2 + 1}
            stroke="#020617"
            strokeWidth={2}
            transform={`rotate(${angle} ${CENTRE} ${CENTRE})`}
          />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`text-[44px] font-bold italic leading-none tabular-nums ${amount > 0 ? 'text-white' : 'text-slate-500'}`}
          style={{ fontFamily: "'Chakra Petch', sans-serif", textShadow: '0 2px 6px rgb(0 0 0 / 0.8)' }}
        >
          {amount}
        </span>
        <span className="mt-1 font-display text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/80">Boost</span>
      </div>
    </div>
  );
};
