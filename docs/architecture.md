# Architecture

## Current scope
Phase 4 adds periodic monitoring and optional upcoming-event notifications.
Validated source points
are normalized, compared and saved in IndexedDB by the worker. Chrome local
storage contains connection configuration, attempt summaries, preferences and
durable retry state.
The project owner confirmed a successful live session check
through the existing browser session on 2026-10-01, including after closing the
Schoolware tab. Logout produced the expected session-unavailable status.
Popup-close recovery still needs live verification.
Session reuse was reported working again on 2026-10-02. Live validation of the
new alarm/notification behavior remains pending. Stable entity identity and
response completeness remain unverified.

## Boundaries
- `src/background`: monitoring orchestration, alarm lifecycle, and history writes.
- `src/content`: isolated generic notification banner on the verified Schoolware origin.
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

## Encrypted participant announcements

Optional self-chosen names are stored in the existing IndexedDB sync state.
A separate PHP `members` exchange sends a random connection ID and encrypted
label, then returns only group-scoped ciphertext and server UTC timestamps.
The worker decrypts and validates the entire list before atomically replacing
its cache. Connection and name guards reject stale replies. Member errors have
a separate flag and cannot roll back an acknowledged task edit. Member changes
invalidate extension views without creating observation events or notifications.
The announcement channel is separate from progress operations for compatibility
with older clients. It is not authenticated person identity or an access roster.

## Automatic agenda connection

The worker registers a non-blocking `webRequest.onCompleted` listener for the
exact observed agenda endpoint, gated by optional API/host permissions.
A user-started discovery session binds a newly opened tab before navigating it
to Schoolware. An allowlisted successful GET/XHR request from its top frame and
same-origin initiator becomes a candidate, with no headers or payload reads.
Trusted session storage preserves the deadline/candidate across worker restarts;
a one-shot alarm expires discovery. Candidate replacement changes a random
confirmation ID. Only a trusted extension page may confirm that exact ID.
Confirmation checks that the tab remains at the installation origin and then
runs the existing transport, normalization and transactional baseline pipeline.
The discovered API response is never passed to the extension; it performs its
own existing-session check. Cancel, confirm and deletion clear transient data
and revoke only `webRequest`, retaining host access needed by monitoring.
See [discovery and live checks](agenda-discovery.md).

## Observation model
Schema version 3 contains `scopes`, `settings`, an indexed `activity` store, and
an optional `sync` store. The new store holds local pairing credentials, the
durable outbox, encrypted-transport receive metadata and cached progress.
Status edits and automatic reopening queue operations atomically with local
changes. Receive cursor/cache writes are atomic and stale connection replies
are ignored. Only matching content versions in the paired local scope receive
remote progress; applying progress creates no Schoolware change events.
The PHP/MySQL service is independently deployed on the owner's cPanel host.
It receives authenticated ciphertext only; no Schoolware session or transport
runs on the server. Polling and upload are coordinated by the worker and a
separate one-minute alarm. Pending group registration is stored alongside the
token/key before network access and retried idempotently after worker restart.
The PHP endpoint derives group scope from the token verifier, with transactional
self-registration quotas. Only an explicit request from a trusted extension
page can redisplay the pairing code. See [progress sync](progress-sync.md) and the
[installation guide](../server/INSTALL.md).
The version-1 migration assigns random local scope/item IDs and initializes local
task progress without changing source snapshots, event history or observation times.
Each scope holds its baseline,
current observations, event snapshots (before/after content versions), and
successful-check metadata (including actual date coverage) in one document. The document and retention cleanup
are committed in a single readwrite transaction. Unchanged observations update
lastSeenAt without adding event versions. A reused check ID is idempotent.
There is no persistent raw-response archive. This initial schema can later be
split into indexed item/event stores without changing domain semantics.

- `firstSeenAt`: first successful local observation; never creation time.
- `lastSeenAt`: last successful observation containing the item.
- `observedAt`: local detection time of an event.
- `coverage`: installation, profile, agenda, requested time window, filters,
  pagination completeness, and response validity.
- Events: baseline, observed, changed, disappeared, and reappeared. The live
  adapter enables only the first three.

Keep GeldigVan, Van, and Tot as source fields. Do not use GeldigVan to infer
creation. A detected change usually occurred between comparable successful
checks; do not present its observation time as the exact source change time.
Items outside a moving window are outside coverage, not disappeared.

Profile matching uses the canonical request's installation, pupil, agenda selection
and mapping, excluding MinTot/MaxVan. The worker reuses a retained legacy scope key
before checking, preferring its existing sharing connection then original baseline.
Existing duplicate window scopes are retained rather than destructively merged.
Requests use rolling dates without changing the selected legacy scope key. New source tuples outside previous
successful coverage receive baseline events. Legacy checks without coverage use
the original configured dates as their conservative coverage. Boundary days are
excluded from new-item classification until boundary semantics are verified.
A source observation key is the
tuple ID, AgendaID, UniekAgendaPuntID, OrigineelPuntID and HerhaaldAgendaPuntID.
This compares only identical observed tuples and does not assert a stable entity
identity. Changed tuples are first observations; no recurrence or rescheduling
merge is attempted. Duplicate tuples abort the write. Broader identity matching
requires verification of ID stability and relationships first.
Public Schoolware frontends from KOHa and Scholen Molenland confirm fixed
TypePunt ranges: 100–999 tests, 1000–1999 assignments, and 9 attention points
(the review category). Types 1 and 2 are unmarked lesson information; activities
2000–2999 and unknown values remain Other. Classification and task eligibility
share one pure domain classifier, including integer validation and range bounds.
Normalize meaningful fields deterministically, preserving source date semantics
until timezone and serialization behavior are verified.

## Session and permissions
Existing-session requests from the worker succeeded in the project owner's
Chrome test, including with the Schoolware tab closed. An open Schoolware tab
is not required for the tested session. Logging out correctly results in a
session-unavailable status. No tab bridge is needed for this integration.
Do not extract or persist cookies or tokens. Permissions are added only as the integration
requires them. The manifest requests storage, alarms and activeTab, and declares optional
notifications, scripting, webRequest and HTTPS host access. Each host request
names the exact user-selected installation; the broad optional declaration allows
custom school domains without granting all-sites access. Only trusted bundled
extension pages can invoke the manual-check message; URLs outside the constrained agenda contract, extra query
parameters, credentials in URLs, and unknown message fields are rejected.
No full agenda payload is persisted or sent to the UI. History messages expose
display snapshots and counts, not source keys or profile IDs. Structured comments
retain only `leerlingen` content; `prive` is discarded. Source HTML renders as
React text. Deletion aborts and waits for an in-flight check before clearing data,
preventing completed checks from restoring erased history. IndexedDB baselines
survive worker restarts; only transient operation coordination lives in memory.
Alarm failures use durable exponential backoff, bounded at six hours. Manual
checks bypass retry delays. Alarm listeners are registered synchronously; startup
and installation verify the schedule and restore it if missing. The worker never
replays every missed interval. Notification eligibility is pure domain logic.

Notification settings select categories and 1–30 future calendar days. Source
timestamps are compared to Europe/Brussels wall time, an explicit unverified API
assumption. Only newly recorded observed/changed events qualify, excluding hidden
and cancelled snapshots. Baselines do not alert. Notifications are generic and
grouped per check. A repository transaction claims delivery before calling the
Chrome API. This guarantees at-most-once attempts for a committed check, with
possible lost notifications if interrupted before delivery. An API error cannot
roll back successful history. Clicking a notification opens a local lesson-detail
route containing only its random check ID. The comparison transaction additionally
captures all fetched points of affected lesson groups, before/after changes and
minimal subject/room context. Subsequent checks do not alter these snapshots.
Detail reads project display fields only and use the active configured scope;
expired/deleted/legacy checks without details show an unavailable message.
The version-2 migration preserves existing version-1 records without rewriting
their baseline or changing observation comparison. Lesson-context enrichment and
local task status do not create Schoolware change events.
UI colors use validated hexadecimal values and keep event labels for accessibility.

The optional Schoolware-page banner uses a dynamically registered content script,
limited to the verified HTTPS origin and the top frame. Existing Schoolware tabs
are injected when enabled; future matching pages receive the registered script.
The script runs in the isolated world and creates its own closed shadow root
with a constructable stylesheet. It reads no page content, forms or credentials,
and receives no raw agenda, titles, scope identifiers or connection state.
Sender validation permits only generic banner read/dismiss/open actions from
the exact Schoolware origin; the open action accepts only a random alert ID that
exists in the active scope's inbox and opens a fixed local lesson-detail route.
Source IDs and detail payloads are never sent to the content script.
Other websites, frames and privileged message types are rejected. Extension
pages have no banner. The content script is built as a standalone classic IIFE;
all executable code remains bundled locally.

A bounded inbox in trusted chrome.storage.local contains random check IDs,
generic counts, time/horizon, a test flag and a configured scope reference.
Worker-only queued writes make publication idempotent and preserve alerts across
restarts; scope references never leave the worker. The inbox has a global cap of
20, uses the history retention setting, and is separate from atomic history
transactions, so interruption before publication can lose a banner. Badge state
is derived from the current scope's inbox on startup and subsequent updates.
Dismissal removes pending banners without modifying observations; scope clearing
also clears its banners. Disconnect clears all pending banners, unregisters the
script and revokes Schoolware/scripting permission. No automatic tab is opened
or focused; lesson details open only after an explicit notification click.
The test-banner action requests scripting/origin access from the settings-page
user gesture, enables the banner without a separate preferences save, and injects
existing Schoolware tabs. Test clicks open a clearly synthetic preview and never
write fake agenda observations.

Retention defaults to 90 days, configurable to 30/90/180/365. Reads, writes and
retention changes prune expired historical events/check metadata and stale scope
content. Recently observed current snapshots remain even if their first-seen
timestamp predates the retention window. Disconnecting deletes all scope history
and configuration, while clearing a selection deletes just that scope.

The polling default is 15 minutes, with 5/15/30/60-minute options. Alarms may run late, cannot
wake a sleeping device, and do not provide monitoring while Chrome is closed.
Expose the last successful check and session state. Do not replay every missed
interval on resume.

## References
See [Activity logging and task progress](activity-and-tasks.md) for correlation,
privacy, retention, atomic updates and acceptance checks.

- [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Chrome notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications)
- [Cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Vite production builds](https://vite.dev/guide/build)
- [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [IndexedDB transactions and schema upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
