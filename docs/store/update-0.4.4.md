# Candidate 0.4.4: two-day focus and local planning advice

The to-do focuses on the next known school weekday and shows a collapsed preview
of the following known school weekday. Manual browsing moves both horizons.
Unconfirmed retained tasks appear in to-do only if unfinished, marked and due
within these two days. Older/later/finished unconfirmed items remain available
through Agenda; current overdue work retains its existing collapsed section.
Help in the focused panel is limited to those two days; other requests remain
accessible through Agenda and retain the existing notifications/sharing behavior.

The deterministic local proposal prioritizes first-day work before second-day
work, then help, tests, assignments and attention points within each day. It
renders concrete item titles/subjects/dates, reflects in-progress status, omits
completed/hidden/cancelled/unconfirmed work and never invents durations or writes
statuses/deadlines. At most six steps are shown, with the full lists available.
Schoolbag suggestions remain in the existing dedicated panel.

Explicit weekday home study, sports/trips and timetable special days supplement
known days without inferring holidays from gaps. Their preparation checklist
counts and home-study material reminders appear in advice when the event falls
within the focused two days or preparation is due today. Weekends are skipped;
non-timetable custom "other" events do not invent a school day. Unknown horizons
are explicitly explained. Existing special days are projected only locally into
the typed task view with runtime validation; remote processing is unchanged.

Includes all 0.4.3 fixes. No new host permissions, backend, protocol, database
migration or cloud/AI service. Source is on the active feature branch. Local
package preparation does not authorize merge, Store upload or publication.
Owner acceptance should check a Friday/weekend, home-study preparation, task
completion updating advice, manual browsing and unconfirmed items across dates.

Validation: strict TypeScript, ESLint, 436 Vitest tests across 38 files, production
build and both Chrome smoke suites passed. Synthetic planning screenshots were
generated from the real UI and visually inspected. No real pupil data was used
in fixtures or promotional artifacts.
