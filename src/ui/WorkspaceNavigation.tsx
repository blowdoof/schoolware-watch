import { useEffect, useRef, useState } from 'react';

const sections = [ ['todo', 'To-do'], ['schoolbag', 'Boekentas'], ['agenda', 'Agenda'],
  ['special-days', 'Speciale dagen'], ['history', 'Geschiedenis'] ] as const;

export function WorkspaceNavigation({ full }: { full: boolean }) {
  const [active, setActive] = useState<string>('todo');
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rail = full && window.matchMedia('(min-width: 1280px)').matches;
        const heading = document.getElementById('overview-todo');
        const scrollOffset = heading ? parseFloat(getComputedStyle(heading).scrollMarginTop) : 176;
        const boundary = rail ? 90 : Math.max((navigation.current?.getBoundingClientRect().bottom ?? 140) + 20, scrollOffset + 1);
        const visible = sections.filter(([id]) => full || !['agenda', 'history'].includes(id))
          .map(([id]) => ({ id, element: document.getElementById(`overview-${id}`) }))
          .filter(({ element }) => element && element.getClientRects().length);
        const current = visible.find(({ element }) => {
          const rect = element!.getBoundingClientRect();
          return rect.top <= boundary && rect.bottom > boundary;
        });
        if (current) setActive(current.id);
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [full]);
  function open(id: string) {
    const section = document.getElementById(`overview-${id}`) as HTMLDetailsElement | null;
    if (!section) return;
    setActive(id);
    section.open = true;
    section.querySelector('summary')?.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <nav ref={navigation} aria-label="Snel naar onderdeel" className={`workspace-navigation${full ? ' workspace-navigation--full' : ''}`}>
    {sections.filter(([id]) => full || !['agenda', 'history'].includes(id)).map(([id, title]) =>
      <button key={id} type="button" aria-controls={`overview-${id}`} aria-current={active === id ? 'location' : undefined} onClick={() => open(id)}
        className="rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">{title}</button>)}
  </nav>;
}
