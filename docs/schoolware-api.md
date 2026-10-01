# Schoolware API investigation

The project owner reports that AgendaPunt JSON includes ID, AgendaID,
OrigineelPuntID, UniekAgendaPuntID, Titel, TypePunt, GeldigVan, Van, and Tot.
Live response and request evidence have been inspected locally; only their
sanitized structure and synthetic fixtures belong in this repository.
GeldigVan is not necessarily the actual creation timestamp.

Before implementing transport, verify:
1. Exact HTTPS origin, endpoint, HTTP method, and query/body parameters.
2. Existing-session behavior from an extension worker versus an authenticated tab.
3. Whether requests require transient authorization material. Never persist it.
4. Profile selection and isolation between students and installations.
5. Pagination, date windows, filters, and proof of response completeness.
6. Types, nullability, stable ID relationships, and recurrence behavior.
7. TypePunt mapping for assignments, tests, and other agenda entries.
8. Date formats, offsets, timezone behavior, and daylight-saving transitions.
9. Authentication expiry, rate limits, partial responses, and error shapes.

Document only sanitized structure and synthetic examples. Keep real payloads,
URLs containing personal identifiers, and session material out of Git and logs.
Do not infer disappearance until completeness and comparable coverage are proven.

## Phase 2 evidence status

Observed request contract:
- Origin: `https://schoolware_siw.ksgwl.be`
- Endpoint: `/webouders/bin/server.fcgi/REST/AgendaPunt`
- Method: GET
- Parameters: `AgendaID` (comma-separated IDs, including repetitions),
  `MapAgendasOp`, `MinTot`, `MaxVan`, and `CompletedTaskForLL`.
- Date parameters use `YYYY-MM-DD`. Boundary inclusivity is not yet established.
- The successful tab request uses a browser-managed session cookie and
  `X-Requested-With: XMLHttpRequest`. No cookie values are retained here.

Observed response contract:
- Envelope: `{ "success": true, "data": [...] }`.
- Required observed fields: ID, AgendaID, UniekAgendaPuntID, Titel, TypePunt,
  GeldigVan, Van, and Tot.
- OrigineelPuntID and HerhaaldAgendaPuntID are present only on some entries.
- IDs and TypePunt are numeric; some IDs exceed 32-bit integer range.
- Source timestamps use `YYYY-MM-DD HH:mm:ss` without a timezone offset.
- UniekAgendaPuntID and OrigineelPuntID repeat within one response. ID is unique
  within the inspected sample, but stability across checks is not proven.
- TypePunt includes multiple values. The owner identified examples with 101
  (test), 1001 (assignment), and 2 (assignment-like content). See the scoped
  classification below; this does not establish every possible task/test code.
- Recurrence fields and visibility/cancellation flags exist.
- Commentaar may contain serialized JSON with HTML. It is omitted from the
  current connection diagnostic, as are student/staff descriptions and names.

The implemented worker diagnostic requests optional access to this exact origin,
uses `credentials: 'include'`, and never reads or stores cookies. Redirects are
not followed, requests time out after 12 seconds, and the entire response must
validate before its count is returned. Dates remain source strings and are not
interpreted using the machine timezone. Null IDs or other date formats, not yet
observed, fail validation rather than being coerced.

Pagination completeness, profile scope semantics, timezone interpretation,
identity stability, and the remaining TypePunt meanings still need
verification. Every parsed response is explicitly `completeness: 'unverified'`.
Even `success: true` with an empty array is not evidence of disappearance.

See `tests/fixtures/synthetic-agenda.json` and `tests/fixtures/agenda-request.ts`
for entirely synthetic examples.

## TypePunt classification

The owner identified these examples on 2026-10-01 for the inspected installation:

| TypePunt | Evidence | Diagnostic category |
| --- | --- | --- |
| 101 | Owner-confirmed test example | Tests |
| 1001 | Owner-confirmed assignment example | Assignments |
| 2 | Owner-confirmed assignment-like example, but ordinary lesson descriptions also use this value in the earlier response | Review |
| Other values | Not yet classified | Other |

Do not infer that all TypePunt 2 entries are assignments, classify based on
homework-like titles, or extrapolate these mappings to other installations.
Review entries can contain relevant tasks and must remain visible as ambiguous
content. Other codes may also represent tests or assignments; the diagnostic
counts are a supported subset, not a complete categorization guarantee.

The manual check now returns only total/category counts. It still does not
persist titles, comments, student names, or source item identifiers. Existing
count-only summaries remain readable; categories appear after the next check.
All classification fixtures use invented titles and identifiers.

## Gather the request contract

In an authenticated Schoolware tab:

1. Open Chrome DevTools and the Network panel. Select Fetch/XHR.
2. Navigate to the agenda or change its visible date range to trigger its request.
3. Locate the response containing AgendaPunt entries. Inspect Headers, Payload,
   and Preview locally.
4. Record only the HTTPS origin, endpoint path, HTTP method, parameter names,
   and the response envelope. Replace profile identifiers with placeholders.
5. Create a small synthetic response preserving actual field types, nulls,
   date formats, and pagination metadata. Replace titles, names, and IDs.
6. Note whether authentication appears cookie-based or uses an authorization
   header; report only the mechanism, never its value.

Do not share Copy as cURL output, full request headers, or a HAR file: those can
include credentials. An observed final page is not enough to prove how the API
signals pagination completion.

Use this text template for findings. Unknown values should remain unknown:

```text
Origin: https://<schoolware-host>
Endpoint path: /<observed-path>
Method: <observed-method>
Query parameter names and synthetic values: <unknown>
Body structure with synthetic values, if present: <unknown>
Authentication mechanism only: <unknown>
Response envelope: <array or observed wrapper>
Pagination and completion signal: <unknown>
Date window and filters: <unknown>
Profile selection: <unknown>
TypePunt meanings confirmed by matching agenda entries: <unknown>
```

## Verify session reuse after the contract is supplied

Test the implemented bounded manual request to the verified read endpoint from
the extension worker, with access limited to that origin. Browser-managed
session cookies may be sent using fetch credentials; host permissions alone
do not establish that Schoolware will authenticate the request.

If that route fails, distinguish permission failure, network failure, login
redirect, HTTP authentication failure, and an invalid response. Do not treat
an HTML login page or empty error payload as a successful empty agenda.
Test an authenticated-tab route only if the observed session mechanism requires
it. A content script runs under the page's origin for network requests, while
page JavaScript state is isolated from its default execution world.

The manual-check acceptance criteria are:
- Authenticated request succeeds with the expected validated response shape.
- Session expiry returns a clear status without writing history.
- Timeouts and invalid or partial responses cannot become an empty baseline.
- Profile and coverage are explicitly known.
- No credential is stored, logged, or included in extension messages.
- The request result survives a popup closing without relying on popup state.

## Chrome smoke check

Confirmed by the project owner on 2026-10-01: the extension settings reported
a successful fetch and validation of 449 agenda points. This verifies the
authenticated worker request for the tested browser session and configuration.
Only this outcome is recorded; no screenshot, actual profile identifiers,
request query values, or agenda payload is included in the repository.

Additional checks confirmed by the project owner on 2026-10-01:
- Closing the Schoolware tab yielded the same successful result. The tested
  integration does not require an open Schoolware tab.
- Logging out produced the expected session-unavailable message in the popup.
  Explicit logout is tested; passive session timeout has not been tested separately.

Pending live checks: popup closure during a request and clearing local state/host
access. The successful count alone does not verify pagination completeness or
identity stability.

1. Build and reload the unpacked extension from `dist`.
2. Log in to Schoolware normally in the same Chrome profile.
3. Open extension settings. Paste only the AgendaPunt Request URL into Agendalink.
4. Choose Nu controleren and grant access to the exact Schoolware origin.
5. Record only the displayed status and count, not the payload or credentials.
6. Close the popup during another check; reopen it and confirm the last attempt
   is available. Its summary is stored by the worker, not by the popup.
7. Log out of Schoolware and repeat. An expired session must not create history.
8. Choose Koppeling wissen en toegang intrekken. Reopen settings and verify
   the link and previous result have gone.
9. Reconnect while logged in, close the Schoolware tab, and repeat the manual
   check to determine whether an open Schoolware tab is required.

If an authenticated worker request fails, report the displayed status first.
Do not add a tab bridge until the failure and session mechanism are understood.

Reference: [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
and [content script isolation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).
