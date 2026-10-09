import { useEffect, useRef, useState } from 'react';
import type { TaskStatus } from '../domain/tasks';
import { validateTasksView, type TasksView } from '../shared/tasks';
import type { ConnectionMessage } from '../shared/connection';

async function send(message: ConnectionMessage): Promise<TasksView> {
  const view = validateTasksView(await chrome.runtime.sendMessage(message) as unknown);
  if (!view?.ok) throw new Error('Tasks unavailable');
  return view;
}

export function useTasks(refreshToken: number, enabled = true) {
  const [view, setView] = useState<TasksView | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const saving = useRef(false);
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  useEffect(() => {
    if (!enabled || !available || saving.current) return;
    let mounted = true;
    const current = ++revision.current;
    void send({ type: 'tasks.read' }).then((next) => {
      if (mounted && revision.current === current) { setView(next); setError(''); }
    }).catch(() => { if (mounted && revision.current === current) setError('De taken konden niet worden geladen.'); });
    return () => { mounted = false; };
  }, [refreshToken, available, enabled]);
  async function updateMany(itemIds: string[], status: TaskStatus) {
    if (saving.current || !itemIds.length) return;
    saving.current = true;
    setWorking(true);
    setError('');
    const current = ++revision.current;
    try {
      // One worker-owned transaction keeps the selection, logs and outbox
      // durable together even when the popup closes before the reply arrives.
      const next = await send(itemIds.length === 1 ? { type: 'tasks.update', itemId: itemIds[0]!, status } :
        { type: 'tasks.updateMany', itemIds, status });
      if (revision.current === current) setView(next);
    } catch { if (revision.current === current) setError('De taakstatus kon niet worden opgeslagen. Vernieuw het overzicht en probeer opnieuw.'); }
    finally { saving.current = false; setWorking(false); }
  }
  async function update(itemId: string, status: TaskStatus) {
    await updateMany([itemId], status);
  }
  async function updateHelp(itemId: string, needed: boolean, recipients: string[]) {
    if (saving.current) return;
    saving.current = true; setWorking(true); setError('');
    const current = ++revision.current;
    try {
      const next = await send({ type: 'tasks.help', itemId, needed, recipients });
      if (revision.current === current) setView(next);
    } catch { if (revision.current === current) setError('De hulpvraag kon niet worden opgeslagen. Vernieuw het overzicht en probeer opnieuw.'); }
    finally { saving.current = false; setWorking(false); }
  }
  return { view, working, error, update, updateMany, updateHelp, available };
}
