# cPanel installation: schoolware.bumper.be

## Compatibility and attribution upgrade (0.4.0 candidate, 2026-10-10)

Copy `sync-policy.php` to `/home/example-account/sync-policy.php` outside the public root,
then replace `public/sync.php` at the existing HTTPS endpoint. Existing database
tables remain unchanged; no SQL migration is required for this upgrade.
Optional configuration defaults are `sync_minimum_protocol = 3`,
`sync_maximum_protocol = 3`, `sync_minimum_version = '0.4.0'`, and
`sync_latest_published_version = null`. Set the latter only after actual release availability.
If the private configuration explicitly sets the earlier candidate's policy,
update those values too. Application versions and review/author fields remain
inside ciphertext; no SQL or local IndexedDB structure migration is needed.

Coordinate the endpoint upgrade with installation of the new client on every
participating device: old clients without version headers receive HTTP 426 before
uploads. They cannot show the new update-specific message. New clients pause
against old endpoints. Do not lower the protocol minimum to bypass this protection.
Deletion and member departure still accept old clients. Version headers are
self-reported compatibility claims, not authentication or a security boundary.
The compatibility response contains no group contents; existing quotas apply.

Test the candidate and existing encrypted records in an isolated environment
before upgrading production. The legacy-compatibility harness exercises old
cryptographic formats through a transport with current headers; it does not
claim that a deployed 0.1.0 client may synchronize against the new policy.
See [version compatibility](../docs/version-compatibility.md) for release gates.

The API requires PHP 8.2 with PDO MySQL and a dedicated MySQL/MariaDB database.
No Docker, Node.js server or publicly exposed database port is needed. Schedule
the private maintenance command daily to remove expired data from idle groups.
One database supports multiple isolated groups, each representing one pupil.
Each group has its own random access token and client-side encryption key.
Users create their own groups from the extension after the host administrator
enables self-registration once. The API derives the group from the token,
never from a client-supplied
student or group ID. No Schoolware account or plaintext student name is stored server-side.
The extension still connects to one group/local agenda selection at a time.

## Upgrade for request limits and retry safety (2026-10-04)

Before replacing the endpoint, import the updated `schema.sql` into the existing
sync database. Its `CREATE TABLE IF NOT EXISTS` statements preserve existing
groups, revisions, ciphertext and pairing codes, and add `sw_sync_request_limits`.
Use a private backup and the host's maintenance procedure before any production
schema change. Then replace `public/sync.php`. No server deployment is performed
by the repository changes.

Existing private configuration remains compatible. Optional settings
`requests_per_minute` (default 6000 globally) and
`requests_per_token_minute` (default 120 per enabled group token) must be integers
from 1 to 100000. All validated actions count, including registration retries,
exchange, membership, deletion and operations that fail after authentication.
Unknown tokens use a separate keyed peer bucket (IPv6 /64) and never consume
the enabled groups' global bucket. `requests_per_unknown_peer_minute` defaults
to 120. Overload returns HTTP 429 with
`Retry-After` until the next UTC minute. Choose limits for expected paired-device
counts; legitimate retry bursts can be throttled too.

Counters commit before the operation transaction, so failed operations cannot
bypass quotas. Bucket keys are one-way digests, not credentials; no IP, raw token,
header or payload is stored. Old minute buckets are pruned on requests after two
minutes. Idle counters need operator cleanup if immediate expiry is required.
Database rate controls do not prevent connections/body parsing from reaching PHP;
configure hosting/WAF connection and body limits as an additional layer.

Duplicate operation IDs remain acknowledged even at the 20,000-row capacity.
Only new operations consume capacity, and an oversized mixed batch rolls back
all inserts and revision changes. Capacity failure remains HTTP 503.

Validate upgrades with the isolated harness in `server/tests/integration.py`
using PHP 8.2 and a disposable localhost MySQL database on port 33307. The harness
covers full-group retries, mixed batches, rollback and concurrent request quotas.
Never point it at the hosting database.

## Files and database

1. In phpMyAdmin, select `example_sync` and import `schema.sql`.
   The tables use InnoDB; other tables are not touched.
2. Create a private folder, for example `/home/example-account/schoolware-sync`, with
   a `public` child directory. Adjust the home path to the actual cPanel account.
3. Set the subdomain's document root to that `public` directory. Upload
   `public/sync.php` and `public/.htaccess` there. Copy `maintenance.php` to
   `/home/example-account/maintenance.php`, the absolute private path required by the API.
   This also supports a document root at `/home/example-account/public_html/schoolware`.
   No other project file belongs
   in the public directory. Ensure HTTPS works before enabling the extension.
4. Copy `config.example.php` to `/home/example-account/schoolware-sync-config.php`.
   It must be outside ALL websites' document
   roots, not merely outside the subdomain's directory. Set permissions to 600
   where the PHP handler runs as the account user.
5. Keep `user` and database name as `example_sync`; fill in the database
   password privately. Use the actual database host if it is not `localhost`.
   Do not send this file, password or the pairing code in chat or commit it.

Example layout:

```text
/home/example-account/schoolware-sync/
    public/                       <- subdomain document root
        sync.php
        .htaccess
/home/example-account/schoolware-sync-config.php
/home/example-account/manage-groups.php
```

The API and CLI manager currently load `/home/example-account/schoolware-sync-config.php`.
For the existing deployment, keep `sync.php` and `.htaccess` in
`/home/example-account/public_html/schoolware/` and the configuration in `/home/example-account/`.
For other accounts, adjust that private absolute path in both PHP files. Do not place the configuration in a
directory accessible through another website.

## Upgrade participant display on an existing server

1. Back up the database and import the latest `schema.sql` into the existing
   database. It adds `sw_sync_members`; existing groups and progress are retained.
2. Upload the latest `public/sync.php` over the current endpoint at
   `/home/example-account/public_html/schoolware/sync.php`.
3. Reload the built extension on all participating computers in their existing
   directories. No migration, CLI command, registration toggle or re-pairing is
   needed for this update. Private configuration remains unchanged.
4. Each participant enters a self-chosen name or role in progress settings.
   Valid edits save automatically. After synchronization, the other computers
   show the name and last server-reported activity time.

The list contains known named connections, not verified accounts or a complete
access-control roster. Users of older extensions or unnamed connections do not
appear; anyone possessing the pairing code can access the group even without
announcing a name. Offline/recently disconnected computers may remain visible
with their last timestamp. Never infer revocation from this list. To revoke
access, disable the entire group with the private CLI.

The new `members` API accepts only encrypted labels and a random connection ID,
and stores no plaintext names. Payloads use the same encryption key with a
separate authenticated `member:` namespace. Labels are limited to 48 characters;
control/bidirectional-format characters are rejected. Each group has at most 50
named connections; refreshing an existing member is possible at capacity.
All member operations are authenticated and scoped to the group derived from
the token. Names and timestamps never enter progress revisions or task history,
so older clients can continue exchanging progress. A member-list failure does
not invalidate successful progress synchronization or erase the last known list.
The UI displays a separate participant-update error.

On successful named synchronization, the connection refreshes its encrypted
label. `lastSeenAt` is server UTC time, formatted in Brussels time in the UI;
it does not prove a person is currently online or has read a particular task.
Membership timestamps use a UTC database session. Members older than the private
`retention_days` setting are pruned during a successful member exchange in that
group. Without exchanges they remain until administrative or remote deletion.
A normal disconnect or local profile deletion attempts a scoped `member.leave`
request before erasing local credentials. If offline, local deletion still
succeeds but the remote name persists until cleanup. Remote group deletion
removes both encrypted progress and named members atomically. Other connected
devices can announce/upload again; neither deletion nor leaving revokes a token.
All members share the same token/key and can impersonate names or remove peer
announcements. This display must never be presented as verified identity.

## Enable self-service on an already migrated server

If `migrate-legacy` succeeded previously, do not run it again. Existing groups,
pairing codes and cursors remain valid through this additive update.

1. Back up the database and import the latest `schema.sql` into the existing
   database with phpMyAdmin. This adds registration settings/rate-limit tables;
   existing group tables and data are unchanged.
2. Upload the new `public/sync.php` over the existing endpoint and upload the new
   `manage-groups.php` to `/home/example-account/manage-groups.php` outside document roots.
   The private config path and database credentials stay unchanged.
3. Run this once in PuTTY/SSH using the hosting account:

   ```sh
   /opt/cpanel/ea-php82/root/usr/bin/php /home/example-account/manage-groups.php enable-registration
   ```

4. Reload the built extension on each computer in its existing directory. Current
   users stay paired. New users select "Eerste computer instellen" and click
   "Nieuwe leerlinggroep aanmaken"; no administrator-generated token is needed.
5. Test a new group and a second computer with its pairing code. Confirm that
   your existing group still synchronizes and cannot see the new group's edits.

There is no command to run per new user. Default registration limits are 5 new
groups per remote IP per UTC hour, 50 globally per UTC hour and 1,000 groups in
total (including disabled groups). Override `registrations_per_ip_hour`,
`registrations_per_hour` and `max_groups` in the private config if needed;
values must be integers from 1 to 100000. Shared networks count as one IP.
Only Apache's `REMOTE_ADDR` is used, never client-provided forwarding headers.
Behind a proxy, configure trusted server-side address handling before use.

To stop new registrations without disrupting current groups:

```sh
/opt/cpanel/ea-php82/root/usr/bin/php /home/example-account/manage-groups.php disable-registration
```

Registration uses a fresh 256-bit token generated locally; only its SHA-256
verifier is stored by the server. Encryption keys never leave the extension.
The token, encryption key and pending registration are saved locally before
network access. A timeout or worker restart retries with the same token; an
already registered active token returns success without creating another group
or consuming quota. Joining a group never registers a new one. A disabled token
cannot be reactivated by registration, and rate-limited attempts create no group.
A global registration lock makes quota checks and insertion one transaction.

The rate-limit table stores hourly keyed IP digests and counts, not raw IPs.
The digest changes each hour; counters older than 24 hours are pruned during
successful new registrations (with no new registrations, old counters remain).
The private digest secret is generated once by the CLI and stored in the DB.
This adds no analytics. Hosting access logs may still record connection metadata.
These quotas bound enrollment; they are not a guarantee against distributed
abuse. Monitor hosting capacity and disable registrations if necessary. Each
registered group retains the existing 20,000-operation storage limit.

## Upgrade the existing single-group installation

1. Back up the database and private configuration. Pause synchronization on all
   devices (close Chrome) and temporarily rename the live `sync.php` to a name
   ending in `.php`, such as `sync-maintenance.php`. Do not use `.bak` for PHP
   files. The usual endpoint must remain unavailable until step 5. No client
   may use the old endpoint during migration.
2. Import the new `schema.sql` into the existing database in phpMyAdmin. It adds
   group and registration tables and leaves legacy tables unchanged; no new
   database is needed.
3. Upload `manage-groups.php` to `/home/example-account/manage-groups.php`, outside every
   document root. Keep the existing private configuration, including its
   `token_hash`, for this migration.
4. Run in cPanel Terminal with PHP 8.2:

   ```sh
   /opt/cpanel/ea-php82/root/usr/bin/php /home/example-account/manage-groups.php migrate-legacy
   ```

   This copies ciphertext, revisions and the verifier into one group atomically.
   A repeated invocation skips an already migrated verifier. Existing pairing
   codes, encryption keys and device cursors stay valid. Save the printed group
   ID privately for administration. Never run this while the old API is active.
5. Upload the updated `public/sync.php` as
   `/home/example-account/public_html/schoolware/sync.php`. Restart Chrome and click
   "Nu synchroniseren". Do not disconnect or generate new pairing codes.
6. After confirming both devices work, remove the old endpoint copy. Remove the
   legacy `sw_sync_meta` and `sw_sync_operations` tables in phpMyAdmin after
   backing them up. Until removed, they contain an independent old snapshot
   unaffected by deletion through the new API. Remove `token_hash` from the
   private configuration after migration; group verifiers now live in the DB.
7. Build the extension and reload its existing installation on each computer
   to update the explanatory UI text. Keep the extension ID/directory.

Database credentials and `retention_days` remain unchanged. Do not rerun the
legacy migration after removing legacy tables. To roll back before step 6,
pause devices and restore the matching pre-migration database and endpoint;
a rollback to an earlier revision can require device reconnection.

## Group administration

Normal enrollment happens in the extension. The private `create` CLI command
remains available for administrative recovery/testing, but users do not need it.
An administrator-created token can be joined using a `sw1.TOKEN.KEY` pairing
code with a privately generated independent 64-character hex encryption key;
normal users should use the automatic first-computer setup instead.
The database stores no family names or Schoolware identities. There are no user
accounts or email verification; possession of the secret pairing code grants
access to that group. Never put tokens or pairing codes in URLs or support logs.

To revoke every device in a group without affecting other groups:

```sh
/opt/cpanel/ea-php82/root/usr/bin/php /home/example-account/manage-groups.php disable GROUP_ID
```

Disabled groups keep encrypted records until an administrator removes them;
periodic API retention applies only on successful exchanges in that group.
Create a new group in the extension and reconnect devices to resume sharing. This does
not transfer encrypted history; the first device seeds its current progress.
The sync deletion button removes records for its authenticated group only.
It does not revoke its token, and other devices can upload again.

## Connect the computers

1. Build/reload the updated extension on both computers and run a successful
   agenda check for the same pupil in each account.
   For an existing unpacked installation, replace files in its existing
   extension directory and use Chrome's Reload button. Keep that directory and
   extension ID to preserve local history. Do not remove/reinstall the extension
   or load a second copy from a different directory just to update it.
2. On the first computer, open Settings, then "Voortgang delen tussen computers".
   Choose "Eerste computer instellen", enter a self-chosen name/role and click
   "Nieuwe leerlinggroep aanmaken".
   Grant optional access to `https://schoolware.bumper.be/*`.
3. Save the resulting pairing code privately. A paired computer can show it again
   with "Koppelcode tonen". Existing Bezig/Klaar status on this first computer is
   queued for upload.
4. On the second computer choose "Koppelen aan een bestaande computer", enter
   that pairing code and a self-chosen name/role, and click "Koppelen". Do not create another first computer:
   that would create a separate group instead of joining the existing one.
5. Use "Nu synchroniseren" on both computers for the first smoke test. Change
   one synthetic/test item's status and confirm it appears on the other device.
   Normal polling is approximately once per minute while Chrome is running;
   Chrome suspension and large paginated queues can delay this.

If the first connection reports an error, verify PHP `pdo_mysql`, HTTPS, the
private config path, the schema import, DB access and the group token. On some
Apache/FastCGI configurations the Authorization header must be passed through
explicitly. The API accepts `HTTP_AUTHORIZATION` and
`REDIRECT_HTTP_AUTHORIZATION`. Configure the handler if both are absent; do not
put tokens in URLs or query parameters. Visiting `sync.php` directly in a
browser returns 405 because the API accepts authenticated POST requests only.

## Behavior, retention and revocation

The server sees encrypted operations, independent operation IDs and request
metadata, but no agenda titles, instructions, pupil identifiers or Schoolware
session material. TLS protects transport. The hosting provider can still
observe timing/IP addresses; disable request-body and Authorization-header
logging in any diagnostics. No analytics is included.

Each exact source tuple is scoped by the explicitly shared encryption key and
the Schoolware installation. Changed tuples are not automatically merged.
Completion is tied to meaningful content; stale completion cannot complete a
new content version. A later automatic reopening cannot override an explicit
status for that same version. Among explicit edits to the same version, the
last server-accepted edit wins, including offline edits uploaded later.

Keep local deletion and remote deletion separate. Disconnecting or deleting a
local profile clears its local sync credentials and outbox, not the server.
To erase server records, disconnect the other devices first, then use the
extension's remote deletion control. Otherwise other devices can upload again.
They may also retain locally cached progress; disconnect them to discard that
sync cache. Remote deletion does not erase their local agenda/progress.

The group token permits reading and deleting only that group's encrypted records.
There are no per-device credentials or parent-only roles. Use the CLI `disable`
command to revoke a whole group. Each API transaction locks the authenticated
active group and every query is scoped by its ID. Operation IDs, revisions,
quotas (20,000 retained records), retention cleanup and deletion are per group.
Unknown or disabled tokens cannot read, write or delete records.

`retention_days` accepts 30, 90, 180 or 365; default 90. Old server operations
are purged during successful exchanges. Run the private CLI `purge` command daily
to also purge inactive groups. Without requests or scheduled maintenance, expired
idle data can remain indefinitely. Empty groups whose `last_active_at` is older
than the retention limit are reclaimed; their old pairing codes then lose access.
The API bounds storage at 20,000 retained operations and accepts 50 uploads and
200 downloads per exchange. Back up encrypted records together with the
group/verifier database tables and private database configuration; the encryption key is only in the devices and
your private saved pairing code. Restoring a database whose revision is behind
a device cursor requires disconnecting/reconnecting that device.

## Validation status

Synthetic Vitest checks cover encryption/tamper rejection, profile binding,
offline queues, stale replies, atomic edits and content-version reopening.
The PHP endpoint is integration-tested locally with PHP 8.2 and an isolated
MySQL instance: authentication, invalid batch rejection, idempotent retries,
pagination, group isolation, migration, revocation, scoped deletion, registration
limits and registration retries. Run `server/tests/integration.py` only against the
disposable local test server described in its header.

Live cPanel HTTPS/header handling and two real Chrome profiles still require
the smoke test after manual installation. Nothing is uploaded or deployed by
the local build.

## Review remediation upgrade (2026-10-05)

For an existing deployment, import `schema.sql`, then run
`migrations/20261005-maintenance.sql` once if `sw_sync_groups` has no
`last_active_at` column. New installations already receive the column from
`schema.sql` and must not repeat the ALTER. Existing groups receive an activity
timestamp at upgrade time; no token, revision or ciphertext is replaced.

Copy `maintenance.php` to `/home/example-account/maintenance.php` before replacing the API.
The API uses that absolute path regardless of its document root. The private CLI
`manage-groups.php` requires a helper in its own directory: place both in the
account home, or also copy the helper beside an existing CLI in another private
directory. Adjust the cron command to the CLI location. Replace `.htaccess` only
in the dedicated API document root, never in a shared `public_html`. The public allowlist
serves only `sync.php` and `privacy.html`; the cPanel PHP handler stays intact.
Schedule a daily cPanel cron using the host's PHP 8.2 CLI:

```text
15 3 * * * /usr/local/bin/ea-php82 /home/example-account/schoolware-sync/manage-groups.php purge
```

Adjust the executable and private path to the hosting installation. Run the
command once privately and check cron execution; repository changes do not
install a schedule. The command removes expired operations and participants
across all groups, reclaims empty idle groups, and expires rate counters. Each
group is locked separately, serializing cleanup against its authenticated writes.
Disabled groups leave a token-verifier tombstone in `sw_sync_revoked_tokens` so
self-registration cannot undo revocation after group cleanup. These small
revocation records have no automatic expiry; they contain no content or device IDs.
Only aggregate deletion counts are printed. Keep backups under a separately
documented hosting policy; database cleanup does not erase backups.

Remote deletion still preserves a group's verifier, ID, revision, enabled flag
and last activity timestamp to keep other clients' cursors safe. It removes
encrypted progress and participant announcements, not access credentials.
Automatic client retries stop on HTTP 401/403/409. Check registration/access or
restore/reconnect the cursor before explicitly retrying in settings.
