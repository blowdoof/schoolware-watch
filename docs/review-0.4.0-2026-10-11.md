# Candidate 0.4.0 review — 2026-10-11

Reviewed source: `e72d0f89c916ed52188cbc81aa06a34152fe5feb`, branch
`features/csv-special-days`, compared with `main` (`3790439`). Latest published
release is 0.2.0 according to the owner; 0.3.0 was an unpublished intermediate.
This document records findings, not remediation or release authorization.

## Remediation update — 2026-10-11

The findings below describe the originally reviewed commit. Subsequent source
remediation on the same branch fixes R1–R3: returning content can be confirmed
offline; materially edited checklist points receive new identities and unfinished
state; deterministic bounded review projection preserves current controls and
withdrawals without aborting synchronization. Five permanent synthetic regression
tests cover both review kinds, history overflow/repeated application and stale
offline checklist completion across two devices.

The Store listing, privacy sources and current submission instructions are updated
for 0.4.0. R4 remains operationally open until the hosted policy is replaced and
verified. The owner will upload `server/public/privacy.html`; no deployment access
is available in this workspace. No API/SQL change is needed for these fixes.

Fresh remediation validation: TypeScript, ESLint, 400 tests and production build
passed. Both Chrome 155 smoke scripts passed; the two-device script passed on
an isolated retry after its initial concurrent run timed out during setup.
The missing disposable PHP 8.2.34 runtime was restored from the official PHP
download with its published SHA-256 verified. Isolated PHP/MySQL integration,
including the legacy compatibility checks, now passes; the earlier failed rerun
below is historical. The temporary local MySQL test process was stopped.
Matthias review, real Store/deployed-device upgrade acceptance and hosting
operational checks remain required. No merge, Store upload or publication occurred.

## Recommendation

Send this report with the candidate for Matthias's review, but fix R1–R4 and
complete the rollout checks before submitting/publishing the next release.
All existing automated checks pass. Three additional synthetic behavioral
probes nevertheless reproduced defects. No production group was read or edited.

## Findings

### R1 — P2: returning task content cannot be checked again offline

Source: `src/storage/history.ts:375–382`, `src/shared/tasks.ts:37–38`,
`src/domain/observations.ts:111`.

Reproduction using an unpaired profile:

1. Observe task content A; mark it checked.
2. Observe changed content B; mark it checked.
3. Observe the original content A again; click checked again.

The checkbox remains unchecked and both reviews appear to concern previous
content. The existing A review already has `done: true`, so `setTaskReview`
skips the write that would update `reviewContent` and `reviewVersion` from B
to A. Observations retain these pointers. A successful paired synchronization
can update them, making offline and connected behavior inconsistent.

Synthetic assertion that a current, completed self-review exists after step 3
failed: expected true, received false.

Recommended change: reconcile the current content projection even when the
matching review's boolean is unchanged. Decide explicitly whether returning
identical content revives its previous review automatically, or requires a new
confirmation; either choice must allow the checkbox to work offline. Cover
both checked/corrected and A → B → A with/without synchronization.

### R2 — P2: materially edited checklist points retain old completion/authorship

Source: `src/ui/SpecialDaysPanel.tsx:112`, `src/storage/history.ts:194–237`,
`src/domain/shared-planning.ts:25–41`.

Reproduction: create a special-day checklist point, complete it, edit that same
point's text to request a different book, then save. It stays completed and
retains the old completion attribution. The UI preserves its UUID and `done`;
the repository detects boolean changes only. Remote projection also preserves
completion by UUID and replays the existing checklist completion resource.

Synthetic assertion that the materially changed point is unfinished failed:
expected false, received true. A parent can therefore see new preparation work
as already done. This behavior is confirmed; resetting completion on meaningful
text changes is the recommended product rule, not an existing explicit invariant.

Recommended change: bind completion to meaningful point content (or allocate
a new point identity when content changes). Reset the old attribution as well.
Simply unchecking locally is insufficient if stale remote operations can restore
the old completion. Test another device, an offline edit, and late old operations.

### R3 — P2: review capacity can repeatedly block application of synchronization

Source: `src/storage/history.ts:377`, `src/storage/progress-sync.ts:175–236`
and `src/storage/progress-sync.ts:280–287`.

The 200-review limit counts historical content versions and withdrawn reviews,
not just active reviewers. A synthetic remote cache containing 201 distinct
review identities for one current task causes `apply()` to reject with
`Error: Review limit`. The entire application transaction aborts, including
other pending planning/status changes. Upload acknowledgements and the remote
cursor are committed separately before application. Repeating application
against that unchanged cache hits the same limit again.

This is a capacity/recovery defect, not evidence of silent loss of all local
data. A single participant can reach it across 201 content versions; several
participants and both review kinds reach it sooner. There is no normal UI for
pruning historical review identities. Server expiry alone does not clear the
already downloaded client cache.

Recommended change: design bounded historical retention and deterministic
recovery that preserves current participant reviews and withdrawal semantics.
Avoid one over-capacity task blocking unrelated changes. Test the boundary,
subsequent successful application, and convergence across two devices. Apply
the same recovery review to planning-cache/special-day/packing limits.

### R4 — P1 release blocker: deployed privacy disclosure contradicts sharing

Source: deployed `https://schoolware.bumper.be/privacy.html`,
`docs/store/listing-nl.txt`, `docs/store/submission.md:3–7`.

An anonymous HTTPS fetch during this review returned 200, but the public policy
still identifies version 0.2.0, dated 6 October. It describes packing/hiding
choices as local and excludes their sharing. It omits the newly shared special
days/free text/checklists/help/version announcements/attribution/reviews.
The repository privacy sources already cover the expanded scope; the hosted
copy does not. The Store listing also describes a narrower remote data scope
than the candidate implements. The submission checklist still treats 0.2.0 as
unpublished and describes an earlier review deferral.

Recommended change: deploy the current public policy, verify its actual text,
and update the listing, Store data declarations and candidate submission pack.
Record 0.2.0 as published and 0.4.0 as the candidate. Keep historical release
documents explicitly historical. Restore Matthias's external review gate in
the current submission instructions. Do not submit with the stale policy.

## Rollout and security acceptance

- Live compatibility policy currently requires protocol 3 / version 0.4.0 and
  has `latestVersion: null`. The published 0.2.0 client is already excluded.
  This prevents incompatible writes but creates a transition gap: Store update
  checks cannot install an unpublished candidate. Communicate the pause and
  verify the published upgrade once available. Do not lower the minimum merely
  to let clients that cannot preserve new fields write again.
- 0.2.0 → 0.4.0 is a valid version progression. Never imply 0.3.0 was published.
  Synchronization protocol numbers and extension versions have separate roles.
- Verify an actual Store-installed 0.2.0 upgrade with existing local history and
  pending offline changes. Synthetic checks cover existing version-3 records,
  worker restarts and upgrade setup, but do not reproduce Store delivery itself.
- The API is publicly reachable and group data actions use a random bearer
  capability. The AES-GCM encryption key is separate and stays client-side.
  Headers/version announcements are self-reported, not identity authentication.
- Anyone with the full pairing code can read/change/delete the shared group;
  bearer possession alone grants ciphertext access and destructive API rights.
  Labels/authors are unverified; individual account roles and device revocation
  do not exist. These are documented design limits, not newly discovered bypasses.
  Teacher access needs a separate authorization design before implementation.
- No additional agenda/history/session upload or telemetry path was identified
  in the reviewed sharing paths. Local agenda transport constrains requests,
  handles redirects/session failures, and bounds response size. Worker messages
  validate both payloads and extension-page senders. Code is bundled locally.
- Hosting access logs, backup retention/deletion, cron cleanup, TLS/WAF and
  operator access were not audited. An API status check cannot certify them.
  Verify these with the operator, plus a real two-device encrypted end-to-end
  test without exporting pupil data into review artifacts.
- API PHP changes were deployed by the owner, not this review. Endpoint behavior
  proves the compatibility gate is active, not that every uploaded source file
  or database maintenance setting matches the repository.

## Nonblocking improvements

- Add clear last-sync/error/pending-change visibility wherever parents act on
  shared information; an offline local edit is not yet visible to another device.
- Include attribution/review fields in a future optional CSV export if users
  need an audit export. The current CSV exports agenda/task fields and help state.
  Keep exports explicit and local; files remain sensitive after download.
- Review sustained capacity and rate limits with representative group sizes.
  Remote planning application scans cached review resources per task; historical
  accumulation should be measured, not only checked with small fixtures.
- Keep the supported Schoolware-format limitation, generic notifications and
  book-bag suggestion caveats explicit. Response completeness and identity remain
  unverified; disappearance inference is appropriately disabled.

## Verification evidence and limits

Fresh checks on this source:

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`: passed.
- Existing Vitest suite: 395 tests, 34 files.
- `npm audit`: zero reported vulnerabilities, not a security certification.
- Chrome 155 settings/setup/CSV/special-day/book-bag/navigation/upgrade/banner
  smoke script: passed, with synthetic content only.
- Chrome 155 two-device encrypted planning/help/authorship/review smoke script:
  passed; isolated local stores and real workers, no production group access.
- Three temporary synthetic probes for R1–R3 failed as described. They were
  removed after reproduction to leave the normal suite unchanged. The steps
  and boundary above specify the regression coverage remediation needs.
- Live API: random unknown group token, compatibility → 200 with the policy
  above; missing authentication → 401; old version/protocol empty exchange →
  426; compatible unknown group empty exchange → 401. No group registration,
  real token, real agenda payload, or deletion request was used.
- Public privacy page: anonymous 200; stale content confirmed by reading it.
- PHP/MySQL integration rerun could not complete: the temporary PHP 8.2 binary
  used previously is no longer present. The harness stopped before its PHP
  checks. The isolated local MySQL process was stopped afterward. Earlier PHP
  integration evidence exists, but is not a fresh successful run from this review.

No code fixes, API deployment, PR creation, merge, Store upload or publication
were performed. Matthias must review and blocking findings must be resolved
before merge/publication; completing review does not authorize those actions.
