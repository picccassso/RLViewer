import * as THREE from 'three';
import {
  ParsedReplayData,
  FrameState,
  TOTAL_FLOATS_PER_FRAME,
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS
} from '../types/replay';

/**
 * Extracts and optionally interpolates frame state from the packed Float32Array.
 * If alpha = 0, returns exact frameA.
 * If alpha > 0, smoothly interpolates position, slerps rotation, and lerps boost.
 */
export function unpackFrame(
  replayData: ParsedReplayData,
  frameIndexA: number,
  frameIndexB: number = frameIndexA,
  alpha: number = 0
): FrameState {
  const { framesBuffer, totalFrames, players, boostPads } = replayData;
  const iA = Math.min(Math.max(0, Math.floor(frameIndexA)), totalFrames - 1);
  const iB = Math.min(Math.max(0, Math.floor(frameIndexB)), totalFrames - 1);
  const offsetA = iA * TOTAL_FLOATS_PER_FRAME;
  const offsetB = iB * TOTAL_FLOATS_PER_FRAME;

  const t = Math.min(Math.max(alpha, 0), 1);

  // Ball
  const ballPosA = new THREE.Vector3(framesBuffer[offsetA + 0], framesBuffer[offsetA + 1], framesBuffer[offsetA + 2]);
  const ballPosB = new THREE.Vector3(framesBuffer[offsetB + 0], framesBuffer[offsetB + 1], framesBuffer[offsetB + 2]);
  const ballPos = new THREE.Vector3().lerpVectors(ballPosA, ballPosB, t);

  const ballRotA = new THREE.Quaternion(framesBuffer[offsetA + 3], framesBuffer[offsetA + 4], framesBuffer[offsetA + 5], framesBuffer[offsetA + 6]);
  const ballRotB = new THREE.Quaternion(framesBuffer[offsetB + 3], framesBuffer[offsetB + 4], framesBuffer[offsetB + 5], framesBuffer[offsetB + 6]);
  const ballRot = new THREE.Quaternion().copy(ballRotA).slerp(ballRotB, t);

  const ballVelA = new THREE.Vector3(framesBuffer[offsetA + 7], framesBuffer[offsetA + 8], framesBuffer[offsetA + 9]);
  const ballVelB = new THREE.Vector3(framesBuffer[offsetB + 7], framesBuffer[offsetB + 8], framesBuffer[offsetB + 9]);
  const ballVel = new THREE.Vector3().lerpVectors(ballVelA, ballVelB, t);

  // Players
  const playersState: FrameState['players'] = [];
  for (let p = 0; p < players.length && p < MAX_PLAYERS; p++) {
    const pOffsetA = offsetA + FLOATS_PER_BALL + (p * FLOATS_PER_PLAYER);
    const pOffsetB = offsetB + FLOATS_PER_BALL + (p * FLOATS_PER_PLAYER);

    const flags = Math.floor(framesBuffer[pOffsetA + 11]);
    const isPresent = (flags & 1) !== 0;
    const ballCamActive = (flags & 2) !== 0;
    const isDemoed = (flags & 4) !== 0;
    const boostActive = (flags & 8) !== 0;
    const powerslideActive = (flags & 16) !== 0;
    const jumpActive = (flags & 32) !== 0;
    const dodgeActive = (flags & 64) !== 0;

    const posA = new THREE.Vector3(framesBuffer[pOffsetA + 0], framesBuffer[pOffsetA + 1], framesBuffer[pOffsetA + 2]);
    const posB = new THREE.Vector3(framesBuffer[pOffsetB + 0], framesBuffer[pOffsetB + 1], framesBuffer[pOffsetB + 2]);
    const pos = new THREE.Vector3().lerpVectors(posA, posB, t);

    const rotA = new THREE.Quaternion(framesBuffer[pOffsetA + 3], framesBuffer[pOffsetA + 4], framesBuffer[pOffsetA + 5], framesBuffer[pOffsetA + 6]);
    const rotB = new THREE.Quaternion(framesBuffer[pOffsetB + 3], framesBuffer[pOffsetB + 4], framesBuffer[pOffsetB + 5], framesBuffer[pOffsetB + 6]);
    const rot = new THREE.Quaternion().copy(rotA).slerp(rotB, t);

    const velA = new THREE.Vector3(framesBuffer[pOffsetA + 7], framesBuffer[pOffsetA + 8], framesBuffer[pOffsetA + 9]);
    const velB = new THREE.Vector3(framesBuffer[pOffsetB + 7], framesBuffer[pOffsetB + 8], framesBuffer[pOffsetB + 9]);
    const vel = new THREE.Vector3().lerpVectors(velA, velB, t);

    const boostA = framesBuffer[pOffsetA + 10];
    const boostB = framesBuffer[pOffsetB + 10];
    const boost = boostA + (boostB - boostA) * t;

    playersState.push({
      info: players[p],
      isPresent,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      velocity: { x: vel.x, y: vel.y, z: vel.z },
      boost: Math.min(Math.max(boost, 0), 100),
      ballCamActive,
      isDemoed,
      boostActive,
      powerslideActive,
      jumpActive,
      dodgeActive
    });
  }

  // Metadata
  const metaOffsetA = offsetA + FLOATS_PER_BALL + (MAX_PLAYERS * FLOATS_PER_PLAYER);
  const metaOffsetB = offsetB + FLOATS_PER_BALL + (MAX_PLAYERS * FLOATS_PER_PLAYER);

  const timeA = framesBuffer[metaOffsetA + 0];
  const timeB = framesBuffer[metaOffsetB + 0];
  const time = timeA + (timeB - timeA) * t;

  const secondsRemaining = Math.floor(framesBuffer[metaOffsetA + 1]);

  // Boost pads bitmask (34 pads) stored losslessly in 32-bit integer slots
  const uint32View = new Uint32Array(framesBuffer.buffer);
  const maskLow = uint32View[metaOffsetA + 2];
  const maskHigh = uint32View[metaOffsetA + 3];
  const boostPadsAvailable: boolean[] = [];
  for (let b = 0; b < 34; b++) {
    if (b < 32) {
      boostPadsAvailable.push(((maskLow >>> b) & 1) === 1);
    } else {
      boostPadsAvailable.push(((maskHigh >>> (b - 32)) & 1) === 1);
    }
  }

  return {
    frameIndex: iA,
    time,
    secondsRemaining,
    ball: {
      position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
      rotation: { x: ballRot.x, y: ballRot.y, z: ballRot.z, w: ballRot.w },
      velocity: { x: ballVel.x, y: ballVel.y, z: ballVel.z }
    },
    players: playersState,
    boostPadsAvailable
  };
}
