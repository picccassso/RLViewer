import { Vec3 } from '../math/coords';

/** Car models bundled under public/models/cars/<name>/<name>.glb. */
export type CarModelName = 'octane' | 'fennec' | 'dominus' | 'breakout' | 'merc' | 'mantis' | 'x-devil';

/** Octane Hitbox: 118.01 length (X), 36.16 height (Y), 84.20 width (Z) */
export const HITBOX_DIMENSIONS: Record<string, { length: number; width: number; height: number }> = {
  Octane: { length: 118.01, width: 84.20, height: 36.16 },
  Dominus: { length: 127.93, width: 83.28, height: 31.30 },
  Breakout: { length: 131.49, width: 80.52, height: 30.15 },
  Plank: { length: 128.82, width: 84.67, height: 29.39 },
  Hybrid: { length: 127.02, width: 82.19, height: 34.16 },
  Merc: { length: 120.72, width: 76.05, height: 41.66 },
};

/**
 * Cars we can tell apart by their body id (the product id in the replay's loadout). Several cars share
 * a hitbox, e.g. the Fennec is an Octane-hitbox car, so the hitbox family alone would draw it as an Octane.
 */
const KNOWN_BODIES: Record<number, { name: string; model: CarModelName }> = {
  22: { name: 'Breakout', model: 'breakout' },
  23: { name: 'Octane', model: 'octane' },
  28: { name: 'X-Devil', model: 'x-devil' },
  30: { name: 'Merc', model: 'merc' },
  403: { name: 'Dominus', model: 'dominus' },
  1018: { name: 'Dominus GT', model: 'dominus' },
  1159: { name: 'X-Devil Mk2', model: 'x-devil' },
  1416: { name: 'Breakout Type-S', model: 'breakout' },
  1568: { name: 'Octane ZSR', model: 'octane' },
  1691: { name: 'Mantis', model: 'mantis' },
  4284: { name: 'Fennec', model: 'fennec' },
};

/** Stand-in model for any other car, chosen by the hitbox it shares so it is at least the right shape. */
const HITBOX_FAMILY_MODEL: Record<string, CarModelName> = {
  octane: 'octane',
  dominus: 'dominus',
  breakout: 'breakout',
  merc: 'merc',
  plank: 'mantis',
  hybrid: 'x-devil',
};

export function carModelFor(bodyId: number, hitboxFamily: string): CarModelName {
  const known = KNOWN_BODIES[bodyId];
  if (known) return known.model;
  const family = (hitboxFamily || 'Octane').toLowerCase();
  if (family.includes('fennec')) return 'fennec';
  for (const [key, model] of Object.entries(HITBOX_FAMILY_MODEL)) {
    if (family.includes(key)) return model;
  }
  return 'octane';
}

/** The car's name when we know it, otherwise its hitbox family. */
export function carDisplayName(bodyId: number, hitboxFamily: string): string {
  return KNOWN_BODIES[bodyId]?.name ?? (hitboxFamily || 'Octane');
}

/**
 * Dual exhaust positions for each car body in car local coordinates (+X forward, +Y up, +Z right, -Z left).
 * Fennec coordinates match its Turbo_L/Turbo_R sockets, and Octane matches its chassis exhaust pipes.
 */
export const CAR_EXHAUSTS: Record<CarModelName, Vec3[]> = {
  octane: [
    { x: -50.5, y: 11.4, z: -14.0 },
    { x: -50.5, y: 11.4, z: 14.0 },
  ],
  fennec: [
    { x: -55.5, y: 9.6, z: -20.3 },
    { x: -55.5, y: 9.6, z: 20.3 },
  ],
  dominus: [
    { x: -57.5, y: 8.5, z: -17.5 },
    { x: -57.5, y: 8.5, z: 17.5 },
  ],
  breakout: [
    { x: -57.0, y: 7.0, z: -22.3 },
    { x: -57.0, y: 7.0, z: 22.3 },
  ],
  merc: [
    { x: -57.0, y: 7.5, z: -23.7 },
    { x: -57.0, y: 7.5, z: 23.7 },
  ],
  mantis: [
    { x: -74.5, y: 9.0, z: -35.8 },
    { x: -74.5, y: 9.0, z: 35.8 },
  ],
  'x-devil': [
    { x: -58.7, y: 9.1, z: -15.7 },
    { x: -58.7, y: 9.1, z: 15.7 },
  ],
};

/**
 * Returns the exhaust point coordinates for a given car, emitting from both left and right sides.
 */
export function getCarExhausts(bodyId: number, hitboxFamily: string): Vec3[] {
  const model = carModelFor(bodyId, hitboxFamily);
  if (CAR_EXHAUSTS[model]) {
    return CAR_EXHAUSTS[model];
  }
  const hitbox = HITBOX_DIMENSIONS[hitboxFamily] || HITBOX_DIMENSIONS.Octane;
  return [
    { x: -hitbox.length / 2, y: hitbox.height * 0.35, z: -hitbox.width * 0.22 },
    { x: -hitbox.length / 2, y: hitbox.height * 0.35, z: hitbox.width * 0.22 },
  ];
}
