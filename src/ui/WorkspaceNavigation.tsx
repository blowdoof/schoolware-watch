import { useEffect, useRef, useState } from 'react';
import { agendaStatus, connectionHealth, sharingStatus, type ConnectionStatus } from './ConnectionNotice';
import { StatusIcon } from './StatusIcon';

const sections = [ ['todo', 'To-do'], ['schoolbag', 'Boekentas'], ['agenda', 'Agenda'],
  ['special-days', 'Speciale dagen'], ['history', 'Geschiedenis'], ['status', 'Controle en sync'] ] as const;

const settingsSections = [['connection', 'Schoolware'], ['preferences', 'Meldingen'],
  ['sharing', 'Delen'], ['privacy', 'Privacy'], ['activity', 'Activiteitenlog']] as const;

export function WorkspaceNavigation({ full, settings = false, snapshot }: { full: boolean; settings?: boolean; snapshot: ConnectionStatus }) {
  const prefix = settings ? 'settings' : 'overview';
  const chapters = settings ? settingsSections : sections.filter(([id]) => full || !['agenda', 'history'].includes(id));
  const [active, setActive] = useState<string>(settings ? 'connection' : 'todo');
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rail = full && window.matchMedia('(min-width: 1280px)').matches;
        const heading = document.getElementById(`${prefix}-${settings ? 'connection' : 'todo'}`);
        const scrollOffset = heading ? parseFloat(getComputedStyle(heading).scrollMarginTop) : 240;
        const boundary = rail ? 90 : Math.max((navigation.current?.getBoundingClientRect().bottom ?? 140) + 20, scrollOffset + 1);
        const visible = (settings ? settingsSections : sections.filter(([id]) => full || !['agenda', 'history'].includes(id)))
          .map(([id]) => ({ id, element: document.getElementById(`${prefix}-${id}`) }))
          .filter(({ element }) => element && element.getClientRects().length);
        const current = visible.find(({ element }) => {
          const rect = element!.getBoundingClientRect();
          return rect.top <= boundary && rect.bottom > boundary;
        });
        if (current) setActive(current.id);
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [full, settings, prefix]);
  function open(id: string) {
    const section = document.getElementById(`${prefix}-${id}`) as HTMLDetailsElement | null;
    if (!section) return;
    setActive(id);
    section.open = true;
    section.querySelector('summary')?.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <nav ref={navigation} aria-label="Snel naar onderdeel" className={`workspace-navigation${full ? ' workspace-navigation--full' : ''}`}>
    <div className="workspace-navigation-status" aria-label="Actuele controles en synchronisatie">
      <button type="button" className="workspace-status-link" aria-controls={settings ? 'settings-connection' : 'overview-status'}
        onClick={() => open(settings ? 'connection' : 'status')} title={snapshot.error ? 'Status kon niet worden geladen' : snapshot.connection ? connectionHealth(snapshot.connection) : 'Schoolware-status nog niet bekend'}>
        <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-12 5 2 2 4-4" /></svg>
        <span>Schoolware</span><StatusIcon status={agendaStatus(snapshot.connection, snapshot.error)} label={snapshot.error ? 'Schoolware-status niet beschikbaar' : snapshot.connection ? connectionHealth(snapshot.connection) : 'Schoolware-status nog niet bekend'} />
      </button>
      <button type="button" className="workspace-status-link" aria-controls={settings ? 'settings-sharing' : 'overview-status'}
        onClick={() => open(settings ? 'sharing' : 'status')}>
        <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5m-4 9a8 8 0 0 0 14 2l3-3m0 5v-5h-5" /></svg>
        <span>Delen{snapshot.sync && !snapshot.sync.enabled ? ' uit' : ''}</span><StatusIcon status={sharingStatus(snapshot.sync, snapshot.error)} label={snapshot.error ? 'Deelstatus niet beschikbaar' : !snapshot.sync ? 'Deelstatus nog niet bekend' : !snapshot.sync.enabled ? 'Delen tussen toestellen staat uit' : ({ busy: 'Synchronisatie bezig', ok: 'Laatste synchronisatie geslaagd', issue: 'Probleem bij synchronisatie; open de details', unknown: 'Synchronisatie nog niet volledig bevestigd' })[sharingStatus(snapshot.sync, false)]} />
      </button>
    </div>
    {chapters.map(([id, title]) =>
      <button key={id} type="button" aria-controls={`${prefix}-${id}`} aria-current={active === id ? 'location' : undefined} onClick={() => open(id)}
        className="rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">{title}</button>)}
  </nav>;
}
