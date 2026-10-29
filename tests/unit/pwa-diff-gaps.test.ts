// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS
import { gapsFor, gapRows } from '../../src/pwa/utils/diff-gaps.js';

const ctx = (oldLine: number, newLine: number) => ({ op: ' ', content: `l${newLine}`, oldLine, newLine });

describe('gapsFor', () => {
  it('places leading, middle and trailing gaps around the hunks', () => {
    const hunks = [
      { oldStart: 10, oldLines: 7, newStart: 10, newLines: 7, rows: [ctx(10, 10), ctx(16, 16)] },
      { oldStart: 40, oldLines: 7, newStart: 40, newLines: 7, rows: [ctx(44, 44), ctx(45, 45), ctx(46, 46)] },
    ];
    expect(gapsFor(hunks)).toEqual([
      { at: 0, from: 1, to: 9 },
      { at: 1, from: 17, to: 39 },
      { at: 2, from: 47, to: null },
    ]);
  });

  it('offers no trailing gap when the last hunk already reaches end of file', () => {
    const hunks = [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 4,
      rows: [ctx(1, 1), ctx(2, 2), { op: '+', content: 'x', newLine: 3 }, ctx(3, 4)] }];
    expect(gapsFor(hunks)).toEqual([]);
  });
});

describe('gapRows', () => {
  it('returns only context rows inside the range', () => {
    const full = { hunks: [{ rows: [ctx(1, 1), { op: '-', content: 'gone', oldLine: 2 }, ctx(3, 2), ctx(4, 3), ctx(5, 4)] }] };
    expect(gapRows(full, 2, 3).map((r: { newLine: number }) => r.newLine)).toEqual([2, 3]);
  });
});
