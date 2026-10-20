import { work } from '../../state/work.js';
import { openSession } from '../../app-bridge.js';
import { sessions } from '../../state/sessions.js';
import { openCwdPickerSheet } from '../cwd-picker.js';

const USER_SESSION_ACTIONS = new Set(['meta.wait', 'meta.session']);

const hasUserSession = (s) => s?.type === 'action' && USER_SESSION_ACTIONS.has(s.action);

// A meta.session step ends when the user says the work is done, not when a hold is released.
export const isSessionStep = (s) => s?.type === 'action' && s.action === 'meta.session';

// The user's session on a parked wait, which the step renders inline as a full session view.
export function inlineWaitSession(s) {
  if (!hasUserSession(s)) return null;
  return s.state === 'waiting' && !s.cancelled && !s.failure ? s.manualSession ?? null : null;
}

export function waitSessionOpening(job, s) {
  return work.isOpeningWait(job.id, s.id);
}

// The label for a meta.wait's session button, or null when the step offers none: a parked
// wait can start one, and once the wait settles it stays reachable until the job's teardown closes it.
export function waitSessionLabel(job, s) {
  if (!hasUserSession(s)) return null;
  if (job.state === 'done' || job.state === 'abandoned') return null;
  if (inlineWaitSession(s) || waitSessionOpening(job, s)) return null;
  if (s.manualSession) return 'View session';
  return s.state === 'waiting' && !s.cancelled && !s.failure ? 'Open session' : null;
}

// A wait with no workspace has nowhere to run until the user picks one.
export function openWaitStepSession(job, s) {
  if (s.manualSession) {
    openSession({ id: s.manualSession.id, cwd: s.manualSession.cwd, fromTicketId: job.id });
    return;
  }
  if (s.workspace?.kind === 'none') {
    openCwdPickerSheet(undefined, { onPick: (cwd) => void create(job, s, cwd) });
    return;
  }
  void create(job, s);
}

// The step's repaint mounts the session once manualSession lands on it.
async function create(job, s, cwd) {
  try {
    await work.openWaitSession(job.id, s.id, cwd, (opened) => {
      sessions.ensureSlice(opened.sessionId, { cwd: opened.cwd, fromTicketId: job.id });
      sessions.for(opened.sessionId).setPendingDefaultPush(true);
    });
  } catch (err) {
    alert(`Open session failed: ${err?.message ?? err}`);
  }
}
