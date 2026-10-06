# Multi-installation setup

This is an unpublished source update following the owner-reported first store release.
The existing reviewed installation remains schoolware_siw.ksgwl.be. Wider structural
compatibility is experimental, not a claim that every Schoolware school works.

## Boundaries

- activeTab reads only the user-invoked current tab URL. Recognition uses known
  parent/portal paths or a Schoolware hostname; it is a suggestion, not proof of identity.
- The optional https://*/* declaration permits runtime selection of custom school
  domains. Permission requests contain one exact public HTTPS origin, never a wildcard.
- Credentials, IP-address hosts, local hostnames and nonstandard ports are rejected.
  Public DNS names are not proof of Schoolware ownership. Users confirm their school.
- The parent AgendaPunt path, GET method and five query parameters remain allowlisted.
  Discovery checks its persisted tab/origin/deadline and the top-frame initiator.
- Runtime response validation remains unchanged. Completeness, ID relationships
  and timezone still require live checks on other installations. Public frontends
  from KOHa and Scholen Molenland confirm standard TypePunt category ranges:
  100–999 tests, 1000–1999 assignments and 9 marked attention points. These ranges
  are now used across validated HTTPS installations; unknown types stay Other.
  Disappearance stays disabled. See the public-code investigation below.
- All history remains local and scoped by installation plus selection. Progress
  pseudonyms include the origin without changing old Wetteren-Lede keys. The fixed
  encrypted progress-only service, retention, deletion and shared-secret limits remain
  as described in the existing privacy policy. No other remote service is introduced.

## Guided setup

The popup, dashboard and settings check connection and relevant permissions on open.
The guide is advisory and never replaces page content. Existing connections with
valid saved preferences are recognized even without the newer completion marker.
First connection must succeed; first preferences are followed by optional sharing
with the existing pairing-code system. No extra account is created. Skipping sharing
is a complete setup. Later instellen defers only the current view. Local deletion
removes the completion decision. Session or access loss reopens the relevant step.

## Acceptance before publishing

Use a fresh Chrome profile and synthetic fixtures for automated smoke checks.
Owner browser acceptance must still verify the native activeTab flow on the real
Schoolware login page, exact-host permission prompt (grant/deny), tab navigation,
agenda confirmation, session recovery and restart. A volunteer at another school
can verify the expected parent endpoint and local history without supplying
credentials or agenda captures. Tasks and optional progress sharing use the
verified standard ranges after a successful supported agenda check. Confirm the
real task presentation and pupil selection during live acceptance. Update the store package
and hosted privacy policy together when publication is separately authorized.

Chrome's permission model follows [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
and [runtime optional hosts](https://developer.chrome.com/docs/extensions/reference/api/permissions).

## Automated validation

Typecheck, lint, the synthetic Vitest suite and the production build pass.
Vitest includes installation/tab/frame isolation, restored discovery deadlines,
first-check failures, recovery after permission loss, optional sharing, existing
progress-key compatibility, installation-specific pseudonyms and setup deletion.
The isolated Chrome 154 smoke confirms the first-opening guide, simulated denied
access without network requests, postponement, rapid settings edits, immediate
tab closure, worker restart and synthetic schoolbag projections. It does not
exercise a real Schoolware session or the native permission approval dialog.

## Upgrade regression fixes

A missing setup marker must not hide the dashboard, history, retention, sync or
activity panels. Setup instructions remain compact; settings retain their full
controls and the popup can still connect the active Schoolware tab directly.

Website script reinjection replaces its own old host and listeners, including
the boolean sentinel used by earlier releases. Successful checks reattach the
banner to existing tabs as well as registering it for future loads. Synthetic
Chrome checks cover upgrades, distinct page content during setup, reinjection,
single-host/listener behavior and dismissal/redisplay. Banner visibility still
requires enabled host/scripting access and an actual pending notification; the
UI's test-banner action creates a generic synthetic example. No real Schoolware
session or native permission approval is used by these automated checks.

## Public type-code comparison (2026-10-06)

See [source evidence and limits](reviews/2026-10-06-public-schoolware-type-codes.md).
The independent Molenland portal serves the same bundle as KOHa. Public code
establishes category ranges and parameter names, not authenticated transport or
response completeness. The exact observed parent API path remains allowlisted.
