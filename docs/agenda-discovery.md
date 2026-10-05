# Automatic agenda connection

## User flow

1. Sign in at the school website and click the extension icon to use that tab,
   or enter the school address in settings. Then click **Schoolware verbinden** (or **Andere agenda koppelen**).
2. Grant optional Chrome access. The selected tab is reused, or a dedicated Schoolware tab opens.
3. Sign in with the user's existing Schoolware account and open the desired
   pupil's agenda in that tab.
4. Return to the extension, verify the pupil/agenda on the Schoolware page,
   check the confirmation box and click **Deze agenda koppelen**.
5. The worker validates/fetches the agenda and records the initial local baseline.
   A login or response error writes no observations. Normal monitoring uses the
   confirmed URL and rolls its date window automatically.

The manual URL field is hidden under **Geavanceerd**. The main check button uses
only the saved connection, even when an advanced draft is edited. Each computer
needs its own Schoolware connection before joining a shared progress group.
An existing connection is never silently changed by website navigation.

## Permissions and boundaries

`webRequest` is optional, requested with the existing exact Schoolware origin
from a user click. The manifest declares optional https://*/* to allow custom
school domains, while requests always name one exact origin. activeTab reads the
current URL after the extension icon is clicked. No blocking permission, debugger, all-sites grant,
script injection, cookies API or remote executable code is added. The observer
uses only successful GET/XHR request URLs, with an allowlist, exact initiator,
top-frame and selected-tab checks. Headers and payloads are never requested.
The API's existing browser-managed session reuse remains unchanged.

The temporary installation origin, tab ID, validated candidate URL, random confirmation ID and
five-minute deadline live in trusted session storage, surviving worker shutdown
but not browser restart or extension reload. Discovery status contains only a
status and random ID. Capture/check/deletion operations use the worker mutation
queue. A changed candidate invalidates any earlier confirmation. The tab must
still be at the selected origin at confirmation. Cancellation, confirmation,
expiry or local connection deletion clears temporary data and removes the
optional network-observation permission. A one-shot alarm and deadline checks
bound capture even when a timer fires late. An absent session means no capture.
No pupil name, agenda content or credential is added to setup status or logs.

Only `/webouders/bin/server.fcgi/REST/AgendaPunt` at the explicitly selected
public HTTPS origin and the five observed query parameters are supported.
Other installations are experimental, with unknown TypePunt codes kept in Other. Schoolware must issue an
actual supported request during the discovery window; if the agenda is cached,
switch its displayed week or reload that tab. Unsupported shapes are ignored.
Do not guess profile identifiers or merge history by title or pupil name.
Selecting another pupil or agenda may create a separate local scope and requires
explicitly configuring progress sharing for that selection.

Chrome references: [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest),
[optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions),
[session storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Validation

Synthetic Vitest checks cover tab/frame/origin/method/status isolation, URL
allowlisting, explicit confirmation, changed-selection rejection, deadline and
alarm expiry, cancellation/deletion, permission refusal, persisted worker state,
secrecy of status/activity and the unchanged baseline pipeline.

Before release, verify a real logged-in parent and pupil browser independently:
Chrome permission prompt, selecting an agenda, cached/week-navigation requests,
popup closure and reopening, worker shutdown while waiting, multiple tabs,
multiple children, login expiry and cancellation/deletion. Confirm that no
unrelated traffic changes the saved connection. Live Schoolware behavior is not
established by synthetic tests. No server deployment is needed for this feature.
