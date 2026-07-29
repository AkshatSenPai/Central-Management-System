Design a minimal, professional web app UI for an internal company CMS used by a team of under 15 people. This is a working tool people live in all day — clarity over decoration. No flashy gradients, no illustrations, no experimental layouts. Quiet, clean, fast-feeling, and consistent.

## What the product is

An internal operations hub: the team tracks clients and the progress of each client's projects, creates tasks and assigns them to anyone on the team, sees what every teammate is currently working on, schedules work on a calendar (including recurring tasks), and keeps a personal vault of private files, notes, and encrypted credentials. There are also announcements, time tracking, leave/availability, meeting notes, and simple invoicing records.

## Design direction

- **Minimalistic and professional.** Whitespace, alignment, and typographic hierarchy do the design work — not color or ornament.
- **Deliver BOTH a light mode and a dark mode version of every screen**, built from one shared token set (same components, swapped surface/text/border tokens). Show the two themes side by side or as separate frames.
- Neutral palette: near-white surfaces in light mode, near-black (not pure black) in dark mode, with a gray text ramp (primary / secondary / muted).
- **One accent color only** — a muted indigo or blue — used for primary buttons, active nav items, links, and focus states. Nothing else is accent-colored.
- Status colors used sparingly and semantically: green = on track / done / paid, amber = at risk / due soon, red = blocked / overdue, plus small priority badges (Low / Medium / High / Urgent).
- Typography: Inter or a similar clean grotesque. ~14px base size for data UI, a restrained heading scale, tabular numerals for tables.
- 8px spacing grid. Cards and inputs with 8–10px corner radius. Prefer subtle 1px borders and very soft shadows over heavy elevation.
- Tables and lists should be dense but breathable — this is a data tool, not a marketing site.
- WCAG AA contrast in both themes.

## App shell (persistent layout)

- **Left sidebar** navigation: app logo/name at top, then Dashboard, My Tasks, Clients, Projects, Calendar, Team, Vault, Announcements, Invoices, Settings. Active item highlighted with the accent. Include a collapsed icon-only state.
- **Top bar**: global search input (with `/` shortcut hint), notification bell with unread badge, user avatar menu containing the light/dark theme toggle.

## Screens to design

1. **Login** — email/password plus "Continue with Google", and an invite-acceptance variant (set your name and password).
2. **Dashboard (home)** — "Today" task list, overdue items called out, my in-progress tasks, a pinned announcement banner, recent activity feed.
3. **My Tasks** — task list grouped by status; each row shows title, client/project chip, priority badge, due date, assignee avatars.
4. **Project view** — header with client name, progress bar, health flag (On Track / At Risk / Blocked) and milestones; below it a kanban board with To Do / In Progress / Review / Done columns and draggable task cards.
5. **Client detail** — client info header with status, contact list, all projects with progress bars, tabbed section for meeting notes and invoices (with outstanding balance).
6. **Team page** — a card per member: avatar, name, job title, open-task count, their current in-progress tasks with project labels, and a small "on leave" indicator when applicable. This screen answers "who is working on what?" at a glance.
7. **Calendar** — month and week views; tasks shown as compact chips colored by project; leave/availability shown as a subtle background overlay; filter by person or project.
8. **Vault** — list of the member's items with type icons (file / note / credential); a credential detail card with masked fields (••••••••) and a click-to-reveal eye icon; a share dialog (choose teammates, read-only or edit); a small access-log list showing who viewed what and when.
9. **Task detail** (drawer or modal over the current view) — title, rich description, assignee picker with avatars, status and priority selects, due date, checklist with progress, comments thread with @mentions, attachments, and a start/stop time-tracking button with logged time.
10. **Notifications panel** — dropdown or slide-over list with unread states and item types (assigned, mention, due soon, shared with you).

## Components to keep systematic

Status and priority badges, progress bars, avatar stacks, empty states (simple text + one action button — no illustrations), form inputs, modals/drawers, data tables, toasts. Design them once and reuse everywhere.

## What to avoid

- Decorative illustrations, 3D elements, glassmorphism, gradient meshes, oversized display typography
- More than one accent color
- Cluttered "enterprise dashboard" density — when in doubt, remove
- Novel navigation patterns — a sidebar app shell is exactly right

Implementation note: this will be built in Next.js with Tailwind CSS, so keep components consistent, token-driven, and reusable.
