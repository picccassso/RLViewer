import { ReplayTickMark } from '../types/replay';

/**
 * A goal event and the game's goal tick mark for the same goal land within this many
 * seconds of each other (the event trails the tick mark by ~1.5-2 s).
 */
export const GOAL_EVENT_MATCH_WINDOW = 3;

/**
 * Builds the timeline tick marks for a replay, with every time on the playback clock.
 *
 * Replay tick mark and goal event times are absolute replay times, so they are
 * re-timed from their frame with `toPlaybackTime`. Goals come from the game's own
 * tick marks. Goal events only add a goal when no goal tick mark lies within
 * GOAL_EVENT_MATCH_WINDOW, and otherwise just supply the scorer's name.
 */
export function buildTickMarks(
  rawTickMarks: any[],
  rawGoalEvents: any[],
  toPlaybackTime: (frame: number) => number,
  scorerNameFor: (player: any) => string | undefined = () => undefined
): ReplayTickMark[] {
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
      description: type === 'goal' ? teamGoalDescription(team) : desc,
    };
  });

  const goalMarks = tickMarks.filter((tm) => tm.type === 'goal');
  for (const g of rawGoalEvents) {
    const team: 0 | 1 = g.scoring_team_is_team_0 ? 0 : 1;
    const time = toPlaybackTime(g.frame);
    const scorerName = scorerNameFor(g.player);

    const nearby = goalMarks.filter((tm) => Math.abs(tm.time - time) <= GOAL_EVENT_MATCH_WINDOW);
    if (nearby.length > 0) {
      // Same goal as a tick mark: only borrow the scorer when the teams agree.
      const sameTeam = nearby
        .filter((tm) => tm.team === team && !tm.scorerName)
        .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
      if (sameTeam && scorerName) {
        sameTeam.scorerName = scorerName;
        sameTeam.description = `Goal by ${scorerName}`;
      }
      continue;
    }

    const goal: ReplayTickMark = {
      frame: g.frame,
      time,
      type: 'goal',
      team,
      description: scorerName ? `Goal by ${scorerName}` : teamGoalDescription(team),
      scorerName,
    };
    tickMarks.push(goal);
    goalMarks.push(goal);
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

function teamGoalDescription(team: 0 | 1): string {
  return team === 0 ? 'Blue goal' : 'Orange goal';
}
