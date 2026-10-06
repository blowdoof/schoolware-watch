# Monitoring and notifications

## Notification selection diagnostics

Settings show the most recent non-test selection and system-delivery results.
Activity selection entries now count baseline events, unselected categories,
inactive points and points outside the configured horizon. Each excluded event
is counted once, in that order; a point failing several filters has one primary
reason. The selected horizon/categories and aggregate counts contain no agenda
content or source identifiers. Old logs cannot reconstruct these exclusions.
Selection behavior and defaults are unchanged. See the
[security and notification review](security-review.md) for the supplied log's
evidence and remaining actions.

## In-page navigation and automatic settings saves

The popup remains the compact to-do view. Its settings and overview icons ask
the worker to open one shared browser tab, activate an existing one and focus
its window. Inside that tab, icons switch the React view without reloading,
so pending saves can finish during view changes. Reopening from the popup
navigates the reused tab to the requested page. Notification detail tabs are
kept separate. No additional permission is introduced.

Connection setup, manual checks and detailed connection/check summaries appear
only in settings. Overview and popup views show no connection card when paired.
Without a connection they show a compact notice, a settings navigation action
and instructions to sign in, select the pupil's agenda and confirm pairing.
This notice uses the existing validated connection read and refreshes after
local settings changes; it never starts discovery or requests permissions.

The worker discovers its own main-page tabs with
[runtime.getContexts](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getContexts).
A session-only tab ID also covers tabs still loading or discarded and worker
restarts. Before using that cached ID it verifies the exact local page URL;
unrelated pages and notification details cannot be overwritten. Opens are
serialized to avoid duplicate creation on rapid clicks. A closed tab is replaced
on the next open. No website or personal data is stored for this navigation.

Closing a document can still discard edits queued in that UI; the latest
**Automatisch opgeslagen** status confirms completion. Notification clicks
retain their existing scoped detail route.

Valid preferences save on each change without a submit button. The UI queues
saves in edit order, keeps the latest draft during storage refreshes and starts
optional permission requests directly in the change gesture. A delayed permission
prompt cannot reorder later changes. Failed writes show an explicit unsaved
message and do not block a corrected edit. Temporary invalid numeric/category
drafts are not persisted; runtime validation still requires 1–30 days and at
least one category. Destructive and pairing operations retain explicit actions.

Existing task status and retention controls already save immediately. Participant
name edits now persist each valid normalized value locally without a save button.
The `sync.name` request no longer waits for the membership network exchange:
the durable progress-sync alarm announces the latest name on its next run, or
the user can synchronize explicitly. A blank/invalid name preserves the previous
saved value. Initial pairing still requires the explicit pairing action and
optional host permission; entering a partial secret cannot create a group.

## Daily to-do reminders

The owner's request on 2026-10-04 extends both existing notification channels
to the to-do overview. `todoRemindersEnabled` defaults to true, including when
older preferences are migrated; notification channels retain their existing
settings and remain off by default for new installations. No extra permission,
server change, remote storage or database migration is required.

After a successful agenda check at or after 16:00 Europe/Brussels, the worker
selects unfinished marked points on the next known future
weekday in that profile's latest agenda. Selected notification categories are
respected; the source-change `notificationDays` horizon does not truncate this
agenda-based horizon. Unknown future days, stale planning from a previous local
day, failed checks and an empty selection cannot produce a reminder. This is
separate from change observation: even an initial baseline can produce a to-do
reminder, without an appearance event or modification to observation history.

Each profile stores one bounded daily reminder ID and per-channel claims inside
its existing IndexedDB scope. Claims commit atomically before Chrome or banner
delivery, providing at most one attempt per channel and Brussels calendar day
across checks and worker restarts. A channel enabled later can claim the same
day's reminder independently. Claims are retained across subsequent observations
and erased with profile history. As with change-notification claims, interruption
between claiming and external delivery can lose that day's reminder; we do not
promise exactly-once delivery or retry in a way that could duplicate toasts.

The system notification uses the existing title/icon. Page reminders use the
same inbox, isolated content script, CSS, badge and dismiss action as change
alerts. Only a random alert ID, generic counts and a planning date reach that
page, never student names, titles, instructions, local task IDs or credentials.
New daily reminders replace older to-do inbox entries for that profile while
preserving change alerts and other profiles. The worker projects current pending
counts when reading a banner; task updates and remote progress refresh it. A
completed, disabled or expired reminder disappears from the page. Dismissal
does not reset the durable claim, so polling cannot restore it that day.

Clicking either channel opens the existing notification URL for its random ID.
The worker matches the ID only inside the active profile and returns a validated
`todo` details status; the extension then renders its live to-do overview with
the same status controls and bulk completion action. Unknown, deleted, replaced
or other-profile IDs return the usual unavailable view. This view is current
progress, unlike the frozen snapshots for source-change notifications.

Synthetic tests cover selection/time zones, unknown dates, concurrent claims,
worker restart, channel permissions/settings, profile isolation/deletion,
counts after completion, dismissal, next-day delivery and failed checks.
Actual Chrome/OS delivery remains a live acceptance check: with both channels
enabled, run a successful check after 16:00 with genuinely pending work, verify
matching generic reminders and click-through, repeat the check/restart the worker
without another reminder, mark the work done and verify the page banner clears.
No changes to real Schoolware agenda content are needed for this check.

## Changes, progress and visibility

Completed assignments/review items return to `in-progress` after a meaningful
source change or reappearance; a `validFrom`-only update preserves completion.
The transition, generic audit metadata and notification details commit together.
It applies even with notifications disabled. Alerts honor enabled channels,
categories and the planning horizon, considering both old and new planning for
changed items. Reopening is labelled in the detail view and generic system toast.

Cancellation/hiding changes can trigger alerts based on the last active planning.
These points leave active task lists but retain history and local progress.
Verified disappearances also have frozen lesson details containing explicitly
labelled last known content. Repeated checks do not repeat disappearance events.
The live adapter still cannot prove response completeness or stable identity,
so absence from a live response never suffices to detect deletion. No additional
Chrome permissions are introduced by these changes.

Live acceptance: observe a natural change to a completed task, confirm Bezig and
one alert with reopening details, then check again and restart the worker to
confirm no duplicate alert/status transition. On a natural cancellation/hiding,
confirm history and one alert remain while active task controls disappear.
An empty/incomplete response or session failure must not remove stored items.

## Live Chrome acceptance checks

Automated tests exercise Chrome API mocks and synthetic agenda points. They
cannot prove alarm wake-up, browser session longevity or operating-system
notification delivery. No real agenda changes should be made for testing.

1. Build, reload the unpacked extension and inspect its worker for startup errors.
2. Log in normally, run a manual check and verify an active 15-minute schedule.
   The first check establishes baseline entries without change notifications.
3. Save a 5-minute interval. Close the popup and Schoolware tab; keep Chrome
   running. After an interval, reopen and verify a newer attempt timestamp.
4. Stop the worker in DevTools, then reopen the popup. Check the existing
   schedule and history. Reload the extension; missing alarms must be restored.
5. Disable polling. Confirm automatic saving and no next scheduled check. Re-enable
   and confirm the selected interval. Restore 15 minutes after testing.
6. Enable notifications, choose three days and select desired categories.
   Grant the optional permission. Show a test notification, click it and verify
   an explicitly synthetic lesson preview opens, with new/changed colors and
   before/after instruction values. No observation is added. The test checks Chrome's notification permission level,
   uses a fresh identifier and requests that the notification stay visible until
   dismissed. It reports whether the created notification appears in Chrome's
   registry; this does not prove an OS banner appeared. A missing registry entry
   can also mean the notification was already dismissed. Check your operating
   system's notification/focus controls if suppressed.
7. Change event colors. Open the dashboard to verify accents on existing
   observed/changed entries; baseline entries stay neutral. Text labels remain.
8. If a natural new/change event occurs within the horizon, verify one generic
   grouped notification and its history entry. Click the notification and verify
   all fetched points of each affected lesson, including unchanged points, and
   the observation-time snapshots remain unchanged after another check.
   An unchanged subsequent check
   must not repeat it. Events outside the horizon remain in history without alerts.
9. Log out. A periodic check should show a session error, leave successful history
   intact, produce no notification and show a future retry time. Log back in and
   use a manual check to recover immediately.
10. Clear history during a check. The next completed check must establish a fresh
    baseline without change alerts. Disconnect during a check and verify all history,
    configuration, preferences, notifications and the polling alarm are removed.

## Schoolware-page banner smoke checks

System notification delivery was confirmed by the owner on 2026-10-02 after
enabling Chrome notifications in Windows settings. The new page banner still
needs live Chrome checks:

1. Rebuild/reload the extension. With banners initially off, choose **Testbanner
   op Schoolware** without saving first. Grant optional scripting access limited
   to the Schoolware origin. Verify the setting switches on. Permission denial
   must leave settings/history unchanged and the test button usable for retry.
2. Open a Schoolware page and choose **Testbanner op Schoolware** in extension
   settings. Verify a generic banner at the bottom right of Schoolware and a
   badge count on the extension icon. Reload the Schoolware page if needed.
3. Open another Schoolware tab. Both should show the pending banner. Other
   websites and the extension's own pages must have no banner.
4. Click **Sluiten**. Both tabs should hide the banner and the badge should clear.
   History remains unchanged. Create another test banner and click the notification
   body. Verify an explicitly synthetic lesson preview with configured colors and
   before/after changes, without new observation history.
5. Keep a test banner pending, restart the worker and reload Schoolware. The
   banner and badge should remain. Disable banners; the banner should
   disappear and future pages should receive no content script.
6. Verify baseline/unchanged checks produce no change banners. Daily to-do
   reminders remain independent of change detection. Natural new/change
   events inside the shared horizon/categories should create generic banners.
   System notification permission or OS suppression must not prevent banners.
   Click a real banner and compare its lesson details with the system notification
   for that check. Different checks must open their own captured details.
7. Clear history or disconnect during a check. No late result may restore erased
   banners. Disconnect must clear the inbox/badge and unregister the script.

The banner uses the extension's configured profile, not a profile inferred from
page contents. The inbox is capped at 20 across selections and follows retention.
Detail snapshots are kept with retained checks, independently of inbox dismissal.
Changing the configured profile cannot expose old-profile notification details.
Legacy notifications without snapshots and deleted/expired checks show an explicit
unavailable message instead of unrelated current history.

## Test notification troubleshooting

If Chrome accepts a test notification but no banner appears on Windows 10:
open Action Center with Win+A (Win+N is the Windows 11 shortcut), set Focus
assist to Off, and open Settings > System > Notifications & actions. Enable
app notifications and Google Chrome; in Chrome's Windows notification entry,
enable both notification banners and Action Center notifications. Retest after
reloading the updated extension. Chrome registration does not establish that
the OS showed a banner.

References: [Windows notifications](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows)
and [Focus settings](https://support.microsoft.com/en-us/windows/experience/focus-stay-on-task-without-distractions-in-windows).

## Coverage and time assumptions

Requests retain the configured pupil/agenda parameters and use Brussels date
coverage from today minus seven days to today plus max(14, notification days)
plus one extra boundary day. These dates roll for manual checks too. Manually
editing the configured URL still creates a separate scope.

Newly covered points are baseline entries. A new source tuple is an observed
event only when its planning lies strictly inside a previous successful check's
coverage. Full response completeness and stable temporal identity remain
unverified, so disappearance detection remains disabled. An empty response
cannot prove disappearance. A first observation cannot prove source creation.

The notification window uses the source start timestamp, between Brussels wall
time now and the same wall time N calendar days later, inclusively. Calendar
days can span 23 or 25 hours at daylight-saving transitions. Source timezone
semantics still need verification. Crossing into the window without a new
observed/changed event does not alert. Newly observed hidden/cancelled points
do not alert; hiding/cancellation changes can alert using previous active planning.

Notification delivery is best effort with a durable at-most-once claim; worker
interruption between history commit/claim and delivery can lose an alert. No
notification error invalidates committed history. Chrome must run; alarms can
be delayed during device sleep and do not wake a sleeping device.

References: [Chrome Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)
and [Chrome notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications).

## Settings closure regression check

Run `node scripts/chrome-settings-smoke.mjs "PATH_TO_CHROME"` after building.
This loads the actual extension in a new isolated headless Chrome profile,
changes the interval twice while the first worker write is artificially delayed,
closes the settings tab immediately, and verifies the latest interval persists
through worker restart. It does not open Schoolware or use existing browser data.
Interactive permission prompts and Windows notification visibility still require
an owner acceptance check. Desired notification settings can be saved without
permission; settings report that permission is missing and delivery stays blocked.
