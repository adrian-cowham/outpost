// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const registered: Record<string, { apply: (v: unknown) => void; current: () => unknown }> = {};
const pushed: Array<[string, unknown]> = [];
vi.mock('../../src/pwa/state/preferences.js', () => ({
  register: ({ key, apply, current }: any) => { registered[key] = { apply, current }; },
  push: (key: string, value: unknown) => { pushed.push([key, value]); return Promise.resolve(true); },
}));

const LAYOUT = { columns: [{ width: 1, sections: ['jobs', 'other', 'sessions'] }], pinned: {} };

async function load() {
  vi.resetModules();
  // @ts-expect-error PWA modules are plain JS; tests import them at runtime.
  return (await import('../../src/pwa/state/cockpit-layout.js')).cockpitLayout;
}

beforeEach(() => { localStorage.clear(); pushed.length = 0; });

describe('cockpit layout store', () => {
  it('loads the mirror synchronously', async () => {
    localStorage.setItem('outpost.cockpitLayout', JSON.stringify(LAYOUT));
    expect((await load()).get()).toEqual(LAYOUT);
  });

  it('starts null with no mirror, and survives a corrupt one', async () => {
    expect((await load()).get()).toBeNull();
    localStorage.setItem('outpost.cockpitLayout', '{nope');
    expect((await load()).get()).toBeNull();
  });

  it('a daemon apply replaces the layout and mirrors it without pushing', async () => {
    const store = await load();
    let seen: unknown = null;
    store.subscribe((v: unknown) => { seen = v; });
    registered.cockpitLayout!.apply(LAYOUT);
    expect(store.get()).toEqual(LAYOUT);
    expect(seen).toEqual(LAYOUT);
    expect(JSON.parse(localStorage.getItem('outpost.cockpitLayout')!)).toEqual(LAYOUT);
    expect(pushed).toEqual([]);
  });

  it('set pushes and mirrors', async () => {
    const store = await load();
    store.set(LAYOUT);
    expect(pushed).toEqual([['cockpitLayout', LAYOUT]]);
    expect(JSON.parse(localStorage.getItem('outpost.cockpitLayout')!)).toEqual(LAYOUT);
    expect(registered.cockpitLayout!.current()).toEqual(LAYOUT);
  });

  it('reset clears to null, drops the mirror, and pushes null', async () => {
    const store = await load();
    store.set(LAYOUT);
    store.reset();
    expect(store.get()).toBeNull();
    expect(localStorage.getItem('outpost.cockpitLayout')).toBeNull();
    expect(pushed.at(-1)).toEqual(['cockpitLayout', null]);
  });

  it('a null first-run value is not seeded to the daemon', async () => {
    await load();
    expect(registered.cockpitLayout!.current()).toBeUndefined();
  });
});
