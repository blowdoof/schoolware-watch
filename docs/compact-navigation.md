# Compact workspace navigation

Candidate 0.4.0 replaces the continuously expanded overview/settings layout
with native collapsible sections. Existing worker actions, permissions, storage
and synchronization remain unchanged.

Overview starts with To-do expanded. Book bag, agenda/progress (including CSV),
special days and change history are collapsed. The popup offers To-do, book bag
and special days; the full overview includes agenda and history as well.

Connection health and automatic-check details follow the overview chapters in a collapsed
"Controle en synchronisatie" header. Its accessible icon shows active work,
confirmed success, an issue or an unconfirmed state. Success requires the latest
agenda check and any enabled sharing to have succeeded, without pending uploads,
partial downloads, registration, member errors or compatibility blocks. Sharing
disabled is explained explicitly. Expanded content separates agenda and sharing.
The UI refreshes local status every two seconds while visible; this starts no
network check or synchronization and does not append polling activity records.
Both overview and settings show separate Schoolware-check and shared-sync icons
at the top of their persistent chapter navigation, using the same local status
snapshot and a single polling subscription per page. Disabled sharing is explicitly
labeled, and failed sharing does not turn a successful agenda check red (or vice
versa). Clicking a status opens the overview's details or the matching settings
group. The overview also has a dedicated control/sync chapter shortcut.
Overview status buttons target separate agenda and sharing details within the
expanded control chapter. Navigation waits for disclosure layout before focusing
and scrolling, so switching either direction and repeated clicks remain usable.
Running indicators are transient worker
presentation state; durable results and retries remain repository-backed.

Quick-navigation buttons replace the overview's instruction paragraph. They open
the selected section, focus its summary and scroll it into view, respecting reduced
motion. The hidden-book-bag preference also hides its quick-navigation button.
On wide overview windows (at least 1280 CSS pixels), shortcuts form a fixed
chapter rail in the left margin. Smaller windows and the popup keep them sticky
below the global navigation. The current chapter has a tinted button and an
accessible current-location indication; scrolling updates it when a section
crosses the reading boundary. Heading scroll offsets leave room for navigation.

Settings uses the same responsive persistent chapter navigation and starts with all five groups collapsed: Schoolware connection,
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
