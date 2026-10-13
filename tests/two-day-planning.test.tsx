import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { todoOverview, todoPlanningProposal } from '../src/domain/todo';
import { validateTasksView, createTasksView, type TaskEntry, type TasksView } from '../src/shared/tasks';
import { TodoOverview } from '../src/ui/TodoPanel';
import { compareObservations } from '../src/domain/observations';
import { point, check } from './fixtures/observations';
import { specialDay } from './fixtures/special-days';

const now = new Date('2026-10-09T17:00:00Z');
function task(day: string, category: TaskEntry['category'] = 'assignments', overrides: Partial<TaskEntry> = {}): TaskEntry {
  return { id: crypto.randomUUID(), category, subject: 'Synthetic subject', room: '', status: 'open', updatedAt: null,
    firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(),
    snapshot: { ...point.snapshot, title: 'Synthetic work', typePunt: category === 'tests' ? 100 : category === 'review' ? 9 : 1001,
      startsAt: `${day} 09:00:00`, endsAt: `${day} 09:50:00` }, ...overrides };
}
const view = (entries: TaskEntry[]): TasksView => ({ ok: true, entries, agenda: { days: ['2026-10-12', '2026-10-13', '2026-10-14'], lastSuccessAt: now.toISOString() } });
const render = (data: TasksView) => renderToStaticMarkup(<TodoOverview view={data} now={now} working={false} update={async () => {}} updateMany={async () => {}} />);

describe('two-school-day planning', () => {
  it('prioritizes next-day work and next-day help before a following-day test, without including later or finished work', () => {
    const homework = task('2026-10-12'); const help = task('2026-10-12', 'review', { help: { needed: true, recipients: [], requestId: crypto.randomUUID() } });
    const test = task('2026-10-13', 'tests');
    const data = view([task('2026-10-14'), task('2026-10-13', 'tests', { status: 'done' }), test, homework, help]);
    const before = JSON.stringify(data);
    expect(todoPlanningProposal(data, now).tasks).toEqual([help, homework, test]);
    expect(todoOverview(data, now).following).toEqual([test]);
    expect(JSON.stringify(data)).toBe(before);
    expect(render(data)).toContain('Voorstel voor je planning');
    expect(render(data)).toContain('Daarna: dinsdag 13 oktober');
  });
  it('shows uncertainty only for open marked work within the chosen two days', () => {
    const relevant = task('2026-10-13', 'tests', { missingFromLatestCheck: true });
    const old = task('2026-10-07', 'assignments', { missingFromLatestCheck: true }); old.snapshot.title = 'Synthetic old unconfirmed';
    const later = task('2026-10-14', 'assignments', { missingFromLatestCheck: true }); later.snapshot.title = 'Synthetic later unconfirmed';
    const data = view([old, later, relevant, task('2026-10-12', 'tests', { status: 'done', missingFromLatestCheck: true })]);
    expect(todoOverview(data, now).unconfirmed).toEqual([relevant]);
    expect(todoPlanningProposal(data, now).tasks).toEqual([]);
    expect(render(data)).toContain('Niet teruggevonden bij laatste controle (1)');
    expect(render(data)).not.toContain(old.snapshot.title);
    expect(render(data)).not.toContain(later.snapshot.title);
  });
  it('uses explicitly configured home study as a known weekday and includes preparation today', () => {
    const data: TasksView = { ok: true, entries: [task('2026-10-12')], specialDays: [specialDay()] };
    expect(todoOverview(data, now).targetDay).toBe('2026-10-12');
    expect(todoPlanningProposal(data, now).preparations).toEqual(data.specialDays);
    expect(render(data)).toContain('boeken en kaften thuis');
    expect(todoOverview({ ...data, specialDays: [specialDay({ day: '2026-10-10' })] }, now).targetDay).toBeNull();
  });
  it('retains special-day validation and local projection without inventing unknown school days', () => {
    const scope = compareObservations(null, check()); scope.specialDays = [specialDay()];
    const data = createTasksView(scope);
    expect(validateTasksView(data)).toEqual(data);
    expect(validateTasksView({ ...data, specialDays: [{ ...scope.specialDays[0], day: 'invalid' }] })).toBeNull();
    expect(todoOverview({ ok: true, entries: [] }, now).dayAfter).toBeNull();
  });
  it('moves the advice window with manual browsing instead of mixing the first and selected day', () => {
    const monday = task('2026-10-12'); const tuesday = task('2026-10-13'); const wednesday = task('2026-10-14');
    expect(todoPlanningProposal(view([monday, tuesday, wednesday]), now, '2026-10-13').tasks).toEqual([tuesday, wednesday]);
  });
});
