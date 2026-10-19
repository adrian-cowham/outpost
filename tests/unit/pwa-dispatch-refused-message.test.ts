// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { dispatchSession, installDispatchDeps } from '../../src/pwa/ws/dispatch.js';
// @ts-expect-error PWA modules are plain JS.
import { sessions } from '../../src/pwa/state/sessions.js';
// @ts-expect-error PWA modules are plain JS.
import { hasReadyAttachments, rememberSent } from '../../src/pwa/components/session-view/attachments.js';

const SID = 'sess-refused';
const photo = { id: '1', kind: 'image', name: 'IMG_1.jpg', mediaType: 'image/jpeg', data: 'AAAA', preview: 'data:image/jpeg;base64,AAAA' };
let stopThinking: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessions.set({ view: 'session', currentSessionId: SID, maxTranscriptLines: 500, sessionsById: new Map() });
  sessions.ensureSlice(SID);
  stopThinking = vi.fn();
  installDispatchDeps({ state: {}, stopThinking, renderSession() {} });
});

describe('daemon_error carrying a clientId', () => {
  it('takes the refused message back out of the transcript and puts its photo back in the tray', () => {
    rememberSent(SID, 'c-1', 'what is this', [photo]);
    sessions.for(SID).appendTranscript({ role: 'user', text: 'what is this', clientId: 'c-1', __pending: true });
    dispatchSession({ type: 'daemon_error', message: 'Message not sent — IMG_1.jpg: unsupported image type', clientId: 'c-1' }, SID);

    const transcript = sessions.getSlice(SID).transcript;
    expect(transcript.some((m: { clientId?: string }) => m.clientId === 'c-1')).toBe(false);
    expect(transcript.at(-1)).toMatchObject({ role: 'error', text: expect.stringContaining('Message not sent') });
    expect(hasReadyAttachments(SID)).toBe(true);
  });

  // The refused message was queued into a running turn; claude is still working on it
  it('leaves the running turn alone', () => {
    rememberSent(SID, 'c-2', 'also this', []);
    dispatchSession({ type: 'daemon_error', message: 'Message not sent — x', clientId: 'c-2' }, SID);
    expect(stopThinking).not.toHaveBeenCalled();
  });

  it('still stops the turn for a daemon_error that is not a refusal', () => {
    dispatchSession({ type: 'daemon_error', message: 'claude exited' }, SID);
    expect(stopThinking).toHaveBeenCalledWith(SID);
  });
});
