// Carries typed text, open disclosures and focus across a job view's innerHTML repaints.

// Class name + step is unique for the once-per-step disclosures (findings, checks, resolved
// threads). It is NOT unique for anything rendered per row: a step's PR block holds one
// "N lines above" expander per comment thread, all identically classed, so without an explicit
// key opening one would reopen all of them on the next repaint. Those carry data-details-key.
function detailsKey(d) {
  const step = d.closest('[data-step-id]');
  const own = d.getAttribute('data-details-key') ?? d.className;
  return `${own}|${step ? step.getAttribute('data-step-id') : ''}`;
}

// Every in-timeline composer — the orchestrated card's "Message the controller" and
// voluntary-gate "Propose changes" boxes, and a write-draft card's "Propose changes"/"Deny"
// boxes (write-draft-card.js, keyed `wd-revise-<draftId>`/`wd-deny-<draftId>` — a step can
// carry more than one draft, so the name alone isn't unique) — is a
// `[data-composer="<name>"]` wrapper around one textarea, scoped to its step.
function composerKey(c) {
  const step = c.closest('[data-step-id]');
  return `${c.getAttribute('data-composer')}|${step ? step.getAttribute('data-step-id') : ''}`;
}

function composerByKey(root, key) {
  for (const c of root.querySelectorAll('[data-composer]')) {
    if (composerKey(c) === key) return c;
  }
  return null;
}

// A write-draft field's sanitized `id` (write-draft-card.js's fieldHtml/callHtml:
// `wd-f-<draftId>-<callIdx>-<cssId(argKey)>`) collapses two arg keys that differ only in
// punctuation to the SAME id — `cssId` maps every non `[A-Za-z0-9_-]` character to `_`, so
// `user.id` and `user_id` both become `user_id`. Keying a snapshot on that id would bleed
// one field's restored value into the other's. Build the key from the RAW pieces instead:
// the enclosing card's `data-draft-id` (never sanitized) + the field's own `data-call-idx`
// + its raw `data-arg-key` — or a sentinel for the one field with no arg key, the bash
// command textarea.
function draftFieldKey(el) {
  const card = el.closest('.wd-card');
  const draftId = card ? card.getAttribute('data-draft-id') : '';
  const callIdx = el.getAttribute('data-call-idx') ?? '';
  // Distinguish "has an arg key" from "is the bash textarea" by prefix rather than
  // by a sentinel value a real arg key could equal. The prefix must stay plain
  // text: this was a NUL byte, which made the whole file read as binary to grep
  // and silently excluded it from every repo-wide search.
  const raw = el.dataset.argKey;
  const argKey = raw == null ? 'bash!' : `arg!${raw}`;
  return `${draftId}|${callIdx}|${argKey}`;
}

function draftFieldByKey(root, key) {
  for (const el of root.querySelectorAll('.wd-card [id^="wd-f-"]')) {
    if (draftFieldKey(el) === key) return el;
  }
  return null;
}

export function snapshotUi(root) {
  const snap = { details: new Map(), composers: new Map(), trail: new Map(), replan: null, discard: null, launchContext: null, menuOpen: false, focus: null, draftFields: new Map() };
  // A thread's own fold is owned by state/thread-collapse.js and re-decided at render, so
  // snapshotting it would let the pre-repaint DOM outrank the store — a reply arriving on a
  // folded thread is meant to unfold it, and a restored `open` would put it straight back.
  // The `.hunk-more` expanders nested inside a thread are NOT excluded: they carry an explicit
  // data-details-key and this is still the only thing that carries them across a repaint.
  root.querySelectorAll('details').forEach((d) => {
    if (d.classList.contains('thread-card')) return;
    snap.details.set(detailsKey(d), d.open);
  });
  // The orchestrated card's trail strip (orchestrated-card.js) is plain buttons, not
  // <details>, so the pass above can't see which artifact the user has open. At most one
  // chip per step is open, so the step id is the whole key.
  root.querySelectorAll('.orc-trail-chip.is-open').forEach((chip) => {
    const step = chip.closest('[data-step-id]');
    if (step) snap.trail.set(step.getAttribute('data-step-id'), chip.getAttribute('data-trail-chip'));
  });
  root.querySelectorAll('[data-composer]').forEach((c) => {
    snap.composers.set(composerKey(c), {
      value: c.querySelector('textarea')?.value ?? '',
      open: !c.hasAttribute('hidden'),
    });
  });
  const replan = root.querySelector('.replan-composer');
  if (replan) {
    snap.replan = {
      open: replan.getAttribute('data-open') === 'true',
      value: replan.querySelector('.replan-textarea')?.value ?? '',
    };
  }
  const discard = root.querySelector('.recon-discard-composer');
  if (discard) {
    snap.discard = {
      open: discard.getAttribute('data-open') === 'true',
      value: discard.querySelector('.recon-discard-textarea')?.value ?? '',
    };
  }
  const launchTa = root.querySelector('.launch-context-textarea');
  if (launchTa && launchTa.value) snap.launchContext = launchTa.value;
  snap.menuOpen = !!root.querySelector('.tk-menu-body:not([hidden])');
  // Write-draft card fields (write-draft-card.js) — an edit here is the feature's entire
  // promise (the user's correction pinned verbatim on Accept), so it must survive a repaint
  // the same as any composer text. A sibling step's `submit_step_progress` bumps
  // `job.updatedAt` on an unrelated timer while the user is mid-edit, and without this pass
  // the next repaint would silently revert every field to the action's original values —
  // Accept would then pin the UN-edited payload with nothing telling the user anything was
  // lost. Keyed on draftFieldKey (the field's RAW draftId/callIdx/argKey), not its sanitized
  // `id` — see draftFieldKey's own comment for why.
  root.querySelectorAll('.wd-card [id^="wd-f-"]').forEach((el) => {
    snap.draftFields.set(draftFieldKey(el), el.type === 'checkbox' ? { checked: el.checked } : { value: el.value });
  });
  const ae = document.activeElement;
  if (ae && root.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) {
    const composer = ae.closest('[data-composer]');
    snap.focus = {
      replan: !!ae.closest('.replan-composer'),
      launchContext: !!ae.closest('.launch-context'),
      composer: composer ? composerKey(composer) : null,
      discard: !!ae.closest('.recon-discard-composer'),
      // A wd-field carries its own stable id; only set when the focused element IS one
      // (distinct from being inside a `.wd-card` generally — the composer branch above
      // already owns the revise/deny textareas, which also live inside a `.wd-card`).
      draftField: ae.id && ae.id.startsWith('wd-f-') ? draftFieldKey(ae) : null,
      start: ae.selectionStart,
      end: ae.selectionEnd,
    };
  }
  return snap;
}

export function restoreUi(root, snap) {
  // Carries per-step findings collapse (step-card.js's <details.tl-findings>),
  // PR resolved-threads disclosure, etc. across store-driven repaints.
  root.querySelectorAll('details').forEach((d) => {
    const k = detailsKey(d);
    if (snap.details.has(k)) d.open = snap.details.get(k);
  });
  // A repainted trail always starts fully closed, so re-clicking the chip through its own
  // handler restores it — no second code path that could drift from openTrail's semantics.
  for (const [stepId, slug] of snap.trail) {
    root.querySelector(`.tl-step[data-step-id="${CSS.escape(stepId)}"] .orc-trail-chip[data-trail-chip="${CSS.escape(slug)}"]`)?.click();
  }
  // Composers repaint empty and (for the toggled ones) closed. Carry the text back and
  // re-open anything the user had open — a dispatch transition or a pr-watcher event
  // bumps job.updatedAt every few seconds while they're mid-sentence.
  root.querySelectorAll('[data-composer]').forEach((c) => {
    const prev = snap.composers.get(composerKey(c));
    if (!prev) return;
    const ta = c.querySelector('textarea');
    if (ta && prev.value) {
      ta.value = prev.value;
      // A write-draft composer's Submit button starts `disabled` and is only re-enabled by
      // its own `input` listener (write-draft-card.js's wireComposer) — a programmatic
      // `.value =` fires no native `input` event, so without this the restored text would
      // sit in the box with a dead Submit button until the user typed or deleted a
      // character. wireWriteDraft/wireOrchestratedCard have already attached their
      // listeners by the time restoreUi runs (wiring happens before snapshot/restore), so
      // the synthetic event reaches them. Harmless no-op for every other composer here,
      // none of which listen for `input`.
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (prev.open) c.removeAttribute('hidden');
  });
  if (snap.replan && (snap.replan.open || snap.replan.value)) {
    const composer = root.querySelector('.replan-composer');
    const ta = composer?.querySelector('.replan-textarea');
    if (ta) ta.value = snap.replan.value;
    if (composer && snap.replan.open) {
      composer.setAttribute('data-open', 'true');
      composer.setAttribute('aria-hidden', 'false');
      root.querySelector('[data-job-action="reopen-orchestrator"]')?.setAttribute('aria-expanded', 'true');
    }
  }
  if (snap.discard && (snap.discard.open || snap.discard.value)) {
    const composer = root.querySelector('.recon-discard-composer');
    const ta = composer?.querySelector('.recon-discard-textarea');
    if (ta) ta.value = snap.discard.value;
    if (composer && snap.discard.open) {
      composer.setAttribute('data-open', 'true');
      composer.setAttribute('aria-hidden', 'false');
      root.querySelector('[data-job-action="recon-discard"]')?.setAttribute('aria-expanded', 'true');
    }
  }
  if (snap.launchContext) {
    const ta = root.querySelector('.launch-context-textarea');
    if (ta) ta.value = snap.launchContext;
  }
  root.querySelectorAll('.wd-card [id^="wd-f-"]').forEach((el) => {
    const prev = snap.draftFields.get(draftFieldKey(el));
    if (!prev) return;
    if (el.type === 'checkbox') el.checked = prev.checked;
    else el.value = prev.value;
  });
  if (snap.focus) {
    let ta = null;
    if (snap.focus.replan) {
      ta = root.querySelector('.replan-textarea');
    } else if (snap.focus.discard) {
      ta = root.querySelector('.recon-discard-textarea');
    } else if (snap.focus.launchContext) {
      ta = root.querySelector('.launch-context-textarea');
    } else if (snap.focus.draftField) {
      ta = draftFieldByKey(root, snap.focus.draftField);
    } else if (snap.focus.composer) {
      ta = composerByKey(root, snap.focus.composer)?.querySelector('textarea') ?? null;
    }
    if (ta) {
      ta.focus();
      try { ta.setSelectionRange(snap.focus.start, snap.focus.end); } catch { /* non-text input, e.g. checkbox/number */ }
    }
  }
}
