# Version 0.2.0 development and review

Recorded on 2026-10-05. Version 0.1.0 is published according to the owner.
Version 0.2.0 is a development target, not an approved release. Continue all
work on features/multi-school-onboarding; no merge to main or publication
is authorized by the version bump.

## Acceptance before merging

- [ ] Continue owner testing of the complete dashboard, settings, schoolbag and
  history, including upgrades from a configured 0.1.0 installation.
- [ ] Verify real Schoolware login, exact-site consent, connection confirmation,
  session recovery and Chrome restart.
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

No review has been recorded and no reviewer has been contacted by the agent.
Do not treat automated checks as Matthias's approval.
