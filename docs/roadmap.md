# Development roadmap

1. Foundation: project instructions, architecture, strict TypeScript, React,
   Vite, Tailwind, MV3 build, and Vitest. Build artifacts ready for local loading.
2. API and session: verify endpoint, authentication, pagination, dates, identity,
   and TypePunt. Complete one manual check through the existing browser session.
3. History: IndexedDB migrations, normalization, baseline, comparison, and
   atomic observations. Prove incomplete checks cannot mark items disappeared.
4. Monitoring: alarms, timeouts, back-off, overlap prevention, and restart recovery.
5. UI: connected popup, agenda, event history, settings, and clear check/session status.
6. Extensions and release: multiple profiles, optional notifications, safe CSV
   export, retention/deletion controls, GitHub CI, and release checklist.

Publication and uploads require separate authorization. Chrome loading and
worker behavior need browser smoke checks in addition to automated tests.
