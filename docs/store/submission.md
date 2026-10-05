# Chrome Web Store submission pack

Development target: version 0.2.0, updated on 2026-10-05. The owner reports
that 0.1.0 is approved and published. This next update is not ready for submission;
continued testing and Matthias's external review precede any merge to main or
release publication. See [0.2.0 release checks](../release-0.2.0.md).

## Upload assets

Build with `npm run build`. ZIP only the contents of `dist`, with manifest.json
at the root. `artifacts/chrome-web-store/` holds the local release ZIP, checksums,
128px icon, 440x280 promotional tile and 1280x800 synthetic screenshots. These
artifacts are ignored by Git and must not contain real pupil data or server files.

Generate synthetic images using:

```sh
node scripts/chrome-settings-smoke.mjs "PATH_TO_CHROME" --store-assets
```

Copy the Dutch store-facing text from `listing-nl.txt`. Use
`privacy-policy-nl.md` as the public privacy page. The GitHub-rendered document
can serve as its URL only after confirming anonymous accessibility:

https://github.com/blowdoof/schoolware-watch/blob/main/docs/store/privacy-policy-nl.md

Anonymous access to that GitHub URL returned 404 during preparation. Do not use
it until public accessibility is confirmed. Upload `server/public/privacy.html`
beside the deployed `sync.php` and verify
`https://schoolware.bumper.be/privacy.html` without signing in. This static page
contains the same policy, no JavaScript and no external assets. Keep both copies
in sync when editing the policy. No SQL or API changes are needed for this page.
A privacy document bundled in the ZIP is insufficient.
Review the hosting operator's actual log/backup retention before certification;
the application cannot guarantee that those systems delete data immediately.

## Dashboard fields

- Name: Schoolware Watch.
- Language: Dutch.
- Support contact: info@bumper.be.
- Website/source: https://github.com/blowdoof/schoolware-watch.
- Single purpose: use the final paragraph in listing-nl.txt.
- Remote executable code: No. All JavaScript and styles are locally bundled;
  HTTPS API responses are data, not executable code.
- Distribution: the owner requested public availability. A first unlisted pilot
  is useful for the outstanding two-device check; it still undergoes review and
  is installable by anyone with the link. Public visibility is the searchable
  option. Deferred publication allows final acceptance before making it live.

## Permission justification (reviewer-facing)

| Permission | Justification |
| --- | --- |
| storage | Store the user-confirmed agenda connection, settings and monitoring state locally; no Chrome storage sync is used. Agenda history and task progress use local IndexedDB. |
| alarms | Coordinate periodic agenda checks, retries, temporary discovery expiry and opt-in progress exchange after service-worker suspension. |
| activeTab | Temporarily read the current tab URL when the user clicks the extension icon to identify a possible Schoolware origin; no unrelated browsing history is retained. |
| notifications (optional) | User-enabled generic change/to-do notifications. No pupil names or agenda titles appear in system notification text. |
| scripting (optional) | Inject the locally bundled generic notification banner only into the connected Schoolware origin after user permission. |
| webRequest (optional) | During explicit connection setup, recognize an allowlisted agenda GET request from the explicitly selected or dedicated tab, without reading headers, cookies or bodies. Permission is revoked when discovery ends. |
| https://*/* (optional host declaration) | Schools use different custom HTTPS domains. Request only the exact user-selected origin for agenda transport, discovery and an optional banner. No all-sites grant is requested. The endpoint and query parameters remain constrained. |
| schoolware.bumper.be (runtime optional host grant, covered by https://*/*) | Exchange encrypted progress and optional encrypted participant announcements only after explicit group pairing. No agenda text or Schoolware credentials are uploaded. |

## Data-use declaration

Do not select "no user data" just because agenda content stays local. Google's
policy includes locally handled data. Disclose website content (agenda text),
personally identifiable information (local pupil references and optional user
labels), narrowly scoped Schoolware request URLs/activity and optional independent
sync authentication material. No unrelated browsing history, payment details,
Schoolware passwords/cookies, analytics or advertising data are collected.
Match the actual dashboard categories and explain these distinctions accurately.
The account holder must personally certify the declarations; encryption does not
exempt uploaded data from disclosure. Do not claim legal certification here.

## Reviewer test instructions

The verified installation is https://schoolware_siw.ksgwl.be. Other installations
are experimental and must expose the same validated agenda contract; task-type
classification and shared task progress remain unavailable there. Normal monitoring
requires an authorized parent account at the selected installation and a valid session.
No real parent's credentials are supplied. Without a connection reviewers can
inspect settings, privacy, permissions and the explicitly synthetic system
notification preview after granting the optional notifications permission.

Connection flow: sign in at the school website, click the extension icon to use
the current site (or enter its address in settings), choose Schoolware verbinden
and grant exact-origin access. The first-opening guide also covers preferences
and optional pairing with an existing progress group. Then
sign in at Schoolware, open the relevant agenda, return and confirm the selection.
The initial successful response is a baseline; later checks compare local
observations. Login/session failures preserve history. Logout and PC-restart
recovery were owner-tested. Notifications require enabling the desired channel.
Task statuses do not modify Schoolware. Schoolbag suggestions are advisory.

Optional sharing requires separately pairing a group and granting only the sync
host. Two-device live acceptance remains pending. Do not provide permanent
pairing codes or real pupil content in reviewer notes. If Google requires
authenticated integration access, arrange a school-approved synthetic/demo
account through an appropriate private review channel; availability is currently
unconfirmed. Synthetic screenshots do not prove real Schoolware authorization.

## Publication handoff

Register/setup the developer account, upload the ZIP as a new item, complete
Store Listing, Privacy, Distribution and Test Instructions, then submit for
review. Account payment, identity verification and signing policy declarations
belong to the account holder. Submission does not guarantee approval.

Store installation usually has a different extension ID from an unpacked build.
Existing unpacked IndexedDB/history do not automatically transfer. Reconnect
Schoolware in the store build; a trusted progress pairing may be re-used separately.
Avoid running both copies with notifications enabled during transition.

Official sources checked on 2026-10-04:

- https://developer.chrome.com/docs/webstore/register
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
