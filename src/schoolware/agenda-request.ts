export const SCHOOLWARE_ORIGIN = 'https://schoolware_siw.ksgwl.be';
export const AGENDA_PATH = '/webouders/bin/server.fcgi/REST/AgendaPunt';

/** User-selected public HTTPS installations; endpoint validation is separate from host consent. */
export function schoolwareOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/^[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
export function schoolwarePermission(value: string): string {
  const origin = schoolwareOrigin(value);
  if (!origin) throw new Error('Invalid installation');
  return `${origin}/*`;
}
export function isSchoolwarePage(value: unknown): boolean {
  if (!schoolwareOrigin(value)) return false;
  const url = new URL(value as string);
  return /^\/web(?:ouders|wisad)(?:\/|$)/.test(url.pathname) || /(?:^|[._-])schoolware(?:[._-]|$)/i.test(url.hostname);
}

const parameters = ['AgendaID', 'MapAgendasOp', 'MinTot', 'MaxVan', 'CompletedTaskForLL'] as const;

/** Coverage is transport configuration, never pupil identity. Preserve all other IDs. */
export function agendaProfileKey(value: string): string | null {
  const validated = validateAgendaRequest(value);
  if (!validated) return null;
  const url = new URL(validated);
  url.searchParams.delete('MinTot');
  url.searchParams.delete('MaxVan');
  return url.href;
}

function isId(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Accept only the observed endpoint and parameters, never arbitrary fetch URLs. */
export function validateAgendaRequest(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!schoolwareOrigin(value) || url.pathname !== AGENDA_PATH ||
      url.username || url.password || url.hash) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== parameters.length ||
      parameters.some((key) => url.searchParams.getAll(key).length !== 1)) return null;
  const agendaIds = url.searchParams.get('AgendaID')!.split(',');
  if (!agendaIds.every(isId) || !isId(url.searchParams.get('MapAgendasOp')!) ||
      !isId(url.searchParams.get('CompletedTaskForLL')!)) return null;
  const min = url.searchParams.get('MinTot')!;
  const max = url.searchParams.get('MaxVan')!;
  if (!isDate(min) || !isDate(max) || min > max) return null;

  // Reconstruct from the allowlist; preserve repeated agenda IDs until understood.
  const canonical = new URL(AGENDA_PATH, url.origin);
  for (const key of parameters) canonical.searchParams.set(key, url.searchParams.get(key)!);
  return canonical.href;
}
