/** Minimal source fields; identity relationships and response completeness remain unverified. */
export interface AgendaPoint {
  ID: number;
  AgendaID: number;
  OrigineelPuntID?: number;
  UniekAgendaPuntID: number;
  Titel: string;
  PublicComment?: string;
  TypePunt: number;
  GeldigVan: string;
  Van: string;
  Tot: string;
  HerhaaldAgendaPuntID?: number;
  Herhaling?: string;
  Verborgen?: boolean;
  Vervalt?: boolean;
  LesDataID?: number;
  VakNaam?: string;
  LokaalCode?: string;
  LokaalOmschrijving?: string;
}

export type AgendaResponseResult =
  | { ok: true; points: AgendaPoint[]; completeness: 'unverified' }
  | { ok: false; reason: 'invalid-json' | 'api-failure' | 'invalid-response' }
  | { ok: false; reason: 'invalid-item'; index: number; field: keyof AgendaPoint | 'Commentaar' | null };

const requiredIds = ['ID', 'AgendaID', 'UniekAgendaPuntID', 'TypePunt'] as const;
const optionalIds = ['OrigineelPuntID', 'HerhaaldAgendaPuntID', 'LesDataID'] as const;
const optionalText = ['VakNaam', 'LokaalCode', 'LokaalOmschrijving'] as const;
const dates = ['GeldigVan', 'Van', 'Tot'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSourceId(value: unknown): value is number {
  // Some observed IDs exceed 32 bits. Never coerce strings or truncate numbers.
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSourceDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined ||
      hour === undefined || minute === undefined || second === undefined) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) && hour <= 23 && minute <= 59 && second <= 59;
}

function publicComment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.trimStart().startsWith('{') && !value.trimStart().startsWith('[')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    if (!Object.hasOwn(parsed, 'leerlingen')) return '';
    return typeof parsed.leerlingen === 'string' ? parsed.leerlingen : null;
  } catch {
    // A malformed serialized object may contain non-pupil fields. Fail closed.
    return /^\s*\{\s*"/.test(value) ? null : value;
  }
}

/** Validate all items before returning any; errors contain no source values. */
export function validateAgendaResponse(value: unknown): AgendaResponseResult {
  if (!isRecord(value)) return { ok: false, reason: 'invalid-response' };
  if (value.success === false) return { ok: false, reason: 'api-failure' };
  if (value.success !== true || !Array.isArray(value.data)) {
    return { ok: false, reason: 'invalid-response' };
  }

  const points: AgendaPoint[] = [];
  for (let index = 0; index < value.data.length; index++) {
    const item: unknown = value.data[index];
    const invalid = (field: keyof AgendaPoint | 'Commentaar' | null): AgendaResponseResult =>
      ({ ok: false, reason: 'invalid-item', index, field });
    if (!isRecord(item)) return invalid(null);
    for (const field of requiredIds) {
      if (!isSourceId(item[field])) return invalid(field);
    }
    for (const field of optionalIds) {
      if (Object.hasOwn(item, field) && !isSourceId(item[field])) return invalid(field);
    }
    if (typeof item.Titel !== 'string') return invalid('Titel');
    for (const field of optionalText) {
      if (Object.hasOwn(item, field) && typeof item[field] !== 'string') return invalid(field);
    }
    const comment = Object.hasOwn(item, 'Commentaar') ? publicComment(item.Commentaar) : '';
    if (comment === null) return invalid('Commentaar');
    for (const field of dates) {
      if (!isSourceDate(item[field])) return invalid(field);
    }
    if (Object.hasOwn(item, 'Herhaling') && typeof item.Herhaling !== 'string') return invalid('Herhaling');
    for (const field of ['Verborgen', 'Vervalt'] as const) {
      if (Object.hasOwn(item, field) && typeof item[field] !== 'boolean') return invalid(field);
    }

    // Project an explicit allowlist rather than retaining full source objects.
    const point: AgendaPoint = {
      ID: item.ID as number,
      AgendaID: item.AgendaID as number,
      UniekAgendaPuntID: item.UniekAgendaPuntID as number,
      Titel: item.Titel,
      PublicComment: comment,
      TypePunt: item.TypePunt as number,
      GeldigVan: item.GeldigVan as string,
      Van: item.Van as string,
      Tot: item.Tot as string,
    };
    for (const field of optionalIds) {
      if (Object.hasOwn(item, field)) point[field] = item[field] as number;
    }
    for (const field of optionalText) {
      if (Object.hasOwn(item, field)) point[field] = item[field] as string;
    }
    if (Object.hasOwn(item, 'Herhaling')) point.Herhaling = item.Herhaling as string;
    for (const field of ['Verborgen', 'Vervalt'] as const) {
      if (Object.hasOwn(item, field)) point[field] = item[field] as boolean;
    }
    points.push(point);
  }

  // success=true is not proof of pagination completion or comparable coverage.
  return { ok: true, points, completeness: 'unverified' };
}

export function parseAgendaResponse(text: string): AgendaResponseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // JSON parser messages can contain source content; do not expose them.
    return { ok: false, reason: 'invalid-json' };
  }
  return validateAgendaResponse(value);
}
