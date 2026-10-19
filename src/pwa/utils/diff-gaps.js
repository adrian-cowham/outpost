// At -U3 every changed line sits inside a hunk, so a gap is all context and one full-context fetch fills any of them.

const CONTEXT_LINES = 3;

function hunkSpan(h) {
  return { start: h.newStart, endExcl: h.newStart + h.newLines };
}

// gapsFor returns [{ at, from, to }]: `at` is the hunk the gap precedes; the trailing gap has `to: null` until the file is loaded.
export function gapsFor(hunks) {
  if (!hunks.length) return [];
  const spans = hunks.map(hunkSpan);
  const gaps = [];
  if (spans[0].start > 1) gaps.push({ at: 0, from: 1, to: spans[0].start - 1 });
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start > spans[i - 1].endExcl) {
      gaps.push({ at: i, from: spans[i - 1].endExcl, to: spans[i].start - 1 });
    }
  }
  if (trailingContext(hunks[hunks.length - 1]) >= CONTEXT_LINES) {
    gaps.push({ at: hunks.length, from: spans[spans.length - 1].endExcl, to: null });
  }
  return gaps;
}

// git only cuts trailing context short at end of file, so fewer than -U3's worth means nothing follows.
function trailingContext(h) {
  let n = 0;
  for (let i = h.rows.length - 1; i >= 0 && h.rows[i].op === ' '; i--) n++;
  return n;
}

export function gapRows(fullFile, from, to) {
  return fullFile.hunks.flatMap((h) => h.rows)
    .filter((r) => r.op === ' ' && r.newLine >= from && r.newLine <= to);
}

export function lastNewLine(fullFile) {
  let last = 0;
  for (const h of fullFile.hunks) for (const r of h.rows) if (r.newLine > last) last = r.newLine;
  return last;
}
