const sections = [ ['todo', 'To-do'], ['schoolbag', 'Boekentas'], ['agenda', 'Agenda'],
  ['special-days', 'Speciale dagen'], ['history', 'Geschiedenis'] ] as const;

export function WorkspaceNavigation({ full }: { full: boolean }) {
  function open(id: string) {
    const section = document.getElementById(`overview-${id}`) as HTMLDetailsElement | null;
    if (!section) return;
    section.open = true;
    section.querySelector('summary')?.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <nav aria-label="Snel naar onderdeel" className="mt-4 flex flex-wrap gap-2">
    {sections.filter(([id]) => full || !['agenda', 'history'].includes(id)).map(([id, title]) =>
      <button key={id} type="button" aria-controls={`overview-${id}`} onClick={() => open(id)}
        className="rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">{title}</button>)}
  </nav>;
}
