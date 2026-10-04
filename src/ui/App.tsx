import { ConnectionPanel } from './ConnectionPanel';
import { ConnectionNotice } from './ConnectionNotice';
import { HistoryPanel } from './HistoryPanel';
import { useEffect, useState } from 'react';
import { PreferencesPanel } from './PreferencesPanel';
import { NotificationDetailsPanel } from './NotificationDetailsPanel';
import { notificationTarget } from '../shared/notification-details';
import { TasksPanel } from './TasksPanel';
import { ActivityPanel } from './ActivityPanel';
import { HelpPanel } from './HelpPanel';
import { ProgressSyncPanel } from './ProgressSyncPanel';
import { TodoPanel } from './TodoPanel';
import { SchoolbagPanel } from './SchoolbagPanel';
import { InfoPanel, infoSections, type InfoSection } from './InfoPanel';
import type { OpenPageMessage } from '../shared/navigation';

type Page = 'popup' | 'dashboard' | 'options' | 'info';

const titles: Record<Page, string> = {
  popup: 'Je agenda, met een geheugen.',
  dashboard: 'Agenda en voortgang',
  options: 'Instellingen en privacy',
  info: 'Over Schoolware Watch',
};

export function App({ page: initialPage }: { page: Page }) {
  const [page, setPage] = useState(initialPage);
  const [target, setTarget] = useState(() => initialPage === 'dashboard' ? notificationTarget(window.location.search) : null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [infoSection, setInfoSection] = useState<InfoSection>('about');
  const [navigationPending, setNavigationPending] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  function navigate(next: Page) {
    if (initialPage === 'popup' && (next === 'dashboard' || next === 'options') &&
        typeof chrome !== 'undefined' && chrome.runtime?.id) {
      setNavigationPending(true);
      setNavigationError(false);
      void chrome.runtime.sendMessage({ type: 'ui.open', page: next } satisfies OpenPageMessage)
        .then((result: unknown) => {
          if (!result || typeof result !== 'object' || (result as Record<string, unknown>).ok !== true) throw new Error('Navigation unavailable');
          window.close();
        }).catch(() => setNavigationError(true)).finally(() => setNavigationPending(false));
      return;
    }
    setTarget(null);
    setPage(next);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const changed = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local') setHistoryRevision((revision) => revision + 1);
    };
    chrome.storage.onChanged.addListener(changed);
    const taskChanged = (raw: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && !sender.tab && raw && typeof raw === 'object' &&
          Object.keys(raw).length === 1 && (raw as Record<string, unknown>).type === 'tasks.updated') {
        setHistoryRevision((revision) => revision + 1);
      }
    };
    chrome.runtime.onMessage.addListener(taskChanged);
    return () => { chrome.storage.onChanged.removeListener(changed); chrome.runtime.onMessage.removeListener(taskChanged); };
  }, []);
  return (
    <main className={initialPage === 'popup' ? 'w-96 p-6' : 'mx-auto max-w-3xl px-6 pb-12 pt-6'}>
      <nav aria-label="Navigatie" className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 flex justify-end gap-1 bg-slate-50 px-4 py-2 text-teal-700">
        {(page !== 'dashboard' || target) && (
          <button type="button" disabled={navigationPending} aria-label="Overzicht openen" title="Overzicht openen" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-teal-50" onClick={() => navigate('dashboard')}>
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        )}
        {page !== 'options' && (
          <button type="button" disabled={navigationPending} aria-label="Instellingen" title="Instellingen" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-teal-50" onClick={() => navigate('options')}>
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M4 17h16" />
              <circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" />
              <circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" />
            </svg>
          </button>
        )}
        <button type="button" aria-expanded={helpOpen} aria-controls="help-panel"
          aria-label={helpOpen ? 'Hulp sluiten' : 'Hulp'} title={helpOpen ? 'Hulp sluiten' : 'Hulp'}
          onClick={() => setHelpOpen((open) => !open)}
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 ${helpOpen ? 'bg-teal-100' : ''}`}>
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
            <path d="M12 16h.01" />
          </svg>
        </button>
      </nav>
      {navigationError && <p role="alert" className="mb-4 text-sm text-red-700">Het scherm kon niet worden geopend. Probeer opnieuw.</p>}
      <p className="text-xs font-bold uppercase tracking-widest text-teal-700">Schoolware Watch</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{target ? 'Details bij je melding' : titles[page]}</h1>
      {helpOpen && <HelpPanel />}
      {target ? <NotificationDetailsPanel target={target} refreshToken={historyRevision} /> : page === 'info' ?
        <InfoPanel section={infoSection} onSectionChange={setInfoSection} onSettings={() => navigate('options')} /> : <>
      {page === 'options' ?
        <ConnectionPanel showSetup refreshToken={historyRevision} onHistoryChanged={() => setHistoryRevision((revision) => revision + 1)} /> :
        <ConnectionNotice refreshToken={historyRevision} onSettings={() => navigate('options')} navigationPending={navigationPending} />}
      {page === 'popup' && <TodoPanel refreshToken={historyRevision} />}
      {(page === 'popup' || page === 'dashboard') && <SchoolbagPanel refreshToken={historyRevision} />}
      <PreferencesPanel settings={page === 'options'} refreshToken={historyRevision} onSaved={() => setHistoryRevision((revision) => revision + 1)} />
      {page === 'dashboard' && <TasksPanel refreshToken={historyRevision} />}
      {page !== 'popup' && <HistoryPanel settings={page === 'options'} refreshToken={historyRevision} />}
      {page === 'options' && (
        <p className="mt-6 text-sm leading-6 text-slate-600">
          Je agendageschiedenis blijft lokaal in deze browser. Schoolware Watch bewaart geen
          Schoolware-inloggegevens. Je kunt hierboven de bewaartermijn instellen en lokale gegevens wissen.
        </p>
      )}
      </>}
      {page === 'options' && <ProgressSyncPanel refreshToken={historyRevision} />}
      {page === 'options' && <ActivityPanel />}
      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <p>Een onafhankelijk project van Bumper.be</p>
        <nav aria-label="Projectinformatie" className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {(Object.keys(infoSections) as InfoSection[]).map((section) => <button key={section} type="button"
            className="text-teal-700 underline underline-offset-2 hover:text-teal-900"
            onClick={() => { setInfoSection(section); navigate('info'); }}>{infoSections[section]}</button>)}
        </nav>
      </footer>
    </main>
  );
}
