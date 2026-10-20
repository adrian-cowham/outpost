// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../src/pwa/components/cockpit/bodies.js', () => ({
  mountBody(el: HTMLElement) {
    el.innerHTML = '<div class="fake-body"><textarea></textarea></div>';
    return { update() {}, unmount() { el.innerHTML = ''; } };
  },
}));

// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { renderDetail } from '../../src/pwa/components/cockpit/index.js';
// @ts-expect-error runtime JS import
import { work } from '../../src/pwa/state/work.js';
// @ts-expect-error runtime JS import
import { sessions } from '../../src/pwa/state/sessions.js';
// @ts-expect-error runtime JS import
import { cockpitLayout } from '../../src/pwa/state/cockpit-layout.js';
// @ts-expect-error runtime JS import
import { expansion } from '../../src/pwa/components/cockpit/expansion.js';

const NO_LIVE = { orchestrator: false, stepIds: [], sessionIds: [], interactiveSessionIds: [] };
const flush = () => new Promise((r) => setTimeout(r, 30));

let mount: HTMLElement;
let unmount: () => void;

function open(width = 1400) {
  mount = document.createElement('div');
  Object.defineProperty(mount, 'clientWidth', { value: width, configurable: true });
  document.body.appendChild(mount);
  unmount = renderDetail(mount);
}
const colSections = () => [...mount.querySelectorAll('.ckb-column')]
  .map((c) => [...c.querySelectorAll(':scope > .ckb-section')].map((s) => (s as HTMLElement).dataset.section));
const keysIn = (section: string) => [...mount.querySelectorAll(`[data-section="${section}"] .ckb-item`)]
  .map((e) => (e as HTMLElement).dataset.rowKey);
const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  document.documentElement.dataset.layout = 'desktop';
  work.applyWsEvent({ jobId: 'ja', job: { id: 'ja', title: 'A', state: 'executing', source: 'manual', createdAt: 2, updatedAt: 2, lastEngagedAt: 2, events: [], steps: [], live: NO_LIVE } });
  sessions.setProjects([{ cwd: '/r/outpost', sessions: [
    { id: 's1', title: 'one', lastModified: 5, lastEngagedAt: 5 },
    { id: 's2', title: 'two', lastModified: 4, lastEngagedAt: 4 },
  ] }]);
});
beforeEach(() => { cockpitLayout.reset(); localStorage.clear(); });
afterEach(() => { unmount?.(); mount?.remove(); expansion.close('session:s1'); });

describe('cockpit columns', () => {
  it('default layout renders Jobs in column 1 and Other then Sessions in column 2', () => {
    open(1400);
    expect(colSections()).toEqual([['jobs'], ['other', 'sessions']]);
  });

  it('a narrow board starts as one column', () => {
    open(600);
    expect(colSections()).toEqual([['jobs', 'other', 'sessions']]);
  });

  it('a pinned row renders in its Pinned section and not in Sessions', () => {
    cockpitLayout.set({ columns: [{ width: 0.5, sections: ['jobs', 'pin:p1'] }, { width: 0.5, sections: ['other', 'sessions'] }], pinned: { p1: { title: 'Replay', rows: ['session:s2'] } } });
    open();
    expect(keysIn('pin:p1')).toEqual(['session:s2']);
    expect(keysIn('sessions')).toEqual(['session:s1']);
    expect(mount.querySelector('[data-section="pin:p1"] .ckb-pin-title')!.textContent).toBe('Replay');
  });

  it('an expanded row moved into a Pinned section keeps its node and body', async () => {
    open();
    expansion.open('session:s1', 'caret');
    await flush();
    const rowEl = mount.querySelector('[data-row-key="session:s1"]')!;
    const body = rowEl.querySelector('.fake-body')!;
    cockpitLayout.set({ columns: [{ width: 0.5, sections: ['jobs', 'pin:p1'] }, { width: 0.5, sections: ['other', 'sessions'] }], pinned: { p1: { title: 'Pinned', rows: ['session:s1'] } } });
    await flush();
    const moved = mount.querySelector('[data-section="pin:p1"] [data-row-key="session:s1"]');
    expect(moved).toBe(rowEl);
    expect(moved!.querySelector('.fake-body')).toBe(body);
  });

  it('Other shows Nothing waiting when empty', () => {
    open();
    expect(mount.querySelector('[data-section="other"] .ckb-none')!.hasAttribute('hidden')).toBe(false);
  });

  it('j walks column-major', async () => {
    open();
    await flush();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { press('j'); await flush(); seen.push((mount.querySelector('.ckb-item.is-selected') as HTMLElement).dataset.rowKey!); }
    expect(seen).toEqual(['job:ja', 'session:s1', 'session:s2']);
  });

  it('the add-column button appends an empty column', async () => {
    open(1400);
    (mount.querySelector('.ckb-add-col') as HTMLButtonElement).click();
    await flush();
    expect(colSections()).toEqual([['jobs'], ['other', 'sessions'], []]);
    expect(mount.querySelectorAll('.ckb-column')[2]!.querySelector('.ckb-col-empty')!.hasAttribute('hidden')).toBe(false);
  });

  it('add-column is disabled when another column would not fit', () => {
    open(800);
    expect((mount.querySelector('.ckb-add-col') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a mutation before hydration never prunes a pin whose row has not loaded', async () => {
    cockpitLayout.set({ columns: [{ width: 0.5, sections: ['jobs', 'pin:p1'] }, { width: 0.5, sections: ['other', 'sessions'] }], pinned: { p1: { title: 'P', rows: ['job:not-loaded-yet', 'session:s1'] } } });
    open(1400);
    (mount.querySelector('.ckb-add-col') as HTMLButtonElement).click();
    await flush();
    expect(cockpitLayout.get().pinned.p1.rows).toEqual(['job:not-loaded-yet', 'session:s1']);
  });

  it('a store update mid-drag does not repaint until the drop, then repaints', async () => {
    open();
    await flush();
    const line = mount.querySelector('[data-row-key="job:ja"] .ckb-line')!;
    const mouse = (t: EventTarget, type: string, x: number, y: number) =>
      t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    mouse(line, 'pointerdown', 10, 10);
    mouse(document, 'pointermove', 40, 40);
    work.applyWsEvent({ jobId: 'ja', job: { ...work.get().byId.get('ja'), title: 'Renamed', updatedAt: 50 } });
    await flush();
    expect(mount.querySelector('[data-row-key="job:ja"] .ckb-title')!.textContent).toBe('A');
    mouse(document, 'pointerup', 40, 40);
    await flush();
    expect(mount.querySelector('[data-row-key="job:ja"] .ckb-title')!.textContent).toBe('Renamed');
  });

  it('p pins the selected session into a new section at the top of column 1 when none exists', async () => {
    open();
    await flush();
    press('j'); press('j');
    await flush();
    press('p');
    await flush();
    const l = cockpitLayout.get();
    const [first] = l.columns[0].sections;
    expect(first).toMatch(/^pin:/);
    expect(l.pinned[first.slice(4)].rows).toEqual(['session:s1']);
  });

  it('p pins into the first Pinned section in column-major order, appending', async () => {
    cockpitLayout.set({ columns: [{ width: 0.5, sections: ['jobs', 'pin:a'] }, { width: 0.5, sections: ['pin:b', 'other', 'sessions'] }],
      pinned: { a: { title: 'A', rows: ['job:ja'] }, b: { title: 'B', rows: ['session:s2'] } } });
    open();
    await flush();
    press('j'); press('j');
    await flush();
    expect((mount.querySelector('.ckb-item.is-selected') as HTMLElement).dataset.rowKey).toBe('session:s2');
    press('j');
    await flush();
    press('p');
    expect(cockpitLayout.get().pinned.a.rows).toEqual(['job:ja', 'session:s1']);
  });

  it('p on a pinned row unpins it', async () => {
    cockpitLayout.set({ columns: [{ width: 1, sections: ['pin:a', 'jobs', 'other', 'sessions'] }], pinned: { a: { title: 'A', rows: ['session:s1', 'session:s2'] } } });
    open();
    await flush();
    press('j');
    await flush();
    press('p');
    expect(cockpitLayout.get().pinned.a.rows).toEqual(['session:s2']);
  });

  it('ArrowRight on a focused grip moves the section to the next column and keeps focus', async () => {
    open();
    await flush();
    const grip = mount.querySelector('[data-section="jobs"] .o-grip') as HTMLButtonElement;
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await flush();
    expect(colSections()).toEqual([['jobs', 'other', 'sessions']]);
    expect(document.activeElement).toBe(grip);
  });

  it('ArrowDown on a focused grip moves the section down its column', async () => {
    open();
    await flush();
    const grip = mount.querySelector('[data-section="other"] .o-grip') as HTMLButtonElement;
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(colSections()).toEqual([['jobs'], ['sessions', 'other']]);
  });

  it('Reset layout restores the default after confirm', async () => {
    cockpitLayout.set({ columns: [{ width: 1, sections: ['sessions', 'jobs', 'other'] }], pinned: {} });
    open();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    (mount.querySelector('[data-ckb-reset]') as HTMLButtonElement).click();
    await flush();
    expect(confirm).toHaveBeenCalled();
    expect(cockpitLayout.get()).toBeNull();
    expect(colSections()).toEqual([['jobs'], ['other', 'sessions']]);
    expect((mount.querySelector('[data-ckb-reset]') as HTMLElement).hidden).toBe(true);
    confirm.mockRestore();
  });

  it('renaming a Pinned section stores the new title', async () => {
    cockpitLayout.set({ columns: [{ width: 1, sections: ['jobs', 'other', 'sessions', 'pin:p1'] }], pinned: { p1: { title: 'Pinned', rows: ['session:s1'] } } });
    open();
    (mount.querySelector('.ckb-pin-title') as HTMLButtonElement).click();
    const input = mount.querySelector('.ckb-pin-rename') as HTMLInputElement;
    input.value = 'Replay';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(cockpitLayout.get().pinned.p1.title).toBe('Replay');
  });
});
