import { brusselsWallTime } from './notification-window';
import { hasAgendaMarker, type TaskStatus } from './tasks';
import type { Category } from './observations';
import type { SpecialDay } from './special-days';

export interface BagPoint {
  id: string; day: string; subject: string; title: string; instructions: string;
  category: Category; typePunt: number; status: TaskStatus;
}
export interface BagSource { id: string; title: string; text: string; day: string }
export interface BagMaterial {
  key: string; label: string; subject: string; uncertain: boolean; pages: string[]; sources: BagSource[];
}
export interface BagAgenda { points: BagPoint[]; lastSuccessAt: string | null; specialDays?: SpecialDay[] }

/** Evidence changes invalidate packing choices without persisting duplicate agenda text. */
export async function packingChoiceId(day: string, direction: 'school' | 'home', material: BagMaterial | null): Promise<string> {
  const evidence = material ? [material.key, material.uncertain,
    material.sources.map((source) => JSON.stringify([source.id, source.day, source.title, source.text])).sort()] : ['laptop'];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([day, direction, evidence])));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function availablePackingChoices(agenda: BagAgenda, now: Date): Promise<Map<string, string>> {
  const choices = new Map<string, string>();
  const overview = schoolbagOverview(agenda, now);
  for (const day of overview.days) {
    const selected = schoolbagOverview(agenda, now, day);
    for (const [direction, materials] of [['school', selected.school], ['home', selected.homework]] as const) {
      for (const material of [null, ...materials]) choices.set(await packingChoiceId(day, direction, material), day);
    }
  }
  return choices;
}

const materialNames: [RegExp, string][] = [
  [/\b(?:werkboek(?:en)?|cahier)\b/iu, 'Werkboek'],
  [/\b(?:handboek(?:en)?|leerboek(?:en)?)\b/iu, 'Handboek'],
  [/\bboek(?:en)?\b/iu, 'Boek'], [/\bcursus\b/iu, 'Cursus'],
  [/\bschrift(?:en)?\b/iu, 'Schrift'], [/\b(?:ringmap(?:pen|jes?)?|map(?:pen|jes?)?)\b/iu, 'Map'],
  [/\batlas\b/iu, 'Atlas'], [/\bwoordenboek\b/iu, 'Woordenboek'],
  [/\b(?:rekenmachine|calculator)\b/iu, 'Rekenmachine'],
  [/\bgeodriehoek\b/iu, 'Geodriehoek'], [/\bpasser\b/iu, 'Passer'],
  [/\b(?:lat|liniaal)\b/iu, 'Lat'], [/\b(?:turnkledij|sportkledij|turnzak|sportzak)\b/iu, 'Sportgerief'],
  [/\b(?:zwemgerief|zwemkledij)\b/iu, 'Zwemgerief'], [/\blabojas\b/iu, 'Labojas'],
  [/\b(?:lader|oplader)\b/iu, 'Lader'], [/\bpennenzak\b/iu, 'Pennenzak'],
  [/\b(?:tekenmateriaal|kleurpotloden)\b/iu, 'Tekenmateriaal'], [/\bkladpapier\b/iu, 'Kladpapier'],
];

/** Text-only projection: no DOM, network, remote model or executable markup. */
export function agendaText(value: string): string {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

/** Suggestions retain source evidence; page numbers alone never identify a book. */
export function materialsFor(points: BagPoint[]): BagMaterial[] {
  const materials = new Map<string, BagMaterial>();
  const add = (point: BagPoint, label: string, text: string, uncertain: boolean) => {
    const subject = point.subject.trim();
    const key = JSON.stringify([subject.toLocaleLowerCase('nl-BE'), label]);
    const material = materials.get(key) ?? { key, label, subject, uncertain, pages: [], sources: [] };
    const pages = text.match(/\b(?:p\.?|pp\.?|pag\.?|pagina(?:'s|\u2019s|s)?|blz\.?)\s*\d+(?:\s*[-\u2013\u2014]\s*\d+)?/giu) ?? [];
    material.pages = [...new Set([...material.pages, ...pages.map((page) => page.trim())])];
    if (!material.sources.some((source) => source.id === point.id && source.text === text)) {
      material.sources.push({ id: point.id, title: agendaText(point.title), text, day: point.day });
    }
    materials.set(key, material);
  };
  for (const point of points) {
    const text = agendaText(`${point.title}\n${point.instructions}`);
    const lines = text.split(/[\n;!?]+/u).map((line) => line.trim()).filter((line) => {
      const normalized = line.replace(/\b(?:niet\s+vergeten|vergeet\s+niet)\b/giu, '');
      return line && !/\b(?:geen|niet|zonder|hoeft?\s+niet)\b/iu.test(normalized);
    });
    const pointLabels = materialNames.filter(([pattern]) => lines.some((line) => pattern.test(line))).map(([, label]) => label);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let matched = false;
      for (const [pattern, label] of materialNames) {
        if (pattern.test(line)) { add(point, label, line, false); matched = true; }
      }
      if (!matched && /\b(?:p\.?|pp\.?|pag\.?|pagina(?:'s|’s|s)?|blz\.?)\s*\d+/iu.test(line)) {
        add(point, pointLabels.length === 1 ? pointLabels[0]! : 'Paginaverwijzing — materiaal controleren', line, pointLabels.length !== 1);
      }
    }
  }
  return [...materials.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'nl-BE') || a.label.localeCompare(b.label, 'nl-BE'));
}

export function schoolbagOverview(agenda: BagAgenda, now: Date, selectedDay: string | null = null) {
  const wall = brusselsWallTime(now);
  const today = wall.slice(0, 10);
  const specialDays = agenda.specialDays ?? [];
  const days = [...new Set([...agenda.points.map((point) => point.day), ...specialDays.flatMap((entry) => [entry.day, ...(entry.preparationDay ? [entry.preparationDay] : [])])])].filter((day) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return day >= today && ((weekday !== 0 && weekday !== 6) || specialDays.some((entry) => entry.day === day || entry.preparationDay === day));
  }).sort();
  const nextDay = days.find((day) => day > today) ?? null;
  const defaultDay = (wall.slice(11, 16) < '16:00' || specialDays.some((entry) => entry.preparationDay === today)) && days.includes(today) ? today : nextDay;
  const targetDay = selectedDay && days.includes(selectedDay) ? selectedDay : defaultDay;
  const special = specialDays.find((entry) => entry.day === targetDay);
  const schoolPoints = agenda.points.filter((point) => point.day === targetDay && special?.useTimetable !== false);
  // A preparation-only date is a packing choice, not evidence of a lesson/deadline day.
  const homeDay = targetDay ? days.find((day) => day > targetDay &&
    (agenda.points.some((point) => point.day === day) || specialDays.some((entry) => entry.day === day))) ?? null : null;
  const preparations = specialDays.filter((entry) => entry.preparationDay === targetDay);
  const homework = agenda.points.filter((point) => (point.day === homeDay && point.status !== 'done' && point.category !== 'other' && hasAgendaMarker(point.typePunt)) ||
    preparations.some((entry) => entry.day === point.day && entry.kind === 'home-study' && entry.useTimetable));
  const manual = (entries: SpecialDay[]): BagMaterial[] => entries.flatMap((entry) => entry.checklist.filter((item) => item.pack).map((item) => ({
    key: `special:${entry.id}:${item.id}`, label: item.text, subject: entry.title, uncertain: false, pages: [],
    sources: [{ id: item.id, day: entry.day, title: entry.title, text: item.text }],
  })));
  return { today, nextDay, days, targetDay, homeDay, special, preparations,
    school: [...materialsFor(schoolPoints), ...manual(special ? [special] : [])], homework: [...materialsFor(homework), ...manual(preparations)],
    schoolPoints, homeworkPoints: homework };
}
