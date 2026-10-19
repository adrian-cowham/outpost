// The composer's pending photos and files, per session like composerDraft so tab churn keeps them
import { escapeHtml } from '../../util.js';
import { MAX_ATTACHMENTS, MAX_MESSAGE_ATTACHMENT_BYTES, attachmentBytes, prepareAttachment } from '../../utils/attachments.js';

const pendingBySession = new Map();
// The last few sends per session, so one the daemon refuses can go back in the composer
const sentBySession = new Map();
// The mounted composer's restore hook, per session
const mounts = new Map();
let nextId = 0;

// Something ready to send — what turns Send on with an empty composer.
export function hasReadyAttachments(sessionId) {
  const list = pendingBySession.get(sessionId) ?? [];
  return list.length > 0 && !list.some((a) => a.preparing);
}

export function rememberSent(sessionId, clientId, text, items) {
  sentBySession.set(sessionId, [...(sentBySession.get(sessionId) ?? []), { clientId, text, items }].slice(-5));
}

// A refused message's attachments go back in the tray and its text into an empty composer.
// Returns false for a clientId this tab didn't send.
export function restoreRefused(sessionId, clientId) {
  const recent = sentBySession.get(sessionId) ?? [];
  const sent = recent.find((s) => s.clientId === clientId);
  if (!sent) return false;
  sentBySession.set(sessionId, recent.filter((s) => s !== sent));
  if (sent.items.length) {
    pendingBySession.set(sessionId, [...sent.items, ...(pendingBySession.get(sessionId) ?? [])].slice(0, MAX_ATTACHMENTS));
  }
  mounts.get(sessionId)?.(sent.text);
  return true;
}

function trayHtml(list, error) {
  const items = list.map((a) => {
    const body = a.preparing
      ? `<span class="sv-attachment-busy" aria-label="Preparing ${escapeHtml(a.name)}">…</span>`
      : a.kind === 'image'
        ? `<img src="${escapeHtml(a.preview)}" alt="${escapeHtml(a.name)}">`
        : `<span class="sv-attachment-file">📄 ${escapeHtml(a.name)}</span>`;
    return `<span class="sv-attachment">${body}` +
      `<button type="button" class="sv-attachment-remove" data-remove="${a.id}" aria-label="Remove ${escapeHtml(a.name)}">×</button></span>`;
  });
  const err = error ? `<span class="sv-attachment-error" role="alert">${escapeHtml(error)}</span>` : '';
  return items.join('') + err;
}

// `onChange` repaints Send/Stop when the list changes; `onRestoreText` puts a refused message's
// text back. Every listener sits on mount-owned DOM, so it goes away with the mount.
export function wireAttachments(dom, sessionId, onChange, onRestoreText) {
  let error = '';
  const list = () => pendingBySession.get(sessionId) ?? [];
  const render = () => {
    dom.attachments.innerHTML = trayHtml(list(), error);
    dom.attachments.hidden = list().length === 0 && !error;
  };
  const set = (next) => {
    if (next.length) pendingBySession.set(sessionId, next);
    else pendingBySession.delete(sessionId);
    render();
    onChange();
  };
  mounts.set(sessionId, (text) => {
    error = '';
    render();
    onRestoreText(text);
    onChange();
  });

  // Checked once prepared: a 12 MB HEIC photo is a fraction of that after downscaling
  const fitsMessage = (id, ready) => {
    const others = list().reduce((n, a) => (a.id === id || a.preparing ? n : n + attachmentBytes(a)), 0);
    return others + attachmentBytes(ready) <= MAX_MESSAGE_ATTACHMENT_BYTES;
  };

  const add = (files) => {
    error = '';
    const room = MAX_ATTACHMENTS - list().length;
    if (files.length > room) error = `Up to ${MAX_ATTACHMENTS} attachments per message.`;
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = String(++nextId);
      set([...list(), { id, name: file.name || 'file', preparing: true }]);
      prepareAttachment(file).then(
        (ready) => {
          if (fitsMessage(id, ready)) return set(list().map((a) => (a.id === id ? { id, ...ready } : a)));
          error = `Attachments are limited to ${MAX_MESSAGE_ATTACHMENT_BYTES / 1024 / 1024} MB per message.`;
          set(list().filter((a) => a.id !== id));
        },
        (e) => { error = e.message; set(list().filter((a) => a.id !== id)); },
      );
    }
    render();
  };

  const onPick = () => {
    add([...dom.attachInput.files]);
    dom.attachInput.value = ''; // so picking the same photo again still fires `change`
  };
  const onAttachClick = () => dom.attachInput.click();
  const onTrayClick = (e) => {
    const id = e.target.closest('[data-remove]')?.dataset.remove;
    if (!id) return;
    error = '';
    set(list().filter((a) => a.id !== id));
  };
  // Left alone, a pasted image lands in the contenteditable composer as an <img> that send()
  // drops. A copy that also carries text (spreadsheet cells, Keynote) pastes as the text.
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length || [...(e.clipboardData?.types ?? [])].includes('text/plain')) return;
    e.preventDefault();
    add(files);
  };
  const onDragOver = (e) => {
    if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
  };
  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  };

  dom.attach.addEventListener('click', onAttachClick);
  dom.attachInput.addEventListener('change', onPick);
  dom.attachments.addEventListener('click', onTrayClick);
  dom.composer.addEventListener('paste', onPaste);
  dom.composerWrap.addEventListener('dragover', onDragOver);
  dom.composerWrap.addEventListener('drop', onDrop);
  render();

  return {
    // Still decoding/downscaling — sending now would drop it.
    busy: () => list().some((a) => a.preparing),
    take: () => {
      const taken = list();
      error = '';
      set([]);
      return taken;
    },
  };
}
