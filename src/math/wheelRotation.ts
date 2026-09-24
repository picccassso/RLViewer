import { FLOATS_PER_BALL, FLOATS_PER_PLAYER, MAX_PLAYERS, ParsedReplayData, TOTAL_FLOATS_PER_FRAME } from '../types/replay';
import { getFrameTime } from './frameUnpacker';
import { isOnSurface } from './trails';

const TIME_OFFSET = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;

/** Signed rolling distance in uu, integrated once per replay so seeking never changes phase. */
export function buildWheelTravel(data: ParsedReplayData): Float64Array[] {
  const buffer = data.framesBuffer;
  return data.players.slice(0, MAX_PLAYERS).map((_, player) => {
    const travel = new Float64Array(data.totalFrames);
    const position = { x: 0, y: 0, z: 0 };
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    let speed = 0;
    for (let f = 0; f < data.totalFrames; f++) {
      const frameOffset = f * TOTAL_FLOATS_PER_FRAME;
      const offset = frameOffset + FLOATS_PER_BALL + player * FLOATS_PER_PLAYER;
      const flags = buffer[offset + 11];
      position.x = buffer[offset]; position.y = buffer[offset + 1]; position.z = buffer[offset + 2];
      rotation.x = buffer[offset + 3]; rotation.y = buffer[offset + 4];
      rotation.z = buffer[offset + 5]; rotation.w = buffer[offset + 6];
      const { x, y, z, w } = rotation;
      const forwardSpeed = buffer[offset + 7] * (1 - 2 * (y * y + z * z)) +
        buffer[offset + 8] * 2 * (x * y + w * z) + buffer[offset + 9] * 2 * (x * z - w * y);
      if (f === 0) {
        speed = (flags & 1) !== 0 && (flags & 4) === 0 ? forwardSpeed : 0;
        continue;
      }
      const old = offset - TOTAL_FLOATS_PER_FRAME;
      const oldFlags = buffer[old + 11];
      const dt = buffer[frameOffset + TIME_OFFSET] - buffer[frameOffset - TOTAL_FLOATS_PER_FRAME + TIME_OFFSET];
      const valid = (flags & 1) !== 0 && (flags & 4) === 0 && (oldFlags & 1) !== 0 && (oldFlags & 4) === 0;
      const step = Math.hypot(position.x - buffer[old], position.y - buffer[old + 1], position.z - buffer[old + 2]);
      if (!valid || dt <= 0 || dt > 0.25 || step > 3500 * dt + 20) {
        travel[f] = travel[f - 1];
        speed = valid ? forwardSpeed : 0;
        continue;
      }
      // Air rolls change the car's heading, not the wheels' existing rotation direction.
      const nextSpeed = isOnSurface(position, rotation) ? forwardSpeed : speed * Math.exp(-0.8 * dt);
      travel[f] = travel[f - 1] + (speed + nextSpeed) * 0.5 * dt;
      speed = nextSpeed;
    }
    return travel;
  });
}

export function sampleWheelTravel(data: ParsedReplayData, travel: Float64Array, frameIndex: number, time: number): number {
  if (!travel.length) return 0;
  const frame = Math.min(Math.max(frameIndex, 0), travel.length - 1);
  const next = Math.min(frame + 1, travel.length - 1);
  const from = getFrameTime(data, frame);
  const span = getFrameTime(data, next) - from;
  const alpha = span > 0 && span <= 0.25 ? Math.max(0, Math.min(1, (time - from) / span)) : 0;
  return travel[frame] + (travel[next] - travel[frame]) * alpha;
}
