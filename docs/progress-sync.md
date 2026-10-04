# Optional self-hosted progress synchronization

All sync invocations and remote stages have privacy-preserving local activity
records, including automatic minute-alarm runs and their success/failure. See
[activity diagnostics](activity-and-tasks.md) for stage names, counts, safe
failure reasons and correlation IDs. A succeeded runtime request alone does not
prove a successful exchange. New diagnostics require a rebuilt/reloaded extension;
they cannot recover details absent from older exports.

## Status and authorized scope

Initial implementation is available locally; not deployed or live-validated. On 2026-10-03 the owner requested
cross-computer task progress sharing and offered self-hosted infrastructure.
This request explicitly extends the earlier local-only scope for progress only.
Agenda content, Schoolware credentials, observation history and notification
preferences remain local. No analytics or third-party synchronization is added.

The owner and pupil use different Schoolware accounts. A cross-account sample
comparison supports shared source identifiers for the inspected installation;
long-term stability remains unverified. Browser-local random IDs must not be
used as shared identities.

## Implementation

Target `https://schoolware.bumper.be` on the owner's existing cPanel hosting.
Use a small PHP API with PDO and MySQL/MariaDB, served by the existing webserver
and HTTPS certificate. The earlier Node.js/SQLite and Docker proposal is
superseded by the owner's hosting clarification. No Docker, additional proxy,
public database port or background application process is required. The
extension remains TypeScript. Deploy the PHP API separately from the locally
bundled MV3 extension. The server must not call Schoolware or hold a Schoolware
session. The owner configured PHP 8.2 and a dedicated database. Confirm `pdo_mysql` on the host during installation.

Create the subdomain with its own document root in cPanel; point its DNS A
record at the hosting account's public address at the authoritative DNS
provider. Use cPanel's existing TLS/AutoSSL facilities. Store database
configuration outside the public document root. Use a dedicated database and
database user, transactional InnoDB tables and prepared statements. Server
revisions must be allocated transactionally, not from PHP process memory.
Deploy through the account's file manager or SFTP once the API is implemented.

Synchronization is disabled by default. Each isolated server group and shared encryption key represent one pupil
at one installation; multiple groups share one database. Devices explicitly join using a saved pairing code.
Separate children require separate groups, access tokens and encryption keys. Parent and pupil continue using
their own Schoolware sessions. Host permission is requested for the configured
HTTPS synchronization origin only when the owner enables synchronization.
Reject credentials in URLs and cross-origin redirects. Validate messages,
responses, payload sizes and destinations at the worker boundary.

The server stores one verifier hash per group, encrypted progress operations,
operation IDs and a monotonically increasing revision per group. Every query,
cleanup and deletion is scoped to the group authenticated by its token.
At the owner's request on 2026-10-04, first-computer setup now automatically
registers an isolated group after the administrator enables registration once.
No per-user administration is needed. Registration is transactional, idempotent
for an existing active token and bounded by per-IP/hour, global/hour and total
group limits. The private CLI can disable registration or revoke a group.
There are no per-device credentials or parent-only roles in this version.
Authentication is independent of Schoolware. The requested opt-in sync requires
its own revocable device credentials, distinct from the prohibited persistence
of Schoolware authentication material. Store server-side verifier
hashes rather than plaintext credentials and exclude credentials from logs.

Generate a 256-bit AES-GCM encryption key on the first device. Share it only through the
device-pairing material (shown only on explicit request in a trusted extension page); never send it to the server. Use authenticated
encryption with fresh nonces. Encrypted operations contain a pupil-scoped opaque
item key, Open/Bezig/Klaar progress, an operation ID and content-version context.
Do not upload titles, instructions, names, source URLs or raw source identifiers.
The server can still observe request timing, devices and ciphertext sizes;
encryption does not hide those metadata.

The worker owns synchronization. IndexedDB holds the device configuration,
outbox, operation IDs, receive cursor and optional pending registration flag.
Generate and save the token/key before registering; retries use the same token
after worker restart. Joining never creates a group. A status edit and its outbox
operation must commit atomically. Retry with the same operation ID after a
timeout or worker restart. Persist received operations and the cursor together.
Sync failures must not roll back local progress or a successful agenda check.

Use bounded periodic polling and immediate upload after a local status edit.
Show connection state, last successful sync and pending edits in settings.
Do not promise instantaneous delivery when Chrome is closed or suspended.
Provide local disconnect and explicit encrypted remote-data deletion separately
from local-profile deletion. Revoke shared access by disabling the server group with the private CLI;
this revokes all devices in that group. Server retention is configured in the private PHP
configuration, independently of local history retention.

## Known participants

Each named connection announces a user-chosen name or role encrypted with the
existing group key and a separate authenticated `member:CONNECTION_ID` context.
The per-connection random UUID is durable across worker restart, changes on
re-pairing and carries no Schoolware identity. The server stores only encrypted
labels and UTC receipt timestamps in a separate group-scoped table. Member
updates do not consume progress revisions and cannot alter task/observation
history. Existing unnamed clients can continue exchanging the original protocol.

The settings panel shows other named connections, the local name and the last
server-reported activity time. Names are not verified identities, timestamps
are not proof of current online presence, and clients that never announce a
name do not appear. Sharing a secret cannot produce a complete access-control
roster. Users can rename locally; subsequent member exchanges carry that name.
Member responses are decrypted/validated fully before an atomic cache write,
with connection/token/key/name guards against stale replies. Errors retain the
old list and a separate error flag without failing successful task progress.

Normal disconnect/profile deletion attempts a scoped leave before erasing local
credentials; offline deletion is still local and may leave a stale remote name.
Membership retention follows server retention. Remote deletion removes both
membership and progress atomically. The CLI still revokes at whole-group level.
See ../server/INSTALL.md for the additive schema/API upgrade and limitations.

## Identity gate

### Local comparison on 2026-10-03

The owner supplied a second response after opening the pupil's laptop. Compared
locally with the earlier parent response, 110 points could be paired uniquely
by content, source times, type and subject for investigation only. Of these,
25 were marked types (100, 101, 1001, 1002 or 9).

- ID, AgendaID and UniekAgendaPuntID matched in all 110 pairs.
- OrigineelPuntID matched in all 49 pairs containing it and was absent on both
  sides in the remaining 61 pairs.
- All 25 marked pairs had matching OrigineelPuntID values.
- HerhaaldAgendaPuntID matched when present on the paired entries and was
  absent on both sides otherwise.
- ID was unique within each supplied response; UniekAgendaPuntID and
  OrigineelPuntID were not unique across all points.

No source identifiers, titles, request URLs or payloads are recorded here.
Content matching was an investigation technique, not a runtime identity rule.
The comparison supports using the exact source tuple already used for local
observations as a conservative cross-account candidate. This tuple includes
ID, AgendaID, UniekAgendaPuntID, optional OrigineelPuntID and optional
HerhaaldAgendaPuntID. Hash it under an explicitly paired pupil space and the
installation origin, independently of local request dates or local random IDs.
Do not automatically merge changed tuples or infer stability through edits,
rescheduling or recurrence. Such changes can leave progress unmatched until
additional evidence establishes a safe relationship.

Current `localId` values are independently generated on each computer.
Current observation keys include account-sensitive source fields and configured
request scope. Neither is suitable as an unverified shared item identity.

Compare the same marked items in both accounts for ID, UniekAgendaPuntID,
OrigineelPuntID and AgendaID. Retain only equality/absence findings in this repo.
Verify candidates across repeated checks, recurrence and rescheduling before
using them. A shared original ID alone is insufficient if multiple occurrences
reuse it. Never merge by title, subject or matching text.

Once supported, derive opaque item keys with a keyed digest of the verified
identity and installation, under the explicit shared-pupil space. The server
does not receive the underlying identifiers. Ambiguous or unsupported items
remain local and show a clear explanation. Changing the local request window
must not merge different pupils or accidentally erase shared progress.

## Conflict and content-change behavior

Use server revisions to order accepted edits rather than comparing device wall
clocks. State the offline policy explicitly: a queued edit accepted later can
supersede an edit made earlier on another computer. Preserve an operation ID for
deduplication and make the resulting status understandable to users.

A remote status must not create a Schoolware observation event or a new-item
notification. Local automatic reopening after a meaningful source change also
needs a synchronized operation. Bind completion to a digest of the meaningful
content version, excluding GeldigVan-only changes, so stale completion cannot
silently mark changed work as done. Hold operations for unseen versions until
the local agenda check resolves the version. Explicit edits take precedence over automatic reopening for the same version.
These rules have synthetic domain/repository tests.

## Validation and remaining live checks

- Cross-account sample comparison and synthetic exact-tuple isolation are documented; long-term ID stability remains unverified.
- Test pupil isolation, ambiguous IDs, recurrence and rescheduling.
- Encryption/wrong-key/tamper and disconnect tests pass; shared-token revocation and real pairing still need Chrome smoke tests.
- Test duplicate requests, concurrent edits, offline queues and worker restarts.
- Test atomic status/outbox and receive/cursor transactions and migrations.
- Test content-change reopening and stale remote completion.
- Run typecheck, lint, Vitest and build; verify optional permissions and both
  parent/pupil browser sessions in Chrome.

The selected host is schoolware.bumper.be. See ../server/INSTALL.md for the
cPanel document-root layout, PHP configuration, schema import, server retention
and explicit deletion behavior. No production service or remote artifact has
been created by the local implementation.
