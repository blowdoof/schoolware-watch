# Encrypted shared planning

The owner expanded the optional synchronization scope on 2026-10-09 to make
parent/pupil special days, checklist completion and packing choices agree.
This extends the existing self-hosted PHP group; no new destination, telemetry,
permission, PHP code, SQL schema or production upload is added.

## Shared and local fields

Shared encrypted values include special-day date/type/title/notes/preparation,
the ordinary-timetable switch, checklist IDs/text/material switches, independent
checklist completion and schoolbag packing/hiding/reset choices. Existing
Open/Bezig/Klaar and optional participant labels remain shared. Special-day text
is explicitly user-created; users should include only information they want
the paired group to read. No Schoolware source title, instruction, source tuple,
raw pupil ID, history event, source URL or session is included.

Schoolware agendas still come from each device's own authenticated session.
To-do dates and automatic materials use that local latest successful response.
Same source observations, shared data and display filters produce the same
results, but expired sessions, different capture coverage, ambiguous/changed
source IDs and different polling times can produce temporarily different lists.
Selected viewing dates, expanded panels and notification preferences remain
device preferences. The special-day and bookbag panels display whether sharing
is active for this exact profile, pending encrypted messages, sync failures and
last successful sync. This feature does not promise identical source data while
one device cannot fetch Schoolware. Each screen shows source/sync freshness.

## Identity and local upgrade

Schoolbag evidence references are derived locally from a SHA-256 digest of the
verified source tuple plus installation origin, formatted as a pseudonymous
UUID. The tuple is the same conservative candidate used for progress; it does
not establish long-term identity across recurrence/rescheduling. Material-choice
fingerprints also include meaningful instructions/evidence, date and direction.
No matching by title or subject is introduced. Changed evidence invalidates old
packing flags instead of hiding changed requirements. Manual checklist material
uses the shared event/point IDs.

The one-time IndexedDB v3 optional-field upgrade maps currently valid existing
packing choices from browser-local item IDs to stable fingerprints and preserves
their states. Stale/inapplicable choices are discarded. Source observations,
events and task progress remain intact. The marker survives subsequent checks;
no IndexedDB object-store upgrade is needed.

## Wire compatibility, delivery and conflict policy

The existing encrypted exchange accepts operation UUID, IV and ciphertext only.
New `planning-part` plaintext envelopes split validated planning JSON into
256-byte UTF-8 fragments, base64 encoded inside AES-GCM. They retain the existing
512-byte padded plaintext, authenticated operation IDs and PHP limits of 50
uploads/200 downloads per exchange. An envelope has at most 192 fragments.
UTF-8 is decoded only after complete validated assembly. Outbox UUIDs survive
retry; duplicate requests retain existing server idempotency.

All paired extensions must update. Older clients reject new operation types
and cannot complete synchronization through them; they are not silently allowed
to skip unreadable data. The UI and invitation state the upgrade requirement.
No Store release or automatic installation is performed by this change.

Each local edit commits its local state and encrypted-operation preparation in
one IndexedDB transaction. The worker offers upload immediately without delaying
the edit on network access; existing minute polling retries offline/interrupted
work. Incomplete assemblies and the receive cursor persist atomically. Invalid
reassembly aborts that exchange's cache/cursor/acknowledgements. UI application
waits until the download cursor reaches the response head. Remote application
commits with task changes and does not create Schoolware observation events.
Open popup/dashboard views refresh, and received events reschedule each device's
local preparation alarm. Generic received-change alerts mention progress/planning.

Metadata records are keyed by event date, with an explicit null deletion
tombstone. Thus one special day exists per date throughout a group. Checklist
completion is keyed separately by shared event/point ID, preserving simultaneous
edits to different checkboxes. Packing flags are independent records; reset/open
also travels as a tombstone. Last accepted server revision wins for the same
explicitly edited field/resource. Whole event metadata (including checklist
structure/text) is one resource: concurrent note/list edits can overwrite one
another. Later-accepted offline metadata can supersede or recreate a deleted
event; this is the explicit existing last-accepted conflict policy, not a claim
that device wall clocks establish edit order. Moving a date uses one fragmented
envelope whose complete assembly atomically establishes old-date deletion and
new-date metadata. An interrupted upload cannot remove the old date alone.

Pending local resource edits prevent older received values from overwriting
the local view before acknowledgement. Startup/upgrade seeds retained local
events/completion/packing once, but seed records never outrank explicit remote
edits or deletion tombstones. This prevents an old unshared snapshot from
undoing a known server deletion when joining. Existing progress-only groups
automatically gain this authorized capability when their clients update.

## Privacy, retention and deletion

Only explicitly paired devices can decrypt. All shared-secret holders retain
existing read/write/delete and impersonation capability; this does not add
verified parent/teacher roles. The host sees ciphertext length/count, request
times, existing group/device metadata and hosting connection information.
Fragmentation reveals approximate size; padding does not hide operation counts.
Logs contain counts/outcomes and generic actions, never planning text or IDs.

Local special-day history uses configured retention and enclosing profile
deletion. Packing dates in the past are dropped from local views. Remote
planning records and deletion tombstones use the existing server operation
retention/maintenance policy, independently of local retention. Inactive groups
still require host cleanup; hosting logs/backups remain under host management.
Clients retain bounded received caches for unseen material and up to 128
partial batches; local disconnect/profile deletion removes that cache. Server
deletion removes encrypted operations (including planning), not copies already
received on other devices. A surviving participant can upload again. Expired
server tombstones can no longer prevent stale offline bootstrap data from
returning; this is the existing finite-retention shared-secret limitation.

No source agenda completeness/identity gate is relaxed. Remote planning does
not create evidence of source disappearance, school attendance or new tasks.

## Validation and acceptance

2026-10-09: strict typecheck, ESLint, 362 Vitest tests across 31 files and the
production build passed. The existing isolated Chrome suite and the new
`node scripts/chrome-planning-sync-smoke.mjs "PATH_TO_CHROME"` suite passed in
Chrome 155. The latter uses two separately loaded extensions with independent
IndexedDB stores and a CDP-bound in-memory encrypted exchange, never the live
service. One run timed out under parallel browser/compiler/test load; its
isolated rerun passed. Run the browser suites separately from the full Vitest
worker pool on constrained machines.

Synthetic two-device tests use separate IndexedDB factories and the real
encryption/transport/repository code with a bounded in-memory server. They cover
maximal Unicode fragments, partial pagination, replay, concurrent independent
checkboxes, metadata moves/deletion, stable cross-account packing, reset/hide,
bootstrap deletion precedence, group isolation, failed outbox transaction and
malformed receive rollback. Existing wrong-key/tamper/session tests still apply.

Owner acceptance requires the same updated build on both real computers,
successful Schoolware checks, the same pupil pairing code and checking displayed
sync/source timestamps. Compare a Monday home-study event with Friday preparation,
checklist flags and packing/hiding/restoring from each side, including an offline
edit and later recovery. Visible OS reminders/material accuracy still require
real-device acceptance. Matthias's external review is required before merge
or publication. Privacy-page source changes are prepared locally, not deployed.
