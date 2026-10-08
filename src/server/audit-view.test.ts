import { describe, expect, it } from 'vitest';
import { changedFields } from './audit-view';

describe('changedFields', () => {
  it('lists fields that changed, ignoring timestamps', () => {
    expect(changedFields({ bonusCents: 0, pieces: 10, updatedAt: 'a' }, { bonusCents: 2000, pieces: 10, updatedAt: 'b' })).toEqual(['bonusCents']);
    expect(changedFields(null, { a: 1 })).toEqual(['a']);
  });
});
