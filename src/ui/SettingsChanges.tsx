import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type SettingsGroup = 'connection' | 'preferences' | 'sharing' | 'privacy';
const labels: Record<SettingsGroup, string> = {
  connection: 'Schoolware-koppeling', preferences: 'Controles en meldingen',
  sharing: 'Delen tussen toestellen', privacy: 'Privacy en bewaren',
};
const ChangesContext = createContext<((group: SettingsGroup, dirty: boolean) => void) | null>(null);

/** Only presentation flags are shared; field values and secrets stay in their forms. */
export function SettingsChangesProvider({ children }: { children: ReactNode }) {
  const [changes, setChanges] = useState<Partial<Record<SettingsGroup, boolean>>>({});
  const report = useCallback((group: SettingsGroup, dirty: boolean) => {
    setChanges(current => current[group] === dirty ? current : { ...current, [group]: dirty });
  }, []);
  const pending = (Object.keys(labels) as SettingsGroup[]).filter(group => changes[group]);
  return <ChangesContext.Provider value={report}>
    {pending.length > 0 && <aside aria-label="Niet-opgeslagen instellingen" role="status" className="settings-unsaved-notice">
      <strong>Er zijn nog niet-opgeslagen wijzigingen.</strong>
      <p className="mt-1 text-xs">Automatische opslag kan nog bezig zijn. Controleer de genoemde onderdelen; bij een fout blijven je wijzigingen hier staan.</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {pending.map(group => <button key={group} type="button" className="font-semibold underline underline-offset-2"
          onClick={() => document.querySelector<HTMLButtonElement>(`.workspace-navigation button[aria-controls="settings-${group}"]`)?.click()}>{labels[group]}</button>)}
      </div>
    </aside>}
    {children}
  </ChangesContext.Provider>;
}

export function useSettingsChanges(group: SettingsGroup, dirty: boolean) {
  const report = useContext(ChangesContext);
  useEffect(() => { report?.(group, dirty); }, [report, group, dirty]);
  useEffect(() => () => { report?.(group, false); }, [report, group]);
}
