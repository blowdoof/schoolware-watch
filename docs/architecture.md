# Architecture

## Current scope
Phase 2 provides a manual connection diagnostic from the extension worker to
the observed Schoolware endpoint. It validates and minimizes the response,
returns only total/category counts, and stores a canonical request URL and last attempt summary
in local extension storage. The project owner confirmed a successful live check
through the existing browser session on 2026-10-01, including after closing the
Schoolware tab. Logout produced the expected session-unavailable status.
Popup-close recovery still needs live verification.
History storage, alarms, notifications, and identity resolution are not yet
implemented.

## Boundaries
- `src/background`: monitoring orchestration, alarm lifecycle, and history writes.
- `src/content`: session integration only if the verified transport requires it.
- `src/schoolware`: API transport, runtime validation, and normalization.
- `src/domain`: pure identity resolution and observation comparison.
- `src/storage`: IndexedDB repositories and versioned migrations.
- `src/shared`: typed messages and runtime contracts.
- `src/ui`: popup, history dashboard, and options.
- `tests/fixtures`: synthetic responses only.

Directories are introduced when their implementation exists; empty layers are
not scaffolded. React renders the UI; it does not own monitoring state.

## Data flow
Alarm or manual check → verified Schoolware transport → complete-response
validation → normalization → identity resolution → comparison → IndexedDB
transaction → UI update and optional notification.

The worker is the intended history writer. Persist state in IndexedDB, register
event listeners synchronously, verify the alarm on worker startup, use bounded
requests, and prevent overlapping checks. Interrupted checks must be retryable.

## Observation model
The planned stores are profiles, current items, content versions, events, and
check metadata. Successful checks update versions, events, and check state in
one transaction. Unchanged observations update lastSeenAt without duplicating
content. No persistent raw-response archive is planned.

- `firstSeenAt`: first successful local observation; never creation time.
- `lastSeenAt`: last successful observation containing the item.
- `observedAt`: local detection time of an event.
- `coverage`: installation, profile, agenda, requested time window, filters,
  pagination completeness, and response validity.
- Events: baseline, appeared, changed, disappeared, and reappeared.

Keep GeldigVan, Van, and Tot as source fields. Do not use GeldigVan to infer
creation. A detected change usually occurred between comparable successful
checks; do not present its observation time as the exact source change time.
Items outside a moving window are outside coverage, not disappeared.

Identity is scoped by installation and profile. ID, AgendaID, OrigineelPuntID,
and UniekAgendaPuntID need verified relationships before choosing a stable key.
For the tested installation, TypePunt 101 is classified as a test and 1001 as an
assignment based on owner-confirmed examples. TypePunt 2 remains a review
category because it also appears on ordinary lesson content. Other values
remain unclassified until their meanings are established.
Normalize meaningful fields deterministically, preserving source date semantics
until timezone and serialization behavior are verified.

## Session and permissions
Existing-session requests from the worker succeeded in the project owner's
Chrome test, including with the Schoolware tab closed. An open Schoolware tab
is not required for the tested session. Logging out correctly results in a
session-unavailable status. No tab bridge is needed for this integration.
Do not extract or persist cookies or tokens. Permissions are added only as the integration
requires them. The current manifest requests local storage and declares optional
host access only for the observed Schoolware installation. Only trusted bundled
extension pages can invoke the manual-check message; arbitrary URLs, extra query
parameters, credentials in URLs, and unknown message fields are rejected.
No full agenda payload is persisted or sent to the UI in this diagnostic phase.
In-memory coordination only prevents concurrent manual checks in the current
worker; durable retry/deduplication belongs to the monitoring phase.

The provisional polling default is 15 minutes. Alarms may run late, cannot
wake a sleeping device, and do not provide monitoring while Chrome is closed.
Expose the last successful check and session state. Do not replay every missed
interval on resume.

## References
- [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Vite production builds](https://vite.dev/guide/build)
- [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite)
