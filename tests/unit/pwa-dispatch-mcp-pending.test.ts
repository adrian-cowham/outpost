// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { dispatchSession, installDispatchDeps } from '../../src/pwa/ws/dispatch.js';
// @ts-expect-error PWA modules are plain JS.
import { sessions } from '../../src/pwa/state/sessions.js';
// @ts-expect-error PWA modules are plain JS.
import { renderThinkingStrip } from '../../src/pwa/components/session-view/regions.js';

const SID = 'sess-mcp';

// Trimmed from a real `claude -p` 2.1.292 init
function init(statuses: string[]) {
  return {
    type: 'system',
    subtype: 'init',
    mcp_servers: statuses.map((status, i) => ({ name: `server-${i}`, status })),
  };
}

function stripLabel() {
  const region = document.createElement('div');
  renderThinkingStrip(region, sessions.getSlice(SID));
  return region.querySelector('.thinking-strip-label')?.textContent ?? null;
}

beforeEach(() => {
  sessions.set({ view: 'session', currentSessionId: SID, maxTranscriptLines: 500, sessionsById: new Map() });
  sessions.ensureSlice(SID);
  installDispatchDeps({
    state: {},
    startThinking: (sid: string) => sessions.for(sid).startThinking(),
    stopThinking: (sid: string) => sessions.for(sid).stopThinking(),
    renderSession() {},
  });
});

describe('init with pending MCP servers → thinking strip', () => {
  it('reads "loading MCPs" until the first stream event', () => {
    dispatchSession(init(['connected', 'pending', 'needs-auth']), SID);
    expect(stripLabel()).toBe('loading MCPs');

    dispatchSession({ type: 'stream_event', event: { type: 'message_start' } }, SID);
    expect(stripLabel()).toBe('thinking');
  });

  it('stays a plain thinking strip when nothing is pending', () => {
    sessions.for(SID).startThinking();
    dispatchSession(init(['connected', 'needs-auth', 'failed']), SID);
    expect(stripLabel()).toBe('thinking');
  });

  it('clears when the turn ends before any stream event', () => {
    dispatchSession(init(['pending']), SID);
    sessions.for(SID).stopThinking();
    expect(sessions.getSlice(SID).mcpPending).toBe(false);
  });
});
