import { describe, expect, it } from 'vitest';
import { periodFor, periodsFor } from './periods';

describe('pay periods (rule 8: two cycles)', () => {
  it('Hovership is biweekly from June 8', () => {
    expect(periodFor('2026-06-08', 'biweekly', '2026-06-15')).toEqual({ start: '2026-06-08', end: '2026-06-21' });
    expect(periodFor('2026-06-08', 'biweekly', '2026-06-22')).toEqual({ start: '2026-06-22', end: '2026-07-05' });
    expect(periodFor('2026-06-08', 'biweekly', '2026-06-01')).toEqual({ start: '2026-05-25', end: '2026-06-07' });
  });
  it('T-Force is weekly', () => {
    expect(periodFor('2026-06-15', 'weekly', '2026-06-20')).toEqual({ start: '2026-06-15', end: '2026-06-21' });
  });
  it('lists the periods a file touches', () => {
    expect(periodsFor('2026-06-08', 'biweekly', ['2026-06-21', '2026-06-08', '2026-06-22']).map((p) => p.start)).toEqual(['2026-06-08', '2026-06-22']);
  });
});
