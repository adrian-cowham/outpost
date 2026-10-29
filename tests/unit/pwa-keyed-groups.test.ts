// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { placeKeyedGroups } from '../../src/pwa/utils/keyed-rows.js';

function node(key: string) {
  const el = document.createElement('div');
  el.dataset.key = key;
  el.innerHTML = `<div class="ckb-body"><div class="ckb-session"></div><textarea></textarea></div>`;
  return el;
}
const keys = (c: Element) => [...c.children].map((e) => (e as HTMLElement).dataset.key);

function setup() {
  document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
  const a = document.getElementById('a')!;
  const b = document.getElementById('b')!;
  const n = { x: node('x'), y: node('y'), z: node('z') };
  a.append(n.x, n.y);
  b.append(n.z);
  return { a, b, n };
}

describe('placeKeyedGroups', () => {
  it('a node moved from group A to group B is the same node with the same children', () => {
    const { a, b, n } = setup();
    const body = n.x.querySelector('.ckb-body');
    placeKeyedGroups([
      { container: a, entries: [{ key: 'y', node: n.y }] },
      { container: b, entries: [{ key: 'z', node: n.z }, { key: 'x', node: n.x }] },
    ]);
    expect(keys(a)).toEqual(['y']);
    expect(keys(b)).toEqual(['z', 'x']);
    expect(b.lastElementChild).toBe(n.x);
    expect(n.x.querySelector('.ckb-body')).toBe(body);
  });

  it('a node moved to a group painted earlier than its old one is not removed', () => {
    const { a, b, n } = setup();
    placeKeyedGroups([
      { container: b, entries: [{ key: 'x', node: n.x }, { key: 'z', node: n.z }] },
      { container: a, entries: [{ key: 'y', node: n.y }] },
    ]);
    expect(keys(b)).toEqual(['x', 'z']);
    expect(keys(a)).toEqual(['y']);
  });

  it('stale nodes in every container are removed', () => {
    const { a, b, n } = setup();
    placeKeyedGroups([
      { container: a, entries: [{ key: 'x', node: n.x }] },
      { container: b, entries: [] },
    ]);
    expect(keys(a)).toEqual(['x']);
    expect(keys(b)).toEqual([]);
    expect(n.y.isConnected).toBe(false);
  });

  it('reorders within one container', () => {
    const { a, b, n } = setup();
    placeKeyedGroups([
      { container: a, entries: [{ key: 'y', node: n.y }, { key: 'x', node: n.x }] },
      { container: b, entries: [{ key: 'z', node: n.z }] },
    ]);
    expect(keys(a)).toEqual(['y', 'x']);
  });

  it('focus and caret inside a moved textarea are restored', () => {
    const { a, b, n } = setup();
    const ta = n.x.querySelector('textarea')!;
    ta.value = 'half a thought';
    ta.focus();
    ta.setSelectionRange(4, 6);
    placeKeyedGroups([
      { container: a, entries: [{ key: 'y', node: n.y }] },
      { container: b, entries: [{ key: 'x', node: n.x }, { key: 'z', node: n.z }] },
    ]);
    expect(document.activeElement).toBe(ta);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([4, 6]);
    expect(ta.value).toBe('half a thought');
  });

  it('scrollTop of a session transcript is restored', () => {
    const { a, b, n } = setup();
    const scroller = document.createElement('div');
    scroller.className = 'sv-transcript';
    n.x.querySelector('.ckb-session')!.appendChild(scroller);
    const writes: number[] = [];
    let top = 120;
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v) => { writes.push(v); top = v; }, configurable: true });
    placeKeyedGroups([
      { container: a, entries: [{ key: 'y', node: n.y }] },
      { container: b, entries: [{ key: 'x', node: n.x }, { key: 'z', node: n.z }] },
    ]);
    expect(writes).toContain(120);
  });
});
