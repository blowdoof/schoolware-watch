# Help requests with recipients

Owner-authorized on 2026-10-09. Help is a separate flag, alongside Open, Bezig
or Klaar. It does not change Schoolware, completion, observation history or the
daily ordinary task count. Turning help off clears its recipients. A task's help
flag survives source changes/reappearance, including automatic reopening.

## User flow

The task and to-do panels offer Hulp nodig. When other named linked devices are
known, checking it opens a multiple-recipient picker. Saving without a recipient
is allowed; when no other named participants are known, checking saves directly.
The picker can be reopened to change recipients. Each effective change has a new
request UUID; an unchanged save neither creates a new request nor alerts again.
Existing Bezig/Klaar changes never clear help. A dedicated Hulp nodig section in
the to-do displays all visible help tasks, including completed, earlier and
future tasks. CSV adds an independent Hulp nodig column.

Recipients come from the existing optional encrypted participant-name feature.
Each receiving device must share a name at Settings > Voortgang delen and
synchronize to be discoverable; the sender must also share a name to fetch that
roster. Anonymous paired devices cannot be enumerated by the current service.
Names represent devices, not verified people or roles. If a person uses multiple
devices, select each intended named device. There is no email, mobile push or
verified teacher access. Cached names remain available after a roster failure;
the UI reports that the list could not be refreshed. Names that are no longer
in the roster cannot be newly selected, and self-addressing is rejected.

## Sharing and ordering

The existing planning-part channel carries a help value containing a keyed HMAC
of the task source identity scoped to the installation, the independent flag,
recipient device UUIDs and request UUID. All of these fields are encrypted.
No source title, instructions, raw task/pupil IDs, source URL or credentials
are uploaded. Help follows stable task identity, independently of the content
version used by completion. Local help/outbox writes are atomic; a concurrent
connection change or invalid recipient aborts the write. Pending local help
edits take precedence until acknowledged. Last server-accepted help edit wins
for the same task, with the existing seed-versus-manual precedence.

When sharing is first enabled, existing needed flags are seeded without
recipient references from an earlier group. Existing manual queued requests
take precedence. A group switch never silently forwards old recipients.
All linked devices need this extension version. Existing PHP, API shape and SQL
tables need no migration. Only the privacy-page source needs publication at the
next authorized release. This implementation performs no deployment.

## Delivery and retention

Only a latest, still-active request addressed to this device produces a specific
generic help system notification. Requests are also highlighted as Hulp aan jou
gevraagd in the to-do. Help-only updates do not generate an ordinary shared
progress notification on unrelated devices. System delivery respects existing
notification settings and Chrome permission; Chrome must be running and the
group must successfully synchronize. Source-session validity is not needed to
receive the encrypted flag, but task details need a matching locally observed
task. Requests for not-yet-observed tasks can be notified generically and become
visible when the source task is locally available.

Complete pagination is required before delivery. A durable per-task request
claim is written before calling Chrome's notification API. Worker interruption
or API failure after claiming may lose that one notification, but cannot repeat
it. The in-app flag remains visible. When delivery is disabled or permission is
missing, no claim is taken; the latest still-active request can be delivered
after settings/permission become available and synchronization runs again.
Superseded or cancelled requests are not replayed. Multiple newly addressed
requests in one exchange produce one generic notification; the to-do lists them.

Help metadata follows its enclosing local task's retention/deletion. Remote
encrypted operations, cache limits, retention, deletion, backups and shared-code
access limits are those of existing shared planning. Any full pairing-code
holder can decrypt recipient references and modify help requests; targeting is
notification routing, not read isolation or authorization. Reconnecting creates
a new device reference, so requests to its old reference must be re-addressed.

## Validation

Synthetic repository/transport tests cover independent flags across statuses,
observation changes and restarts, two recipients among four isolated databases,
first-download delivery, cancellation/reactivation, unchanged edits, complete
pagination, pending-local precedence, notification preference/permission,
invalid/self/cross-profile addressing, transaction rollback and encrypted
transport without source content. UI rendering verifies visibility for completed
tasks, CSV and malformed view rejection. The Chrome shared-planning smoke also
exercises the real recipient picker, worker-owned save, addressed delivery
without replay and cancellation in two isolated extension stores, using a mocked
service and synthetic data only.

Validated on 2026-10-09: typecheck, lint, all 371 tests across 32 files and the
production build pass. Chrome 155 passes the updated two-device planning/help
smoke and the existing setup/settings/CSV/special-day/bookbag/sharing suite.
