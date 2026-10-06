# Public Schoolware type-code investigation

Investigated on 2026-10-06 without authentication, account creation, agenda API
requests or access to pupil data. Only public HTML and a referenced JavaScript
bundle were fetched. No third-party executable code was executed or bundled.

## Sources

- The official school-group directory links KOHamme's parent portal:
  <https://www.durme.be/links/>
- Public parent portal: <https://kohamme-ouders.durme.be/>
- Its directly referenced application bundle:
  <https://kohamme-ouders.durme.be/assets/index-BihnKBT6.js>
- Bundle SHA-256:
  `e6319672eca9cf56ca132e77d25ae3d008f40f7962a4bb2c5091bf27f42d7018`

## Findings

The bundle contains a central `AGENDA_PUNT` definition and
`getTypePuntOfAgendaPunt` classifier. Its range helper includes the lower bound
and excludes the upper bound.

| Numeric type | Application category |
| --- | --- |
| 0 | Hour schema |
| 1 | Timetable |
| 2 | Teacher |
| 3 | Free calendar |
| 4 | Absence calendar |
| 5 | Room |
| 6 | Resource |
| 7, 8 | Personal |
| 9 | Attention point |
| 100 through 999 | Test |
| 1000 through 1999 | Assignment |
| 2000 through 2999 | Activity |

This confirms that the observed 100/101 and 1001/1002 values fit fixed category
ranges in another installation's public frontend. It does not establish whether
individual subtype numbers within those ranges can be configured by schools.
The current extension recognizes only the individually observed values, so it
can miss other valid values inside the ranges. Code 9 is explicitly an attention
point in this frontend; the existing conservative marked-content treatment does
not assert it is a test or assignment.

Public request-building code uses the `AgendaPunt` REST resource and parameters
`AgendaID`, `MapAgendasOp`, `MinTot`, `MaxVan`, adding `CompletedTaskForLL` for
parents. This matches the parameter names allowed by the extension. The public
portal is a newer Vue frontend served at the host root. The authenticated server
location and complete request path were not verified, and the extension still
requires its exact observed `/webouders/bin/server.fcgi/REST/AgendaPunt` path.

## Limits and follow-up

One independently hosted frontend is enough to refute the assumption that only
the original school has this numeric category scheme. It is not enough to certify
every Schoolware version, endpoint path, response shape or pupil identity.
No live cross-school extension integration or synchronization was tested.

Future implementation can use the verified category ranges with explicit
integer-boundary tests. Wider feature enablement should distinguish verified
frontend type semantics from successful transport/response validation. Unknown
types must remain Other. The initial investigation did not change feature gates
or the released package.

## Second independent domain and implementation

The official Molenland school group confirms its Schoolware use:
<https://molenland.be/schoolware.html>. Its published parent guide links
<https://webksotr.schoolware.be/webouders/start.html>.
On the same date that portal referenced
<https://webksotr.schoolware.be/webouders/assets/index-BihnKBT6.js>.
Its SHA-256 is identical to the KOHa bundle recorded above. Definitions, range
inclusivity and parent agenda parameter names therefore match exactly. This is
evidence of shared frontend code across different school groups, not two
independent implementations or an authenticated transport test.

Following owner authorization, the extension now classifies the full test/task
ranges across validated installation origins. Task eligibility uses the same
pure classifier. The UI enables existing opt-in progress sharing for supported
agenda URLs, with successful local history still required by the repository.
Unknown/ordinary lesson types and activity types remain Other. Host-specific
permissions, exact request paths, response validation, installation-scoped
identities and progress pseudonyms remain in place. Existing retained points
are reclassified on the next successful check, not by a destructive migration.
Live cross-school session, identity and response compatibility still require
acceptance; the extension does not claim universal Schoolware compatibility.

Validation: 319 tests across 26 files, strict TypeScript, ESLint, production build
and the isolated Chrome 154 smoke suite passed. Synthetic boundary cases cover
99/100/999/1000/1999/2000, invalid numeric types and rejected installation URLs.
Worker integration verifies subtype projection, opt-in pairing and encrypted-only
uploads on a different synthetic installation. Existing installation-isolation
and old progress-key compatibility tests remain passing. No server change or
database migration is needed for this frontend/domain update.
