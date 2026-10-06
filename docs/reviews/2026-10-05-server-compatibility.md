# Server compatibility with extension 0.1.0

The owner confirmed that Chrome Web Store version 0.1.0 is published.
The isolated compatibility run on 2026-10-05 passed using the original crypto,
pairing-code parser, item-key derivation and progress validator from commit
`fe1f32e` (package version 0.1.0), alongside the current feature-branch code.
This is a source-based protocol test, not execution of the downloaded Web Store
artifact or a browser UI test of that artifact.

## Verified

- Existing sw1 pairing codes and default-installation item keys are unchanged.
- Old unpadded encrypted progress is accepted by the updated PHP API and read
  by the current client code.
- New padded encrypted progress is accepted by the same API and read by the
  original 0.1.0 client code, including its payload validator.
- Old-to-old exchanges also continue to work on the new server.
- Retried uploads preserve operation identity and do not increment revision twice.
- Participant labels written by either codec can be read by both codecs.
- Leaving participants and deleting remote content preserve the group cursor.
- The surrounding PHP/MySQL integration suite passes migration preservation,
  isolation, registration, revocation, pagination, quotas and maintenance tests.

All data and credentials are synthetic, and the database and HTTP endpoint are
local and disposable. No production service or Schoolware session was used.

## Limits and upgrade order

Apply schema additions and the activity-column migration before replacing the API.
Install the private maintenance helper before the new API requires it. Preserve
existing private configuration. Native Apache/cPanel authorization forwarding,
TLS and cron configuration still require a hosting check after deployment.

Scheduled maintenance may reclaim empty groups inactive beyond the configured
retention period; this intentional behavior also applies to old clients.
Client-side task-version normalization changed in 0.2.0: unusual whitespace may
produce different task-version hashes across mixed client versions. That is not
a database incompatibility, but completion can be ignored for such differing
versions until both clients update. This test does not establish UI-level task
matching across all mixed-version agenda fixtures.

## Reproduction

With an isolated local MySQL instance on port 33307, root without a password:

```sh
python server/tests/integration.py --php PATH_TO_PHP82 --mysql PATH_TO_MYSQL --legacy-compatibility
```

The test loads historical source with git; retain baseline commit `fe1f32e`.
Full feature-branch review by Matthias remains required before merge/release.
