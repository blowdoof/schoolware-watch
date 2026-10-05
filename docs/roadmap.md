# Development roadmap

## Owner-requested backlog

Recorded on 2026-10-04. These extensions are planned, not implemented; they do
not change the current Chrome Web Store submission.

- [ ] Support multiple children within one extension installation. Add a pupil
  selector and separate agenda connections, monitoring state, history, task
  progress, schoolbag suggestions and notification routing per pupil. Manage a
  separate optional sharing group and pairing code for each pupil. Preserve
  existing single-pupil data through migration and verify isolation across
  pupils, devices and worker restarts. Today, one active agenda connection and
  one sharing group are supported per Chrome profile.
- [ ] Explore teacher follow-up of selected marked items. The owner will first
  brainstorm the workflow. Define verified invitations, pupil/item selection,
  read-only teacher access, revocation and how teachers identify assignments
  before implementation. See [Teacher follow-up proposal](teacher-follow-up-proposal.md)
  for the design constraints and unresolved decisions. Existing parent pairing
  codes must not be used to grant teacher access.

## Development phases

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

Current implementation: phases 1 and the manual session integration in phase 2
are available. Phase 3 provides scoped, local baseline/first-observation/
change history and retention/deletion controls. Phase 4 adds rolling coverage,
alarms, durable backoff, overlap prevention and restart recovery. Configurable
colors, optional system notifications and an optional Schoolware-page banner are
also available. System notification delivery was owner-confirmed on 2026-10-02.
Both channels now open captured lesson details with configurable new/changed
accents and before/after values. The test-banner button can enable and test the
banner directly after permission approval, without saving first. Test clicks
open synthetic previews without adding observations.
Version 2 adds always-on local activity logs with correlation/span IDs, filtering,
local JSON export and deletion. Task progress (open/in-progress/done) persists
locally and is committed atomically with its audit entry. Real version-1 migration,
profile isolation, restarts, logging failure reporting and rollback are tested.
Live Chrome alarm, banner and popup-close checks remain pending. Stable entity
identity, pagination completeness, full TypePunt
mapping and source timezone semantics remain research items. Disappearance is
implemented only in the pure comparison engine behind verified completeness and
identity flags; the live adapter leaves both false. Multiple profiles and safe
export remain future work.
