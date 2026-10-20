// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { createColumnResizer } from '../../src/pwa/components/cockpit/resize.js';

let layout: any;
let board: any;
let boardEl: HTMLElement;
let cols: HTMLElement[];

function setup(widthPx = 1000) {
  layout = { columns: [{ width: 0.5, sections: ['jobs'] }, { width: 0.5, sections: ['other', 'sessions'] }], pinned: {} };
  board = {
    layout: () => layout,
    applyLayout: vi.fn((fn: any) => { layout = fn(layout); }),
    freeze: vi.fn(), thaw: vi.fn(),
  };
  document.body.innerHTML = '<div class="ckb-board"></div>';
  boardEl = document.querySelector('.ckb-board')!;
  cols = [0, 1].map(() => {
    const c = document.createElement('div');
    c.className = 'ckb-column';
    Object.defineProperty(c, 'offsetWidth', { value: widthPx / 2, configurable: true });
    boardEl.appendChild(c);
    return c;
  });
  const r = createColumnResizer(boardEl, board);
  r.sync(cols);
  return r;
}
const fire = (el: EventTarget, type: string, clientX: number) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
const handle = () => boardEl.querySelector('.ckb-resize') as HTMLElement;
const widths = () => layout.columns.map((c: any) => +c.width.toFixed(3));

beforeEach(() => { document.body.innerHTML = ''; });

describe('column resize', () => {
  it('renders one handle per gutter', () => {
    setup();
    expect(boardEl.querySelectorAll('.ckb-resize')).toHaveLength(1);
    expect(handle().dataset.leftCol).toBe('0');
  });

  it('dragging a handle changes only its pair, preserving their sum, and writes once on release', () => {
    setup(1000);
    fire(handle(), 'pointerdown', 500);
    fire(document, 'pointermove', 600);
    fire(document, 'pointermove', 620);
    expect(board.applyLayout).not.toHaveBeenCalled();
    expect(cols[0]!.style.flexGrow).toBe('0.62');
    fire(document, 'pointerup', 620);
    expect(board.applyLayout).toHaveBeenCalledTimes(1);
    expect(widths()).toEqual([0.62, 0.38]);
    expect(board.freeze).toHaveBeenCalled();
    expect(board.thaw).toHaveBeenCalled();
  });

  it('clamps at 360px', () => {
    setup(1000);
    fire(handle(), 'pointerdown', 500);
    fire(document, 'pointermove', 950);
    fire(document, 'pointerup', 950);
    expect(widths()).toEqual([0.64, 0.36]);
  });

  it('double-click equalises', () => {
    setup();
    layout.columns[0].width = 0.7;
    layout.columns[1].width = 0.3;
    handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(widths()).toEqual([0.5, 0.5]);
  });

  it('a pointerdown on a handle never reaches the board', () => {
    setup();
    const onBoard = vi.fn();
    boardEl.addEventListener('pointerdown', onBoard);
    fire(handle(), 'pointerdown', 500);
    expect(onBoard).not.toHaveBeenCalled();
    fire(document, 'pointerup', 500);
  });

  it('a resize never removes a column', () => {
    setup();
    fire(handle(), 'pointerdown', 500);
    fire(document, 'pointerup', 500);
    expect(layout.columns).toHaveLength(2);
  });
});
