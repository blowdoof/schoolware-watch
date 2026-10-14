# Candidate 0.4.3: connection environment and version diagnostics

Prepared 2026-10-13. Setup now offers an explicit parent portal/student intranet
selector. Previously settings without an active school tab opened the parent
portal even for students. Existing tab detection initializes this choice, and
discovery remains bound to the selected installation/tab and allowlisted requests.
It still requires sign-in, explicit host permission and user confirmation; it
does not bypass SSO or automatically pair a progress group.

Sync view includes the running worker's bundled application version as local
diagnostic metadata. The UI warns when a newly built interface is running beside
an old worker and explains reloading an unpacked extension. The self device entry
is explicitly labeled as the last shared version, not the current installed
version. Old workers without this optional field remain readable. A local build
alone does not reload Chrome's extension worker; use chrome://extensions Reload,
close stale extension windows, reopen and synchronize to announce the new version.

No new remote fields, permissions, server changes or database migration. Existing
working manual connections and progress groups remain intact. This feature-branch
candidate contains all 0.4.2 fixes. No Store submission or main merge is performed.
Real student discovery acceptance remains pending because the prior failed path
was not captured; the settings-only wrong-environment path is regression tested.

Validation passed: strict TypeScript, ESLint, 431 Vitest tests across 37 files,
production build and both synthetic Chrome smoke suites. Version UI tests cover
an old worker versus an old shared announcement and backward-compatible local
message validation. No real account content or identifiers were committed.

Follow-up: owner-supplied wide and rolling-window responses contain 237 matching
source tuples with identical dates. This rules out a rolling-window date shift
for this sample. Regressions cover corrected dates with stable and changed source
tuples. A legacy worker without version diagnostics now also triggers a local
reload instruction. Actual local database and worker state have not been inspected.
