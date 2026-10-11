export type Status = 'busy' | 'ok' | 'issue' | 'unknown';
export function StatusIcon({ status, label }: { status: Status; label: string }) {
  const color = status === 'ok' ? 'text-green-700' : status === 'issue' ? 'text-red-700' : 'text-slate-500';
  return <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 ${color}`}>
    <svg aria-hidden="true" className={`h-5 w-5 ${status === 'busy' ? 'motion-safe:animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {status === 'ok' ? <path d="m5 12 4 4L19 6" /> : status === 'issue' ? <path d="m6 6 12 12M18 6 6 18" /> : status === 'busy' ?
        <path d="M20 12a8 8 0 1 1-8-8" /> : <><circle cx="12" cy="12" r="8" /><path d="M12 8v4m0 4h.01" /></>}
    </svg>
  </span>;
}
