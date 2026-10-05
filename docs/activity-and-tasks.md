# Activity logging and local task progress

## Recorded operations

Logging is always on and remains entirely inside the extension's IndexedDB.
The worker records validated runtime requests and their completion/failure,
rejected messages (without their contents), worker/install/browser startup,
alarm configuration/firing, check start, transport outcome/timing, retries,
each baseline/appearance/change/disappearance/reappearance observation,
notification eligibility, OS notification API creation and registry diagnostics,
native notification clicks/closures/clear requests, banner publication,
content-script rendering acknowledgements, opening/dismissal, permission results,
preferences saves, and task-status changes. The live adapter's existing guards
still prevent disappearance inference from incomplete responses.

Progress sharing now records every invocation, including automatic minute-alarm
runs, manual runs, checks and deferred uploads after task edits. `progress.sync`
has started and succeeded/failed/skipped results; a successful idle exchange is
still a success. Its stages are `progress.registration`, `progress.exchange`,
`progress.apply` and `progress.members`. Local pairing/name saves, participant
leaving, remote deletion and all three kinds of alarm firing are also recorded.
Validated changes in automatic agenda recognition record `connection.discovery`
without the candidate URL or source identifiers. Discovery status polling and
ignored unrelated browser requests do not create activity rows.
The `trigger` and `alarm` enums distinguish background work from user requests.
Downloaded/uploaded/pending counts, elapsed time, application flags and bounded
HTTP status codes explain the outcome, without remote IDs or payloads.

Failures distinguish network errors, timeouts, missing browser permission,
authentication, server/rate-limit errors, invalid replies, decryption failures
and stale replies. A successful progress exchange with a failed member update
reports `partial-success`, with the specific failure under `progress.members`.
Request completion alone is not proof of sync success; use the terminal
`progress.sync` and stage records sharing its correlation ID. Work interrupted
by worker termination may leave a start without a result; the next alarm retries.
Old exports cannot acquire these new diagnostics retroactively.
If `hasMore` is true, a downloaded page is valid but receiving all progress is
still pending; `progress.apply` skips with `pagination-pending` until the receive
cursor catches up. The run reports `partial-success` until that point.

Actual remote task-status changes append `task.status` with reason `remote-sync`
and a random local item reference in the same transaction as the update.
Invalid audit metadata rolls that update back; unchanged retries add no duplicate
status event. Logging the external stages remains best effort through the
existing log-health indicator and never uploads data or stores raw exceptions.

Daily to-do selection is recorded as `notification.todo`, including disabled,
missing permission, no eligible reminder and an already-claimed daily reminder.
An eligible reminder's selection and delivery can be correlated by its random
local reminder ID. Existing system/banner records describe the actual delivery.
Deletion still erases the relevant local activity without leaving a deletion
receipt; logs retain the existing age limit and 20,000-entry cap. More detailed
minute-level diagnostics can reach that cap before the chosen age limit.

A successful check, its item observations and generic audit entries commit in
the same transaction. Local task status and its audit record also commit together;
an audit failure rolls back that task update. Failed attempts and Chrome side
effects have separate records and cannot be made atomic with external browser APIs.
These side effects use started/completed records where available.

## Correlation and timestamps

- `correlationId`: a random operation ID. For a check this is also its check ID
  and the ID of its generic system/banner alert. Creation, render, click and
  dismissal records can be filtered together. Other UI requests have their own IDs.
- `spanId`: a random ID for the individual request or callback. Multiple records
  within that action share it, including started/result phases.
- `profileId`: an optional random local scope reference. It is not a student ID.
- `itemId`: a random local item reference linking observations and progress changes
  across check correlations. Task cards expose this same reference for filtering.
- `timestamp`: worker UTC ISO timestamp. UI displays Brussels time; expanded rows
  and JSON retain UTC. An auto-increment sequence preserves write order when
  timestamps coincide. Display acknowledgements record receipt time.

IDs are generated locally and are not derived from source/student IDs. Data is
projected through a strict metadata allowlist. Never add source objects, payloads,
titles, instructions, URLs, headers, credentials or raw error strings to logs.
Task status is a separate local feature; it is not a Schoolware observation.

## Observability limits and deletion

Logs begin with this implementation; older activity cannot be reconstructed.
Chrome acceptance/registration does not prove OS toast visibility. A banner
acknowledgement means its DOM was constructed on a visible Schoolware tab, not
that a person read it. Chrome's native closure event supplies `byUser`; false
does not distinguish API clearing, expiration or other non-user causes.
No page contents, free-text keystrokes or browser activity on other sites is logged.

Logging failures set a persisted health indicator shown by the activity viewer;
raw exceptions are never saved. A worker/process interruption can leave a started
record without a result. Browser API outcomes that never reach the worker cannot
be logged. Do not claim that the log is a complete external-system audit trail.

Logs follow 30/90/180/365-day history retention and have a global 20,000-entry
cap. Reads/writes and retention changes prune old entries; the device must run
an extension operation for cleanup. The viewer shows up to 500 matching rows;
export includes all retained matching rows. Export is a local browser download,
not an upload; the browser/OS controls whether the file is actually saved.

Clearing logs intentionally retains no deletion receipt and leaves task progress
unchanged. New operations can create fresh records afterward. Clearing active
history removes that scope's task progress and associated audit correlations,
including root rows without a profile reference. Disconnect clears all scopes,
progress, logs and logging-health state. Late native closure events are ignored
when their correlation was erased. Retention/cap cleanup does not generate a
recursive record for each removed log row.

## Progress semantics

The popup and dashboard include a compact to-do overview. The horizon is the
first future weekday with active agenda points in the latest successful response
for the selected profile, using Brussels dates. All point categories contribute
dates, including unmarked lesson information. Five pending marked points are
shown initially; additional points and earlier unfinished work are expandable.
The earlier-work section includes an "Alles als klaar markeren" button that
marks the earlier pending selection done through one validated worker request.
Controls stay disabled during saving. Statuses, per-item audit records and the
sync outbox commit in one transaction; a failed item or log write rolls back
the entire selection. When a next schoolday is known, today's unfinished work
is included in earlier work; future schoolday work is not included in this action.
Open and in-progress points scheduled on that day are included;
done, hidden and cancelled points are excluded. The same worker-owned status
updates and optional progress synchronization are used as in the task list.

There is no external holiday calendar or calendar request. Weekends are skipped;
holidays, school breaks and school-specific free days follow gaps in the actual
agenda. This is a **known agenda day**, not verification of school attendance or
proof that gaps are free days. Response completeness remains unverified. Only
points seen in the latest successful response contribute dates, so retained
missing points cannot invent a day. Failed checks retain the last successful
agenda and its displayed timestamp; they never establish a new calendar.
If no future weekday is known, the UI shows today's work and an unknown-day
message instead of inventing Monday. During long breaks the existing rolling
request horizon may not reach the next school day; checking again closer to
school resumption is required. Planning start dates are the due-day proxy;
no separate verified submission deadline exists in the integration. No agenda
data is uploaded and no new permissions, schema migration or durable UI state
are added.

The dashboard defaults to tasks whose planning end time has not yet passed in
Europe/Brussels. It refreshes this filter every 30 seconds and on window focus.
Elapsed tasks remain available under earlier/all tasks, without automatically
changing progress or recording a source disappearance. Their observations and
audit records remain subject to the existing retention controls.

Progress is `open`, `in-progress`, or `done`. Bezig/Klaar checkboxes are mutually
exclusive; unchecking either returns to open. Assignments and explicitly marked
TypePunt 2 review points are eligible. Other lesson content and tests do not get
task controls. Progress persists on identical source tuples across successful
checks. A completed active task returns to `in-progress` when meaningful source
fields change or the item reappears. A `validFrom`-only change does not reopen it;
open/in-progress tasks keep their progress. Cancelled/hidden tasks keep their
local progress but leave the active task list and reject progress edits.
Restoring their active visibility reopens completed tasks. Automatic reopening,
its `task.status` audit entry (`source-changed`), source events and frozen
notification details commit in the same transaction. Retrying the same check
does not reopen a task the user completed again afterward.
Changed source IDs create a
separate item with open progress; no unverified identity merging occurs.

Nothing writes to Schoolware or synchronizes its `Completed` field. Existing
items migrate to open without producing a source-change event. Deletion/retention
removes progress with the scoped item. Notification content remains frozen at
its observation time, while linked progress controls show current local state.
Older notification snapshots without a local item reference cannot show controls;
use the dashboard for those tasks. Synthetic notification previews have no task
references and cannot change real progress.

Notifications include cancellations, hiding, reappearance and verified
disappearance within the selected categories and planning horizon. Moves out of
the horizon use the previous planning as well. Reopening happens regardless of
notification settings; alerts still require enabled notification channels.
Notification details and history explicitly identify automatically reopened tasks.

Disappearance remains gated by complete responses, verified identity and identical
coverage, with strict interior date boundaries. The live Schoolware adapter still
provides neither verified flag: missing points cannot be labelled deleted based
on `success: true` alone. Explicit `Vervalt`/`Verborgen` source changes are handled
immediately. A verified disappearance retains history, the last known lesson
snapshot and local identity for later reappearance; it does not prove deletion.
No additional permissions or schema version are required. Optional display
metadata remains compatible with older records.

## Live acceptance checks

Automated tests cover real version-1 migration, source-history preservation,
atomic log/status rollback, retry idempotency, profile isolation, reappearance,
retention/cap deletion, safe runtime messages, restarts and notification correlation.
Actual Chrome/OS behavior still needs acceptance testing:

1. Build/reload the extension and reload Schoolware. Existing source history must
   remain; settings should show a local activity log with a worker-start entry.
2. Run Nu controleren. Filter its correlation ID and inspect check/transport/
   observation/selection records; no payload, source ID or URL may appear.
3. Create a test system notification, click it, and close another test notification.
   Refresh logs; creation, click/clear/closure should share the test correlation ID.
   Inspect `byUser` without assuming it proves popup visibility.
4. Create a test Schoolware banner, click it, then dismiss a second test banner.
   Verify publication/render/open/dismiss records. Other websites have no banner.
5. In the dashboard, mark a task Bezig, then Klaar, then uncheck it. Refresh logs
   using its local item ID. From/to values and timestamps must match the actions.
   No extra Schoolware request or agenda-change notification should be generated.
6. Recheck/restart the worker and verify progress persists. Change status from
   a real notification detail page; another open extension page should refresh.
7. Export logs, inspect the local JSON metadata and delete the exported file when
   finished. Filter by correlation/item and verify exports respect those filters.
8. Clear logs; progress remains. Clear the active history; its progress and logs
   disappear. Disconnect during a check and verify erased IDs cannot reappear
   through late native close events. Other scopes remain isolated during scope-only
   deletion; disconnect removes all scopes.
