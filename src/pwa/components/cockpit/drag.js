import { moveSection, pinRow, unpinRow, dropEmptyColumns } from '../../vm/cockpit-layout.js';

const THRESHOLD_PX = 4;
const EDGE_PX = 10;
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_MAX_PX = 18;
const NOT_A_HANDLE = 'button, a, input, textarea, select, [contenteditable="true"], .ckb-body';

const pinIdOf = (sectionId) => (sectionId.startsWith('pin:') ? sectionId.slice(4) : null);
const kindOfKey = (key) => key.split(':')[0];

// Targets are measured once against a frozen board, so store ticks mid-drag can't move rows under the pointer.
export function installDrag(boardEl, board) {
  const scroller = boardEl.closest('.o-frame-detail');
  let pending = null;
  let active = null;

  function sourceOf(target) {
    if (!(target instanceof Element)) return null;
    const grip = target.closest('.o-grip');
    if (grip) {
      const section = grip.closest('.ckb-section');
      return section ? { kind: 'section', id: section.dataset.section, el: section, header: grip.closest('.o-group-hdr') } : null;
    }
    if (target.closest(NOT_A_HANDLE)) return null;
    const line = target.closest('.ckb-line');
    const item = line?.closest('.ckb-item');
    const key = item?.dataset.rowKey;
    if (!key || !/^(job|session):/.test(key)) return null;
    return { kind: 'row', id: key, el: item, header: line };
  }

  function onDown(e) {
    if (e.button !== 0 || active) return;
    const src = sourceOf(e.target);
    if (!src) return;
    pending = { src, x: e.clientX, y: e.clientY };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancelEvent);
  }

  function onMove(e) {
    if (pending && !active) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < THRESHOLD_PX) return;
      start(pending.src, e);
    }
    if (!active) return;
    active.pointer = { x: e.clientX, y: e.clientY };
    moveGhost(e);
    evaluate();
    autoScroll();
  }

  function start(src, e) {
    board.freeze();
    window.getSelection?.()?.removeAllRanges();
    const layout = board.layout();
    const scroll = { top: scroller?.scrollTop ?? 0, left: boardEl.scrollLeft };
    const columns = [...boardEl.querySelectorAll(':scope > .ckb-column')].map((col) => ({
      index: Number(col.dataset.col), rect: col.getBoundingClientRect(),
      sections: [...col.querySelectorAll(':scope > .ckb-section')].map((el) => ({
        id: el.dataset.section, kind: el.dataset.kind, el, rect: el.getBoundingClientRect(),
        rows: [...el.querySelectorAll('.ckb-item[data-row-key]')].map((r) => ({ key: r.dataset.rowKey, rect: r.getBoundingClientRect() })),
      })),
    }));
    const ghost = document.createElement('div');
    ghost.className = 'ckb-ghost';
    ghost.appendChild(src.header.cloneNode(true));
    ghost.style.width = `${src.el.getBoundingClientRect().width}px`;
    document.body.appendChild(ghost);
    const lineEl = document.createElement('div');
    lineEl.className = 'ckb-drop-line';
    lineEl.hidden = true;
    document.body.appendChild(lineEl);
    active = { src, layout, scroll, columns, ghost, lineEl, target: null, pointer: { x: e.clientX, y: e.clientY }, raf: 0 };
    boardEl.classList.add('is-dragging');
    src.el.classList.add('is-drag-source');
    window.addEventListener('keydown', onKey, true);
  }

  function moveGhost(e) {
    active.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
  }

  // Pointer position in drag-start coordinates, so auto-scroll doesn't invalidate the frozen rects.
  function frozenPoint() {
    const dy = (scroller?.scrollTop ?? 0) - active.scroll.top;
    const dx = boardEl.scrollLeft - active.scroll.left;
    return { x: active.pointer.x + dx, y: active.pointer.y + dy, dx, dy };
  }

  function evaluate() {
    const p = frozenPoint();
    const col = active.columns.find((c) => p.x >= c.rect.left && p.x <= c.rect.right);
    const target = col ? (active.src.kind === 'section' ? sectionTarget(col, p) : rowTarget(col, p)) : null;
    active.target = target;
    paintIndicator(target, p);
  }

  function sectionTarget(col, p) {
    const others = col.sections.filter((s) => s.id !== active.src.id);
    const index = others.filter((s) => p.y > s.rect.top + s.rect.height / 2).length;
    const lineY = index < others.length ? others[index].rect.top - 12 : (others.at(-1)?.rect.bottom ?? col.rect.top) + 12;
    return { kind: 'move-section', col: col.index, index, lineY, colRect: col.rect };
  }

  function rowTarget(col, p) {
    const key = active.src.id;
    const ownPin = Object.entries(active.layout.pinned).find(([, pin]) => pin.rows.includes(key));
    const vanishing = ownPin && ownPin[1].rows.length === 1 ? `pin:${ownPin[0]}` : null;
    const secs = col.sections.filter((s) => s.id !== vanishing);
    for (let i = 0; i <= secs.length; i++) {
      const above = secs[i - 1];
      const below = secs[i];
      const lo = above ? above.rect.bottom - EDGE_PX : -Infinity;
      const hi = below ? below.rect.top + EDGE_PX : Infinity;
      if (p.y >= lo && p.y <= hi) {
        const lineY = below ? below.rect.top - 12 : (above ? above.rect.bottom + 12 : col.rect.top + 12);
        return { kind: 'new-pin', col: col.index, index: i, lineY, colRect: col.rect };
      }
      if (!below || p.y > below.rect.bottom - EDGE_PX) continue;
      return rowTargetIn(below, p, key, ownPin);
    }
    return null;
  }

  function rowTargetIn(sec, p, key, ownPin) {
    if (sec.kind === 'pinned') {
      const rows = sec.rows.filter((r) => r.key !== key);
      const index = rows.filter((r) => p.y > r.rect.top + r.rect.height / 2).length;
      const lineY = index < rows.length ? rows[index].rect.top : (rows.at(-1)?.rect.bottom ?? sec.rect.top + 32);
      return { kind: 'join-pin', pinId: pinIdOf(sec.id), index, lineY, colRect: sec.rect };
    }
    const home = kindOfKey(key) === 'job' ? 'jobs' : 'sessions';
    if (sec.kind !== home) return null;
    return { kind: ownPin ? 'unpin' : 'home', section: sec };
  }

  function paintIndicator(t, p) {
    for (const el of boardEl.querySelectorAll('.is-drop-target')) el.classList.remove('is-drop-target');
    const lineEl = active.lineEl;
    if (!t || t.kind === 'home') { lineEl.hidden = true; return; }
    if (t.kind === 'unpin') { lineEl.hidden = true; t.section.el.classList.add('is-drop-target'); return; }
    lineEl.hidden = false;
    lineEl.style.top = `${t.lineY - p.dy}px`;
    lineEl.style.left = `${t.colRect.left - p.dx}px`;
    lineEl.style.width = `${t.colRect.width}px`;
  }

  function autoScroll() {
    if (!scroller || !scroller.clientHeight || active.raf) return;
    const tick = () => {
      if (!active) return;
      active.raf = 0;
      const r = scroller.getBoundingClientRect();
      const { x, y } = active.pointer;
      const vy = speed(y - r.top) - speed(r.bottom - y);
      const b = boardEl.getBoundingClientRect();
      const vx = speed(x - b.left) - speed(b.right - x);
      if (!vy && !vx) return;
      scroller.scrollTop -= vy;
      boardEl.scrollLeft -= vx;
      evaluate();
      active.raf = requestAnimationFrame(tick);
    };
    active.raf = requestAnimationFrame(tick);
  }

  function speed(distance) {
    return distance < AUTOSCROLL_EDGE_PX ? Math.ceil(((AUTOSCROLL_EDGE_PX - Math.max(0, distance)) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_PX) : 0;
  }

  function onUp() {
    if (!active) { detach(); return; }
    const { target, src } = active;
    const mutation = target ? mutationFor(src, target) : null;
    swallowNextClick();
    finish();
    if (mutation) board.applyLayout((l) => dropEmptyColumns(mutation(l)));
  }

  function mutationFor(src, t) {
    if (t.kind === 'move-section') return (l) => moveSection(l, src.id, t.col, t.index);
    if (t.kind === 'new-pin') return (l) => pinRow(l, src.id, { newAt: { col: t.col, index: t.index } }).layout;
    if (t.kind === 'join-pin') return (l) => pinRow(l, src.id, { pinId: t.pinId, index: t.index }).layout;
    if (t.kind === 'unpin') return (l) => unpinRow(l, src.id);
    return null;
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish();
    document.addEventListener('pointerup', swallowNextClick, { capture: true, once: true });
  }

  function onCancelEvent() {
    if (active) finish();
    else detach();
  }

  function finish() {
    if (active.raf) cancelAnimationFrame(active.raf);
    active.ghost.remove();
    active.lineEl.remove();
    for (const el of boardEl.querySelectorAll('.is-drop-target')) el.classList.remove('is-drop-target');
    active.src.el.classList.remove('is-drag-source');
    boardEl.classList.remove('is-dragging');
    window.removeEventListener('keydown', onKey, true);
    active = null;
    detach();
    board.thaw();
  }

  function detach() {
    pending = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancelEvent);
  }

  function swallowNextClick() {
    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  }

  boardEl.addEventListener('pointerdown', onDown);
  return {
    isDragging: () => !!active,
    uninstall() {
      if (active) finish();
      detach();
      boardEl.removeEventListener('pointerdown', onDown);
    },
  };
}
