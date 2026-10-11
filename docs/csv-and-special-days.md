# CSV export and special days

Special days, checklist completion and schoolbag choices now synchronize through
the existing optional encrypted group, following the owner's 2026-10-09 scope
expansion. See [shared planning](shared-planning.md). All paired clients must
update; PHP/SQL remain unchanged. CSV downloads and Schoolware content remain local.

## CSV export

The dashboard task panel includes **Taken exporteren (CSV)**. The export has
independent inclusive start-date and end-date filters and an Open/Bezig/Klaar
filter. Empty dates include all retained task entries. Display pagination,
five-day planning and the hide-completed switch do not restrict the export.
The UI reads a fresh runtime-validated task view before creating the file.

Columns are date, planning start/end (Europe/Brussels wall time), subject,
category, title, instructions and task status. Planning dates are not verified
submission deadlines. Source identifiers, profile IDs, local item IDs,
credentials, history events and special-day free text are excluded. The Help
needed feature is not implemented, so no such column is included.

The local browser download uses UTF-8 with BOM, semicolon delimiters, quoted
cells, doubled embedded quotes and CRLF row endings. Multiline instructions
remain within one quoted cell. Known source markup is converted to text.
Formula-like values, including whitespace/control-prefixed formula markers,
receive a leading apostrophe for spreadsheet safety. The UI warns that the
download can contain personal information. The browser/OS decides whether the
file is saved; local profile deletion cannot erase previously downloaded files.

## Special days

Popup and dashboard include a per-profile **Speciale dagen** panel. After
a successful agenda check, a user can create one event per date, with:

- Home study, sports day, trip or another event type.
- A required editable title and optional multiline notes.
- An explicit ordinary-timetable material switch.
- An optional preparation/bring-home date on or before the event date.
- Up to 40 checklist points, each independently completed and optionally shown
  in the schoolbag. Checklist completion is separate from packing choices.

An event can be edited or deleted; past events can be shown explicitly. The
limit is 200 retained events per profile. Free text is rendered as escaped text,
never interpreted as HTML. No automatic event detection or recurrence is added.
The user explicitly chooses preparation dates; weekends, holidays and unknown
attendance are never inferred from agenda gaps.

For home study with ordinary timetable enabled, the chosen preparation date's
**Mee naar huis** suggestions include all latest-observed points on the home
study date: ordinary lessons and completed tasks as well as unfinished work.
After 16:00 Brussels, the school/study list defaults to the next known day,
including a Monday home-study day. An explicit preparation date on today keeps
only the bring-home list on today; it never holds the school/study selector on
Friday. The bring-home heading shows its own packing date and preserves its
existing date-scoped packing choices. Explicit lesson-day selection continues
to select both directions for that day.
On the home study date the heading becomes **Nodig voor thuisstudie**. For an
event with the timetable disabled, ordinary agenda material is omitted only
from that date's school list. Existing homework remains eligible for the home
list. Explicit checklist material appears on the event date and on its selected
preparation date, with existing local packing/hiding controls.

Special/preparation dates can be selected even without observed lessons,
including explicitly selected weekend dates. These selections do not create
Schoolware observations or change the to-do horizon. Missing books and folders
must still be added manually: absence from agenda text is not proof that no
material is needed. The source view retains its last-success timestamp when
checks fail; additions do not establish source completeness.

## Reminders and persistence

A separate one-shot Chrome alarm schedules a generic system reminder at 16:00
Europe/Brussels on the preparation date, or event date when preparation is
empty. It uses the existing system-notification and daily-to-do preferences and
actual notification permission. Agenda monitoring can remain disabled. No
Schoolware check or session is needed for this local reminder. There is no
special-day Schoolware webbanner in this version.

Startup, worker restart, event edits, preferences, profile changes, retention
and deletion restore or remove the alarm using repository state. A delayed
alarm/startup may deliver later on the same date; expired reminder dates are
skipped. A durable claim prevents repeats. Claiming happens before Chrome
delivery, so worker termination or a delivery error can lose a reminder rather
than create duplicates. Editing a checklist does not trigger another reminder
for the same event/preparation date. Notification clicks open the dashboard.
OS toast visibility still requires owner acceptance on a normal device.

Optional fields are stored inside the existing IndexedDB v3 profile object;
no store/schema upgrade is required. Domain observations preserve those fields,
and existing retention prunes past events. Expiring the entire enclosing
profile removes its events, including future ones. History clearing and
disconnect remove events and claims. Writes require the active random local
profile ID and matching local event revision to reject stale/cross-profile edits.
Remote changes increment that revision so open editors cannot silently overwrite
received updates. Checklist completion updates travel independently.

Special days, user-created titles/notes/checklists and packing choices join the
encrypted outbox when sharing is enabled. Schoolware title/instruction content
is never uploaded. Logs contain validated request/action names and delivery
outcomes only, without free text. No new
permission, transport destination, API assumption or PHP/SQL update is needed.

## Verification

2026-10-09 validation: strict typecheck, ESLint, all 353 Vitest tests across 30
files and the production build passed. The complete isolated Chrome 155 smoke
suite passed, including the new CSV/special-day flow. This does not establish
real school material accuracy or visible OS toast delivery.

Synthetic Vitest tests cover CSV encoding and formula protection, complete
export selection, validation limits, local rendering, preparation-day material,
non-timetable events, profile boundaries, concurrent stale edits, failed-write
rollback, existing v3 data, retention/deletion, daylight-saving offsets and
durable reminder claims. Worker tests cover independent alarms, permissions,
restart, generic delivery, duplicate firing and untrusted senders.

The isolated Chrome smoke suite exercises the real form, checklist save,
schoolbag projection, worker restart, event deletion and an actual synthetic
CSV download beyond the visible five-day task window. It uses a disposable
browser profile and never reads the owner's Schoolware session.

For owner acceptance after rebuilding/reloading: create Monday home study with
Friday preparation, select Friday in the book bag, compare ordinary lesson
material and manual folders, check/uncheck a checklist point, and inspect the
CSV in the target spreadsheet program. Confirm a visible system reminder with
notifications enabled. Matthias's external review is required before merging
or publishing; neither action is included in this implementation.
