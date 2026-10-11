# Candidate 0.4.1 correction package

Prepared 2026-10-11 on the active feature branch. Version 0.4.0 was submitted
by the owner and its archive is unchanged; approval/publication is not confirmed.
Version 0.4.1 adds student intranet connection support and visible share-button
feedback. Protocol 3, IndexedDB schema 3 and encrypted shared field formats are
unchanged. No PHP or SQL deployment is required; do not raise the server minimum
just for this client update.

See [student support and validation limits](../student-agenda.md). On a student
device: load the new build, sign in to the intranet, open the student agenda and
start Schoolware connection from the extension popup in that tab. For an already
configured device, the advanced connection field accepts the student request URL.
Join the parent's existing group; do not create a second group for that pupil.
Local histories remain separate across frontend selections; shared matching task
keys remain interoperable. Unpacked and Store installs have separate local data.

Fresh checks: TypeScript, ESLint, 420 Vitest tests in 35 files and production build
passed. Both Chrome smoke suites passed; the paired-device suite now uses a parent
scope and a student scope and verifies planning/packing, status/help attribution,
reviews and withdrawal. No authenticated Schoolware or production sync calls are
made by these suites. Real student login, discovery, monitoring after session
expiry, and propagation with the owner's parent device remain acceptance checks.

The local release ZIP contains only `dist` with a root manifest for 0.4.1 and
license notices. Existing synthetic promotional assets may be reused because this
correction does not change their depicted screens. The privacy policy from 0.4.0
still describes the same data processing; student support adds no new remote
fields or recipients. Use the updated Store listing and these reviewer notes.

Store upload/publication and another main merge are not performed by preparing
this correction. The current candidate needs the outstanding external review and
operational acceptance checks described in [0.4.0 rollout](update-0.4.0.md).
Obtain owner authorization for the next integration/upload step. Update the
latest-published server setting only when the corresponding version is live.
