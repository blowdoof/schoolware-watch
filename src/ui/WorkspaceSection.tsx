import { useState, type ReactNode } from 'react';

/** Native disclosure keeps form drafts mounted while its content is collapsed. */
export function WorkspaceSection({ title, description, defaultOpen = false, children }: {
  title: string; description: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className="workspace-section group mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center gap-3 p-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-700">
      <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-teal-700 transition-transform group-open:rotate-90"
        viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 3 5 5-5 5" /></svg>
      <span><span className="block font-semibold">{title}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></span>
    </summary>
    <div className="workspace-content border-t border-slate-100">{children}</div>
  </details>;
}
