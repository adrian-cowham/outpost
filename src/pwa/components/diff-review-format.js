// Shared wire format for the diff-review bundled message: diff-overlay's
// "Submit review" composes it from drafted per-hunk comments; session-view's
// message-html.js renders it back out as a structured Review tile. Single
// source of truth so the two never drift on what marks a message as a review
// (previously diff-overlay sent a bare human-readable prefix while
// message-html looked for an HTML-comment marker it never received — the
// tile silently fell back to a plain text bubble).
//
// Wire shape (marker line first so the renderer can recognize it unambiguously,
// human-readable prefix kept below so the message still reads sensibly
// wherever the marker gets stripped — Linear comments, plain-text exports):
//
//   <!-- outpost:diff-review -->
//   Code review comments on the diff:
//
//   **file:line** (old|new)
//   > mark quotedline
//
//   note text
//
//   ---
//
//   **file2:line2** ...
//
// A range comment cites `file:start-end` and quotes each row with its own +/-/space mark.

export const DIFF_REVIEW_MARKER = '<!-- outpost:diff-review -->';
export const DIFF_REVIEW_PREFIX = 'Code review comments on the diff:';

const MAX_QUOTE_LINES = 12;

export function isDiffReviewMessage(text) {
  return typeof text === 'string' && text.startsWith(DIFF_REVIEW_MARKER);
}

function clip(s) { return s.length > 240 ? s.slice(0, 240) + '…' : s; }

// `comments` — { file, side: 'old'|'new', line, lineText, content }[], plus `startLine` and `quote: [{ mark, text }]` on a range.
export function formatDiffReviewMessage(comments) {
  const blocks = comments.map((c) => {
    const sideLabel = c.side === 'old' ? ' (old)' : ' (new)';
    if (c.startLine) {
      const lines = c.quote.slice(0, MAX_QUOTE_LINES).map((q) => `> ${q.mark} ${clip(q.text)}`);
      if (c.quote.length > MAX_QUOTE_LINES) lines.push(`> … ${c.quote.length - MAX_QUOTE_LINES} more lines`);
      return `**${c.file}:${c.startLine}-${c.line}**${sideLabel}\n${lines.join('\n')}\n\n${c.content}`;
    }
    const mark = c.side === 'old' ? '-' : '+';
    return `**${c.file}:${c.line}**${sideLabel}\n> ${mark} ${clip(c.lineText)}\n\n${c.content}`;
  });
  return `${DIFF_REVIEW_MARKER}\n${DIFF_REVIEW_PREFIX}\n\n${blocks.join('\n\n---\n\n')}`;
}

const BLOCK_RE = /^\*\*(.+?):(\d+)(?:-(\d+))?\*\*(?: \((old|new)\))?\n(> [\s\S]*?)\n\n([\s\S]*)$/;
const QUOTE_LINE_RE = /^> (.) ?([\s\S]*)$/;

// An unmatched block falls back to { note: <raw block> } so a hand-edited or truncated message still renders.
export function parseDiffReviewMessage(text) {
  if (!isDiffReviewMessage(text)) return null;
  let body = text.slice(DIFF_REVIEW_MARKER.length).replace(/^\n/, '');
  if (body.startsWith(DIFF_REVIEW_PREFIX)) body = body.slice(DIFF_REVIEW_PREFIX.length).replace(/^\n+/, '');
  return body.split('\n\n---\n\n').map((block) => {
    const m = BLOCK_RE.exec(block);
    if (!m) return { file: '', line: '', side: 'new', mark: '', quote: '', quoteLines: [], note: block.trim() };
    const [, file, first, last, side, quoteBlock, note] = m;
    const quoteLines = quoteBlock.split('\n').map((l) => {
      const q = QUOTE_LINE_RE.exec(l);
      return q ? { mark: q[1], text: q[2] } : { mark: '', text: l };
    });
    return {
      file,
      line: last ?? first,
      ...(last ? { startLine: first } : {}),
      side: side ?? 'new',
      mark: quoteLines[0].mark,
      quote: quoteLines[0].text,
      quoteLines,
      note: note.trim(),
    };
  });
}
