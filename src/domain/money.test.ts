import { describe, expect, it } from 'vitest';
import { formatCents, toCents } from './money';

describe('toCents', () => {
  it('parses decimals without float drift', () => {
    expect(toCents('909.75')).toBe(90975);
    expect(toCents('0.1')).toBe(10);
    expect(toCents(167.5)).toBe(16750);
    expect(toCents('20')).toBe(2000);
    expect(toCents('-12.5')).toBe(-1250);
    expect(toCents('')).toBe(0);
  });
  it('rejects garbage and sub-cent amounts', () => {
    expect(() => toCents('abc')).toThrow();
    expect(() => toCents('1.005')).toThrow();
  });
});

describe('formatCents', () => {
  it('formats USD', () => {
    expect(formatCents(734450)).toBe('$7,344.50');
  });
});
