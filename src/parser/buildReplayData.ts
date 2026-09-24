import {
  ParsedReplayData,
  PlayerInfo,
  ReplayBoostPad,
  TOTAL_FLOATS_PER_FRAME,
  FLOATS_PER_BALL,
  FLOATS_PER_PLAYER,
  MAX_PLAYERS
} from '../types/replay';
import { rlToThreeVec3, rlToThreeQuat } from '../math/coords';
import { BoostPadClockManager } from '../math/boostPadClock';
import { smoothReplayPositions } from '../math/motionSmoothing';
import { buildTickMarks, readFinalScore } from './tickMarks';
import { buildFlipResets } from '../math/flipReset';

/**
 * Builds the viewer's frame buffer and metadata from subtr-actor's
 * `get_replay_frames_data` output. Runs in the replay worker, and in Node for tests.
 */
export function buildReplayData(rawData: any): ParsedReplayData {
  const meta = rawData.meta;
  const frameData = rawData.frame_data;
  const rawBallFrames = frameData?.ball_data?.frames ?? [];
  const rawPlayers = frameData?.players ?? [];
  const metadataFrames = frameData?.metadata_frames ?? [];
  const totalFrames = metadataFrames.length || rawBallFrames.length;

  if (totalFrames === 0) {
    throw new Error('Replay has 0 frames or invalid structure');
  }

  // Process Players
  const teamZero = meta?.team_zero ?? [];
  const teamOne = meta?.team_one ?? [];
  const players: PlayerInfo[] = [];

  // Map unique remote ids to player metadata
  const findMetaPlayer = (uidObj: any) => {
    const uidKey = uidObj ? Object.keys(uidObj)[0] : null;
    const uidVal = uidKey ? uidObj[uidKey] : null;

    for (const p of teamZero) {
      const pKey = p.remote_id ? Object.keys(p.remote_id)[0] : null;
      if (pKey && p.remote_id[pKey] === uidVal) return { meta: p, team: 0 as const };
    }
    for (const p of teamOne) {
      const pKey = p.remote_id ? Object.keys(p.remote_id)[0] : null;
      if (pKey && p.remote_id[pKey] === uidVal) return { meta: p, team: 1 as const };
    }
    return null;
  };

  for (let i = 0; i < rawPlayers.length && i < MAX_PLAYERS; i++) {
    const pTuple = rawPlayers[i];
    const pUid = pTuple[0];
    const pFrames = pTuple[1]?.frames ?? [];
    const match = findMetaPlayer(pUid);
    const firstFrameData = pFrames[0]?.Data;
    const pName = match?.meta?.name || firstFrameData?.player_name || `Player ${i + 1}`;
    const team = match ? match.team : (i < 3 ? 0 : 1);
    const cam = match?.meta?.camera_settings || {
      fov: 110,
      height: 100,
      angle: -3,
      distance: 270,
      stiffness: 0.45,
      swivel_speed: 5.0,
      transition_speed: 1.3
    };

    players.push({
      index: i,
      id: JSON.stringify(pUid),
      name: pName,
      team,
      car_body_id: match?.meta?.car_body_id ?? 0,
      car_hitbox_family: match?.meta?.car_hitbox_family ?? 'Octane',
      camera_settings: {
        fov: cam.fov ?? 110,
        height: cam.height ?? 100,
        angle: cam.angle ?? -3,
        distance: cam.distance ?? 270,
        stiffness: cam.stiffness ?? 0.45,
        swivel_speed: cam.swivel_speed ?? 5.0,
        transition_speed: cam.transition_speed ?? 1.3
      },
      score: match?.meta?.stats?.score ?? 0,
      goals: match?.meta?.stats?.goals ?? 0,
      assists: match?.meta?.stats?.assists ?? 0,
      saves: match?.meta?.stats?.saves ?? 0,
      shots: match?.meta?.stats?.shots ?? 0
    });
  }

  // Boost Pads (34 authentic pads)
  const rawBoostPads = rawData.boost_pads ?? [];
  const boostPads: ReplayBoostPad[] = rawBoostPads.map((bp: any, idx: number) => {
    const threePos = rlToThreeVec3(bp.position);
    return {
      index: bp.index ?? idx,
      pad_id: bp.pad_id,
      size: bp.size === 'Big' ? 'Big' : 'Small',
      position: { x: threePos.x, y: bp.size === 'Big' ? 130 : 10, z: threePos.z }
    };
  });

  // Demolish Events
  const rawDemos = rawData.demolish_infos ?? [];
  // Map of victim UID string -> list of demo frames
  const demosByVictim = new Map<string, number[]>();
  for (const d of rawDemos) {
    const victimId = JSON.stringify(d.victim);
    const list = demosByVictim.get(victimId) ?? [];
    list.push(d.frame);
    demosByVictim.set(victimId, list);
  }

  // Player Camera Events (Ball Cam tracking per player)
  const rawCameraEvents = rawData.player_camera_events ?? [];
  const ballCamTimelineByPlayer: boolean[][] = [];
  for (let p = 0; p < players.length; p++) {
    const pTimeline = new Array<boolean>(totalFrames).fill(true); // default true in RL
    const pEvents = rawCameraEvents.find((entry: any) => JSON.stringify(entry[0]) === players[p].id)?.[1] ?? [];
    let currentBallCam = true;
    let eventIdx = 0;
    for (let f = 0; f < totalFrames; f++) {
      while (eventIdx < pEvents.length && pEvents[eventIdx].frame <= f) {
        if (pEvents[eventIdx].ball_cam_active !== undefined) {
          currentBallCam = Boolean(pEvents[eventIdx].ball_cam_active);
        }
        eventIdx++;
      }
      pTimeline[f] = currentBallCam;
    }
    ballCamTimelineByPlayer.push(pTimeline);
  }

  // Playback clock: seconds since the first recorded frame
  const baseTime = metadataFrames[0]?.time ?? 0;
  const playbackTimeAtFrame = (frame: number): number => {
    const metaF = metadataFrames[Math.min(Math.max(0, Math.floor(frame)), totalFrames - 1)];
    return metaF ? metaF.time - baseTime : frame / 30;
  };

  // Replay Tick Marks & Events (Goals, Saves, Demolishes)
  const tickMarks = buildTickMarks(
    {
      tickMarks: rawData.replay_tick_marks ?? [],
      goalEvents: rawData.goal_events ?? [],
      statEvents: rawData.player_stat_events ?? [],
    },
    playbackTimeAtFrame,
    (player) => {
      const name = findMetaPlayer(player)?.meta?.name;
      return name ? { name } : undefined;
    }
  );

  const flipResets = buildFlipResets(
    rawData.dodge_refreshed_events ?? [],
    players.map((p) => p.id),
    playbackTimeAtFrame
  );

  // Boost Pad Clock Manager for bitmasks
  const padClock = new BoostPadClockManager(
    boostPads.map(bp => ({
      index: bp.index,
      pad_id: bp.pad_id,
      size: bp.size,
      position: bp.position
    })),
    rawData.boost_pad_events ?? []
  );

  // Build the Float32Array streaming buffer
  const framesBuffer = new Float32Array(totalFrames * TOTAL_FLOATS_PER_FRAME);
  const ballHasTransform = new Uint8Array(totalFrames);
  const uint32View = new Uint32Array(framesBuffer.buffer);
  for (let f = 0; f < totalFrames; f++) {
    const frameOffset = f * TOTAL_FLOATS_PER_FRAME;
    const metaF = metadataFrames[f];
    const matchTime = playbackTimeAtFrame(f);
    const secRemaining = metaF?.seconds_remaining ?? 300;

    // 1. Ball (10 floats)
    const rawBall = rawBallFrames[f]?.Data?.rigid_body;
    if (rawBall && rawBall.location) {
      ballHasTransform[f] = 1;
      const bPos = rlToThreeVec3(rawBall.location);
      const bRot = rawBall.rotation ? rlToThreeQuat(rawBall.rotation) : { x: 0, y: 0, z: 0, w: 1 };
      const bVel = rawBall.linear_velocity ? rlToThreeVec3(rawBall.linear_velocity) : { x: 0, y: 0, z: 0 };

      framesBuffer[frameOffset + 0] = bPos.x;
      framesBuffer[frameOffset + 1] = bPos.y;
      framesBuffer[frameOffset + 2] = bPos.z;
      framesBuffer[frameOffset + 3] = bRot.x;
      framesBuffer[frameOffset + 4] = bRot.y;
      framesBuffer[frameOffset + 5] = bRot.z;
      framesBuffer[frameOffset + 6] = bRot.w;
      framesBuffer[frameOffset + 7] = bVel.x;
      framesBuffer[frameOffset + 8] = bVel.y;
      framesBuffer[frameOffset + 9] = bVel.z;
    } else if (f > 0) {
      // Keep the last valid transform through unreplicated frames. Writing a
      // synthetic centre-field ball here creates a visible one-frame jump.
      const previousFrameOffset = frameOffset - TOTAL_FLOATS_PER_FRAME;
      for (let i = 0; i < FLOATS_PER_BALL; i++) {
        framesBuffer[frameOffset + i] = framesBuffer[previousFrameOffset + i];
      }
    } else {
      // Fallback: resting at center ground (Z = 92.75 uu in RL -> Y = 92.75 in Three)
      framesBuffer[frameOffset + 0] = 0;
      framesBuffer[frameOffset + 1] = 92.75;
      framesBuffer[frameOffset + 2] = 0;
      framesBuffer[frameOffset + 6] = 1; // w = 1
    }

    // 2. Players (up to 6 players, 12 floats each)
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const pOffset = frameOffset + FLOATS_PER_BALL + (p * FLOATS_PER_PLAYER);
      if (p < rawPlayers.length) {
        const pFrames = rawPlayers[p][1]?.frames;
        const pFrame = pFrames ? pFrames[f] : null;
        const rb = pFrame?.Data?.rigid_body;

        if (rb && rb.location) {
          const pPos = rlToThreeVec3(rb.location);
          const pRot = rb.rotation ? rlToThreeQuat(rb.rotation) : { x: 0, y: 0, z: 0, w: 1 };
          const pVel = rb.linear_velocity ? rlToThreeVec3(rb.linear_velocity) : { x: 0, y: 0, z: 0 };
          const rawBoost = pFrame.Data.boost_amount ?? 0;
          // Boost amount is 0-100 or 0-255 in subtr-actor; check range
          const boostPercent = rawBoost > 100 ? (rawBoost / 255) * 100 : rawBoost;

          framesBuffer[pOffset + 0] = pPos.x;
          framesBuffer[pOffset + 1] = pPos.y;
          framesBuffer[pOffset + 2] = pPos.z;
          framesBuffer[pOffset + 3] = pRot.x;
          framesBuffer[pOffset + 4] = pRot.y;
          framesBuffer[pOffset + 5] = pRot.z;
          framesBuffer[pOffset + 6] = pRot.w;
          framesBuffer[pOffset + 7] = pVel.x;
          framesBuffer[pOffset + 8] = pVel.y;
          framesBuffer[pOffset + 9] = pVel.z;
          framesBuffer[pOffset + 10] = boostPercent;

          // Check if player is demoed (within 3 seconds of a demo)
          const demoFrames = demosByVictim.get(players[p].id) ?? [];
          const isDemoed = demoFrames.some(df => f >= df && f < df + 90); // ~90 frames = 3s

          // Flags bitmask
          let flags = 1; // bit 0: isPresent
          if (ballCamTimelineByPlayer[p]?.[f]) flags |= 2;
          if (isDemoed) flags |= 4;
          if (pFrame.Data.boost_active) flags |= 8;
          if (pFrame.Data.powerslide_active) flags |= 16;
          if (pFrame.Data.jump_active) flags |= 32;
          if (pFrame.Data.dodge_active) flags |= 64;

          framesBuffer[pOffset + 11] = flags;
        } else {
          // Player inactive or off field. Preserve its last transform so an
          // interpolation ending on this frame cannot pull it to the origin.
          if (f > 0) {
            const previousPlayerOffset = pOffset - TOTAL_FLOATS_PER_FRAME;
            for (let i = 0; i < 11; i++) {
              framesBuffer[pOffset + i] = framesBuffer[previousPlayerOffset + i];
            }
          } else {
            framesBuffer[pOffset + 6] = 1; // rot.w
          }
          framesBuffer[pOffset + 11] = 0; // isPresent = false
        }
      } else {
        framesBuffer[pOffset + 6] = 1;
        framesBuffer[pOffset + 11] = 0;
      }
    }

    // 3. Metadata & Boost Pad Bitmasks (4 floats)
    const metaOffset = frameOffset + FLOATS_PER_BALL + (MAX_PLAYERS * FLOATS_PER_PLAYER);
    framesBuffer[metaOffset + 0] = matchTime;
    framesBuffer[metaOffset + 1] = secRemaining;

    // Compute 34-bit boost mask at matchTime
    let maskLow = 0;
    let maskHigh = 0;
    const timeInReplay = metaF?.time ?? f / 30;
    for (let b = 0; b < boostPads.length && b < 34; b++) {
      const isAvail = padClock.getPadStateAt(boostPads[b].pad_id, timeInReplay).isAvailable;
      if (isAvail) {
        if (b < 32) {
          maskLow |= (1 << b);
        } else {
          maskHigh |= (1 << (b - 32));
        }
      }
    }
    uint32View[metaOffset + 2] = maskLow >>> 0;
    uint32View[metaOffset + 3] = maskHigh >>> 0;
  }

  smoothReplayPositions(framesBuffer, totalFrames, ballHasTransform);

  const duration = framesBuffer[(totalFrames - 1) * TOTAL_FLOATS_PER_FRAME + FLOATS_PER_BALL + (MAX_PLAYERS * FLOATS_PER_PLAYER)];
  const frameRate = totalFrames > 1 && duration > 0 ? totalFrames / duration : 30;

  // Team scores
  const finalScores = readFinalScore(meta?.all_headers, tickMarks);

  return {
    totalFrames,
    duration,
    frameRate,
    players,
    boostPads,
    tickMarks,
    teamScores: finalScores,
    flipResets,
    framesBuffer
  };
}
