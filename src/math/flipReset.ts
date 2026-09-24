/** How long the flip reset badge stays up after a reset, in seconds. */
export const FLIP_RESET_BADGE_SECONDS = 2;
const POP_IN_SECONDS = 0.2;
const FADE_OUT_SECONDS = 0.5;

/**
 * Playback times of each player's flip resets, indexed like `players`, sorted.
 *
 * subtr-actor reports a dodge refresh whenever a car's wheels touch the ball in the air
 * and give its flip back: a flip reset. Events are re-timed from their frame onto the
 * playback clock, and matched to players by remote id (`PlayerInfo.id`).
 */
export function buildFlipResets(
  rawDodgeRefreshedEvents: any[],
  playerIds: string[],
  toPlaybackTime: (frame: number) => number
): number[][] {
  const resets = playerIds.map((): number[] => []);
  for (const e of rawDodgeRefreshedEvents) {
    const playerIndex = playerIds.indexOf(JSON.stringify(e.player));
    if (playerIndex >= 0) resets[playerIndex].push(toPlaybackTime(e.frame));
  }
  resets.forEach((times) => times.sort((a, b) => a - b));
  return resets;
}

/**
 * How the badge looks at `time`: it pops in slightly oversized, settles, then fades.
 * Returns null when the player has no reset within the last FLIP_RESET_BADGE_SECONDS.
 */
export function flipResetBadgeAt(
  resetTimes: number[],
  time: number
): { opacity: number; scale: number } | null {
  let latest = -1;
  for (const t of resetTimes) {
    if (t > time) break;
    latest = t;
  }
  if (latest < 0) return null;

  const age = time - latest;
  if (age >= FLIP_RESET_BADGE_SECONDS) return null;
  const popIn = Math.min(age / POP_IN_SECONDS, 1);
  const fadeOut = Math.min((FLIP_RESET_BADGE_SECONDS - age) / FADE_OUT_SECONDS, 1);
  return { opacity: Math.min(popIn, fadeOut), scale: 1 + 0.35 * (1 - popIn) };
}
