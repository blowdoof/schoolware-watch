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
types must remain Other. This investigation does not itself change feature gates,
request permissions, classification or the released package.
