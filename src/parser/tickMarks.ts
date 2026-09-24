import { ReplayTickMark } from '../types/replay';

/**
 * A goal event and the game's goal tick mark for the same goal land within this many
 * seconds of each other (the event trails the tick mark by ~1.5-2 s).
 */
export const GOAL_EVENT_MATCH_WINDOW = 3;

/**
 * A save stat event trails the game's save tick mark for the same save by ~1-2.5 s.
 */
export const SAVE_EVENT_MATCH_WINDOW = 3;

export interface RawReplayEvents {
  tickMarks: any[];
  goalEvents: any[];
  /** Player stat events (Shot / Save / Assist); only saves are used, for the saver's name. */
  statEvents?: any[];
}

export interface TickMarkPlayer {
  name: string;
}

/**
 * Builds the timeline tick marks for a replay, with every time on the playback clock.
 *
 * Replay tick mark and event times are absolute replay times, so they are re-timed
 * from their frame with `toPlaybackTime`. Goals and saves come from the game's own
 * tick marks, which carry the team. Goal events only add a goal when no goal tick mark
 * lies within GOAL_EVENT_MATCH_WINDOW, and otherwise just supply the scorer's name;
 * save stat events supply the saver's name the same way.
 */
export function buildTickMarks(
  raw: RawReplayEvents,
  toPlaybackTime: (frame: number) => number,
  playerFor: (player: any) => TickMarkPlayer | undefined = () => undefined
): ReplayTickMark[] {
  const rawTickMarks = raw.tickMarks;
  const rawGoalEvents = raw.goalEvents;
  const tickMarks: ReplayTickMark[] = rawTickMarks.map((tm) => {
    const desc: string = tm.description || '';
    let type: ReplayTickMark['type'] = 'user';
    let team: 0 | 1 = 0;
    if (desc.includes('Goal')) {
      type = 'goal';
      team = desc.includes('Team1') ? 1 : 0;
    } else if (desc.includes('Save')) {
      type = 'save';
      team = desc.includes('Team1') ? 1 : 0;
    } else if (desc.includes('Demolish')) {
      type = 'demolish';
    }
    return {
      frame: tm.frame,
      time: toPlaybackTime(tm.frame),
      type,
      team,
      description:
        type === 'goal' || type === 'save' ? teamEventDescription(type, team) : desc,
    };
  });

  const goalMarks = tickMarks.filter((tm) => tm.type === 'goal');
  for (const g of rawGoalEvents) {
    const team: 0 | 1 = g.scoring_team_is_team_0 ? 0 : 1;
    const time = toPlaybackTime(g.frame);
    const scorerName = playerFor(g.player)?.name;

    const nearby = goalMarks.filter((tm) => Math.abs(tm.time - time) <= GOAL_EVENT_MATCH_WINDOW);
    if (nearby.length > 0) {
      // Same goal as a tick mark: only borrow the scorer when the teams agree.
      const sameTeam = nearby
        .filter((tm) => tm.team === team && !tm.scorerName)
        .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
      if (sameTeam && scorerName) {
        sameTeam.scorerName = scorerName;
        sameTeam.description = teamEventDescription('goal', team, scorerName);
      }
      continue;
    }

    const goal: ReplayTickMark = {
      frame: g.frame,
      time,
      type: 'goal',
      team,
      description: teamEventDescription('goal', team, scorerName),
      scorerName,
    };
    tickMarks.push(goal);
    goalMarks.push(goal);
  }

  const unnamedSaves = tickMarks.filter((tm) => tm.type === 'save');
  for (const e of raw.statEvents ?? []) {
    if (e.kind !== 'Save') continue;
    const team: 0 | 1 = e.is_team_0 ? 0 : 1;
    const time = toPlaybackTime(e.frame);
    const saver = playerFor(e.player)?.name;
    if (!saver) continue;

    const closest = unnamedSaves
      .filter((tm) => tm.team === team && Math.abs(tm.time - time) <= SAVE_EVENT_MATCH_WINDOW)
      .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
    if (!closest) continue;
    closest.playerName = saver;
    closest.description = teamEventDescription('save', team, saver);
    unnamedSaves.splice(unnamedSaves.indexOf(closest), 1);
  }

  return tickMarks.sort((a, b) => a.time - b.time);
}

/**
 * Final score from the replay header (Team0Score / Team1Score). The game leaves out a
 * team's header while it has not scored; with no score headers at all, the goal tick
 * marks are counted instead.
 */
export function readFinalScore(
  allHeaders: any[] | undefined,
  tickMarks: ReplayTickMark[]
): { team0: number; team1: number } {
  const header = (key: string): number | undefined => {
    const value = Number(allHeaders?.find((h) => h?.[0] === key)?.[1]);
    return Number.isFinite(value) ? value : undefined;
  };
  const team0 = header('Team0Score');
  const team1 = header('Team1Score');
  if (team0 !== undefined || team1 !== undefined) {
    return { team0: team0 ?? 0, team1: team1 ?? 0 };
  }

  const goals = tickMarks.filter((tm) => tm.type === 'goal');
  return {
    team0: goals.filter((tm) => tm.team === 0).length,
    team1: goals.filter((tm) => tm.team === 1).length,
  };
}

function teamEventDescription(type: 'goal' | 'save', team: 0 | 1, playerName?: string): string {
  const label = `${team === 0 ? 'Blue' : 'Orange'} ${type}`;
  return playerName ? `${label} by ${playerName}` : label;
}
