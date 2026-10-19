// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS
import { formatDiffReviewMessage, parseDiffReviewMessage } from '../../src/pwa/components/diff-review-format.js';

describe('diff review wire format', () => {
  it('keeps the single-line block byte-identical to the original format', () => {
    const text = formatDiffReviewMessage([{ file: 'a.txt', side: 'new', line: 2, lineText: 'TWO', content: 'Lowercase?' }]);
    expect(text).toBe('<!-- outpost:diff-review -->\nCode review comments on the diff:\n\n**a.txt:2** (new)\n> + TWO\n\nLowercase?');
  });

  it('round-trips a range, eliding past 12 quoted lines', () => {
    const quote = Array.from({ length: 14 }, (_, i) => ({ mark: i === 0 ? ' ' : '+', text: `row ${i}` }));
    const text = formatDiffReviewMessage([
      { file: 'src/x.ts', side: 'new', line: 23, startLine: 10, lineText: 'row 13', content: 'Split this up.', quote },
    ]);
    expect(text).toContain('**src/x.ts:10-23** (new)\n>   row 0\n> + row 1\n');
    expect(text).toContain('> + row 11\n> … 2 more lines\n\nSplit this up.');

    const [c] = parseDiffReviewMessage(text);
    expect(c).toMatchObject({ file: 'src/x.ts', startLine: '10', line: '23', side: 'new', note: 'Split this up.' });
    expect(c.quoteLines).toHaveLength(13);
    expect(c.quoteLines[0]).toEqual({ mark: ' ', text: 'row 0' });
    expect(c.quoteLines[1]).toEqual({ mark: '+', text: 'row 1' });
  });

  it('parses a single-line message the same way it always has', () => {
    const [c] = parseDiffReviewMessage('<!-- outpost:diff-review -->\nCode review comments on the diff:\n\n**a.txt:2** (old)\n> - two\n\nWhy?');
    expect(c).toMatchObject({ file: 'a.txt', line: '2', side: 'old', mark: '-', quote: 'two', note: 'Why?' });
    expect(c.startLine).toBeUndefined();
  });
});
