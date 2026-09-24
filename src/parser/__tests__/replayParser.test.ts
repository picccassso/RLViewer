import { describe, it, expect } from 'vitest';
import { describeParseError } from '../replayParser';

describe('describeParseError', () => {
  it('explains replays from a newer game version than the parser knows', () => {
    const raw =
      'Failed to parse replay: Error decoding frame: attribute unknown or not implemented:\n' +
      'attribute: TAGame.PRI_TA:PlayerStatus';
    expect(describeParseError(raw)).toMatch(/newer version of Rocket League/);
  });

  it('passes other errors through unchanged', () => {
    expect(describeParseError('Failed to parse replay: unexpected end of file')).toBe(
      'Failed to parse replay: unexpected end of file'
    );
  });
});
