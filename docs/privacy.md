# Privacy

Schoolware Watch has no external backend, analytics, telemetry, or cloud sync.
The manual connection diagnostic makes requests only when the user chooses to
check and grants access to the observed Schoolware origin. It stores the
validated request URL (including local profile/agenda identifiers and date
coverage) and total/category counts, status, and timestamp in chrome.storage.local.
Full agenda payloads, titles, and names are not persisted in this phase.
The connection can be cleared and its host access revoked in settings.

The planned history will be stored locally in extension IndexedDB. Local storage is
not an encryption guarantee: access to the browser profile or device can expose
its contents. Store only the agenda fields required for comparison and display.
Keep settings in chrome.storage.local, not chrome.storage.sync.

Reuse the user's existing Schoolware session without persisting passwords,
session cookies, authentication tokens, or authorization headers. Restrict
permissions to the verified installation origin and validate message senders.

Before history is enabled, implement a documented retention policy and profile
deletion covering item versions, observations, and profile metadata. Generic
notifications are the default; displaying personal content requires opt-in.

CSV export is an explicit local user action. Warn within that action that the
file contains personal information and escape formula-like cell values.

Only synthetic fixtures belong in Git. The private data directories and HAR
files are ignored, but ignore patterns do not replace review of staged changes.
