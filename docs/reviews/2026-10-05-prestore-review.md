# Pre-store review - 2026-10-05

Scope: HEAD `fe1f32e` (clean tree), full repository, before Chrome Web Store submission.
Run: `swarm-20261005-dc64e0` (audit log `~/.claude/swarm/audit.jsonl`).

| Slice | Backend | Result |
| --- | --- | --- |
| s1 data-flow inventory | Gemini `gemini-3.8-flash-high` via agy, read-only | accepted after spot-check |
| s2 observation semantics | Claude subagent (sonnet) | accepted, F2 downgraded |
| s3 security / privacy | Claude subagent (sonnet) | accepted |
| s4 disclosures vs code, gates | Claude (main session) | below |
| s5 test generation | Codex | not launched - awaiting decision |

## Gates

After `npm ci` (no `node_modules` in the checkout): typecheck, lint, test (23 files,
250 tests) and build all exit 0. `npm run build` rewrites `THIRD-PARTY-NOTICES.txt` with
LF line endings; under `core.autocrlf=true` and without `.gitattributes` the tree shows it
as modified with no content diff.

## Verdict

No critical or high findings. Nothing blocks submission technically. Two disclosure
mismatches should be fixed in the privacy text before submission (D1, D2); the rest are
backlog.

## Disclosure vs code (s4)

- **D1 - retention claim overstated.** Privacy policy: "Remote inhoud volgt de
  serverbewaartermijn, standaard 90 dagen." The purge only runs inside an authenticated
  `exchange`/`members` call for that group (`server/public/sync.php:193-196`). Idle or
  abandoned groups keep ciphertext, device ids and timestamps indefinitely, and
  `manage-groups.php` has no purge command. The policy does say cleanup is not guaranteed,
  but the headline sentence and the missing operator tool together overstate it.
- **D2 - "delete" leaves the group row.** `delete` removes operations and members but keeps
  the `sw_sync_groups` row (token verifier, revision, enabled) on purpose
  (`sync.php:181-189`). The UI says "Servergegevens gewist"; the policy should name what
  remains.
- **D3 - "encrypted statuses" leaks one status by length.** No padding before AES-GCM
  (`src/domain/progress-sync.ts:24-29`); `in-progress` is 7 bytes longer than `open`/`done`,
  so the server can see which operations set "Bezig". Labels leak their length too.
- **D4 - participant labels called optional.** The policy says "optioneel versleutelde,
  zelfgekozen deelnemerlabels"; `ProgressSyncPanel.tsx:122-137` requires a name to connect.
- **D5 - member heartbeat.** `updated_at` per member refreshes on every sync (about once a
  minute while Chrome runs), which is a last-seen presence signal per device. "ontvangsttijden"
  covers it only loosely.
- Confirmed consistent: `manifest.json` permissions match the justification table in
  `docs/store/submission.md`; only two fetch destinations exist
  (`src/schoolware/agenda-client.ts:51`, `src/background/progress-sync.ts:47`, the latter with
  `credentials: 'omit'`, `redirect: 'error'`); no `console.*` in `src`; the
  markdown and HTML privacy pages carry the same text.

## Security / privacy findings (s3)

1. **Medium - global request bucket starvation.** Unknown tokens are charged to the shared
   `requests:global` bucket (`sync.php:36-56`, deliberate per the comment). About 100 req/s
   with random tokens locks every group out until the minute rolls over; the single row is
   also a `FOR UPDATE` hot spot. Fix: do not charge unknown tokens globally, add a keyed
   per-IP bucket as registration already has.
2. **Medium - retention for idle groups** (D1 above).
3. **Medium - registration capacity never reclaimed.** With registration enabled, the 50/h
   global limit fills `max_groups` = 1000 in about 20 hours; empty or disabled groups are
   never removed. The per-IP bucket keys on the full address, so IPv6 rotation inside one
   /64 bypasses it. Fix: GC empty groups after N days, bucket IPv6 by /64.
4. **Low-medium - ciphertext length** (D3 above).
5. **Low - malicious-server model.** AAD is only `sw1:<opId>` (no group or revision
   binding), so an operator with DB write can replay or roll back statuses. One raw key is
   used for both HMAC pseudonyms and AES-GCM, with no subkey derivation
   (`src/domain/progress-sync.ts:18-30`). Outside the honest-but-curious model.
6. **Low - any group-code holder can overwrite or remove another member row**
   (`sync.php:157-180`); within the documented trust boundary.
7. **Low - no `FilesMatch` allowlist in `server/public/.htaccess`**; safety depends on
   deploying only `server/public/`. Hosting path is hard-coded in `sync.php:114` and
   `manage-groups.php:9`.
8. **Low - `registrationPending` retries every minute forever** after a 403, and a cursor
   past the server revision (DB restore) gets 409 forever.

Found clean: prepared statements everywhere, generic errors, no CORS, single
`runtime.onMessage` listener with strict sender and payload checks, constrained fetch
destinations, closed shadow root plus `isTrusted` in the content script, minimal required
permissions, strict CSP.

## Observation semantics findings (s2)

1. **Medium - retry of an already-recorded check rewrites the sync outbox.**
   `src/storage/history.ts:55-63` runs on every `record()`; only the activity block is
   guarded by the `checkId` dedupe. A retry after the user re-marked a reopened task done
   drops the newer manual op and pushes a fresh `in-progress` reopen. Rare today because
   `checkId` is the correlation id. Fix: move the outbox block under the same guard.
2. **Medium - `Commentaar` that starts with `{` or `[` but is not JSON** makes
   `publicComment` return null (`src/schoolware/agenda-response.ts:55-64`), the item fails
   validation and the whole response is rejected on every check until the teacher edits it.
   Fix: treat non-JSON as plain text.
3. **Medium - `scopeId` includes `MinTot`/`MaxVan`** (`agenda-request.ts`, `observation-input.ts:7`)
   while monitoring overrides those dates. Re-capturing the same pupil from another calendar
   view starts a new baseline and orphans task status and history. Intentional per
   `observations.test.ts:157-160`, but identity includes a non-identity parameter.
4. **Medium-low - GeldigVan-only change emits a `changed` event** and can notify
   (`src/domain/observations.ts:70,82`).
5. **Low-medium - no text normalization** (CRLF, trailing whitespace, NBSP produce `changed`).
6. **Low-medium - `observedAt < lastSuccessAt` throws** (`observations.ts:52`); a clock step
   back stalls monitoring as `storage-error` until the clock catches up.
7. **Low - duplicate source tuples throw** "Ambiguous source identity" on every check.
8. **Low - `coveredBefore` trusts unverified windows**; can over-notify after a truncated
   first response.
9. **Low - pruning past retention drops reappearance history** and old `checkId`s.
10. **Low - v1/v2 to v3 migration is untested** (`src/storage/database.ts:31-34`).
- Downgraded: disappearance/reappearance never fire in production (`complete: false` in
  `observation-input.ts:9`). This is documented as deliberately disabled (`README.md:120`);
  only the notification wording "niet meer zichtbare" (`service-worker.ts:266`) suggests
  otherwise.

## Test gaps (combined)

- Migrations v1 and v2 to v3, including an aborting upgrade.
- Transaction rollback when a later store write throws after `scopes.put`.
- Repeated `checkId` with a pending outbox (fails today, s2 F1) and with no duplicate
  activity or events.
- Non-JSON brace `Commentaar`, whitespace-only diffs, GeldigVan-only change.
- Coverage boundaries and rolling-window shift with identical content.
- Clock step back through the worker; duplicate tuples through `fetchAgenda` + `record`.
- Server: retention purge actually runs, idle groups, unknown-token traffic vs valid groups,
  group row after `delete`, IPv6 /64 registration.
- Equal-length ciphertext for all statuses.
- Sender checks for subframe content scripts and unlisted extension paths; content-script
  DOM test for `isTrusted` and the closed shadow root.

## Concurrent changes: `features/multi-school-onboarding`

While this review ran, 7 commits landed on `origin/features/multi-school-onboarding`
(`b8579ed`..`000a899`, branched from the reviewed `fe1f32e`; 54 files, +1183/-180).
`main` is unchanged, so every finding above is valid for `main`. On the branch:

- Still open: s2 F1 (`history.ts:59` outbox rewrite), s2 F2 (`agenda-response.ts`
  unchanged), s3 F1-F3 and F5-F8 (`sync.php` unchanged), D1-D5 (privacy text only changed
  in the host-access paragraph).
- Not covered by this review: the new attack surface. `manifest.json` adds required
  `activeTab` and replaces the two optional hosts with `optional_host_permissions:
  ["https://*/*"]`; agenda transport now targets any user-selected HTTPS origin
  (`schoolwareOrigin` in `agenda-request.ts`), and there is a setup wizard. The s1 and s3
  conclusions about fixed fetch destinations and minimal host permissions apply to `main`
  only.
- Noticed in passing: `privacy-policy-nl.md:56` reads "Hosttoegang is wordt alleen
  gevraagd" (the old "is" survived the edit). `submission.md:62` still lists
  `schoolware.bumper.be` as its own optional host, which the manifest no longer declares
  separately (it is covered by `https://*/*`). The broad host declaration is likely to draw
  extra Chrome Web Store review scrutiny.

## Suggested next steps

1. Fix the privacy text for D1, D2, D4 (and decide on D3: pad or disclose) before submission.
2. Code fixes with small diffs: s2 F1 (guard outbox block), s2 F2 (plain-text fallback),
   s3 F1 (do not charge unknown tokens globally).
3. Backlog: group GC + purge command, IPv6 /64 bucketing, `.htaccess` allowlist,
   `.gitattributes`.
4. Optional s5: Codex generates the test gaps above in a worktree.
