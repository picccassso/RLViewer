import * as THREE from 'three';
import { FrameState, ParsedReplayData } from '../types/replay';
import {
  BOOST_PARTICLE_SECONDS,
  BOOST_PARTICLES_PER_SECOND,
  isOnSurface,
  sampleBallTrail,
  sampleBoostPlume,
  sampleCarWheelTrail
} from '../math/trails';
import { Vec3 } from '../math/coords';
import { getCarExhausts, HITBOX_DIMENSIONS } from './carBodies';
import { TrailRibbon } from './TrailRibbon';
import { BoostPlume, ALPHA_BOOST_COLOR } from './BoostPlume';

/** How far back the ball's trail reaches, in seconds, if the ball was touched longer ago. */
export const BALL_TRAIL_SECONDS = 1.5;
/** How long a supersonic car's tyre streaks take to fade. */
export const SUPERSONIC_TRAIL_SECONDS = 0.5;
/** Replays run at up to ~120 recorded frames a second, plus the interpolated head. */
const POINTS_PER_SECOND = 120;
/** Streaks sit just off the surface, under the ball's ground ring and the car shadows. */
const SURFACE_TRAIL_LIFT = 1.5;

const TEAM_TRAIL_COLORS = [new THREE.Color(0x2f8cff), new THREE.Color(0xff7a1a)];

interface CarTrail {
  playerIndex: number;
  wheels: { offset: Vec3; ribbon: TrailRibbon }[];
  /** Where boost leaves the car, in the car's frame (+X forward, +Y up). */
  exhausts: Vec3[];
  boost: BoostPlume;
}

/**
 * Glowing trails, drawn from the recorded frames around the current time so they look
 * the same when paused, scrubbing or at any playback speed:
 * - the ball's path since its last touch, in the colour of the team that touched it;
 * - streaks behind the back wheels of supersonic cars driving on the floor, walls, ramps or ceiling;
 * - boost plumes, which hang in the air behind a boosting car and stream back past the camera.
 */
export class TrailManager {
  private readonly group = new THREE.Group();
  private readonly ballTrail: TrailRibbon;
  private carTrails: CarTrail[] = [];
  private replayData: ParsedReplayData | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.ballTrail = new TrailRibbon({
      maxPoints: Math.ceil(BALL_TRAIL_SECONDS * POINTS_PER_SECOND) + 2,
      facing: 'camera',
      color: TEAM_TRAIL_COLORS[0],
      intensity: 2.2,
    });
    this.group.add(this.ballTrail.mesh);
  }

  public setReplay(replayData: ParsedReplayData) {
    this.clearCarTrails();
    this.replayData = replayData;
    for (const player of replayData.players) {
      const hitbox = HITBOX_DIMENSIONS[player.car_hitbox_family] || HITBOX_DIMENSIONS.Octane;
      const rear = -hitbox.length * 0.3;
      const track = hitbox.width * 0.4;
      const wheels = [-track, track].map((side) => {
        const ribbon = new TrailRibbon({
          maxPoints: Math.ceil(SUPERSONIC_TRAIL_SECONDS * POINTS_PER_SECOND) + 2,
          facing: 'surface',
          color: TEAM_TRAIL_COLORS[player.team],
          intensity: 1.8,
        });
        this.group.add(ribbon.mesh);
        return { offset: { x: rear, y: 0, z: side }, ribbon };
      });
      const exhausts = getCarExhausts(player.car_body_id, player.car_hitbox_family);
      const boost = new BoostPlume(
        (Math.ceil(BOOST_PARTICLE_SECONDS * BOOST_PARTICLES_PER_SECOND) + 2) * exhausts.length,
        ALPHA_BOOST_COLOR
      );
      this.group.add(boost.points);
      this.carTrails.push({ playerIndex: player.index, wheels, exhausts, boost });
    }
  }

  public update(frameState: FrameState) {
    const data = this.replayData;
    if (!data) return;
    const { frameIndex, time } = frameState;

    const ball = this.ballTrail;
    ball.clear();
    const team = sampleBallTrail(data, frameIndex, time, frameState.ball.position, BALL_TRAIL_SECONDS, (x, y, z, age) => {
      const life = 1 - age / BALL_TRAIL_SECONDS;
      ball.push(x, y, z, 0.9 * life, 6 + 22 * life);
    });
    if (team !== null) ball.setColor(TEAM_TRAIL_COLORS[team]);
    ball.commit();

    for (const trail of this.carTrails) {
      const player = frameState.players[trail.playerIndex];
      const car = player && {
        position: player.position,
        rotation: player.rotation,
        lit: player.isPresent && !player.isDemoed && player.supersonic && isOnSurface(player.position, player.rotation),
      };
      for (const { offset, ribbon } of trail.wheels) {
        ribbon.clear();
        if (car) {
          sampleCarWheelTrail(data, trail.playerIndex, frameIndex, time, car, offset, SUPERSONIC_TRAIL_SECONDS, (x, y, z, nx, ny, nz, age, lit) => {
            const life = 1 - age / SUPERSONIC_TRAIL_SECONDS;
            const lift = SURFACE_TRAIL_LIFT;
            ribbon.push(x + nx * lift, y + ny * lift, z + nz * lift, lit ? 0.85 * life : 0, 5 + 5 * life, nx, ny, nz);
          });
        }
        ribbon.commit();
      }

      const { boost } = trail;
      boost.clear();
      if (player && player.isPresent && !player.isDemoed) {
        sampleBoostPlume(data, trail.playerIndex, frameIndex, time, player, trail.exhausts, BOOST_PARTICLE_SECONDS, (x, y, z, age, variant) => {
          boost.push(x, y, z, age / BOOST_PARTICLE_SECONDS, variant);
        });
      }
      boost.commit();
    }
  }

  private clearCarTrails() {
    for (const trail of this.carTrails) {
      for (const { ribbon } of trail.wheels) ribbon.dispose();
      trail.boost.dispose();
    }
    this.carTrails = [];
  }

  public dispose() {
    this.clearCarTrails();
    this.ballTrail.dispose();
    this.group.removeFromParent();
    this.replayData = null;
  }
}
