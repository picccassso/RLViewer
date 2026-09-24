import { CameraSettings } from '../math/cameraMath';

export const FLOATS_PER_BALL = 10;
export const FLOATS_PER_PLAYER = 12;
export const MAX_PLAYERS = 6;
export const FLOATS_META = 4;
export const TOTAL_FLOATS_PER_FRAME = FLOATS_PER_BALL + (MAX_PLAYERS * FLOATS_PER_PLAYER) + FLOATS_META; // 86

export interface PlayerInfo {
  index: number;
  id: string;
  name: string;
  team: 0 | 1; // 0 = Blue, 1 = Orange
  car_body_id: number;
  car_hitbox_family: string;
  camera_settings: CameraSettings;
  score?: number;
  goals?: number;
  assists?: number;
  saves?: number;
  shots?: number;
}

export interface ReplayTickMark {
  frame: number;
  time: number;
  type: 'goal' | 'save' | 'demolish' | 'overtime' | 'user';
  team: 0 | 1;
  description: string;
  scorerName?: string;
  /** Who made the save. */
  playerName?: string;
}

export interface ReplayBoostPad {
  index: number;
  pad_id: string;
  size: 'Big' | 'Small';
  position: { x: number; y: number; z: number }; // In Three.js space
}

export interface ParsedReplayData {
  totalFrames: number;
  duration: number; // total match seconds
  frameRate: number; // e.g. 30 or 60 fps
  players: PlayerInfo[];
  boostPads: ReplayBoostPad[];
  tickMarks: ReplayTickMark[];
  teamScores: { team0: number; team1: number };
  framesBuffer: Float32Array; // Stride = TOTAL_FLOATS_PER_FRAME
}

export interface FrameState {
  frameIndex: number;
  time: number;
  secondsRemaining: number;
  ball: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    velocity: { x: number; y: number; z: number };
  };
  players: Array<{
    info: PlayerInfo;
    isPresent: boolean;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    velocity: { x: number; y: number; z: number };
    boost: number;
    ballCamActive: boolean;
    isDemoed: boolean;
    boostActive: boolean;
    powerslideActive: boolean;
    jumpActive: boolean;
    dodgeActive: boolean;
  }>;
  boostPadsAvailable: boolean[]; // 34 booleans
}
