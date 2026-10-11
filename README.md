# Schoolware Watch

An independent Chrome extension that monitors
Schoolware agenda changes.

## Features

- Automatic agenda monitoring
- Detection of new assignments and tests
- Change history
- Schoolbag suggestions with optionally shared packing/hiding choices
- Independent help flags with optional multiple named recipients and addressed notifications
- Browser notifications
- Local data storage
- Optional encrypted progress, special days and checklist sharing through a self-hosted PHP/MySQL API
- Filtered local CSV task export

For the owner's cPanel host, see [server/INSTALL.md](server/INSTALL.md).
This optional service shares task progress, user-created special days and
checklists, and schoolbag choices. Schoolware source agenda content/history
remain local. All paired extensions must update for planning sharing. See
[shared planning](docs/shared-planning.md) for compatibility and acceptance.

Multiple student profiles remain planned; CSV export is implemented.

## Technology

TypeScript, React, Vite, Chrome Manifest V3.

## Status

Phase 4: periodic checks, rolling date coverage, configurable event colors,
optional system notifications and Schoolware-page banners for upcoming
new/changed points. Local IndexedDB
history preserves baselines and first-observation/change events. Settings
provide polling, notification, retention and deletion controls.
Response validation and session-aware error handling are implemented. The project
owner confirmed a successful live Chrome check on 2026-10-01: 449 agenda points
were received and validated through the existing browser session. The check also
succeeded with the Schoolware tab closed, and logout produced the expected
session-unavailable status. The owner reported another successful session check
on 2026-10-02. Live testing of the new history UI and popup-close recovery remains
pending. The owner confirmed Windows notification delivery on 2026-10-02 after
enabling Chrome notifications in Windows settings. Live verification of alarms
and the new Schoolware-page banner remains pending.

## Release review

See [production review](docs/production-review.md) and
[release readiness](docs/release-readiness.md) before merging or publishing.
Review findings around settings handoff, server capacity retries and request
quotas are fixed in source. The hosting schema/endpoint upgrade and remaining
interactive Chrome acceptance checks must still be completed before public release.

## Development

Requires Node.js 22.12 or newer and npm. Install dependencies with `npm ci`.
On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm run dev
npm run check
```

The dev server previews `/popup.html`, `/dashboard.html`, and `/options.html`.
It does not provide Chrome extension APIs. Use a production build to test the
extension:

```sh
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select this project's `dist` directory. Open the toolbar popup, follow its
dashboard link, and open settings. Check the service worker for startup errors.
Use `npm run build:watch` during extension development and reload the extension
after rebuilds. Schoolware host access is optional and requested only when
starting a manual check or recognizing an agenda.

## Connect Schoolware

Click **Schoolware verbinden** in the extension and grant optional access.
Sign in in the newly opened Schoolware tab and open the desired pupil's agenda.
Return to the extension, verify the selection, check the confirmation box and
click **Deze agenda koppelen**. Developer tools and copied URLs are unnecessary.
Recognition remains active for five minutes in the selected or newly opened tab. The
extension validates the observed request and fetches the agenda through the
existing browser session before creating the local baseline. Existing
connections do not change until explicitly confirmed.

The verified integration is `schoolware_siw.ksgwl.be`. Other user-selected public HTTPS installations can be connected experimentally when they expose the same validated agenda contract. Their TypePunt semantics are unverified: all points remain Other, with no inferred tasks, to-do reminders or shared task progress. Every computer
still connects to its own Schoolware session; the progress pairing code does
not grant Schoolware access. The manual URL field remains under **Geavanceerd**
for troubleshooting. See [automatic connection](docs/agenda-discovery.md).

For both manual and periodic checks, request dates roll from seven days before
today to at least fourteen days ahead (or the notification horizon, if longer),
with an extra day at the upper boundary. Never paste cookies or authentication headers.

The result reports a validated agenda-point count or a connection error.
Successful checks also show supported test/assignment counts, mixed lesson
content needing review, and other points. For this installation, TypePunt 101
maps to tests and 1001 to assignments. TypePunt 2 remains ambiguous because it
also represents ordinary lesson content. Other codes are not classified yet.

## Observation history

The first successful nonempty check establishes a baseline for the exact
installation, pupil and configured agenda URL. The dashboard reports
first observations and changes to titles, pupil-visible instructions, planning,
source validity dates, type, recurrence, and visibility/cancellation flags.
Unchanged checks update last-seen times without duplicating content versions.

Only identical source-ID tuples are compared; identity stability across checks
is not yet proven. Changed IDs are separate observations, not automatically
merged entities. Reconnecting the same installation, pupil and agenda selection
from another calendar window reuses an existing retained profile, preserving
history and progress. A different selection or installation remains isolated.
Legacy scope keys are retained; previously duplicated window scopes are not merged.
Newly covered days receive baseline events, rather than new-item alerts. Only
new source tuples strictly inside previously checked coverage are classified as
first observations. This is conservative because API boundary inclusion and
pagination completeness remain unverified.
First observation never means source creation time, and GeldigVan is not used
as creation time. Incomplete or failed responses do not generate disappearance
events. Disappearance detection remains disabled pending completeness and
identity verification.

History stays in local IndexedDB. The default retention is 90 days; settings
offer 30, 90, 180, and 365 days. Loading, checking, and changing retention prune
expired events/checks across all scopes. Recently observed current content
remains available. Clearing the active selection starts its next baseline anew.
**Koppeling en alle geschiedenis wissen** deletes all scopes, resets retention,
removes connection and monitoring configuration, cancels the alarm, clears
extension notifications, and revokes Schoolware access.

## Automatic checks, colors and notifications

After connection, polling defaults to every 15 minutes. Settings allow 5, 15,
30 or 60 minutes, or disabling polling. The popup reports whether an alarm is
scheduled, its next planned time, and retry delays. Failed checks use persisted
exponential backoff capped at six hours. Manual checks can retry immediately.
Worker startup restores a missing alarm without resetting an existing schedule.
Checks never overlap. Chrome must be running; sleeping devices can delay alarms.

First observations have a green accent and changes an orange accent in the
dashboard. Both colors are configurable; text labels always identify event kinds.
Baseline entries remain neutral.

Both notification channels are off by default. Enable system notifications in
settings and grant Chrome's optional notification permission. For a banner on
the actual Schoolware website, enable **Banner op de Schoolware-webpagina** and
grant optional scripting access to the existing Schoolware origin. Banners are
never injected into other websites or the extension's own pages. They require
an open Schoolware tab; notifications remain pending until dismissed, and a
toolbar badge shows their count. Neither channel depends on the other.
Choose 1–30 future calendar days (default 3),
and select categories. Confirmed tests and assignments are selected by default;
ambiguous TypePunt 2 entries and other codes can be included explicitly.
Only new/changed events detected during a successful check qualify, using the
point's planned start between now and the selected limit. Source timestamps are
assumed to use Europe/Brussels wall time for this installation; that assumption
still requires API verification. Crossing into the time window alone does not
create an alert. Baseline, hidden/cancelled points and failed checks never alert.

One generic notification per qualifying check contains counts, with no student
names or agenda titles. Clicking opens the affected lesson details. All fetched
points in each affected lesson appear, including unchanged lesson content. New
and changed items use the configured colors and text labels; changes include
before/after values. Details are frozen at the observation, stored atomically
with history, and remain available after worker restart until retention/deletion.
Older notifications without detail snapshots show an unavailable message.
A durable claim prevents
repeated notification delivery for the same check; an interruption between
commit/claim and delivery can lose a notification. Notifications are best effort,
while committed history remains available. Use **Testmelding systeem** to verify
Chrome/OS notification delivery without needing a real agenda change. The test
reports Chrome permission/registration status, which does not prove a visible
OS banner, and requests that the test toast remain until dismissed.

For the banner, open a Schoolware page and choose **Testbanner op Schoolware**
in extension settings. This button works before saving: it requests optional
permission, enables banners and injects the script into existing Schoolware tabs.
Preference changes save automatically. A generic banner should appear
at the bottom right of Schoolware. Each notification is clickable to open its
lesson details; **Sluiten** dismisses the pending notifications. Both test
channels open an explicitly synthetic lesson preview, without adding history.
Closing dismisses the current selection's pending banners on all Schoolware
tabs and clears the badge; observation history stays intact. Unread banners
survive worker restarts. Their generic inbox is capped at 20 notifications across
selections and follows the configured retention period. Clearing selection
history also clears its banners; disconnect removes every banner and unregisters
the content script. Disabling banners stops injection and hides existing banners;
Chrome keeps granted optional permission until revoked or disconnected.

After rebuilding, reload the extension at `chrome://extensions`. Open settings,
confirm automatic checks are active, enable notifications, then show a
test notification. For a quick polling smoke check, choose 5 minutes, close the
popup, and verify the last-attempt time advances after one interval. Reload the
extension to check schedule recovery. Repeat while logged out: the session error
must not alter history or produce notifications. Restore the preferred interval.

After loading the new build, run a manual check and open **Overzicht**. Run a
second unchanged check: it should report zero new observations and changes.
Reload the extension and confirm the history remains. Test session logout and
deletion as described in the API investigation.

## Activity logging and local task progress

Activity logging is enabled automatically. In settings, **Activiteitenlog** shows
timestamped requests, checks, observation kinds, alarm/retry operations, permission
results and notification creation/rendering/click/closure/dismissal. A check and
its alerts share a random correlation ID; individual actions have span IDs. Local
item IDs connect observations and progress changes across different checks.
Filter by either ID, refresh the log, or export retained metadata to a local JSON
file. No raw payload, URL, student identifier, instruction or credential is logged.
The log follows history retention and is capped at 20,000 entries; oldest entries
are removed first. Logs cannot reconstruct activity before this build or prove
that Windows displayed a toast. Clearing logs leaves no deletion receipt; later
actions start new entries. Disconnect removes logs as well as all profile data.

The dashboard's **Taken en voortgang** section offers **Bezig** and **Klaar**
checkboxes. Unchecking returns the task to **Open**. Progress also appears in
new notification lesson details when the item is still in the active selection.
Status changes and audit entries commit together. Status survives checks, content
changes and worker restarts; it is local and does not update Schoolware's
`Completed` field. Source-ID changes still represent separate items and do not
automatically inherit progress. TypePunt 2 remains explicitly marked for review.
Clear active history to remove its progress and related logs, or disconnect to
remove every selection. The existing retention setting also applies to logs.

## Documentation

- [Architecture](docs/architecture.md)
- [API investigation](docs/schoolware-api.md)
- [Privacy](docs/privacy.md)
- [Change attribution, independent task reviews and API authentication](docs/participation-and-reviews.md)
- [Security, privacy and notification review](docs/security-review.md)
- [Roadmap](docs/roadmap.md)
- [Monitoring and notification smoke checks](docs/monitoring.md)
- [Activity logging and task progress](docs/activity-and-tasks.md)
- [Schoolbag suggestions](docs/schoolbag.md)
- [Contributor instructions](AGENTS.md)
- [Project information, licensing and donations](docs/project-information.md)

## Project information and license

The extension footer opens **Info**, **Privacy**, **Open source** and **Steunen**
inside the current window. Schoolware Watch is an independent Bumper.be project,
licensed under [MIT](LICENSE). Full third-party copyright and license notices
are displayed locally and included in the built extension. The optional PayPal
link opens externally on a user click; it adds no payment SDK or data collection.

The to-do **Volgende schooldag** button browses later known weekdays from the
latest observed agenda; **Vorige schooldag** and **Terug naar eerstvolgende
schooldag** return to earlier planning. Later selections show only that day's
pending work. The default view includes today and the first known future school
day. Browsing does not change progress, overdue grouping or reminder scheduling.

## Privacy

Schoolware agenda content and observation history remain local. Optional encrypted
progress sharing follows the documented opt-in exception. No Schoolware credentials
are persisted and no real student data may be committed. History stores a minimized field allowlist;
raw responses, staff/student descriptions, and private comment fields are not
retained. HTML instructions are rendered as text, never executed.
Lesson drill-down additionally retains subject, room and a scoped lesson-grouping
hint. Staff names and student descriptions are excluded. Grouping uses agenda,
LesDataID and exact planning times; without LesDataID it falls back to the same
agenda/time. This is presentation grouping, not verified stable lesson identity.

## Schoolbag

**Boekentas** appears in the popup and dashboard, with **Mee naar school** and
**Mee naar huis**. Laptop is always listed. Material names and page references
come from locally stored agenda text, including ordinary lessons for the school
list and unfinished marked work for the home list. Unknown material remains
explicitly marked for review. No new API, server update or permission is needed.
See [schoolbag behavior and verification](docs/schoolbag.md).

## Guided setup and installation selection

On opening the popup, dashboard or settings, setup checks the existing connection
and permissions. A missing connection starts a three-step guide: connect the school
and pupil agenda, choose monitoring/notifications, then optionally join an existing
progress group using its private pairing code (or create one). Sharing can be skipped.
There is no new account system. Completion is stored locally by the worker and
removed with local data. Later instellen postpones the guide for the current view.
Lost host permission or an expired session returns to connection repair; a missing
permission for an enabled notification channel returns to preferences.

Click the extension icon while the Schoolware site is open to read its address
using activeTab. Only the origin of a likely Schoolware page is used; page content
and unrelated tab URLs are not stored. Settings also allow a school address to be
entered explicitly. Optional HTTPS host access is declared broadly because schools
use custom domains, but requested only for the exact selected origin. The agenda
path and five parameters stay constrained. Discovery binds origin, tab, top frame,
initiator and a five-minute deadline, with no headers or bodies collected.
Banner scripts and periodic checks use the connected origin; switching origins
revokes the previous host grant. Encrypted progress item keys include the installation
origin, preserving existing Wetteren-Lede keys. No backend change is required.

See [multi-installation acceptance](docs/multi-installation-setup.md) for assumptions
and remaining real-browser acceptance checks.

Schoolbag suggestions are optional and enabled by default, including when older
preferences are upgraded. Explicitly saved visibility choices are preserved.
Use **Boekentas tonen onder de to-do** in settings to change visibility.
The panel appears below the to-do overview and above dashboard planning; changing
the setting immediately updates open extension views without deleting history.

Connection status in the popup, dashboard and settings shows the latest check
outcome and the last successful observation independently. Session expiry prompts
the parent to sign in again without erasing history; network errors do not imply
expired credentials. A saved connection alone does not prove a working session.

Packing suggestions can be marked as packed or hidden, with a restore control.
These choices are stored only in the existing local IndexedDB profile, separately
for each selected day and packing direction. SHA-256 fingerprints of the suggestion
and its source evidence invalidate choices when instructions change, without
duplicating agenda text in packing metadata. Choices are not progress updates and
are encrypted and synchronized when optional group sharing is enabled. Past choices are pruned during successful observations;
profile deletion and history retention remove their enclosing profile. No schema
upgrade or additional permission is needed.

Upcoming planning initially shows five positively known agenda days and at most
20 tasks. Parents can expand by five days or show more tasks. Ongoing tasks and
observed weekend deadlines remain eligible; unknown dates are not assumed to be
school holidays. Earlier/all-task selections remain available. The dashboard has
one to-do overview, followed by local special days, the optional schoolbag and planning.

The dashboard supports filtered local CSV export of all retained tasks,
independent of the visible planning window. Popup and dashboard support local
special days with preparation dates, checklists and schoolbag additions. Home
study preparation includes ordinary lesson material and completed tasks.
Generic preparation reminders use each device's existing system/to-do preferences.
Special days, checklist completion and packing/hiding choices now share through
the existing optional encrypted group. Schoolware agenda content stays local;
different source freshness can temporarily produce different suggestions.
All paired extensions must update. No PHP/SQL update or new permission is required. See
[CSV and special days](docs/csv-and-special-days.md) for behavior and validation.
