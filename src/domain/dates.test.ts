import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, todayLA, weekStart } from './dates';

describe('dates', () => {
  it('uses the Los Angeles calendar day', () => {
    expect(todayLA(new Date('2026-06-16T05:00:00Z'))).toBe('2026-06-15'); // 10 PM in LA
  });
  it('adds days across months and finds Monday', () => {
    expect(addDays('2026-06-29', 3)).toBe('2026-07-02');
    expect(daysBetween('2026-06-08', '2026-06-21')).toBe(13);
    expect(weekStart('2026-06-21')).toBe('2026-06-15'); // Sunday
    expect(weekStart('2026-06-15')).toBe('2026-06-15');
  });
});
