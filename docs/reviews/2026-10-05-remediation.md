# Pre-store review remediation on the active feature branch

The supplied review (`9be484f`, reviewing `fe1f32e`) is preserved alongside this
record. This implementation retains the multi-school, onboarding, schoolbag and
planning changes on `features/multi-school-onboarding`. It is not a merge, release,
hosting deployment or reviewer approval.

## Addressed findings

| Review item | Remediation |
| --- | --- |
| s2 F1 repeated check/outbox | Reopening outbox writes use the same durable check-ID guard as events/audit. Regression test protects a newer manual completion. |
| s2 F2 brace-prefixed comments | Ordinary non-JSON brace/bracket instructions remain text. Malformed quoted-key objects still fail closed because they may contain private serialized fields. |
| s2 F3 date-window identity | Before a worker check, resolve the verified installation and pupil/agenda selection independently of MinTot/MaxVan. Reuse the legacy scope key, preferring an existing sync connection and then the original baseline; retain IDs, history and sharing keys. Existing duplicate legacy scopes are not destructively merged. |
| s2 F4/F5 metadata and formatting | GeldigVan-only edits do not create meaningful change events. Compare normalized CRLF, NBSP and trailing whitespace, retaining the original snapshot text locally. Progress versions use the same normalization. |
| s2 F6 clock rollback | A newly completed serialized worker check may explicitly accept its true wall-clock timestamp after rollback. Generic out-of-order comparisons still reject stale input. No creation time is invented. |
| s2 F10 and transaction gaps | Test v1/v2-to-v3 migration, aborted upgrade/retry and rollback after a later audit-store failure. Handle both abort promises to prevent unhandled migration rejections. |
| D1 / s3 F2/F3 | Add a private per-group transactional purge command and an activity-column migration. Expired idle content and empty idle groups can be reclaimed by scheduled operator maintenance. Policy does not promise a deployed daily schedule. |
| D2 | Policy and UI distinguish erased encrypted content/participants from retained group verifier, revision, access status and activity metadata. Disabled reclaimed groups retain only a revocation verifier so cleanup cannot resurrect access. |
| D3 / s3 F4 | Pad new plaintext JSON to 512 UTF-8 bytes using JSON whitespace. All new status and label ciphertext has equal length; existing sw1 clients can read it and old unpadded records remain readable. Older traffic still leaks length until clients update/records expire. |
| D4 | A label is optional when creating/joining a group. No label means no participant announcement; progress sharing still works. |
| D5 | Disclose the per-device last-seen heartbeat and approximate one-minute cadence. |
| s3 F1 | Unknown credentials use a rotating keyed peer limiter, never the legitimate groups' global quota. IPv6 addresses share a /64 bucket; no raw IP is stored. |
| s3 F7 | Public Apache allowlist permits sync.php/privacy.html only. Hosting paths remain installation-specific and documented. |
| s3 F8 | Persist automatic-sync blocking on 401/403/409. Stop the alarm and retain local progress; an explicit manual retry resumes attempts. A restored cursor is not silently reset or used to overwrite local progress. |
| Disclosure wording | Fix the host-access typo and describe the sync host as a runtime grant covered by the broad optional declaration. Markdown and HTML policy sources match. |
| Build line endings | Add .gitattributes for stable generated notice/source line endings. |

## Deliberately retained boundaries and follow-up

- Duplicate source tuples remain a rejected ambiguous response. Unverified ID
  relationships are not guessed or silently merged; no disappearance is inferred.
- Coverage completeness/pagination is still unverified. Disappearance remains
  disabled, and notification wording no longer claims it is detected. Truncated
  initial coverage can still affect whether a later observation is a baseline.
- Retention intentionally removes old history, including old reappearance/check IDs.
- The sw1 shared-secret protocol retains the existing HMAC/AES key material and
  operation-ID AAD for compatibility. Key separation and authenticated group/revision
  binding require a separately designed protocol migration. A malicious server with
  database write access can replay/roll back data; members holding the group code
  can change peer announcements. Shared-secret limits remain documented.
- Broad optional hosts, activeTab, discovery, setup, schoolbag and planning need
  Matthias's review on the final feature commit. Automated checks are not approval.
- The owner must install the additive server migration/private helper and schedule
  maintenance, then verify cPanel TLS, Authorization handling, allowlist and cron.
  Nothing was uploaded, no production database was modified, and no cron was installed.
- Another-school acceptance waits for the owner's external volunteer.

## Validation

Use synthetic fixtures only. Run typecheck, lint, Vitest, production build, isolated
Chrome smoke and the PHP 8.2/local MySQL integration harness. The harness covers
maintenance-schema upgrade, inactive-group purge, preservation of revision/token,
revocation after reclamation, peer quotas/IPv6 /64 isolation and existing API
transactions. It must never target the hosting database.

Completed locally: strict typecheck, ESLint, 295 tests across 26 Vitest files,
production build, isolated Chrome 154 smoke, and PHP 8.2.34/MySQL 5.6.22 API
integration. No real student data, owner browser session or production service
was used. Apache/cPanel behavior and scheduled maintenance remain hosting checks.
