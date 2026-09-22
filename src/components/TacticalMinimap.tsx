import React, { useRef, useEffect } from 'react';
import { FrameState, PlayerInfo } from '../types/replay';
import { FIELD_WIDTH, FIELD_LENGTH } from '../scene/StadiumManager';

interface TacticalMinimapProps {
  frameState: FrameState | null;
  activePlayerIndex: number;
  onSelectPlayer: (index: number) => void;
}

export const TacticalMinimap: React.FC<TacticalMinimapProps> = ({
  frameState,
  activePlayerIndex,
  onSelectPlayer,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frameState) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Padding
    const pad = 12;
    const drawW = w - pad * 2;
    const drawH = h - pad * 2;

    // Field scale: X (-4096..+4096) -> drawW, Z (-5120..+5120) -> drawH
    const toCanvasX = (fieldX: number) => pad + ((fieldX + FIELD_WIDTH / 2) / FIELD_WIDTH) * drawW;
    const toCanvasY = (fieldZ: number) => pad + ((fieldZ + FIELD_LENGTH / 2) / FIELD_LENGTH) * drawH;

    // 1. Draw Field Boundary (Octagon)
    const cornerCutX = 1024 * (drawW / FIELD_WIDTH);
    const cornerCutY = 1088 * (drawH / FIELD_LENGTH);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(pad + cornerCutX, pad);
    ctx.lineTo(w - pad - cornerCutX, pad);
    ctx.lineTo(w - pad, pad + cornerCutY);
    ctx.lineTo(w - pad, h - pad - cornerCutY);
    ctx.lineTo(w - pad - cornerCutX, h - pad);
    ctx.lineTo(pad + cornerCutX, h - pad);
    ctx.lineTo(pad, h - pad - cornerCutY);
    ctx.lineTo(pad, pad + cornerCutY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 2. Midfield Line & Center Circle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(pad, h / 2);
    ctx.lineTo(w - pad, h / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
    ctx.stroke();

    // Goals (Blue top at -Z, Orange bottom at +Z)
    const goalCanvasW = (1785 / FIELD_WIDTH) * drawW;
    ctx.fillStyle = 'rgba(0, 136, 255, 0.4)';
    ctx.fillRect(w / 2 - goalCanvasW / 2, pad - 6, goalCanvasW, 6);
    ctx.fillStyle = 'rgba(255, 102, 0, 0.4)';
    ctx.fillRect(w / 2 - goalCanvasW / 2, h - pad, goalCanvasW, 6);

    // 3. Draw Players
    frameState.players.forEach((p, idx) => {
      if (!p.isPresent || p.isDemoed) return;

      const px = toCanvasX(p.position.x);
      const py = toCanvasY(p.position.z);
      const isSelected = idx === activePlayerIndex;
      const isBlue = p.info.team === 0;

      // Direction vector from quaternion
      // Forward in Three space is +X (from Unreal +X)
      // Rotated forward vector:
      const qx = p.rotation.x, qy = p.rotation.y, qz = p.rotation.z, qw = p.rotation.w;
      // forward = q * (1, 0, 0) * q^-1
      const fX = 1 - 2 * (qy * qy + qz * qz);
      const fZ = 2 * (qx * qz - qy * qw);

      // Selected pulse ring
      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Orientation pointer
      const angle = Math.atan2(fZ, fX);
      ctx.fillStyle = isBlue ? '#38bdf8' : '#fb923c';
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(angle) * 12, py + Math.sin(angle) * 12);
      ctx.lineTo(px + Math.cos(angle + 2.4) * 6, py + Math.sin(angle + 2.4) * 6);
      ctx.lineTo(px + Math.cos(angle - 2.4) * 6, py + Math.sin(angle - 2.4) * 6);
      ctx.closePath();
      ctx.fill();

      // Player circle
      ctx.fillStyle = isBlue ? '#0088ff' : '#ff6600';
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Player Number (1-6)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${idx + 1}`, px, py);
    });

    // 4. Draw Ball
    const bx = toCanvasX(frameState.ball.position.x);
    const by = toCanvasY(frameState.ball.position.z);

    // Ball outer glow
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();

    // Ball center
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
    ctx.fill();

  }, [frameState, activePlayerIndex]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !frameState) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const pad = 12;
    const drawW = canvas.width - pad * 2;
    const drawH = canvas.height - pad * 2;

    const toCanvasX = (fieldX: number) => pad + ((fieldX + FIELD_WIDTH / 2) / FIELD_WIDTH) * drawW;
    const toCanvasY = (fieldZ: number) => pad + ((fieldZ + FIELD_LENGTH / 2) / FIELD_LENGTH) * drawH;

    // Check click near players
    for (let i = 0; i < frameState.players.length; i++) {
      const p = frameState.players[i];
      if (!p.isPresent) continue;
      const px = toCanvasX(p.position.x);
      const py = toCanvasY(p.position.z);
      const dist = Math.hypot(clickX - px, clickY - py);
      if (dist <= 16) {
        onSelectPlayer(i);
        break;
      }
    }
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-xl p-2.5 shadow-2xl flex flex-col items-center">
      <div className="flex items-center justify-between w-full px-1 mb-1.5 text-xs font-semibold text-slate-400">
        <span className="tracking-wider uppercase font-mono text-[10px]">Tactical Radar</span>
        <span className="text-[10px] text-cyan-400 font-mono">2D MINIMAP</span>
      </div>
      <canvas
        ref={canvasRef}
        width={180}
        height={225}
        onClick={handleClick}
        className="cursor-pointer rounded-lg hover:border-white/20 transition-colors"
      />
    </div>
  );
};
