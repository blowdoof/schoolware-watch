# Security, privacy and notification review

## Candidate update (2026-10-10, 0.3.0)

Fresh compatibility preflight and server-side version enforcement prevent accidental
exchange by incompatible clients. Self-reported version headers are not an
authorization boundary. Device versions use the existing encrypted channel only
after opt-in; agenda/history/session content stays local. No new analytics,
remote executable code, permissions or SQL tables are introduced.

This source review does not certify the deployed service. Group secrets still
grant full read/write/delete access, with no individual revocation or verified
parent/teacher roles. Hosting access logs, TLS/WAF settings, backups, scheduled
retention cleanup and deletion require operator verification. Matthias's external
review remains a release gate. See [version compatibility](version-compatibility.md).

Review date: 2026-10-04. This report describes the current local working tree,
including the fixes below. It is a source review with synthetic tests, not a
penetration test or a certification of the deployed host.

## Remediation update (2026-10-04)

R1, R2 and R3 below describe the original findings. Source remediation now:

- Sends valid preference edits immediately during the input event, without a
  document-owned queue or waiting for permission prompts. The worker serializes
  writes and persists desired settings even when permission is absent. Actual
  notification delivery and script injection still require Chrome permission.
  Permission grants reconcile the latest persisted settings, so a late grant
  cannot restore a setting the user has since disabled.
- Counts only genuinely new operation IDs under the group lock. Duplicate-only
  retries succeed at capacity; oversized mixed batches roll back completely.
- Applies configurable global and per-enabled-token minute quotas to validated
  requests. Counters commit independently of operation success, unknown tokens
  create no per-token rows, old buckets are pruned, and overload returns 429.

PHP 8.2 and isolated MySQL 5.6 integration checks pass for quota boundaries,
rollback and concurrency. Hosting/WAF limits and actual server upgrade are still
required operational checks. These are application controls, not a DDoS guarantee.
See [production review](production-review.md) for current release status.

## Scope and conclusion

Reviewed the manifest/build, application layers in `src/`, runtime messages,
Schoolware discovery/transport/validation, observation semantics, IndexedDB
transactions/migrations/deletion, notifications, UI/settings, progress-sharing
crypto/transport, and the PHP endpoint, schema, administration utility and
deployment instructions. Existing synthetic tests were inspected and the whole
Vitest suite was run. Dependency advisories were checked with `npm audit`.

No critical or high-severity issue was identified. Two concrete issues were
fixed. The three medium-priority findings below are historical; see the remediation
update above for their current status and deployment requirements. Absence of
a finding does not prove absence of a vulnerability.

The supplied activity file was read in place, never copied into the project,
uploaded or committed. This report retains only aggregate diagnostic counts
and timestamps, without agenda content, item/profile IDs or credentials.

## Notification evidence

`schoolware-watch-activity-2026-10-04.json` contains 9,459 entries from October 2
18:59 to October 4 09:33 Europe/Brussels, with a healthy activity store:

- 114 successful checks and 114 notification selections, all skipped with
  `no-events`. No non-test system notification creation was logged.
- Six newly observed points in four checks on October 3:

  | Check time, Europe/Brussels | Newly observed points | Notification selection |
  | --- | ---: | --- |
  | 12:54 | 1 | Skipped, `no-events` |
  | 13:54 | 1 | Skipped, `no-events` |
  | 14:09 | 2 | Skipped, `no-events` |
  | 15:24 | 2 | Skipped, `no-events` |

- Before those checks, both channels were enabled, with a three-day horizon
  and tests, assignments and review selected. An observed point is not
  necessarily a task or a test.
- System tests on October 3 at 07:54 and October 4 at 08:36 were accepted and
  reported registered by Chrome. That does not establish a visible Windows
  toast. See the [Chrome notifications API](https://developer.chrome.com/docs/extensions/reference/api/notifications).
- Three banner publications were tests. Four failed checks were timeouts,
  distinct from the successful checks which filtered those observations.

The lack of automatic change pop-ups is consistent with notification selection,
rather than evidence of an attempted notification failing. The old log lacks
per-filter counters and individual planning/categories, so it cannot determine
which filter excluded each of the six points.

New diagnostics record bounded counts for baseline entries, unselected
categories, inactive points and points outside the horizon, along with the
configured horizon/categories. Settings explain them under **Laatste
meldingscontrole**. No titles, individual planning dates or source IDs are
added. Selection behavior and user preferences remain unchanged.

Change alerts consider events from the current check, with active planning
between now and the same Brussels wall time N calendar days later. A point
first observed outside that window does not alert later merely because its
planning enters the window. Initial observations are baselines. Daily to-do
reminders are independent: a fresh successful check at or after 16:00,
unfinished work and a known following schoolday are required. The export ends
before that time on October 4.

## Fixed findings

### F1 — Medium: pairing state could outlive an expired profile

Location: `src/storage/history.ts`, `read` and `setRetention`.

Shortening retention could remove an expired scope but leave its sync token,
encryption key, outbox and cached member data. Later cleanup iterated existing
scopes, so an already-orphaned record could survive indefinitely.

Retention updates now delete orphaned sync state in the same transaction as
scope pruning. Reads repair orphans left by older code. Two synthetic tests
cover expired/retained paired scopes and cleanup after reopening the database.
The progress-sharing panel clears a previously displayed pairing code when
a refreshed view reports sharing disabled.

This is local deletion only; it does not revoke a server token or delete remote
records, other devices or hosting backups.

### F2 — Medium: Schoolware response bodies had no size bound

Location: `src/schoolware/agenda-client.ts`, `readAgendaText`.

The previous `response.text()` path read the entire body before validation.
A fast large response could consume excessive memory/CPU despite the timeout.
Reading now stops at 5,000,000 streamed bytes, checks declared length early,
and cancels oversized bodies even with missing/dishonest length headers.
Such a response becomes `invalid-response`; no partial history is committed.
Synthetic tests cover both rejection paths. An unusually large legitimate
agenda may need a reviewed limit adjustment; failure remains non-destructive.

## Original findings (remediated in source)

### R1 — Medium: closing the settings document can discard queued edits

Locations: `src/ui/autosave.ts:6`, `src/ui/PreferencesPanel.tsx:66`.

An edit waits for the complete previous operation, including its worker reply,
before being sent. If a user edits twice while the first operation is pending
and closes the settings document, the second edit may still exist only there.
For example, a quick reversal of a notification setting can be lost.
Already-sent writes are coordinated by the worker; switching React views in
the same document also preserves the queue.

Settings now open in a shared browser tab, so ordinary popup closure no longer
destroys that settings document. Closing that tab, or navigating it again from
the popup before saving finishes, can still discard queued edits. This follows
from source inspection; document termination was not reproduced in live Chrome
here. Transfer valid edits promptly to a worker-owned ordered queue,
with an ordering/version strategy for permission-dependent edits. Verify rapid
edits plus immediate document closure, slow/denied permissions and worker restart.
Until then, **Automatisch opgeslagen** confirms that the latest edit completed.

### R2 — Medium: quota checks can reject an idempotent sync retry

Location: `server/public/sync.php:166`.

The capacity check adds the entire upload batch length to stored rows before
checking duplicate operation IDs. At the 20,000-record limit, retrying an
accepted batch returns 503 although it would insert no rows. A lost first
acknowledgement can therefore leave an outbox blocked until cleanup/deletion.

Count only genuinely new operations under the existing group lock. Add isolated
PHP/MySQL coverage for full-group duplicate retries, mixed duplicate/new batches
and atomic rollback at capacity. This PHP change was not made or deployed as
part of the extension fixes.

### R3 — Medium hardening: rate controls cover registration only

Locations: `server/public/sync.php:24` and `server/public/sync.php:118`.

Registration has hourly limits. Exchange/member/deletion requests have body and
storage bounds, but no application-level per-token/global request-rate limit.
Repeated requests can consume PHP/database capacity; valid exchanges serialize
on the group row. This is an availability concern, not evidence of cross-group
disclosure or a confirmed outage.

Add bounded request-rate controls and explicit overload handling, also at the
hosting layer where possible. Do not log raw IPs, Authorization headers or
request bodies to implement them. Hosting/WAF limits may already exist, but
the deployed configuration was unavailable for verification.

## Controls verified in source

- Schoolware transport constrains the HTTPS origin, exact endpoint and
  canonical parameters, and does not follow redirects. Browser-managed session
  use does not collect or store passwords, cookies or Schoolware tokens.
- Required permissions are storage and alarms. Other capabilities and two
  exact hosts are optional. Executable code is bundled; CSP limits scripts to
  self. No analytics, telemetry or remote payment SDK was found.
- Message schemas, extension ID and trusted page paths are validated. Schoolware
  top-frame content scripts have only narrow generic banner actions; they cannot
  request history or pairing secrets.
- Chrome local storage is restricted to trusted contexts during initialization.
  This matters because it is exposed to content scripts by default. See
  [Chrome storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage).
- Agenda projection uses an allowlist; structured comments retain pupil-visible
  instructions only. React/text nodes display untrusted content without HTML
  execution. Notification text is generic and activity metadata is bounded.
- Observation versions/events/checks and task changes commit atomically.
  Profile identities are scoped. Failed/incomplete/invalid checks cannot infer
  disappearance; first observation is not creation time.
- Optional progress sharing uses independent random keys/tokens, AES-GCM with
  random nonces and authenticated IDs, and keyed source identifiers. No titles,
  instructions, raw pupil IDs or Schoolware session material are uploaded.
  Peer labels are encrypted; responses are size/schema/cursor/acknowledgement
  validated and sent only to the fixed HTTPS service.
- PHP uses prepared statements, authenticated group scoping and row locks,
  private configuration, generic errors and bounded batches/storage.
- Retention/deletion controls exist. Exports are explicit local actions.
  Contact/support pages embed no remote assets; PayPal receives no agenda data
  through its user-opened link.

## Privacy and operational boundaries

IndexedDB is not encrypted at rest. Device/browser-profile access can expose
agenda data and local sync keys. Each shared group-secret holder can read,
write, delete and impersonate participants. There are no per-device roles or
individual revocation; peer labels do not prove identity. The server cannot
independently verify correct-pupil pairing.

Local deletion, remote deletion and access revocation are separate. Other
devices can retain data or upload again. Remote retention runs on requests,
not a guaranteed scheduled job. Idle groups, old migration tables, hosting
logs and backups require operator cleanup. Hosting can observe IP/timing even
when content is encrypted. Keep these limits explicit in product documentation.

Notification claims precede delivery to avoid duplicates; interruption can
lose an alert. Chrome acceptance does not prove OS visibility. Source timezone,
completeness and stable identity remain documented assumptions, so the live
adapter disables disappearance inference. See [monitoring](monitoring.md),
[privacy](privacy.md), [API assumptions](schoolware-api.md) and
[server rules](../server/INSTALL.md).

## Original review validation and limits

- Typecheck, lint, tests and production build passed; 204 tests in 20 files.
- `npm audit --json` reported zero vulnerabilities at review time. Package
  advisory checks do not cover all application or supply-chain risks.
- PHP 8.2/MySQL integration was not rerun; the PHP found in this shell is 7.3.
  Prior integration results do not cover R2's quota boundary.
- No production hosting access or authenticated server probing was used.
  Real Chrome alarm wake-up, popup destruction, interrupted delivery,
  two-device sharing and Windows visibility remain live acceptance checks.
- No publishing, deployment, upload, commit or push was performed.
