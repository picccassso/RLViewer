import { describe, it, expect } from 'vitest';
import { groupTimelineMarks } from '../PlaybackTimeline';
import { ReplayTickMark } from '../../types/replay';

describe('groupTimelineMarks', () => {
  it('returns empty array when duration is 0 or negative', () => {
    const marks: ReplayTickMark[] = [
      { frame: 100, time: 10, type: 'goal', team: 0, description: 'Blue Goal' },
    ];
    expect(groupTimelineMarks(marks, 0)).toEqual([]);
    expect(groupTimelineMarks(marks, -5)).toEqual([]);
  });

  it('filters out non-goal and non-save marks', () => {
    const marks: ReplayTickMark[] = [
      { frame: 50, time: 5, type: 'demolish', team: 0, description: 'Demo' },
      { frame: 100, time: 10, type: 'goal', team: 0, description: 'Blue Goal' },
      { frame: 150, time: 15, type: 'user', team: 1, description: 'Marker' },
      { frame: 200, time: 20, type: 'save', team: 1, description: 'Orange Save' },
    ];
    const groups = groupTimelineMarks(marks, 100);
    expect(groups.length).toBe(2);
    expect(groups[0].marks[0].type).toBe('goal');
    expect(groups[1].marks[0].type).toBe('save');
  });

  it('correctly calculates percentage along timeline', () => {
    const marks: ReplayTickMark[] = [
      { frame: 100, time: 25, type: 'goal', team: 0, description: 'Goal at 25s' },
      { frame: 300, time: 75, type: 'goal', team: 1, description: 'Goal at 75s' },
    ];
    const groups = groupTimelineMarks(marks, 100);
    expect(groups.length).toBe(2);
    expect(groups[0].percent).toBe(25);
    expect(groups[1].percent).toBe(75);
  });

  it('groups proximate marks that are within span threshold', () => {
    // duration = 1000s, span = 0.012 -> 12s
    const marks: ReplayTickMark[] = [
      { frame: 100, time: 50, type: 'goal', team: 0, description: 'Goal 1' },
      { frame: 110, time: 54, type: 'save', team: 1, description: 'Save 1' },
      { frame: 500, time: 200, type: 'goal', team: 1, description: 'Goal 2' },
    ];
    const groups = groupTimelineMarks(marks, 1000);
    expect(groups.length).toBe(2);
    expect(groups[0].marks.length).toBe(2);
    expect(groups[0].percent).toBe(5.2); // (50 + 54) / 2 / 1000 * 100
    expect(groups[1].marks.length).toBe(1);
  });
});
