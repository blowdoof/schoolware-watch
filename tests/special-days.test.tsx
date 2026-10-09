import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { openDB } from 'idb';
import { validateSpecialDay, validateSpecialDays } from '../src/domain/special-days';
import { validateSpecialDaysView } from '../src/shared/special-days';
import { validateConnectionMessage } from '../src/shared/connection';
import { compareObservations } from '../src/domain/observations';
import { availablePackingChoices, packingChoiceId, schoolbagOverview, type BagPoint } from '../src/domain/schoolbag';
import { createSchoolbagView, validateSchoolbagView } from '../src/shared/schoolbag';
import { specialReminderPlan, specialReminderKey } from '../src/domain/special-day-reminders';
import { HistoryRepository } from '../src/storage/history';
import { SpecialDaysOverview } from '../src/ui/SpecialDaysPanel';
import { check } from './fixtures/observations';
import { specialDay } from './fixtures/special-days';
import { SchoolbagOverview } from '../src/ui/SchoolbagPanel';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
const friday = new Date('2026-10-09T10:00:00Z');
const bagPoint = (day: string, overrides: Partial<BagPoint> = {}): BagPoint => ({ id: crypto.randomUUID(), day, subject: 'Synthetic subject',
  title: 'Lesson', instructions: 'Boek pagina 10', category: 'other', typePunt: 2, status: 'done', ...overrides });

describe('special days validation and book bag', () => {
  it('bounds free text and checklist and rejects impossible dates, duplicates and extra fields', () => {
    const entry = specialDay();
    expect(validateSpecialDay(entry)).toEqual(entry);
    for (const changes of [{ day: '2026-02-30' }, { title: ' ' }, { notes: 'x'.repeat(4001) }, { preparationDay: '2026-10-13' },
      { unexpected: 'value' }, { revision: -1 }, { checklist: [entry.checklist[0], entry.checklist[0]] }]) expect(validateSpecialDay({ ...entry, ...changes })).toBeNull();
    expect(validateSpecialDays([entry, specialDay()])).toBeNull();
    expect(validateConnectionMessage({ type: 'specialDays.save', profileId: crypto.randomUUID(), entry })).not.toBeNull();
    expect(validateConnectionMessage({ type: 'specialDays.save', entry, sourceId: 'synthetic' })).toBeNull();
    expect(validateSpecialDaysView({ ok: true, connected: false, profileId: null, entries: [entry] })).toBeNull();
  });
  it('includes all Monday lesson material on the explicit Friday preparation date, regardless of completion', () => {
    const entry = specialDay();
    const agenda = { lastSuccessAt: friday.toISOString(), specialDays: [entry], points: [bagPoint('2026-10-09'), bagPoint('2026-10-12')] };
    const overview = schoolbagOverview(agenda, friday, '2026-10-09');
    expect(overview.homeworkPoints).toHaveLength(1);
    expect(overview.homework.map((item) => item.label)).toEqual(['Boek', 'All folders and charger']);
    expect(overview.preparations).toEqual([entry]);
    const evening = schoolbagOverview(agenda, new Date('2026-10-09T18:00:00Z'));
    expect(evening.targetDay).toBe('2026-10-12');
    expect(evening.homePackingDay).toBe('2026-10-09');
    expect(evening.preparations).toEqual([entry]);
    expect(schoolbagOverview(agenda, friday, '2026-10-12').school.map((item) => item.label)).toEqual(['Boek', 'All folders and charger']);
    expect(schoolbagOverview({ ...agenda, specialDays: [] }, friday, '2026-10-09').homework).toHaveLength(0);
  });
  it('shows Monday home study at Friday 21:24 while preserving Friday bring-home choices and full Monday material', async () => {
    const now = new Date('2026-10-09T19:24:00Z');
    const entry = specialDay();
    const fridayLesson = bagPoint('2026-10-09', { subject: 'Synthetic Friday', instructions: 'Atlas' });
    const mondayLesson = bagPoint('2026-10-12', { subject: 'Synthetic Monday', instructions: 'Werkboek', status: 'done' });
    const agenda = { lastSuccessAt: now.toISOString(), specialDays: [entry], points: [fridayLesson, mondayLesson] };
    const evening = schoolbagOverview(agenda, now);
    expect(evening.targetDay).toBe('2026-10-12');
    expect(evening.special).toEqual(entry);
    expect(evening.schoolPoints).toEqual([mondayLesson]);
    expect(evening.homePackingDay).toBe('2026-10-09');
    expect(evening.homeDay).toBe('2026-10-12');
    expect(evening.homeworkPoints).toEqual([mondayLesson]);
    expect(evening.school.map((material) => material.label)).toEqual(['Werkboek', 'All folders and charger']);
    expect(evening.homework.map((material) => material.label)).toEqual(['Werkboek', 'All folders and charger']);
    const fridayHome = schoolbagOverview(agenda, now, '2026-10-09');
    const choices = await availablePackingChoices(agenda, now);
    for (const material of [null, ...evening.homework]) {
      const id = await packingChoiceId(evening.homePackingDay!, 'home', material);
      expect(choices.get(id)).toBe('2026-10-09');
      if (material) expect(id).toBe(await packingChoiceId('2026-10-09', 'home', fridayHome.homework.find((point) => point.key === material.key)!));
    }
    const html = renderToStaticMarkup(<SchoolbagOverview now={now} view={{ ok: true, ...agenda }} />);
    expect(html).toContain('Nodig voor thuisstudie');
    expect(html).toContain('Voor maandag 12 oktober');
    expect(html).toContain('Meenemen naar huis op vrijdag 9 oktober');
    expect(html).not.toContain('Voor vrijdag 9 oktober');
  });
  it('keeps the 16:00 transition and explicit selections separate from preparation-only dates', () => {
    const entry = specialDay();
    const agenda = { lastSuccessAt: friday.toISOString(), specialDays: [entry], points: [bagPoint('2026-10-09'), bagPoint('2026-10-12')] };
    expect(schoolbagOverview(agenda, new Date('2026-10-09T13:59:00Z')).targetDay).toBe('2026-10-09');
    expect(schoolbagOverview(agenda, new Date('2026-10-09T14:00:00Z')).targetDay).toBe('2026-10-12');
    const explicit = schoolbagOverview(agenda, new Date('2026-10-09T19:24:00Z'), '2026-10-09');
    expect(explicit.targetDay).toBe('2026-10-09'); expect(explicit.homePackingDay).toBe('2026-10-09');
    const saturday = schoolbagOverview(agenda, new Date('2026-10-10T12:00:00Z'));
    expect(saturday.targetDay).toBe('2026-10-12'); expect(saturday.preparations).toEqual([]);
    const preparationOnly = schoolbagOverview({ ...agenda, points: [bagPoint('2026-10-12')] }, new Date('2026-10-09T19:24:00Z'));
    expect(preparationOnly.targetDay).toBe('2026-10-12'); expect(preparationOnly.homePackingDay).toBe('2026-10-09');
  });
  it('supports a sports day without a known Schoolware day and suppresses timetable packing only on that date', () => {
    const entry = specialDay({ kind: 'sports', useTimetable: false });
    const agenda = { lastSuccessAt: friday.toISOString(), specialDays: [entry], points: [bagPoint('2026-10-12')] };
    const overview = schoolbagOverview(agenda, friday, entry.day);
    expect(overview.schoolPoints).toEqual([]);
    expect(overview.school.map((item) => item.label)).toEqual(['All folders and charger']);
    expect(schoolbagOverview({ ...agenda, points: [] }, friday, entry.day).targetDay).toBe(entry.day);
    expect(schoolbagOverview(agenda, friday, '2026-10-09').homeworkPoints).toEqual([]);
  });
  it('does not let a preparation-only weekend date hide homework for the next observed Monday', () => {
    const entry = specialDay({ day: '2026-10-13', preparationDay: '2026-10-11' });
    const agenda = { lastSuccessAt: friday.toISOString(), specialDays: [entry], points: [bagPoint('2026-10-09'),
      bagPoint('2026-10-12', { category: 'assignments', typePunt: 1001, status: 'open' })] };
    const overview = schoolbagOverview(agenda, friday, '2026-10-09');
    expect(overview.days).toContain('2026-10-11');
    expect(overview.homeDay).toBe('2026-10-12');
    expect(overview.homeworkPoints).toHaveLength(1);
  });
  it('projects only local display data, validates it and escapes special-day markup', () => {
    const entry = specialDay({ title: '<script>synthetic</script>' });
    const scope = { ...compareObservations(null, check()), specialDays: [entry] };
    const view = createSchoolbagView(scope);
    expect(validateSchoolbagView(view)).toEqual(view);
    expect(validateSchoolbagView({ ...view, specialDays: [{ ...entry, kind: 'unknown' }] })).toBeNull();
    expect(JSON.stringify(view)).not.toContain(scope.scopeId);
    const html = renderToStaticMarkup(<SpecialDaysOverview view={{ ok: true, connected: true, profileId: crypto.randomUUID(), entries: [entry] }} now={friday} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).toContain('Voorbereiden / meenemen naar huis');
  });
});

describe('durable isolated special day edits', () => {
  it('preserves v3 history, status and observations through edits, fresh checks and repository restart', async () => {
    const name = 'synthetic-special-days';
    const repo = new HistoryRepository(name);
    await repo.record(check());
    const before = (await repo.read(check().scopeId, '2026-10-09T10:00:00Z')).scope!;
    // Fixtures own the scope identity; no new IndexedDB store or migration is needed.
    const scopeId = check().scopeId;
    const entry = specialDay();
    await repo.saveSpecialDay(scopeId, entry);
    const saved = (await new HistoryRepository(name).read(scopeId, '2026-10-09T10:00:00Z')).scope!;
    expect(saved.specialDays?.[0]?.revision).toBe(1);
    await expect(repo.saveSpecialDay(scopeId, entry)).rejects.toThrow('changed');
    await expect(repo.deleteSpecialDay(scopeId, entry.id, 2)).rejects.toThrow('changed');
    await expect(repo.saveSpecialDay(scopeId, specialDay())).rejects.toThrow('changed');
    await expect(repo.saveSpecialDay('synthetic-other-profile', entry)).rejects.toThrow('unavailable');
    await repo.record(check({ checkId: 'synthetic-next-check', observedAt: '2026-10-09T11:00:00Z' }));
    const refreshed = (await repo.read(scopeId, '2026-10-09T12:00:00Z')).scope!;
    expect(refreshed.specialDays).toEqual(saved.specialDays);
    expect(refreshed.items[0]?.taskStatus).toBe(saved.items[0]?.taskStatus);
    expect(saved.events).toEqual(before.events);
    expect(saved.checks).toEqual(before.checks);
    expect(await repo.claimSpecialDayReminder(scopeId, specialReminderKey(entry), '2026-10-09T14:00:00Z')).toBe(true);
    expect(await new HistoryRepository(name).claimSpecialDayReminder(scopeId, specialReminderKey(entry), '2026-10-09T14:01:00Z')).toBe(false);
    await repo.clearScope(scopeId);
    expect((await repo.read(scopeId, '2026-10-09T14:02:00Z')).scope).toBeNull();
  });
  it('rolls back failed writes without losing the previous checklist', async () => {
    const repo = new HistoryRepository('synthetic-special-rollback');
    await repo.record(check());
    const entry = specialDay(); await repo.saveSpecialDay(check().scopeId, entry);
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('Synthetic storage failure'); });
    try { await expect(repo.saveSpecialDay(check().scopeId, { ...entry, revision: 1, notes: 'Changed' })).rejects.toThrow(); } finally { failure.mockRestore(); }
    expect((await repo.read(check().scopeId, '2026-10-09T12:00:00Z')).scope?.specialDays?.[0]?.notes).toBe(entry.notes);
    await repo.deleteSpecialDay(check().scopeId, entry.id, 1);
    expect((await repo.read(check().scopeId, '2026-10-09T12:00:00Z')).scope?.specialDays).toEqual([]);
  });
  it('adds optional data to an existing v3 database and prunes past events under retention controls', async () => {
    const name = 'synthetic-special-v3';
    const repo = new HistoryRepository(name); await repo.record(check());
    const legacy = await openDB(name, 3); expect((await legacy.get('scopes', check().scopeId)).specialDays).toBeUndefined(); legacy.close();
    await repo.saveSpecialDay(check().scopeId, specialDay({ day: '2026-01-01', preparationDay: null }));
    expect((await repo.read(check().scopeId, '2026-10-09T12:00:00Z')).scope?.specialDays).toEqual([]);
    await repo.clearAll(); expect((await repo.read(check().scopeId)).scope).toBeNull();
  });
});

describe('Brussels special day reminders', () => {
  it('schedules Friday at 16 Brussels, retries same-day startup and never repeats claimed or expired reminders', () => {
    const entry = specialDay();
    expect(specialReminderPlan([entry], [], friday).nextAt).toBe(Date.parse('2026-10-09T14:00:00Z'));
    expect(specialReminderPlan([entry], [], new Date('2026-10-09T14:00:00Z')).due).toEqual([entry]);
    expect(specialReminderPlan([entry], [specialReminderKey(entry)], new Date('2026-10-09T14:00:00Z')).nextAt).toBeNull();
    expect(specialReminderPlan([entry], [], new Date('2026-10-10T10:00:00Z')).nextAt).toBeNull();
    const winter = specialDay({ day: '2026-11-02', preparationDay: '2026-10-30' });
    expect(specialReminderPlan([winter], [], friday).nextAt).toBe(Date.parse('2026-10-30T15:00:00Z'));
    const noPreparation = specialDay({ preparationDay: null });
    expect(specialReminderPlan([noPreparation], [], friday).nextAt).toBe(Date.parse('2026-10-12T14:00:00Z'));
  });
});
