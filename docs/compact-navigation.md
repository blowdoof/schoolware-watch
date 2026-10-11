# Compact workspace navigation

Candidate 0.4.0 replaces the continuously expanded overview/settings layout
with native collapsible sections. Existing worker actions, permissions, storage
and synchronization remain unchanged.

Overview starts with To-do expanded. Book bag, agenda/progress (including CSV),
special days and change history are collapsed. The popup offers To-do, book bag
and special days; the full overview includes agenda and history as well.

Settings starts with all five groups collapsed: Schoolware connection,
checks/notifications, paired sharing, privacy/retention/deletion and activity log.
Section summaries describe the actions inside. Full-page navigation buttons show
text labels; popup navigation keeps compact icons.

Collapsing a group leaves its child components mounted, preserving drafts,
filters and live updates. Disclosure is local presentation state and does not
change data or start additional sharing. Navigation away or page reload still
has the existing form behavior; expansion choices reset to the compact defaults.
Native summaries support pointer and keyboard operation without a custom tab
keyboard implementation. Notification destinations and the setup wizard remain
directly accessible outside the collapsible groups.

Chrome smoke coverage verifies compact defaults, keyboard summary activation, preserving
an unsaved special-day checklist draft, existing settings saves/worker restarts,
CSV download, the book-bag visibility preference and two-device encrypted
planning/help/review behavior. Store image
capture opens the relevant group before capturing its content. Synthetic data
only; no server/schema change or hosting upload is needed for this UI update.
