import { FLOATS_PER_BALL, FLOATS_PER_PLAYER, MAX_PLAYERS, ParsedReplayData, TOTAL_FLOATS_PER_FRAME } from '../../types/replay';

const META = FLOATS_PER_BALL + MAX_PLAYERS * FLOATS_PER_PLAYER;
export function replay(): ParsedReplayData {
  const totalFrames = 31;
  const framesBuffer = new Float32Array(totalFrames * TOTAL_FLOATS_PER_FRAME);
  for (let f = 0; f < totalFrames; f++) {
    const o = f * TOTAL_FLOATS_PER_FRAME;
    framesBuffer.set([1000, 400, 0, 0, 0, 0, 1, 0, 0, 0], o);
    framesBuffer.set([0, 17, 0, 0, 0, 0, 1, 0, 0, 0, 100, 1], o + FLOATS_PER_BALL);
    framesBuffer.set([2000, 17, 0, 0, 0, 0, 1, 0, 0, 0, 100, 1], o + FLOATS_PER_BALL + FLOATS_PER_PLAYER);
    framesBuffer[o + META] = f / 30;
  }
  return { totalFrames, duration: 1, frameRate: 30, framesBuffer,
    players: [{ index: 0, team: 0 }, { index: 1, team: 1 }] as ParsedReplayData['players'],
    boostPads: [], tickMarks: [], teamScores: { team0: 0, team1: 0 }, flipResets: [], ballTouches: [], demolitions: [] };
}
export function car(data: ParsedReplayData, frame: number, player = 0) {
  return data.framesBuffer.subarray(frame * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL + player * FLOATS_PER_PLAYER);
}
