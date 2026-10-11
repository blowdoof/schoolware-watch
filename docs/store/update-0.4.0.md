# Candidate 0.4.0 submission and rollout

Updated 2026-10-11. Published baseline: 0.2.0 (owner-confirmed). Version 0.3.0
was an intermediate development version, not a published release. Candidate
0.4.0 uses synchronization protocol 3 and IndexedDB schema version 3.

## Required before submission

1. Complete Matthias's external review and resolve blocking findings. Obtain
   separate owner authorization before merge, Store upload or publication.
2. Replace the hosted `https://schoolware.bumper.be/privacy.html` with
   `server/public/privacy.html`. Verify anonymous access and the actual text:
   version 0.4.0, shared packing/checklists, special-day free text, help,
   attribution/reviews, paired versions, deletion and shared-secret limitations.
   On 2026-10-11 the deployed page still described 0.2.0. Local preparation
   does not prove the hosted file was updated.
3. Use the updated `listing-nl.txt`, privacy policy and data-use declarations in
   `submission.md`. Keep the supported Schoolware-format limitation explicit.
4. Run the required project checks and both Chrome smoke scripts. The isolated
   API integration rerun passed after restoring a disposable PHP 8.2 runtime;
   do not use the installed PHP 7.3 for PHP 8.2 source. Preserve the fresh check
   evidence when rebuilding the final reviewed package.
5. Check real paired-device propagation and an installed 0.2.0 upgrade, including
   existing history, pending offline changes, review withdrawal, edited checklist
   text and version mismatch. Do not attach actual pupil content or pairing codes.
6. Verify host TLS/WAF, logs/backups, retention cleanup and deletion operationally.

## Compatibility transition

The live API currently requires 0.4.0 / protocol 3. Published 0.2.0 devices are
already paused; Store update checks cannot install an unpublished candidate.
Tell affected users that edits remain local until they have a compatible client.
Do not lower the policy to allow older clients to write new shared fields.

After authorized publication, set the private `sync_latest_published_version`
to `0.4.0`, verify compatibility responses, and confirm Store-installed devices
receive the update. Store installation alone does not prove an update has
arrived; Chrome/browser restart and rollout timing can affect activation.
Keep the minimum at 0.4.0 and protocol at 3. No SQL schema change is needed for
the review remediation; old completion operations safely refer to retired point
identities and reviews use the same encrypted payload format.

## Package preparation

Rebuild after the final approved change. ZIP only the contents of `dist`, with
`manifest.json` at the root; verify version 0.4.0, bundled code, license notices,
icons and checksums. Keep PHP, tests, credentials and personal captures out.
Regenerate synthetic Store images if they need to show the new features.
Historical 0.2.0 packages must not be reused. Package preparation is not upload
or publication authorization.
