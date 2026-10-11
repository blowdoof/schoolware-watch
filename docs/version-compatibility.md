# Version compatibility (0.4.0 candidate, 2026-10-10)

Application versions, synchronization protocol versions and task content versions
have different purposes. Compatible application versions may coexist. Protocol 3
and minimum application version 0.4.0 are required by the new server defaults.
This supersedes the unpublished 0.3.0/protocol-2 candidate; the new format adds
encrypted attribution and [independent reviews](participation-and-reviews.md).
Task content versions still prevent completion from applying to changed tasks.

Every exchange requires a fresh, validated compatibility response. Unreachable,
outdated or incompatible services pause exchange before uploading pending edits.
Local editing remains available. The endpoint rechecks version headers before
registration, membership updates and progress exchange, including when policy
changes after preflight. Deletion and member departure remain available to old
clients. Previously shipped clients cannot display the new explanatory warning;
they receive HTTP 426 and their existing generic synchronization error.

Each device announces its application version and protocol once per connection
and version change, using the existing encrypted planning channel. Optional
participant labels identify computers, not authenticated people. Anonymous
devices also report versions. The displayed timestamp is the sender's report
time, not proof of current connectivity. Older devices cannot announce versions.
There is no inventory of unpaired devices and no account or operating-system
telemetry. Announcement history follows existing encrypted operation retention;
disconnecting does not revoke a copied group secret or remove every remote record.

Requests carry application/protocol headers in plaintext over HTTPS. The service
uses these for compatibility, not authorization, and does not persist a device
inventory from them. Hosting infrastructure may see request metadata. Header
claims and encrypted participant labels are self-reported: a group-secret holder
can forge them and can read, edit or delete all shared group data. Per-person
roles and individual revocation are not implemented.

The manual Store check uses Chrome's native API, respects throttling and never
forces a reload that could discard unsaved forms. `no_update` is not proof of
compatibility or immediate Store availability. Unpacked installations need manual
updating. The native update-available event records an available version.

New clients retain validated existing progress formats. Arbitrary backward
compatibility, database downgrade support and safe uploads by previously shipped
clients are not promised. Local edits from incompatible clients remain local
until an eligible client can synchronize them. Existing server-order conflict
resolution is unchanged; concurrent offline edits are not merged automatically.

## Deployment and release gates

Deploy the new private `server/sync-policy.php` helper and public endpoint together
using [installation instructions](../server/INSTALL.md). No SQL change is needed.
An old endpoint makes new clients pause with a server-update notice. The upgraded
endpoint blocks old clients before content writes; coordinate availability of the
new extension before enforcing this on existing users. During pre-release testing,
all participating devices must install the candidate manually. Never advertise
an unpublished version as Store-available: `sync_latest_published_version` defaults to null.

Repository preparation does not deploy the API, publish a Store release, merge
to main or complete Matthias's required external review. Verify real hosting
controls, cleanup and a two-device upgrade/offline/restart scenario before wider
distribution. This is a release candidate, not an independent security certification.
