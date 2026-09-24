/** Car models bundled under public/models/cars/<name>/<name>.glb. */
export type CarModelName = 'octane' | 'fennec' | 'dominus' | 'breakout' | 'merc' | 'mantis' | 'x-devil';

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
