import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { xlsx } from './xlsx';

/** Reads the files back out of the zip (local headers), enough to check what was written. */
function unzip(buf: Buffer) {
  const out = new Map<string, string>();
  for (let i = 0; buf.readUInt32LE(i) === 0x04034b50;) {
    const size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extra;
    out.set(name, inflateRawSync(buf.subarray(start, start + size)).toString('utf8'));
    i = start + size;
  }
  return out;
}

describe('Excel download', () => {
  it('writes the sheets with a bold header, numbers as numbers and text escaped', () => {
    const files = unzip(xlsx([
      { name: 'Día por día', header: ['Fecha', 'Persona', 'Piezas'], rows: [['2026-06-01', 'Ana <B> & "C"', 64], ['2026-06-02', null, null]] },
      { name: 'Por/persona', header: ['Persona'], rows: [] },
    ]));
    expect([...files.keys()]).toContain('xl/worksheets/sheet2.xml');
    expect(files.get('xl/workbook.xml')).toContain('name="Día por día"');
    expect(files.get('xl/workbook.xml')).toContain('name="Por persona"');
    const s1 = files.get('xl/worksheets/sheet1.xml')!;
    expect(s1).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Fecha</t></is></c>');
    expect(s1).toContain('<c r="C2"><v>64</v></c>');
    expect(s1).toContain('Ana &lt;B&gt; &amp; &quot;C&quot;');
    expect(s1).toContain('state="frozen"');
    expect(s1).not.toContain('r="B3"');
  });
});
