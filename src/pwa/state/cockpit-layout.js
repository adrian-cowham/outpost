import { createStore } from './create-store.js';
import { register, push } from './preferences.js';

// Raw and unnormalised (null until first changed): only the board knows the width to normalise against.
const MIRROR_KEY = 'outpost.cockpitLayout';

function loadMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mirror(layout) {
  try {
    if (layout == null) localStorage.removeItem(MIRROR_KEY);
    else localStorage.setItem(MIRROR_KEY, JSON.stringify(layout));
  } catch {}
}

const store = createStore(loadMirror());

function applyRemote(layout) {
  mirror(layout);
  store.set(layout ?? null);
}
register({ key: 'cockpitLayout', apply: applyRemote, current: () => store.get() ?? undefined });

export const cockpitLayout = {
  get: store.get,
  subscribe: store.subscribe,
  set(layout) {
    mirror(layout);
    store.set(layout);
    void push('cockpitLayout', layout);
  },
  reset() {
    mirror(null);
    store.set(null);
    void push('cockpitLayout', null);
  },
};
