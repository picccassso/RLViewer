import React, { useRef, useEffect, useState } from 'react';
import { Map, ChevronDown, ChevronUp, X } from 'lucide-react';
import { FrameState, PlayerInfo } from '../types/replay';
import { FIELD_WIDTH, FIELD_LENGTH } from '../scene/StadiumManager';

/** Map size in CSS pixels. */
const MAP_WIDTH = 152;
const MAP_HEIGHT = 190;
const MAP_PAD = 12;
const DRAW_W = MAP_WIDTH - MAP_PAD * 2;
const DRAW_H = MAP_HEIGHT - MAP_PAD * 2;

// Field X (-4096..+4096) -> map width, Z (-5120..+5120) -> map height
const toCanvasX = (fieldX: number) => MAP_PAD + ((fieldX + FIELD_WIDTH / 2) / FIELD_WIDTH) * DRAW_W;
const toCanvasY = (fieldZ: number) => MAP_PAD + ((fieldZ + FIELD_LENGTH / 2) / FIELD_LENGTH) * DRAW_H;

interface TacticalMinimapProps {
  frameState: FrameState | null;
  activePlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  defaultCollapsed?: boolean;
  /** Show a close button that calls this instead of collapsing the map in place. */
  onClose?: () => void;
}

export const TacticalMinimap: React.FC<TacticalMinimapProps> = ({
  frameState,
  activePlayerIndex,
  onSelectPlayer,
  defaultCollapsed,
  onClose,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof defaultCollapsed === 'boolean') return defaultCollapsed;
    if (typeof window !== 'undefined' && window.innerHeight < 520) return true;
    return false;
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frameState) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw in CSS pixels on a backing store sized for the screen, so it stays sharp.
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== MAP_WIDTH * dpr) {
      canvas.width = MAP_WIDTH * dpr;
      canvas.height = MAP_HEIGHT * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = MAP_WIDTH;
    const h = MAP_HEIGHT;
    ctx.clearRect(0, 0, w, h);

    // 1. Field boundary (octagon), each half tinted by the team defending it
    const cornerCutX = 1024 * (DRAW_W / FIELD_WIDTH);
    const cornerCutY = 1088 * (DRAW_H / FIELD_LENGTH);
    const traceField = () => {
      ctx.beginPath();
      ctx.moveTo(MAP_PAD + cornerCutX, MAP_PAD);
      ctx.lineTo(w - MAP_PAD - cornerCutX, MAP_PAD);
      ctx.lineTo(w - MAP_PAD, MAP_PAD + cornerCutY);
      ctx.lineTo(w - MAP_PAD, h - MAP_PAD - cornerCutY);
      ctx.lineTo(w - MAP_PAD - cornerCutX, h - MAP_PAD);
      ctx.lineTo(MAP_PAD + cornerCutX, h - MAP_PAD);
      ctx.lineTo(MAP_PAD, h - MAP_PAD - cornerCutY);
      ctx.lineTo(MAP_PAD, MAP_PAD + cornerCutY);
      ctx.closePath();
    };

    const turf = ctx.createLinearGradient(0, MAP_PAD, 0, h - MAP_PAD);
    turf.addColorStop(0, 'rgba(22, 90, 200, 0.22)');
    turf.addColorStop(0.5, 'rgba(10, 14, 24, 0.6)');
    turf.addColorStop(1, 'rgba(230, 100, 20, 0.22)');
    traceField();
    ctx.fillStyle = turf;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 2. Midfield line & centre circle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(MAP_PAD, h / 2);
    ctx.lineTo(w - MAP_PAD, h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 20, 0, Math.PI * 2);
    ctx.stroke();

    // Goals (Blue top at -Z, Orange bottom at +Z)
    const goalCanvasW = (1785 / FIELD_WIDTH) * DRAW_W;
    ctx.fillStyle = '#3b9cff';
    ctx.fillRect(w / 2 - goalCanvasW / 2, MAP_PAD - 4, goalCanvasW, 3);
    ctx.fillStyle = '#ff8a1f';
    ctx.fillRect(w / 2 - goalCanvasW / 2, h - MAP_PAD + 1, goalCanvasW, 3);

    // 3. Players
    frameState.players.forEach((p, idx) => {
      if (!p.isPresent || p.isDemoed) return;

      const px = toCanvasX(p.position.x);
      const py = toCanvasY(p.position.z);
      const isSelected = idx === activePlayerIndex;
      const isBlue = p.info.team === 0;

      // Forward in Three space is +X (from Unreal +X): forward = q * (1, 0, 0) * q^-1
      const qx = p.rotation.x, qy = p.rotation.y, qz = p.rotation.z, qw = p.rotation.w;
      const fX = 1 - 2 * (qy * qy + qz * qz);
      const fZ = 2 * (qx * qz - qy * qw);

      if (isSelected) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Orientation pointer
      const angle = Math.atan2(fZ, fX);
      ctx.fillStyle = isBlue ? '#93c5fd' : '#fdba74';
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(angle) * 12, py + Math.sin(angle) * 12);
      ctx.lineTo(px + Math.cos(angle + 2.4) * 6, py + Math.sin(angle + 2.4) * 6);
      ctx.lineTo(px + Math.cos(angle - 2.4) * 6, py + Math.sin(angle - 2.4) * 6);
      ctx.closePath();
      ctx.fill();

      // Player disc
      ctx.fillStyle = isBlue ? '#1672e8' : '#f06a0f';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Player number (1-6)
      ctx.fillStyle = '#ffffff';
      ctx.font = "bold 9px 'Chakra Petch', Rajdhani, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${idx + 1}`, px, py + 0.5);
    });

    // 4. Ball
    const bx = toCanvasX(frameState.ball.position.x);
    const by = toCanvasY(frameState.ball.position.z);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.arc(bx, by, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }, [frameState, activePlayerIndex]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !frameState) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (rect.width > 0 ? MAP_WIDTH / rect.width : 1);
    const clickY = (e.clientY - rect.top) * (rect.height > 0 ? MAP_HEIGHT / rect.height : 1);

    // Check click near players
    for (let i = 0; i < frameState.players.length; i++) {
      const p = frameState.players[i];
      if (!p.isPresent) continue;
      const dist = Math.hypot(clickX - toCanvasX(p.position.x), clickY - toCanvasY(p.position.z));
      if (dist <= 16) {
        onSelectPlayer(i);
        break;
      }
    }
  };

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        className="hud-panel hud-btn h-9 px-3 text-[12px] uppercase tracking-wider"
        title="Show Tactical Minimap"
        aria-label="Show Tactical Minimap"
      >
        <Map size={14} className="text-cyan-300" />
        <span>Map</span>
        <ChevronUp size={13} className="text-slate-500" />
      </button>
    );
  }

  return (
    <div className="hud-panel p-2 flex flex-col items-center">
      <div className="flex items-center justify-between w-full pl-1 mb-1.5">
        <span className="hud-label">Map</span>
        <button
          type="button"
          onClick={onClose ?? (() => setIsCollapsed(true))}
          className="hud-btn h-5 w-5 rounded text-slate-500"
          title={onClose ? 'Close Map' : 'Minimize Map'}
          aria-label={onClose ? 'Close Map' : 'Minimize Map'}
        >
          {onClose ? <X size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
        onClick={handleClick}
        className="cursor-pointer"
        title="Click a player to follow them"
      />
    </div>
  );
};
