# Change attribution and task reviews (0.4.0 candidate)

Manual status changes, help edits, checklist toggles and packing/hiding/reset
choices record a random local participant reference, optional paired-device
reference, optional existing participant label and sender timestamp. Attribution
is encrypted with the corresponding shared value. Existing values without this
metadata remain valid and display an unknown author; automatic reopening of a
changed completed task clears the previous manual author. Names are snapshots
of the self-reported computer label at the time of the action, not verified
Schoolware identities. A shared computer cannot automatically distinguish people.

Each local pupil profile has a stable random participant reference, independent
of pairing/re-pairing. Two computers used by one person remain distinct
participants. Anonymous references are displayed with a short suffix so they
can be distinguished. Renaming the computer does not rewrite historical names.

Checked and corrected are separate from Open/In progress/Done and from help.
Each review has an independent resource key including pseudonymous task key,
meaningful content hash, review kind and participant reference. Server revision
ordering resolves updates to the same resource; different participants never
overwrite each other's control. Unsent local changes retain precedence until
acknowledged. Unchecking emits a tombstone for that participant's current-content
review, leaving other participants' reviews intact. Reviews on older task
content remain visible with a previous-content warning and do not check the
current-content controls. The local projection retains at most 200 reviews per
task, prioritizing current controls and withdrawals over older history; exceeding
the historical bound does not abort unrelated synchronization.

The interface edits only the local participant's controls. This is not a security
boundary: all group-secret holders have full group rights and can fabricate names,
timestamps or participant references. There is no per-person authentication,
verified role or individual revocation. Full action history is not implemented;
status/help/checklist/packing attribution identifies the latest retained change.

## Update and offline preservation

App 0.4.0 requires synchronization protocol 3. Upgrade the private policy helper,
public API and any explicit private minimum/maximum protocol configuration together
as described in [installation instructions](../server/INSTALL.md). There is no SQL
migration and no IndexedDB structural migration: existing optional object fields
are extended in the version-3 local database. Local data and pending operations
survive a normal extension update within the same browser profile and extension
identity. Uninstalling the extension
or using another browser/profile is not a normal update and may lose local data.
Existing ciphertext and legacy records remain readable; no Schoolware
agenda/history/session contents are moved online.

Locally created reviews are seeded through the existing encrypted planning channel
on first pairing, including attribution captured before pairing. Existing unknown
authors are not assigned to whoever installs the update. Incompatible or offline
services leave edits pending; a successful fresh policy check is required before
exchange. Do not downgrade a client and resume synchronization: older clients
cannot safely preserve these new fields and are blocked by the new server policy.
This does not fix pre-existing last-accepted-write conflicts for ordinary status
changes; participant reviews specifically use independent resources.

## Bounded review history

The local task projection retains at most 200 review identities. Reviews of the
current content, including withdrawn controls, have priority; remaining places
retain the most recent historical actions with a deterministic identity tie-break.
The existing group supports 50 announced devices, normally at most 100 current
checked/corrected controls. Beyond the projection limit, older reviews are omitted
from the display rather than blocking unrelated synchronization. Cached encrypted
review resources retain withdrawal state under the existing cache/remote retention
rules, so projection trimming does not turn a withdrawal into completion. This
is a bounded current overview, not a permanent complete audit trail.

When previously reviewed content returns, the old review remains marked previous
until a local confirmation or synchronization reconciles the content projection.
Local confirmation works even if its previous boolean was already true.

## API authentication

The HTTPS endpoint is publicly reachable. Group contents require an
`Authorization: Bearer <256-bit random token>` header. The enabled group is found
using a SHA-256 verifier; the plaintext bearer token is not persisted in the
database. The pairing code combines that token with a separate 256-bit AES-GCM
encryption key kept on paired devices. The key is not sent to the endpoint.
Anyone with the full pairing code can decrypt and change shared group records.
Possession of only the bearer token still permits fetching ciphertext and
destructive API actions; HTTPS and protecting the entire invitation are essential.

Compatibility policy is non-secret and can be requested using a syntactically
valid bearer header without belonging to a registered group. When the operator
enables self-registration, new groups require no existing user account; configured
registration and request quotas apply. This is capability-based group access,
not an email/Schoolware login, individual roles or verified parent authority.
Hosting logs, TLS, proxy handling and actual deployed configuration require
operator verification; this document describes repository behavior.

Metadata follows local profile retention/deletion and existing server encrypted
operation retention. Task review history stays with the retained task; checklist
authors are removed when their points are removed, and packing attribution expires
with packing-day retention. Disconnecting removes local sync state, not remote
group records or copied secrets. Remote deletion/retention has the same existing
limits documented in [privacy](privacy.md). No telemetry, new permissions or
automatic Schoolware-content upload is added.
