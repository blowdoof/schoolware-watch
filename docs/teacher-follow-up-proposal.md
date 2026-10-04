# Teacher follow-up proposal

Status: design discussion only. No teacher access is implemented or enabled.
Keep this separate from the current main integration and parent pilot.

## Proposed first version

An explicitly invited teacher can view shared Open/In progress/Done statuses
for a parent-selected set of marked items, for individually enrolled pupils.
Start with read-only access for one teacher and one pupil. Teacher feedback,
class dashboards and bulk enrollment can follow after that pilot is validated.
The status is a parent/pupil report, not independent evidence that homework was
completed or an official Schoolware completion record.

## Required changes

- Replace permanent shared-secret admission with verified invitations and
  independently revocable device/account authorization. Existing group secrets
  allow reading, writing, deletion and participant impersonation; they must
  never be given to teachers as a shortcut around read-only access.
- Enforce parent/pupil and teacher roles on the server, scoped to each approved
  pupil and item selection. A self-chosen participant label is not proof of
  teacher identity or school entitlement.
- Provide explicit sharing choices, recipient visibility and revocation controls
  before enrollment. Document that revocation cannot erase downloaded copies.
- Design key delivery and rotation with the new authorization model. Merely
  restricting the UI cannot protect data already accessible with a group key.
- Resolve how a teacher recognizes tasks: current encrypted progress contains
  keyed item/version references and status, not readable agenda titles. A teacher
  may not have the parent's agenda access. Do not guess cross-pupil task identity
  or upload lesson text to make a dashboard work. Verify an official task mapping
  or separately approve narrowly selected display context before implementation.
- Keep Schoolware passwords, cookies and session tokens out of this flow.
  A parent's browser session cannot prove a teacher's server-side authority.
- Test pupil isolation, allowed item selection, read-only enforcement, revoked
  sessions, old keys, false labels and interrupted enrollment with synthetic data.

The existing privacy exception permits encrypted progress sharing and optional
participant labels. It does not authorize a teacher backend receiving agenda
content or a school-wide pupil database. Any additional shared fields require
an explicit scope decision and updated privacy documentation.

## Decisions before building

Define who invites and verifies the teacher, whether pupils/parents or teachers
control item selection, whether read-only status is sufficient, and how the
teacher identifies their own assignments without unrelated pupil agenda data.
For the first pilot, prefer an invitation approved by the parent through an
existing trusted contact channel and a minimal read-only status view.
