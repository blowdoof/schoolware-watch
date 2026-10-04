import type { TaskStatus } from '../domain/tasks';

export const taskStatusLabels: Record<TaskStatus, string> = { open: 'Open', 'in-progress': 'Bezig', done: 'Klaar' };
export function TaskControls({ status, disabled, onChange }: {
  status: TaskStatus; disabled: boolean; onChange: (status: TaskStatus) => void;
}) {
  return <fieldset disabled={disabled} className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
    <legend className="sr-only">Lokale taakstatus</legend>
    <span className="font-medium">{taskStatusLabels[status]}</span>
    <label className="flex items-center gap-2"><input type="checkbox" checked={status === 'in-progress'}
      onChange={(event) => onChange(event.target.checked ? 'in-progress' : 'open')} />Bezig</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={status === 'done'}
      onChange={(event) => onChange(event.target.checked ? 'done' : 'open')} />Klaar</label>
  </fieldset>;
}
