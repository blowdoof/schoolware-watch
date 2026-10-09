# Schoolbag overview

The popup and dashboard include **Boekentas** with two separate lists:

- **Mee naar school**: the selected known school day, including ordinary lesson
  content and completed assignments. The default is today before 16:00 Brussels
  time when positively observed, otherwise the next known weekday. Users can
  select another known day without changing reminders or task progress.
- **Mee naar huis**: unfinished marked tasks/tests/starred points due on the
  next known school day after the selected lesson day. Browsing the school list
  also advances the home-work horizon. It is not a complete list of all future homework.

Laptop is always displayed in both lists. Other entries are deterministic
suggestions extracted from the already stored agenda title/instructions, grouped
by subject and material. Page ranges and original text remain visible. Examples
include book, workbook, course notes, notebook, atlas, calculator and sports kit.
Page numbers alone produce an explicit **materiaal controleren** suggestion.
When one material is named elsewhere in the same point, a page-only instruction
is associated with it; multiple possible materials remain ambiguous.

Negative instructions are excluded conservatively, while **vergeet niet** and
**niet vergeten** reminders remain positive. This dictionary is not a language
model: abbreviations, mixed negation, implicit books, digital versus printed
materials and subject-specific book names may need manual interpretation.
Unrecognized points remain available under **Materiaal zelf controleren**.
Absence of extracted materials never means the bag is complete.

Only active points observed in the latest successful response for the selected
profile are projected. Hidden, cancelled, missing and older retained points do
not create packing suggestions. Failed checks preserve the last successful
view, with its observation timestamp. Weekends are skipped; unknown days are
never interpreted as holidays or assigned invented lessons.

The service worker reads the existing repository and returns a runtime-validated
`schoolbag.read` response only to trusted extension pages. Website scripts cannot
read it. Source IDs and profile identifiers are excluded. HTML is converted to
text and rendered through React escaping. Packing/hiding choices and special
days now synchronize in the existing optional encrypted group; automatic
Schoolware material text remains local. There are no new permissions or server
changes. Existing retention/profile deletion controls apply to the source data.

An isolated headless Chrome smoke also verifies the actual worker response and
React rendering of both lists, laptop defaults and a synthetic workbook page
range. Run `node scripts/chrome-settings-smoke.mjs "PATH_TO_CHROME"` after building.

Validation uses synthetic fixtures for extraction, page ambiguity, deduplication,
negative instructions, date/horizon selection, progress exclusions, freshness,
profile isolation, message rejection, deletion and text-only rendering.

After rebuilding, reload the extension and open the popup or dashboard. Confirm
that both lists contain Laptop, choose a known school day and compare suggestions
and page references with the source agenda. Mark an applicable homework task
Klaar: its home suggestion should disappear while its school material remains.
No SQL or PHP update is required for this feature.
