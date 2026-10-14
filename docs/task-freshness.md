# Retained tasks and current planning (0.4.2)

Missing source items are not marked disappeared without verified response
completeness and comparable scope. Previously this also left stale tasks in the
normal to-do list after successful checks. Version 0.4.2 separates presentation
freshness from durable presence and completion.

A retained task receives derived `missingFromLatestCheck` metadata only if the
recorded successful check is newer than the task's last positive observation,
has known coverage, and its start and end fall strictly inside the fetched date
boundaries. Later checks outside that window do not revive an unconfirmed task;
only positive observation clears the flag. No absence is inferred
at uncertain boundaries or outside coverage. Failed checks do not advance this
successful-check metadata. Legacy records lacking coverage remain unchanged.

These tasks are excluded from active to-do counts, earlier pending tasks, bulk
completion, help-only current lists and daily task reminders. They remain in a
separate collapsed to-do section and in the agenda filter "Not found at last
check", with an explicit uncertainty warning. All-tasks and CSV retain them;
CSV includes a corresponding flag. A returned task becomes current again without
losing its identity, reviews, help or saved status. Existing meaningful content
changes continue to reopen completed tasks through normal observation semantics.

No disappearance event, source deletion, shared tombstone or new remote field
is generated. Local history and progress remain subject to existing retention.
There is no database, server, protocol or permission migration. Each device
derives freshness from its own successful Schoolware response; different fetch
times or sessions can temporarily produce different views.

The submitted 0.4.1 package remains unchanged. This is a separate 0.4.2 candidate
requiring normal owner review and authorization for integration/submission.
