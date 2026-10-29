// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { installDrag } from '../../src/pwa/components/cockpit/drag.js';

// Geometry: column 0 at x 0-400, column 1 at x 424-824. Sections stack with 24px gaps.
type R = [number, number, number, number];
const rects = new WeakMap<Element, R>();
const realRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    const [left, top, width, height] = rects.get(this) ?? [0, 0, 0, 0];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
  };
});
afterEach(() => { Element.prototype.getBoundingClientRect = realRect; drag?.uninstall(); });

let layout: any;
let board: any;
let boardEl: HTMLElement;
let drag: any;

const rowHtml = (key: string) => `<div class="ckb-item" data-row-key="${key}"><div class="ckb-line"><span class="t">${key}</span><button class="ckb-act">Go</button><button class="ckb-caret"></button></div><div class="ckb-body"><textarea></textarea></div></div>`;
const sectionHtml = (id: string, kind: string, keys: string[]) =>
  `<section class="ckb-section" data-section="${id}" data-kind="${kind}"><div class="o-group-hdr"><button class="o-grip"></button><h2>${id}</h2></div><div class="o-row-group">${keys.map(rowHtml).join('')}</div></section>`;

function setup() {
  layout = {
    columns: [{ width: 0.5, sections: ['jobs'] }, { width: 0.5, sections: ['other', 'sessions', 'pin:p1'] }],
    pinned: { p1: { title: 'Pinned', rows: ['job:b', 'job:c'] } },
  };
  board = {
    layout: () => layout,
    applyLayout: vi.fn((fn: any) => { layout = fn(layout); }),
    freeze: vi.fn(), thaw: vi.fn(),
  };
  document.body.innerHTML = `<div class="o-frame-detail"><div class="ckb-board">
    <div class="ckb-column" data-col="0">${sectionHtml('jobs', 'jobs', ['job:a'])}</div>
    <div class="ckb-column" data-col="1">${sectionHtml('other', 'other', [])}${sectionHtml('sessions', 'sessions', ['session:s1', 'session:s2'])}${sectionHtml('pin:p1', 'pinned', ['job:b', 'job:c'])}</div>
  </div></div>`;
  boardEl = document.querySelector('.ckb-board')!;
  const q = (s: string) => document.querySelector(s)!;
  const cols = document.querySelectorAll('.ckb-column');
  rects.set(cols[0]!, [0, 0, 400, 1000]);
  rects.set(cols[1]!, [424, 0, 400, 1000]);
  rects.set(q('[data-section="jobs"]'), [0, 0, 400, 200]);
  rects.set(q('[data-section="other"]'), [424, 0, 400, 60]);
  rects.set(q('[data-section="sessions"]'), [424, 84, 400, 200]);
  rects.set(q('[data-section="pin:p1"]'), [424, 308, 400, 160]);
  rects.set(q('[data-row-key="job:a"]'), [0, 40, 400, 40]);
  rects.set(q('[data-row-key="session:s1"]'), [424, 124, 400, 40]);
  rects.set(q('[data-row-key="session:s2"]'), [424, 164, 400, 40]);
  rects.set(q('[data-row-key="job:b"]'), [424, 348, 400, 40]);
  rects.set(q('[data-row-key="job:c"]'), [424, 388, 400, 40]);
  drag = installDrag(boardEl, board);
}

const fire = (el: EventTarget, type: string, x: number, y: number) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
const line = (key: string) => document.querySelector(`[data-row-key="${key}"] .ckb-line`)!;
const grip = (id: string) => document.querySelector(`[data-section="${id}"] .o-grip`)!;
function dragTo(src: Element, from: [number, number], to: [number, number]) {
  fire(src, 'pointerdown', ...from);
  fire(document, 'pointermove', from[0] + 10, from[1] + 10);
  fire(document, 'pointermove', ...to);
  fire(document, 'pointerup', ...to);
}

describe('cockpit drag', () => {
  beforeEach(setup);

  it('a 3px move does not start a drag and the click still lands', () => {
    const onClick = vi.fn();
    line('session:s1').addEventListener('click', onClick);
    fire(line('session:s1'), 'pointerdown', 500, 140);
    fire(document, 'pointermove', 503, 140);
    fire(document, 'pointerup', 503, 140);
    line('session:s1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(drag.isDragging()).toBe(false);
    expect(board.freeze).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
  });

  it('pointerdown on a button or inside a body never drags', () => {
    for (const sel of ['[data-row-key="session:s1"] .ckb-act', '[data-row-key="session:s1"] .ckb-caret', '[data-row-key="session:s1"] .ckb-body textarea']) {
      fire(document.querySelector(sel)!, 'pointerdown', 500, 140);
      fire(document, 'pointermove', 560, 300);
      expect(drag.isDragging()).toBe(false);
      fire(document, 'pointerup', 560, 300);
    }
    expect(board.applyLayout).not.toHaveBeenCalled();
  });

  it('dropping a session between sections creates a Pinned section there', () => {
    dragTo(line('session:s1'), [500, 140], [500, 72]);
    const col = layout.columns[1].sections;
    expect(col[0]).toBe('other');
    expect(col[1]).toMatch(/^pin:/);
    expect(col.slice(2)).toEqual(['sessions', 'pin:p1']);
    expect(layout.pinned[col[1].slice(4)].rows).toEqual(['session:s1']);
  });

  it('dropping into a Pinned section inserts at the indicated index', () => {
    dragTo(line('session:s1'), [500, 140], [500, 395]);
    expect(layout.pinned.p1.rows).toEqual(['job:b', 'session:s1', 'job:c']);
  });

  it('dropping a pinned job onto Jobs unpins it', () => {
    dragTo(line('job:b'), [500, 360], [100, 100]);
    expect(layout.pinned.p1.rows).toEqual(['job:c']);
  });

  it('a job over Sessions shows no indicator and snaps back unchanged', () => {
    fire(line('job:a'), 'pointerdown', 100, 50);
    fire(document, 'pointermove', 110, 60);
    fire(document, 'pointermove', 500, 150);
    expect(document.querySelector('.ckb-drop-line:not([hidden])')).toBeNull();
    expect(document.querySelector('.is-drop-target')).toBeNull();
    fire(document, 'pointerup', 500, 150);
    expect(board.applyLayout).not.toHaveBeenCalled();
    expect(board.thaw).toHaveBeenCalled();
  });

  it('dragging a section grip to column 1 index 0 moves it', () => {
    dragTo(grip('jobs'), [10, 10], [500, 5]);
    expect(layout.columns.map((c: any) => c.sections)).toEqual([['jobs', 'other', 'sessions', 'pin:p1']]);
  });

  it('emptying a column by drag removes it, an untouched one stays', () => {
    layout.columns.push({ width: 0.2, sections: [] });
    dragTo(grip('sessions'), [430, 90], [100, 300]);
    expect(layout.columns.map((c: any) => c.sections)).toEqual([['jobs', 'sessions'], ['other', 'pin:p1']]);
  });

  it('a cancelled drag removes no column', () => {
    layout.columns.push({ width: 0.2, sections: [] });
    fire(grip('sessions'), 'pointerdown', 430, 90);
    fire(document, 'pointermove', 480, 200);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fire(document, 'pointerup', 480, 200);
    expect(board.applyLayout).not.toHaveBeenCalled();
    expect(layout.columns).toHaveLength(3);
  });

  it('Escape mid-drag cancels and never reaches the board keys', () => {
    const ta = document.querySelector('[data-row-key="session:s1"] textarea') as HTMLTextAreaElement;
    ta.focus();
    const boardKeys = vi.fn();
    document.addEventListener('keydown', boardKeys);
    fire(line('session:s2'), 'pointerdown', 500, 180);
    fire(document, 'pointermove', 520, 250);
    expect(drag.isDragging()).toBe(true);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(drag.isDragging()).toBe(false);
    expect(boardKeys).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ta);
    document.removeEventListener('keydown', boardKeys);
  });

  it('freezes the board for the whole drag and thaws once', () => {
    fire(line('session:s1'), 'pointerdown', 500, 140);
    fire(document, 'pointermove', 520, 160);
    expect(board.freeze).toHaveBeenCalledTimes(1);
    expect(board.thaw).not.toHaveBeenCalled();
    fire(document, 'pointerup', 520, 160);
    expect(board.thaw).toHaveBeenCalledTimes(1);
  });

  it('the click ending a drag is swallowed', () => {
    const onClick = vi.fn();
    line('session:s1').addEventListener('click', onClick);
    dragTo(line('session:s1'), [500, 140], [500, 395]);
    line('session:s1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('the click after an Escape-cancelled drag is swallowed too', () => {
    const onClick = vi.fn();
    line('session:s1').addEventListener('click', onClick);
    fire(line('session:s1'), 'pointerdown', 500, 140);
    fire(document, 'pointermove', 520, 200);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fire(document, 'pointerup', 500, 140);
    line('session:s1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('the ghost carries the header only', () => {
    fire(line('session:s1'), 'pointerdown', 500, 140);
    fire(document, 'pointermove', 520, 160);
    const ghost = document.querySelector('.ckb-ghost')!;
    expect(ghost.querySelector('.ckb-line')).not.toBeNull();
    expect(ghost.querySelector('.ckb-body')).toBeNull();
    fire(document, 'pointerup', 520, 160);
    expect(document.querySelector('.ckb-ghost')).toBeNull();
  });
});
