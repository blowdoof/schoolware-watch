# Version 0.2.0 development and review

## Owner authorization superseding earlier release gates

On 2026-10-06, after the progress notification changes, the owner explicitly
authorized merging the complete feature branch into main and pushing it. The
owner deferred Matthias's review until later and requested the Store update
handoff. Earlier requirements below for a pre-merge Matthias review are historical
and superseded by this instruction. Review completion is not claimed. Real
two-device acceptance and authenticated cross-school testing remain outstanding.
No agent Store upload or publication is performed; the owner receives the package
and instructions to submit the existing item.

Recorded on 2026-10-05. Version 0.1.0 is published according to the owner.
Version 0.2.0 is a development target, not an approved release. Continue all
work on features/multi-school-onboarding; no merge to main or publication
is authorized by the version bump.

## Store update candidate prepared on 2026-10-06

The owner requested a multi-school Store update candidate and simpler progress
sharing. The candidate remains 0.2.0, higher than published 0.1.0. The listing now
describes supported parent-agenda installations without a KSGWL-only restriction,
while disclosing that authenticated cross-school integration remains untested.
Public KOHa and Molenland frontends confirm identical standard type ranges.

Explicitly copying an invitation provides the existing public Store install URL,
instructions and permanent pairing code as separate message text. No credential
is added to a URL or landing page, and copying does not send a message or admit a
device automatically. No new backend, permissions or protocol are introduced.
The future approved-device invitation protocol remains a separate proposal.

Owner reports on 2026-10-06 confirm logout detection on a new check, subsequent
login recovery without reconnecting, and successful deployed progress exchange
after the activity-column migration. Other-school live integration and two-device
propagation are still pending. Matthias must review the final complete branch
before merge/publication; no Store upload or publication is performed here.

## Acceptance before merging

- [ ] Continue owner testing of the complete dashboard, settings, schoolbag and
  history, including upgrades from a configured 0.1.0 installation.
- [ ] Verify real Schoolware login, exact-site consent, connection confirmation,
  session recovery and Chrome restart.
- [ ] Confirm last-success status after session expiry, daily packing choices,
  hidden suggestion recovery, changed instructions and compact planning expansion.
- [ ] Find an external parent for another installation before treating multi-school
  support as verified; the owner will arrange this candidate.
- [ ] Verify Schoolware test banners, actual change alerts and to-do reminders,
  including extension reload with an existing Schoolware tab.
- [ ] Verify optional encrypted progress pairing and propagation between two
  computers for the same pupil, without exposing agenda content or credentials.
- [ ] Keep other-installation support experimental until its parent endpoint
  and semantics have been confirmed.
- [ ] Run typecheck, lint, Vitest, build and relevant synthetic Chrome checks
  against the final review commit.
- [ ] Matthias completes an external review of the feature branch; record the
  reviewed commit, findings and resolution of blocking findings here.
- [ ] Obtain owner authorization for the reviewed merge to main.

## Acceptance before publication

- [ ] Obtain separate owner authorization for Chrome Web Store submission and
  publication of the reviewed release.
- [ ] Check the final 0.2.0 package, listing, permission declarations, public
  privacy policy and synthetic assets against the reviewed implementation.
- [ ] Upload as an update of the existing store item, preserving its ID.

Matthias supplied a review of `fe1f32e` in `9be484f`; it explicitly excludes full
review of the current feature branch. See [findings](reviews/2026-10-05-prestore-review.md)
and [remediation](reviews/2026-10-05-remediation.md). No reviewer has been contacted
by the agent, and the current feature branch still requires Matthias's review.
Do not treat automated checks as Matthias's approval.
