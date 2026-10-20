import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects } from './csv';

describe('parseCsv', () => {
  it('handles quotes, commas and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });
  it('maps to objects and skips blank lines', () => {
    const { header, records } = parseCsvObjects('﻿code,name\nDUB1, Ana \n\n');
    expect(header).toEqual(['code', 'name']);
    expect(records).toEqual([{ code: 'DUB1', name: 'Ana' }]);
  });
});
