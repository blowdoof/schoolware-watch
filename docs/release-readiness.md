# Release readiness and distribution

Status: 2026-10-04. The current feature build can be committed and pushed for
review. This does not mean that the extension is ready for public release.

## Remaining acceptance checks

- Reload the built extension and verify an automatic progress minute-alarm
  exchange in a new local activity export, including its correlated result.
- Verify an automatically detected, eligible new or changed agenda item produces
  the configured system notification and Schoolware banner. A manual test or
  Chrome accepting a notification is not proof of a visible automatic alert.
- Verify two-device progress propagation, authentication expiry, alarm wake-up
  and worker restart in Chrome with the deployed PHP service.
- Resolve or explicitly assess the remaining findings in
  [the security review](security-review.md): queued setting edits on document
  closure, idempotent retries at server capacity and request-rate controls.
- Keep the verified origin restriction explicit. The current extension supports
  the inspected Schoolware installation, not arbitrary schools.

Merge the feature branch into `main` only after the owner and maintainer agree
that the release criteria are met. Publishing to the store is a separate action.

## Proposed invitation flow (not implemented)

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
