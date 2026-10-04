# Production review

Review date: 2026-10-04. Reviewed branch `features/local-observation-history`
based on `22e5e22`, including the remediation working tree, against local
`main` at `d463fa7`.

## Decision

Public production release remains pending the acceptance checks below. On
2026-10-04 the owner subsequently authorized local integration into `main` for
continued testing. This supersedes the earlier conditional merge checkpoint;
it does not authorize store publication.

This assessment checks source, existing review evidence, synthetic tests and
the production build. It does not certify the deployed PHP host or actual
Chrome/Windows behavior. No authenticated production requests were made.

## Remediation and remaining acceptance

The owner authorized remediation and explicitly retained optional encrypted
progress sharing on 2026-10-04. `AGENTS.md` now reflects that narrow exception.
Schoolware agenda content, history and session credentials remain local.

The source fixes address the three concrete findings:

1. Each valid settings edit is sent immediately to the worker, which serializes
   writes independently of the document and permission prompts. Desired settings
   persist even when permissions are absent; delivery/injection still enforce
   Chrome permissions. Late permission grants reconcile the latest stored state.
2. Server capacity counts only new operation IDs under the group lock. Full-group
   duplicate retries succeed; oversized mixed batches roll back all writes.
3. Global and per-enabled-token minute quotas cover all validated actions.
   Counters commit independently of operation outcome, overload returns 429 with
   Retry-After, and old buckets are pruned without logging secrets or raw IPs.

Remaining release gates:

- Owner-confirmed: SQL/API update installed and synchronization succeeds.
  Hosting/WAF and production throttling verification remain operational checks.
- Verify interactive permission prompts, Windows visibility of an automatically
  eligible notification, and the corresponding Schoolware-page banner.
- Owner-confirmed: logout/login recovers without reconnecting, and extension
  operation survives PC restart. Two-device progress propagation remains pending.
- Owner-confirmed: a Windows to-do reminder and Schoolware unfinished-work banner.
  Automatic new/change alerts still require separate acceptance evidence.
- Verify the new schoolbag overview after reloading; it does not change the server.
- Keep the supported-school limitation explicit in the store listing.

The Schoolware adapter only accepts `schoolware_siw.ksgwl.be`. A release for
parents at that installation must clearly state this limitation. Supporting
other schools requires verified integrations, not merely broader permissions.
Completeness, source identity stability and timezone assumptions remain
documented; disappearance detection stays disabled.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 249 tests in 23 files.
- `npm run build`: passed.
- `npm audit --json`: zero reported vulnerabilities.
- `git diff --check`: passed.
- PHP 8.2 / isolated MySQL 5.6 integration: passed, including capacity retries,
  mixed-batch rollback, per-token/global quotas and concurrent requests.
- Isolated headless Chrome 154 settings smoke: passed with actual React input
  events, a delayed worker write, immediate tab closure and worker restart.
  The extended smoke also verifies both schoolbag lists with synthetic history.
  No real Schoolware session, production server or personal data was used.

Repeat the settings smoke after a production build with:

```sh
node scripts/chrome-settings-smoke.mjs "PATH_TO_CHROME"
```

The script creates a fresh temporary profile, allocates its own debugging port,
loads only `dist` and closes that browser. It preserves the synthetic profile
for diagnosis. It does not prove visible OS alerts or interactive permission UI.

Source checks included destination restrictions, session transport, sender
validation, discovery, observation comparison, database upgrade handling,
settings ordering, progress transport/storage, server quota handling and build
packaging. The existing security review remains relevant; its older test count
does not describe this validation run. Application and server remediation are now included; the report does not assert
that the deployed host has been directly inspected. Its upgrade is owner-reported.

## Owner steps for distribution after acceptance

1. Register a durable Google account in the Chrome Web Store developer
   dashboard, pay the one-time registration fee and complete account setup.
2. Publish a public privacy-policy page and support contact. Describe local
   agenda storage, retention/deletion and any approved optional remote progress
   processing accurately. Do not claim that all data remains local if sharing
   is included.
3. Build the accepted revision and ZIP the contents of `dist`, with
   `manifest.json` at the ZIP root. Exclude the server, source tree, private
   configuration and personal data.
4. Prepare a Dutch description, extension icon, screenshots using synthetic
   data, supported-school limitation, permission justifications and reviewer
   test instructions. Never supply a real parent's Schoolware credentials.
5. Upload the ZIP, complete Store Listing, Privacy, Distribution and Test
   Instructions, then submit for review. Start with unlisted visibility for a
   small pilot; this still requires review and is not access control. Choose
   public visibility for a searchable general release after acceptance.
6. Share the published store link. Parents install through Chrome Web Store,
   confirm installation, open Schoolware Watch, choose **Schoolware verbinden**,
   sign in to their own Schoolware session and confirm their agenda.

No store upload, publication or server deployment was performed by this review.
The owner subsequently authorized a local main merge; see release readiness.

Official publication references checked on 2026-10-04:

- [Developer registration](https://developer.chrome.com/docs/webstore/register)
- [Publishing workflow](https://developer.chrome.com/docs/webstore/publish)
- [Distribution visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/)
- [Privacy requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
