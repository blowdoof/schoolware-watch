# Public source preflight (2026-10-14)

Scope: read-only inspection of the tracked project and all locally reachable Git
objects. No repository visibility change or history rewrite was performed.

The owner subsequently authorized keeping the source link and making the source
public if the exposure checks permit it. A GitHub plugin connection is suggested
for authenticated review of remote settings, workflow logs and attached data;
the available connector is not yet installed/connected. Until that review is
possible, retain the link only as a conditional draft, not a verified public URL.

Anonymous requests to the GitHub repository page and repository REST endpoint
both returned 404. The source link is not usable as a public Store homepage.
Authenticated visibility could not be inspected; a 404 alone is not proof of
the specific visibility setting.

The ignore rules exclude environment files, private keys, HAR captures, populated
sync configuration, private response exports and local artifact packages. The
tracked PHP configuration is an example with a replacement password. Existing
group credentials/encryption keys are generated locally, not static application
secrets in the source. Publishing source does not itself disclose private group
keys or production database passwords. Browser extension code is already
distributed to installed users.

A bounded heuristic scan examined 702 unique reachable file blobs from local
refs. It found no matches for private-key blocks, common GitHub/OpenAI token
formats, populated Schoolware/PHP session-cookie strings or literal PHP database
password assignments outside known placeholders. Historical filenames showed no
tracked .env/key/HAR/private-response or populated sync-config candidates. These
checks are evidence, not an exhaustive secret or personal-data certification;
unknown secret formats and platform-only data are not covered.

Before making the existing repository public, also review GitHub Actions logs,
uploaded artifacts/releases, issue/PR attachments and other remote refs/data
not available in this local scan. Commit author identities and email metadata
also become publicly visible. A final human review of deployment instructions
and fixtures is advisable. Do not commit production configuration or real pupil
responses to make the project easier to demonstrate.

If an actual credential is discovered, revoke/rotate it first and separately
plan removal from history and remote caches; deleting the latest file is not
enough. Alternatively publish a reviewed clean snapshot in a new public source
repository, while preserving this development history privately. This still
requires checking snapshot files and explicit owner publication authorization.
