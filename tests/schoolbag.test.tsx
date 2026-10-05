import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { agendaText, materialsFor, schoolbagOverview, type BagPoint } from '../src/domain/schoolbag';
import { createSchoolbagView, validateSchoolbagView } from '../src/shared/schoolbag';
import { SchoolbagOverview } from '../src/ui/SchoolbagPanel';
import { compareObservations } from '../src/domain/observations';
import { validateConnectionMessage } from '../src/shared/connection';
import { check, point } from './fixtures/observations';

function bagPoint(overrides: Partial<BagPoint> = {}): BagPoint {
  return { id: crypto.randomUUID(), day: '2026-10-05', subject: 'Aardrijkskunde', title: 'Huiswerk',
    instructions: 'Boek pagina 24-34', category: 'assignments', typePunt: 1001, status: 'open', ...overrides };
}
const now = new Date('2026-10-04T12:00:00Z');

describe('local schoolbag suggestions', () => {
  it('recognizes folder diminutives in titles without separate instructions', () => {
    for (const name of ['map', 'mappen', 'mapje', 'mapjes', 'ringmap', 'ringmappen', 'ringmapje', 'ringmapjes']) {
      const materials = materialsFor([bagPoint({ title: `Neem je ${name} mee voor de oefening`, instructions: '' })]);
      expect(materials.map((item) => item.label)).toEqual(['Map']);
    }
    expect(materialsFor([bagPoint({ title: 'Geen mapje nodig', instructions: '' })])).toEqual([]);
    expect(materialsFor([bagPoint({ title: 'Bekijk de roadmap', instructions: '' })])).toEqual([]);
  });
  it('shows unresolved agenda points immediately without suggesting no material is needed', () => {
    const html = renderToStaticMarkup(<SchoolbagOverview now={now} view={{ ok: true,
      lastSuccessAt: now.toISOString(), points: [bagPoint({ title: 'Herhaal de oefeningen', instructions: '' })] }} />);
    expect(html).toContain('het benodigde materiaal kon nog niet automatisch worden bepaald');
    expect(html).toMatch(/<details open=""/);
    expect(html).not.toContain('Geen materiaalverwijzingen herkend');
  });
  it('extracts Dutch material and page references and keeps subjects separate', () => {
    const materials = materialsFor([bagPoint(), bagPoint({ subject: 'Frans', instructions: 'Werkboek pagina 50–65; schrift meebrengen.' })]);
    expect(materials.map((item) => [item.subject, item.label, item.pages])).toEqual([
      ['Aardrijkskunde', 'Boek', ['pagina 24-34']], ['Frans', 'Schrift', []], ['Frans', 'Werkboek', ['pagina 50–65']],
    ]);
    expect(materials.every((item) => !item.uncertain)).toBe(true);
  });
  it('does not invent a specific book from pages alone or multiple possible books', () => {
    const inferred = materialsFor([bagPoint({ instructions: 'Leren p. 50-65' })]);
    expect(inferred[0]).toMatchObject({ label: 'Paginaverwijzing — materiaal controleren', uncertain: true, pages: ['p. 50-65'] });
    const ambiguous = materialsFor([bagPoint({ title: 'Handboek en werkboek', instructions: 'p. 24-34' })]);
    expect(ambiguous.find((item) => item.uncertain)?.pages).toEqual(['p. 24-34']);
    const named = materialsFor([bagPoint({ title: 'Werkboek', instructions: 'p. 24-34' })]);
    expect(named).toHaveLength(1);
    expect(named[0]?.pages).toEqual(['p. 24-34']);
  });
  it('deduplicates material per subject while preserving all task evidence and page ranges', () => {
    const first = bagPoint();
    const other = bagPoint({ instructions: 'Boek pagina 35-40' });
    const material = materialsFor([first, first, other])[0]!;
    expect(material.sources).toHaveLength(2);
    expect(material.pages).toEqual(['pagina 24-34', 'pagina 35-40']);
  });
  it('excludes negative requirements and retains positive reminders', () => {
    expect(materialsFor([bagPoint({ instructions: 'Geen atlas nodig; boek niet meebrengen; zonder schrift werken' })])).toEqual([]);
    expect(materialsFor([bagPoint({ instructions: 'Vergeet niet je atlas; werkboek niet vergeten' })]).map((item) => item.label)).toEqual(['Atlas', 'Werkboek']);
  });
  it('reads source markup as text, omitting scripts and styles', () => {
    expect(agendaText('<style>boek</style><script>atlas</script><p>Werkboek&nbsp;pagina 24-34</p>')).toBe('Werkboek pagina 24-34\n');
    expect(materialsFor([bagPoint({ instructions: '<script>atlas</script><p>Werkboek pagina 24-34</p>' })]).map((item) => item.label)).toEqual(['Werkboek']);
  });
  it('uses lessons including finished work for school and only pending marked points for home', () => {
    const lesson = bagPoint({ category: 'other', typePunt: 2, instructions: 'Atlas meebrengen' });
    const done = bagPoint({ status: 'done', instructions: 'Werkboek p. 5' });
    const pending = bagPoint({ day: '2026-10-06', status: 'in-progress', instructions: 'Boek p. 9' });
    const view = { lastSuccessAt: now.toISOString(), points: [lesson, done, pending] };
    const result = schoolbagOverview(view, now);
    expect(result.targetDay).toBe('2026-10-05');
    expect(result.school.map((item) => item.label)).toEqual(['Atlas', 'Werkboek']);
    expect(result.homework.map((item) => item.label)).toEqual(['Boek']);
    expect(result.homeworkPoints).toEqual([pending]);
  });
  it('defaults to today in the morning and the next positively observed weekday after 16:00', () => {
    const agenda = { lastSuccessAt: now.toISOString(), points: [bagPoint(), bagPoint({ day: '2026-10-06' }), bagPoint({ day: '2026-10-10' })] };
    expect(schoolbagOverview(agenda, new Date('2026-10-05T05:00:00Z')).targetDay).toBe('2026-10-05');
    const evening = schoolbagOverview(agenda, new Date('2026-10-05T14:00:00Z'));
    expect(evening.targetDay).toBe('2026-10-06');
    expect(evening.homeDay).toBeNull();
    expect(evening.days).not.toContain('2026-10-10');
    expect(schoolbagOverview(agenda, now, '2026-10-09').targetDay).toBe('2026-10-05');
    expect(schoolbagOverview({ points: [], lastSuccessAt: null }, now).targetDay).toBeNull();
  });
  it('does not include the selected day in home packing, on weekends or after 16:00', () => {
    const monday = bagPoint();
    const tuesday = bagPoint({ day: '2026-10-06', subject: 'Frans', instructions: 'Werkboek p. 50' });
    const agenda = { points: [monday, tuesday], lastSuccessAt: now.toISOString() };
    for (const time of ['2026-10-04T18:00:00Z', '2026-10-05T05:00:00Z']) {
      const overview = schoolbagOverview(agenda, new Date(time));
      expect(overview.targetDay).toBe('2026-10-05');
      expect(overview.homeDay).toBe('2026-10-06');
      expect(overview.homeworkPoints).toEqual([tuesday]);
    }
    const evening = schoolbagOverview(agenda, new Date('2026-10-05T18:00:00Z'));
    expect(evening.targetDay).toBe('2026-10-06');
    expect(evening.homeDay).toBeNull();
    expect(evening.homeworkPoints).toEqual([]);
  });
  it('moves the homework horizon to the known school day after the selected lesson day', () => {
    const first = bagPoint(); const later = bagPoint({ day: '2026-10-07', instructions: 'Atlas' });
    const result = schoolbagOverview({ points: [first, later], lastSuccessAt: now.toISOString() }, now, '2026-10-07');
    expect(result.schoolPoints).toEqual([later]);
    expect(result.homeworkPoints).toEqual([]);
    expect(result.homeDay).toBeNull();
    const monday = schoolbagOverview({ points: [first, later], lastSuccessAt: now.toISOString() }, now);
    expect(monday.homeworkPoints).toEqual([later]);
    expect(monday.homeDay).toBe('2026-10-07');
  });
});

describe('schoolbag projection and message validation', () => {
  it('projects only fresh, active points of a supplied scope, including ordinary lessons', () => {
    const scope = compareObservations(null, check());
    scope.items[0]!.localId = crypto.randomUUID();
    scope.items.push({ ...scope.items[0]!, localId: crypto.randomUUID(), category: 'other', sourceKey: 'synthetic-lesson',
      snapshot: { ...point.snapshot, typePunt: 2, instructions: 'Atlas' } });
    scope.items.push({ ...scope.items[0]!, localId: crypto.randomUUID(), lastSeenAt: '2026-10-01T08:00:00Z' });
    scope.items.push({ ...scope.items[0]!, localId: crypto.randomUUID(), snapshot: { ...point.snapshot, cancelled: true } });
    scope.items.push({ ...scope.items[0]!, localId: crypto.randomUUID(), snapshot: { ...point.snapshot, hidden: true } });
    const view = createSchoolbagView(scope);
    expect(view.points).toHaveLength(2);
    expect(validateSchoolbagView(view)).toEqual(view);
    expect(JSON.stringify(view)).not.toContain(check().scopeId);
    expect(JSON.stringify(view)).not.toContain('synthetic-source');
    expect(createSchoolbagView(null)).toEqual({ ok: true, lastSuccessAt: null, points: [] });
  });
  it('rejects malformed views, duplicate IDs and extra request fields', () => {
    const view = { ok: true, lastSuccessAt: now.toISOString(), points: [bagPoint()] };
    expect(validateSchoolbagView({ ...view, points: [...view.points, ...view.points] })).toBeNull();
    expect(validateSchoolbagView({ ...view, lastSuccessAt: null })).toBeNull();
    expect(validateSchoolbagView({ ...view, points: [bagPoint({ day: '2026-02-30' })] })).toBeNull();
    expect(validateSchoolbagView({ ...view, points: [{ ...bagPoint(), status: 'invalid' }] })).toBeNull();
    expect(validateConnectionMessage({ type: 'schoolbag.read' })).toEqual({ type: 'schoolbag.read' });
    expect(validateConnectionMessage({ type: 'schoolbag.read', scopeId: 'other' })).toBeNull();
  });
  it('renders both lists, page ranges and laptop defaults with escaped source evidence', () => {
    const view = { ok: true, lastSuccessAt: now.toISOString(), points: [bagPoint({ title: '<img src=x onerror=alert(1)>', instructions: 'Boek p. 24-34 &lt;img src=x&gt;' })] };
    const markup = renderToStaticMarkup(<SchoolbagOverview view={view} now={now} />);
    expect(markup).toContain('Mee naar school'); expect(markup).toContain('Mee naar huis');
    expect(markup.match(/Altijd meenemen/g)).toHaveLength(2);
    expect(markup).toContain('p. 24-34');
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img');
  });
  it('does not describe missing material or a missing day as a complete packing list', () => {
    const markup = renderToStaticMarkup(<SchoolbagOverview view={{ ok: true, lastSuccessAt: null, points: [] }} now={now} />);
    expect(markup).toContain('Geen volgende lesdag bekend');
    expect(markup).toContain('de opgehaalde agenda geeft hierover geen uitsluitsel');
    const unspecified = renderToStaticMarkup(<SchoolbagOverview view={{ ok: true, lastSuccessAt: now.toISOString(), points: [bagPoint({ instructions: 'Leren hoofdstuk 3' })] }} now={now} />);
    expect(unspecified).toContain('Materiaal zelf controleren');
  });
});
