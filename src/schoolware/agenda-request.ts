export const SCHOOLWARE_ORIGIN = 'https://schoolware_siw.ksgwl.be';
export const SCHOOLWARE_PERMISSION = `${SCHOOLWARE_ORIGIN}/*`;
export const AGENDA_PATH = '/webouders/bin/server.fcgi/REST/AgendaPunt';

const parameters = ['AgendaID', 'MapAgendasOp', 'MinTot', 'MaxVan', 'CompletedTaskForLL'] as const;

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
  if (url.origin !== SCHOOLWARE_ORIGIN || url.pathname !== AGENDA_PATH ||
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
  const canonical = new URL(AGENDA_PATH, SCHOOLWARE_ORIGIN);
  for (const key of parameters) canonical.searchParams.set(key, url.searchParams.get(key)!);
  return canonical.href;
}
