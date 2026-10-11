# Release readiness and distribution

Current candidate (2026-10-11): 0.4.0 adds fail-closed synchronization compatibility
checks, encrypted device-version announcements, change attribution and independent
per-participant checked/corrected reviews. See [participation and reviews](participation-and-reviews.md) and
[version compatibility](version-compatibility.md) for deployment and limitations.
The PHP endpoint and private helper must be upgraded together; there is no SQL
migration. No production deployment or Store publication is performed here.
Matthias's external review and resolution of blocking findings remain mandatory
before merging or publishing. Validate deployed TLS/WAF controls, scheduled
retention cleanup, backups and deletion, and real paired-device upgrade/restart
behavior. Shared-code holders have full group rights; individual revocation and
verified teacher/parent permissions are not implemented. Suitable for controlled
family testing after server upgrade, not yet an unrestricted public release.

The older dated observations below are historical evidence, not acceptance of
the current candidate.

The 2026-10-11 review remediation restores offline confirmation of returning
task content, retires edited checklist point identities, and bounds historical
review projection without blocking synchronization. The owner uploaded the public
privacy page; anonymous HTTPS verification confirms it matches the repository.
Overview/settings now use [compact sections](compact-navigation.md).
See [submission checks](store/update-0.4.0.md).

Candidate validation: strict TypeScript, ESLint, 400 Vitest tests and production
build pass. The isolated PHP 8.2/MySQL integration verifies compatibility gating,
policy changes before exchange, unchanged cursors on rejected writes, and legacy
deletion/leave. Old cryptographic fixtures remain readable through a current
transport. Dependency audit reports zero known vulnerabilities (including dev
dependencies); this is not proof that the code or deployed host has no flaws.
Chrome synthetic two-device tests pass for encrypted version announcements,
planning, packing and help, and for blocked exchange retaining a local edit when
the minimum version changes. Settings tests pass for permissions, worker restart,
CSV export and special days. These do not contact Schoolware or production sync.
The 0.4.0 two-device test additionally checks the real review checkbox, two visible
reviewers, propagated status/help attribution and withdrawal retaining the other
reviewer. Existing local databases read without invented historical attribution.

Current status (2026-10-06): 0.1.0 is published. The owner authorized merging the
complete 0.2.0 feature branch into main and pushing it, deferring Matthias's review
until later. Review completion is not claimed. The 2026-10-04 notes below are
historical. See [current update procedure](store/update-0.2.0.md)
and [release gates](release-0.2.0.md).

Status: 2026-10-04. The owner has authorized integration into local `main`
for continued testing. Public release remains a separate checkpoint.

## Owner acceptance evidence (2026-10-04)

The owner reports successful synchronization after installing the SQL/API update,
a Schoolware banner for unfinished agenda work, a visible Windows to-do reminder,
and normal extension operation after a PC restart. The logout test produced the
expected session-unavailable message; after signing back in, the same agenda
connection fetched and validated successfully without reconnecting.
No screenshot, payload or personal identifiers are stored in this repository.
These observations confirm the reported paths, not automatic new/change alerts
or two-device propagation. Two-device testing is currently pending access to a
second installed device. The owner reviewed the schoolbag UI positively; material accuracy should still
be checked against normal school days.

## Remaining acceptance checks

- Reload the built extension and verify an automatic progress minute-alarm
  exchange in a new local activity export, including its correlated result.
- Verify an automatically detected, eligible new or changed agenda item produces
  the configured system notification and Schoolware banner. A manual test or
  Chrome accepting a notification is not proof of a visible automatic alert.
- Verify two-device progress propagation with the deployed PHP service.
  Logout/login recovery and operation after PC restart are owner-confirmed.
- The owner installed the SQL/API upgrade and reports successful synchronization.
  Hosting/WAF controls and throttling behavior still need deployment verification.
- Verify automatic new/change alerts separately from the owner-confirmed visible
  to-do system notification and Schoolware banner.
- State the validated agenda contract explicitly. Standard task ranges have now
  been checked in public frontends from two other school groups; authenticated
  cross-school transport remains untested. Do not claim universal compatibility.

The owner explicitly authorized the local main merge while the remaining
acceptance checks stay open. This is an integration checkpoint, not public-release
approval. Store submission and remote publication are separate actions.

## Proposed invitation flow (not implemented)

The current implementation adds explicit clipboard sharing of a public Store URL,
instructions and the existing pairing code as separate text. It does not implement
the admission protocol below; do not describe it as an expiring or approved invite.

The inviter is the person sharing their own progress group. Approval must be
performed by that person, not by the extension publisher or a central operator.
For example, a parent invites another parent and approves the receiving device.

Use an installation landing page, a short-lived single-use invitation, an
explicit join request and inviter approval with a verification code that can
be compared through an existing trusted channel. Do not trust a self-chosen
participant name as verified identity. Copy-link is the universal sharing
fallback; email, WhatsApp and a supported native share menu can offer shortcuts.
Opening a link or generating its preview must not consume the invitation.

The invitation must not contain the permanent group credential, encryption key,
raw student identifier or agenda contents. Introduce independently revocable
device authorization and securely deliver encrypted group key material only
after approval. Revocation cannot erase information already downloaded; future
encryption-key rotation needs an explicit design. Existing shared-secret
credentials must not remain an alternative route around device admission.
Group ownership and migration require a design because the current protocol
has no owner role and cannot distinguish owners from other secret holders.

A fresh local Schoolware check can protect the normal onboarding flow, but
cannot independently prove authorization to the progress server. A server-side
Schoolware entitlement guarantee requires an official verifiable authorization
integration; availability is not established. Do not send Schoolware passwords,
cookies or existing session tokens to the progress server. An invitation must
never grant Schoolware access by itself.

The landing page may communicate with the installed extension using a narrowly
allowlisted external messaging endpoint. It must not receive local history,
credentials or encryption keys. Installing from the store still requires the
recipient's confirmation; the user can return to the page and continue joining.
Mobile recipients need instructions to complete extension setup on a computer.

## Chrome Web Store preparation

The owner must choose a durable Google account, register it as a store developer,
pay Google's one-time registration fee and complete the required account setup.
The account holder handles payments, verification and policy declarations.

Prepare a ZIP of the production extension with `manifest.json` at its root,
excluding the PHP server, real data, private configuration and source-only
development files. Prepare the description, icons, screenshots with synthetic
data, support contact `info@bumper.be`, a public privacy-policy URL, permission
justifications and review instructions. Privacy declarations must describe the
optional encrypted progress service as well as local storage.

Initially choose unlisted distribution: anyone with the store URL can install,
but the extension is not searchable. This is a visibility setting, not access
control, and still requires Google's review. Deferred publishing lets the owner
wait before making an approved version installable. A published stable extension
ID and store URL are prerequisites for the final installation handoff.

No invitation implementation, store submission, publication or merge is part of
this checkpoint.

## Primary references

- [Developer registration](https://developer.chrome.com/docs/webstore/register)
- [Publishing workflow](https://developer.chrome.com/docs/webstore/publish)
- [Distribution visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/)
- [Extension installation](https://support.google.com/chrome_webstore/answer/2664769?hl=nl)
- [External web-page messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#external-webpage)
- [Native URL sharing](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
