import { escapeHtml } from './text';

/**
 * Live forms: a `<form class="live">` is sent as soon as one of its fields changes (typing in a
 * text or number field waits for a pause), without leaving the page. The server answers JSON
 * `{ message, error, reload? }`; the message shows in `#live-flash` (`reload`: the change reshapes
 * the page, which is reloaded). Without JavaScript the form still
 * posts the usual way.
 */
export const LIVE_FORMS_JS = `
  (() => {
    const timers = new WeakMap();
    const flash = (message, error) => {
      const slot = document.getElementById('live-flash');
      if (!slot) return;
      slot.replaceChildren();
      if (!message) return;
      const box = document.createElement('div');
      box.className = error ? 'live-flash error' : 'live-flash';
      box.textContent = message;
      slot.append(box);
    };
    const send = async (form) => {
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      form.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new URLSearchParams(new FormData(form)),
          headers: { Accept: 'application/json' },
        });
        if (!(response.headers.get('content-type') || '').includes('json')) {
          location.reload();
          return;
        }
        const { message, error, reload } = await response.json();
        if (reload && !error) {
          location.reload();
          return;
        }
        flash(message, error || !response.ok);
      } catch (error) {
        flash('Échec de l’envoi, réessayez', true);
      } finally {
        form.removeAttribute('aria-busy');
      }
    };
    const typed = (field) => field.matches('input[type="number"], input[type="text"], input:not([type])');
    document.addEventListener('input', (event) => {
      const form = event.target.closest('form.live');
      if (!form || !typed(event.target)) return;
      clearTimeout(timers.get(form));
      timers.set(form, setTimeout(() => send(form), 600));
    });
    document.addEventListener('change', (event) => {
      const form = event.target.closest('form.live');
      if (!form) return;
      clearTimeout(timers.get(form));
      send(form);
    });
    document.addEventListener('submit', (event) => {
      if (!event.target.matches('form.live')) return;
      event.preventDefault();
      send(event.target);
    });
  })();
`;

export const LIVE_FORMS_CSS = `
  form.live { margin: 0; }
  form.live[aria-busy='true'] { opacity: 0.5; }
  .live-flash { background: var(--tone-info-bg); color: var(--tone-info-text); padding: 10px 14px; border-left: 4px solid var(--tone-info-border); border-radius: 4px; margin-bottom: 12px; }
  .live-flash.error { background: var(--tone-danger-bg); color: var(--tone-danger-text); border-left-color: var(--tone-danger-border); }
`;

/** Where live forms show the server's answer; a message passed here shows on load (a plain post). */
export const liveFlashSlot = (message?: string, error = false): string =>
  `<div id="live-flash">${message ? `<div class="live-flash${error ? ' error' : ''}">${escapeHtml(message)}</div>` : ''}</div>`;
