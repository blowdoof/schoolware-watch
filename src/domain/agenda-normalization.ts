/** Ignore transport formatting while preserving words, markup and internal spacing. */
export function normalizeAgendaText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .split('\n').map((line) => line.trimEnd()).join('\n').trim();
}
