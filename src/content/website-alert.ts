import { browserAlertsText, validateBrowserAlertsView, type BrowserAlertsView } from '../shared/browser-alerts';

// This isolated-world script only creates its own generic UI. It never reads
// page text/forms, accesses connection storage, or bridges page-window messages.
const state = globalThis as typeof globalThis & { schoolwareAlertAttached?: boolean };
if (!state.schoolwareAlertAttached) {
  state.schoolwareAlertAttached = true;
  const host = document.createElement('schoolware-watch-alert');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px;
      width: min(360px, calc(100vw - 32px)); color-scheme: light; font: 14px/1.6 system-ui, sans-serif; }
    section { box-sizing: border-box; padding: 18px; color: #0f172a; background: #f0fdfa;
      border: 1px solid #5eead4; border-radius: 14px; box-shadow: 0 8px 32px #0003; }
    p { margin: 8px 0 0; } strong { font-size: 15px; } .actions { display: flex; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
    button { font: inherit; cursor: pointer; border: 1px solid #0f766e; border-radius: 8px;
      padding: 6px 12px; background: white; color: #0f766e; } button:focus-visible { outline: 3px solid #0f766e; outline-offset: 2px; }
    button.alert { display: block; width: 100%; text-align: left; margin-top: 10px; padding: 10px; }
    .alerts { max-height: min(50vh, 420px); overflow-y: auto; }
    .error { color: #b91c1c; }
  `);
  shadow.adoptedStyleSheets = [sheet];
  let revision = 0;
  let previous = '';
  let reported = '';

  function report(view: BrowserAlertsView) {
    const ids = view.entries.map((alert) => alert.id);
    const fingerprint = JSON.stringify(ids);
    if (!document.hidden && host.isConnected && view.enabled && ids.length && fingerprint !== reported) {
      reported = fingerprint;
      // Report DOM construction, not proof that a person saw the banner.
      void chrome.runtime.sendMessage({ type: 'browser.alerts.rendered', alertIds: ids }).catch(() => { reported = ''; });
    }
  }

  function render(view: BrowserAlertsView) {
    const serialized = JSON.stringify(view);
    if (serialized === previous) { report(view); return; }
    previous = serialized;
    shadow.replaceChildren();
    if (!view.enabled || !view.entries.length) { host.remove(); reported = ''; return; }
    const section = document.createElement('section');
    section.setAttribute('role', 'status');
    section.setAttribute('aria-label', 'Schoolware Watch browsermeldingen');
    const title = document.createElement('strong');
    title.textContent = `Schoolware Watch · ${view.entries.length} melding(en)`;
    const alerts = document.createElement('div'); alerts.className = 'alerts';
    const actions = document.createElement('div'); actions.className = 'actions';
    const error = document.createElement('p'); error.className = 'error';
    function act(message: { type: 'browser.alerts.open' | 'browser.alerts.dismiss'; alertId?: string }) {
      void chrome.runtime.sendMessage(message).then((raw: unknown) => {
        const next = validateBrowserAlertsView(raw);
        if (!next?.ok) throw new Error('Browser alerts unavailable');
        void refresh();
      }).catch(() => { error.textContent = 'De actie kon niet worden uitgevoerd. Herlaad deze pagina en probeer opnieuw.'; });
    }
    for (const alert of view.entries) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'alert';
      button.textContent = `${browserAlertsText([alert])} ${alert.kind === 'todo' ? 'To-do overzicht openen.' : alert.test ? 'Voorbeeld van lesdetails openen.' : 'Lesdetails openen.'}`;
      button.addEventListener('click', (event) => {
        if (event.isTrusted) act({ type: 'browser.alerts.open', alertId: alert.id });
      });
      alerts.append(button);
    }
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Sluiten';
    close.addEventListener('click', (event) => {
      if (event.isTrusted) act({ type: 'browser.alerts.dismiss' });
    });
    actions.append(close);
    section.append(title, alerts, actions, error);
    shadow.append(section);
    if (!host.isConnected) document.documentElement.append(host);
    report(view);
  }

  async function refresh() {
    const current = ++revision;
    try {
      const raw: unknown = await chrome.runtime.sendMessage({ type: 'browser.alerts.read' });
      const view = validateBrowserAlertsView(raw);
      if (current === revision && view?.ok) render(view);
    } catch { if (current === revision) { host.remove(); previous = ''; } }
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id === chrome.runtime.id && !sender.tab && message && typeof message === 'object' &&
        Object.keys(message).length === 1 && (message as Record<string, unknown>).type === 'browser.alerts.updated') void refresh();
  });
  // Also hide an existing banner when the page is revisited after permissions
  // were revoked and the worker can no longer send tab invalidations.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  void refresh();
}
