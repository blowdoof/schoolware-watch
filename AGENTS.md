# AGENTS.md

## Project
Schoolware Watch is an independent Chrome Manifest V3 extension for parents
to observe changes in Schoolware (WISA) agendas.
Use TypeScript, React, Vite, Tailwind CSS, IndexedDB, Chrome Alarms, and Vitest.

## Communication
- Communicate with the project owner in Dutch.
- Write code, identifiers, comments, and technical documentation in English.

## Privacy
- Keep Schoolware agenda content, history, and session material local. Do not add analytics or telemetry.
- The owner authorizes optional encrypted progress and planning synchronization through the existing self-hosted PHP service, including special-day dates/text/checklists, checklist completion, packing/hiding choices, independent help requests with optional recipient device references and optional participant labels (scope expanded on 2026-10-09).
- Remote sharing must be opt-in and limited to those encrypted fields; never automatically upload Schoolware agenda content/history, raw student/source identifiers, or Schoolware credentials.
- Document remote processing, retention, deletion, shared-secret access limits, and hosting metadata accurately. Do not add other backend or cloud synchronization features without explicit authorization.
- Never persist Schoolware passwords, session cookies, authentication tokens, or authorization headers.
- Reuse the existing browser session only through the verified integration mechanism.
- Never commit real student data, API captures, HAR files, screenshots containing personal data, or secrets.
- Use synthetic test fixtures.
- Do not log agenda payloads, student identifiers, or credentials.
- Store only fields required for monitoring and history.
- Use generic notification text by default.
- Provide retention controls and deletion of local profile data.

## Architecture
- Keep domain logic independent of React and Chrome APIs.
- Isolate Schoolware transport and response validation.
- Isolate IndexedDB access behind repositories.
- Use typed, runtime-validated messages between extension contexts.
- Validate message senders and constrain request destinations.
- Use the service worker to coordinate monitoring and history writes.
- Do not rely on service-worker globals for durable state.
- Bundle executable code locally and use minimal permissions.

## Observation Semantics
- GeldigVan is not evidence of creation time.
- firstSeenAt means first local observation, not creation.
- Treat initial observations as a baseline.
- Scope identities by Schoolware installation and student profile.
- Verify ID relationships and TypePunt values before relying on them.
- Compare normalized, meaningful fields deterministically.
- Record disappearance only after a successful, complete, comparable check covering the item's scope.
- Never infer disappearance from authentication errors, partial pagination, invalid responses, or changed coverage.
- Preserve reappearance history.
- Commit item versions, events, and successful-check metadata atomically.
- Make interrupted or repeated checks safe to retry.

## Development and Validation
- Use strict TypeScript.
- Test observation semantics with Vitest and synthetic fixtures.
- Cover baseline, appearance, changes, disappearance, reappearance, profile isolation, and failed or incomplete checks.
- Test IndexedDB migrations and transaction behavior.
- Verify alarms, session handling, permissions, and worker restart behavior in Chrome when relevant.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` before reporting implementation complete.
- Document unresolved API assumptions and required permissions.

## Scope and Git
- Always commit and push on the single active feature branch for the current work; include all current project changes on that branch and never push directly to `main`.
- Keep `main` and branches created by other contributors. Remove obsolete project-owned feature branches only after verifying their work is included in the active branch.
- Require Matthias's external review and resolution of blocking findings before merging to `main` or publishing the next release. Review completion does not itself authorize merging or publication.
- Keep changes focused on the approved task.
- Do not publish, push, deploy, or upload artifacts unless authorized.
- Inspect staged changes for private data before committing.
