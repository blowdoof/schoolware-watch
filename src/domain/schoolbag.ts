import { brusselsWallTime } from './notification-window';
import { hasAgendaMarker, type TaskStatus } from './tasks';
import type { Category } from './observations';

export interface BagPoint {
  id: string; day: string; subject: string; title: string; instructions: string;
  category: Category; typePunt: number; status: TaskStatus;
}
export interface BagSource { id: string; title: string; text: string; day: string }
export interface BagMaterial {
  key: string; label: string; subject: string; uncertain: boolean; pages: string[]; sources: BagSource[];
}
export interface BagAgenda { points: BagPoint[]; lastSuccessAt: string | null }

const materialNames: [RegExp, string][] = [
  [/\b(?:werkboek(?:en)?|cahier)\b/iu, 'Werkboek'],
  [/\b(?:handboek(?:en)?|leerboek(?:en)?)\b/iu, 'Handboek'],
  [/\bboek(?:en)?\b/iu, 'Boek'], [/\bcursus\b/iu, 'Cursus'],
  [/\bschrift(?:en)?\b/iu, 'Schrift'], [/\b(?:ringmap|map(?:pen)?)\b/iu, 'Map'],
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
  const days = [...new Set(agenda.points.map((point) => point.day))].filter((day) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return day >= today && weekday !== 0 && weekday !== 6;
  }).sort();
  const nextDay = days.find((day) => day > today) ?? null;
  const defaultDay = wall.slice(11, 16) < '16:00' && days.includes(today) ? today : nextDay;
  const targetDay = selectedDay && days.includes(selectedDay) ? selectedDay : defaultDay;
  const schoolPoints = agenda.points.filter((point) => point.day === targetDay);
  const homework = agenda.points.filter((point) => point.day === nextDay && point.status !== 'done' && hasAgendaMarker(point.typePunt));
  return { today, nextDay, days, targetDay, homeDay: nextDay, school: materialsFor(schoolPoints), homework: materialsFor(homework),
    schoolPoints, homeworkPoints: homework };
}
