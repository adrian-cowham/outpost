import { resizePair, equalizeWidths, MIN_COLUMN_PX } from '../../vm/cockpit-layout.js';

// The board stays frozen while dragging so a repaint can't snap the live widths back.
export function createColumnResizer(boardEl, board) {
  let columns = [];
  let drag = null;

  function sync(columnEls) {
    columns = columnEls;
    columnEls.forEach((col, i) => {
      let h = col.querySelector(':scope > .ckb-resize');
      const wanted = i < columnEls.length - 1;
      if (!wanted) { h?.remove(); return; }
      if (!h) {
        h = document.createElement('div');
        h.className = 'ckb-resize';
        h.setAttribute('role', 'separator');
        h.setAttribute('aria-orientation', 'vertical');
        h.setAttribute('aria-label', 'Resize columns');
        h.addEventListener('pointerdown', onDown);
        h.addEventListener('dblclick', () => board.applyLayout(equalizeWidths));
        col.appendChild(h);
      }
      h.dataset.leftCol = String(i);
    });
  }

  function onDown(e) {
    e.stopPropagation();
    e.preventDefault();
    const left = Number(e.currentTarget.dataset.leftCol);
    const totalPx = columns.reduce((a, c) => a + c.offsetWidth, 0);
    if (!totalPx) return;
    const ws = board.layout().columns.map((c) => c.width);
    drag = { left, startX: e.clientX, totalPx, a: ws[left], b: ws[left + 1], delta: 0, min: MIN_COLUMN_PX / totalPx };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    board.freeze();
    boardEl.classList.add('is-resizing');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    const pair = drag.a + drag.b;
    const a = Math.min(pair - drag.min, Math.max(drag.min, drag.a + (e.clientX - drag.startX) / drag.totalPx));
    drag.delta = a - drag.a;
    columns[drag.left].style.flexGrow = String(+a.toFixed(4));
    columns[drag.left + 1].style.flexGrow = String(+(pair - a).toFixed(4));
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    boardEl.classList.remove('is-resizing');
    const { left, delta, min } = drag;
    drag = null;
    if (delta) board.applyLayout((l) => resizePair(l, left, delta, min));
    board.thaw();
  }

  return {
    sync,
    destroy() { if (drag) onUp(); },
  };
}
