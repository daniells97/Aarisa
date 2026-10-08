import { describe, expect, it } from 'vitest';
import { centsToInput, parseAmount } from './format';

describe('parseAmount', () => {
  it('reads typed amounts into cents', () => {
    expect(parseAmount('2.50')).toBe(250);
    expect(parseAmount('$1,234.5')).toBe(123450);
    expect(parseAmount('10')).toBe(1000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('2.555')).toBeUndefined();
    expect(parseAmount('-1')).toBeUndefined();
  });
  it('round-trips', () => {
    expect(centsToInput(175)).toBe('1.75');
    expect(parseAmount(centsToInput(909_75))).toBe(909_75);
  });
});
