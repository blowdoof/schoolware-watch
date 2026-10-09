# Privacy

The local information page includes a plain-language Dutch privacy summary and
external contact/source/site/donation links. No remote resources are embedded.
The PayPal link opens the owner's public `paypal.biz/bumperpuntbe` profile with
no query parameters; the support page also shows the PayPal receiving email. No student,
agenda or local profile data is included in the link. PayPal is
contacted only when the user opens that link and handles any subsequent payment
under its own privacy policy. See [Project information](project-information.md).

Schoolware Watch has no analytics or telemetry. Agenda history stays local.
At the owner's explicit request, optional progress-only synchronization can use
the owner's PHP service at `https://schoolware.bumper.be`. It is disabled until
devices are explicitly paired. Encrypted progress operations and optional
encrypted participant announcements are uploaded;
no titles, instructions, raw pupil/source IDs or Schoolware session material is
sent. The independent sync credential and encryption key are stored locally in
IndexedDB, separately from Schoolware authentication. A device with access to
that browser profile can read these keys. The server stores a token verifier per isolated group,
encrypted operations, operation IDs, revisions and receipt times. The host can
observe connection metadata. One pairing is for one explicitly selected pupil;
the server cannot independently verify that both devices selected that pupil.
Users can create groups without providing names, email addresses or Schoolware
credentials. Self-registration is opt-in and uses a random token generated in
the extension. The encryption key never leaves the device except through a
privately shared pairing code. Only trusted extension pages can explicitly
request display of that code; routine status and activity logs omit it.

Names are optional in the setup UI. New status/label ciphertext is padded to a
fixed length; older unpadded records and clients can still reveal length. Device
announcements update a last-seen timestamp roughly every minute while Chrome
runs. Private request/registration rate identities group IPv6 addresses by /64.
The operator's private `purge` command reaches idle groups; without an installed
schedule, idle data can remain indefinitely. Remote erasure preserves group
access/revision/activity metadata. Cleanup of disabled groups retains only a
revocation verifier indefinitely so a revoked code cannot self-register again.
Server registration counters use keyed IP digests that change each UTC hour,
never raw IPs. Counters older than 24 hours are pruned during successful new
group registrations. Idle counters remain until another registration or manual
cleanup. The host may still keep its own access logs. Limits apply per network,
globally and to total groups; there is no analytics or email/password account.
See [installation and deletion rules](../server/INSTALL.md) for shared-token
revocation, retention, remote deletion and the absence of per-device roles.

At the owner's request, named participant display shares self-chosen names or
roles encrypted under the existing group key. Names are provided by users,
never extracted from Schoolware accounts or agenda data. The server retains
ciphertext, a random per-connection ID and its last receipt timestamp, scoped
to the authenticated group. Names remain plaintext only in the participating
browsers. This adds no identity verification or user accounts. Names and peer
IDs are omitted from activity logs and Schoolware content-script messages.
The list is a last-known announcement list, not a complete list of people who
possess the group secret. Older/unnamed clients are invisible. Remote membership
retention follows the private server setting, cleanup runs during a member
exchange, and offline disconnect may leave a stale announcement. Group deletion
removes announcements with encrypted progress; it does not revoke shared access.

Automatic connection is explicitly started by the user. Optional `webRequest`
and the existing installation host access are requested from that click. Only
validated agenda request URLs from the dedicated Schoolware tab's top frame
and same-origin initiator are accepted, during a five-minute window. No request
headers, bodies, session material or page content are collected. Temporary tab,
request and confirmation metadata are held in trusted `chrome.storage.session`,
cleared on cancel, confirmation, expiry or local connection deletion. The
confirmed allowlisted agenda URL is stored locally for subsequent monitoring.
No candidate URL or source identifier is included in discovery status or logs.
No setup message from a Schoolware content script is trusted. A changed request
invalidates an earlier confirmation. Recognition does not change profile data
until the user confirms; normal response validation still gates history writes.

Checks use only the observed Schoolware origin after the user grants access.
Polling defaults to every 15 minutes after connection and can be disabled.
It stores the
validated request URL (including local profile/agenda identifiers and date
coverage) and total/category counts, status, and timestamp in chrome.storage.local.
Local settings also contain polling preferences, colors, notification categories,
the notification horizon and retry counters/times. Actual requested date coverage
and notification claims accompany check metadata in IndexedDB.
The generic Schoolware-banner inbox stores at most 20 pending notifications:
random check IDs, counts, timestamp, horizon, test flag and a local scope reference.
No title, instruction, source item ID or credential is copied into this inbox.
IndexedDB stores only the source-ID tuple and normalized title, pupil-visible
instructions, type, source dates, recurrence and visibility/cancellation flags
needed for observation comparison. Lesson context additionally stores subject,
room and a grouping key derived from agenda/lesson identifiers. Qualifying checks
store minimized snapshots of the fetched points in affected lessons, including
unchanged points, for notification drill-down. These snapshots are committed with
the observations and deleted with expired checks or history. Staff names, student
descriptions and other non-allowlisted source fields
are not copied from the response. Titles/instructions can themselves contain
personal information and remain local. No full raw response is persisted.
Schoolware response reading is bounded to 5,000,000 bytes before parsing, even
without a reliable Content-Length header. Oversized responses are rejected
without partial history writes. Retention pruning also removes local sync
credentials, outbox and cached participants when their profile expires;
reads repair orphaned pairing state left by earlier versions. This local
cleanup does not delete remote records or revoke access on other devices.

History is stored locally in extension IndexedDB. Local storage is
not an encryption guarantee: access to the browser profile or device can expose
its contents. Store only the agenda fields required for comparison and display.
Keep settings in chrome.storage.local, not chrome.storage.sync.

Reuse the user's existing Schoolware session without persisting passwords,
session cookies, authentication tokens, or authorization headers. Restrict
permissions to the verified installation origin and validate message senders.

Retention defaults to 90 days, selectable as 30/90/180/365 days. Reads and checks
prune expired events/checks across all scopes; changing retention prunes
immediately. Recently observed current content remains. The browser must run an
extension operation for cleanup; successful periodic checks also perform cleanup.
Settings can clear the active scope or disconnect and delete every scope,
connection configuration, preferences and retention setting. Disconnect also
cancels the polling alarm and clears extension notifications. Retention pruning removes
events/content/checks together within a transaction.

The local IndexedDB activity store contains only allowlisted operation names,
result codes, counts, UTC timestamps, timings, setting intervals/horizons,
random correlation/span IDs, random local scope/item IDs, changed field names,
and local task-status transitions. It never contains agenda text, source IDs,
request URLs, headers, cookies, tokens, raw responses or exception messages.
The log is always enabled, follows history retention and has a 20,000-entry cap.
Progress-sharing diagnostics record generic stage results, automatic/manual
triggers, bounded HTTP status codes, counts and timings. Remote task edits use
random local item references and generic before/after status values. Tokens,
encryption keys, pairing codes, participant names/IDs, ciphertext, keyed source
identifiers, URLs and raw exceptions are excluded. Minute-alarm success is logged
even when no progress changed; partial member-list failure is recorded separately.
Settings can filter, export to a local JSON file, or delete it. Export does not
upload data; an exported file remains on the user's device until the user deletes it.
Scope deletion removes its audit correlations and task progress. Disconnect clears
all activity. Deletion deliberately leaves no retained deletion receipt.

Each task gets a random local item ID, independent of Schoolware identifiers.
Local open/in-progress/done state and its change timestamp stay with that scoped
item. The extension does not send progress updates to Schoolware. Both the local
status update and its audit record commit in one transaction.

For structured Commentaar JSON, only the `leerlingen` string is retained;
`prive` and unknown members are never persisted. Malformed structured comments
fail validation instead of being stored as raw private content. Instructions are
displayed as text, with no HTML execution or externally loaded resources.
Notifications are off by default and require an explicit optional Chrome permission.
They contain only generic new/changed counts; source titles and names are never
included. Notification IDs contain random check IDs, not student/source IDs.
Clicking a notification opens a local extension page with the affected lesson
snapshots. Its URL contains only the random check ID. Detail reads are restricted
to trusted extension pages and the currently configured scope. Schoolware content
scripts cannot request these details; they receive only generic counts and random
alert IDs. Test clicks show explicitly synthetic data without storing fake history.
Enabling notifications does not send data to an external service. Local browser
and operating-system notification controls determine whether pop-ups appear.

The optional banner requires scripting permission and uses only the existing
verified Schoolware origin. It runs in the top frame, renders generic counts in
its own shadow root, and never reads page text, forms, credentials or cookies.
Other websites and extension pages have no banner. Content scripts cannot read
trusted local connection/history storage and can request only a minimized banner
view or dismiss/open actions. Browser and system notifications are independently
configurable. Pending browser banners follow retention; scope clearing removes
its banners, and disconnect removes all banners, unregisters the script and
revokes Schoolware/scripting access. Disabling the banner stops injection and
hides it, while Chrome keeps optional permissions until revoked/disconnected.

CSV export is an explicit local user action. Warn within that action that the
file contains personal information and escape formula-like cell values.

Local special-day titles, notes, dates and checklists are stored inside the
selected IndexedDB profile. They are never sent to the encrypted progress
service or written into activity logs. Existing history retention, profile
clearing and disconnect remove them. Generic preparation notifications expose
no event titles or checklist text. User-downloaded CSV files remain outside
extension retention/deletion controls. See [feature details](csv-and-special-days.md).

Only synthetic fixtures belong in Git. The private data directories and HAR
files are ignored, but ignore patterns do not replace review of staged changes.

## Request-rate metadata

The approved optional progress service limits validated requests using global
and per-enabled-token UTC minute buckets. It stores only one-way bucket digests,
minute timestamps and counts, never raw tokens, IPs, headers or bodies. Old
buckets are pruned on subsequent requests after two minutes; idle deployment
cleanup remains the host operator's responsibility. Hosting connection metadata
and backups remain separate from application storage and its deletion controls.
