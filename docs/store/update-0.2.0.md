# Updating the existing Chrome Web Store item to 0.2.0

Prepared on 2026-10-06. Existing item ID:
`phngkgibiapcabhnfjafkfibjobgkkaf`. Published version according to the owner:
0.1.0. Candidate: 0.2.0. Keep all work on `features/multi-school-onboarding`.
Full Matthias review remains required before merge and publication. This document
does not certify review completion or authorize an agent deployment.

## Package and listing

Build the final reviewed commit using `npm run build`. Zip all files inside
`dist`, including unchanged files, with `manifest.json` at the ZIP root. Exclude
server files, configuration, tests, real pupil data and pairing codes. The local
candidate ZIP and synthetic Store images are under `artifacts/chrome-web-store`.
Rebuild the ZIP after any review fix; do not upload a stale candidate.

Use `listing-nl.txt` for the updated description. It states broader support for
the validated parent-agenda contract, not universal support for all deployments.
Standard category ranges and optional progress sharing are available across
validated origins. Authenticated live operation has only been tested at KSGWL.
No new server deployment is needed for the classifier or copy invitation.

Update the hosted `https://schoolware.bumper.be/privacy.html` from
`server/public/privacy.html` before submitting, and verify anonymous access.
This page discloses manual clipboard sharing and third-party email/chat handling.
Preserve the existing database and API configuration. Check the dashboard's
privacy declarations and permission justifications against `submission.md`.
The optional wildcard host declaration permits exact-site selection; it does not
grant automatic access to every site. Compare with the published 0.1.0 manifest
because that update adds discovery/activeTab capabilities.

## Dashboard procedure

1. Sign into the existing owner's Chrome Web Store Developer Dashboard:
   <https://chrome.google.com/webstore/devconsole>.
2. Open Schoolware Watch with the item ID above. Use that existing item so its
   public installation URL and users are retained; do not create another item.
3. Open Package and choose Upload New Package. Select the complete 0.2.0 ZIP.
4. Update Store listing with the prepared Dutch description and synthetic images.
5. Update Privacy practices, policy URL and reviewer test instructions to match
   actual local processing, optional encrypted sync and exact-origin permissions.
6. Keep the existing public distribution. Save all tabs and resolve dashboard
   validation errors. Do not invent a test Schoolware account or supply a real
   parent's credentials; explain the authorized-account requirement.
7. After the required review and release authorization, choose Submit for Review.
   Disable automatic publication after approval to retain a final release gate.
8. When Google approves, perform final acceptance and publish the reviewed update
   manually. The draft/review submission itself does not replace the live version.

Version 0.2.0 is higher than 0.1.0; if the Store already contains a later uploaded
version, increment all version metadata and rebuild before another upload.
Existing Store-installed users retain their installation identity. A previously
unpacked test extension has a separate identity and does not transfer its local
history automatically. Avoid running both copies simultaneously.

## Private progress invitation

After pairing, use Settings → Uitnodiging kopiëren. Paste the message into the
chosen private email/chat. Recipients install from the existing Store URL, connect
their own authorized account to the same pupil and choose the existing-computer
join option. They must explicitly grant sync access and confirm pairing.
The permanent code grants group access; the message is not an expiring invite.
Do not publish this message in a public group, issue or Store listing.
Before 0.2.0 is published, its Store link installs the current 0.1.0 version;
the invitation does not make an unpublished candidate available automatically.

Official procedure verified on 2026-10-06:
<https://developer.chrome.com/docs/webstore/update>.
