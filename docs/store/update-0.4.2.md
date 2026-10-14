# Candidate 0.4.2 correction

Prepared 2026-10-12 on the feature branch. The owner reports submitting 0.4.1;
approval/publication is not confirmed and its package remains unchanged.
This candidate contains the student integration and invitation fixes from 0.4.1,
plus [task freshness presentation](../task-freshness.md).

Retained tasks missing from a successful check covering their dates no longer
count as current to-do or reminder work. They remain available in a separate
collapsed section and agenda filter with an uncertainty warning, and in CSV with
a freshness flag. History, completion, reviews and help are retained. Positive
observation restores normal presentation; a later window moving past the dates
does not silently restore a stale task. No definitive deletion is inferred.

No new permissions, privacy categories, remote fields, protocol, PHP, SQL or
IndexedDB migration are needed. Server minimum 0.4.0/protocol 3 remains suitable.
The minimum should not be raised just for this presentation fix.

Validation: strict TypeScript, ESLint, 426 Vitest tests across 36 files, production
build and both Chrome smoke suites passed. Synthetic regression checks cover
missing tasks, coverage boundaries, moving windows, restoration of completion,
legacy metadata, CSV indication and message validation. No real pupil captures
were committed or used as fixtures.

Before upload: verify the local correction with the owner's retained task and a
fresh successful check. Confirm its separate warning and preserved progress.
Follow the existing external review and authorization gates. Package preparation
does not merge to main, upload, cancel a pending submission or publish anything.
If replacing the pending 0.4.1, upload the complete 0.4.2 ZIP and add the reviewer
note below. Existing listing/privacy/permissions remain applicable; CSV merely
adds a column and existing screenshots still depict supported features.

Reviewer note: "Version 0.4.2 also distinguishes locally retained tasks that were
not found in a successful agenda check covering their dates. These are shown
separately with a warning and excluded from active to-do/reminder counts. Local
history and progress are preserved; absence is not treated as proven deletion.
There are no new permissions or remote data categories."
