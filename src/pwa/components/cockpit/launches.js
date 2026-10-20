import { createStore } from '../../state/create-store.js';
import { expansion } from './expansion.js';

// A new session exists on the daemon only once its view connects, so the cockpit must hold its row until then.
const store = createStore(new Set());

export const launches = {
  get: store.get,
  subscribe: store.subscribe,
  drop(id) { store.set((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; }); },
};

export function openNewSessionInCockpit(id) {
  store.set((s) => new Set(s).add(id));
  expansion.open(`session:${id}`, 'caret');
}
