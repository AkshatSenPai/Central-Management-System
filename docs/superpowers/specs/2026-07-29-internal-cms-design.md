# Internal CMS — Design Spec

**Date:** 2026-07-29
**Status:** Draft for review
**Scale:** Internal tool for a company of under 15 people

## 1. Overview

A cloud-hosted internal operations hub ("CMS") that gives the whole team one place to:

- Track **clients** and the **progress of every project** for each client
- Create and **assign tasks to anyone** — every member can assign tasks to every other member
- **See what everyone is working on** — full transparency of workloads
- **Schedule** work on a calendar, including recurring tasks and reminders
- Keep a personal **vault** — private files, notes, and encrypted credentials, with optional sharing

## 2. Goals & Non-Goals

**Goals**

- One tool replacing scattered spreadsheets/chats for task and client tracking
- Universal task assignment: no hierarchy gatekeeping who can assign to whom
- Team-wide visibility: any member can see any member's active tasks and projects
- Per-member private vault with credential-grade security
- Low operating cost (~$0–20/month) and low maintenance

**Non-Goals (deferred)**

- Client portal (clients logging in to view their own progress)
- Slack integration (incoming-webhook notifications) — planned for later
- WhatsApp integration (requires WhatsApp Business API via Twilio/Meta, number verification, per-message fees) — separate mini-project later
- Mobile native apps (the web app will be responsive)

## 3. Users & Roles

Deliberately flat, because universal assignment removes the need for a manager hierarchy:

| Role | Can do |
|---|---|
| **Member** | Everything day-to-day: create/assign tasks to anyone, manage clients & projects, use own vault, view team page |
| **Admin** | Everything a Member can, plus: invite/deactivate members, delete clients, app settings |

Signup is **invite-only** (Admin sends an email invite with a tokenized link). Login: email/password and Google OAuth.

## 4. Architecture & Stack

**Modular monolith** — one Next.js codebase, features as clearly separated modules.

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript), Server Actions for mutations |
| Database | Postgres (Neon or Supabase managed) |
| ORM | Prisma |
| Auth | Auth.js — credentials + Google provider, invite-only registration |
| File storage | Cloudflare R2 (S3-compatible), presigned upload/download URLs |
| Email | Resend |
| Scheduled jobs | Vercel Cron hitting internal API routes |
| Hosting | Vercel |

Module boundaries (each owns its own components, server actions, and queries):
`auth` · `team` · `clients` · `projects` · `tasks` · `calendar` · `vault` · `notifications` · `search` · `time-tracking` · `announcements` · `leave` · `invoicing`

## 5. Core Modules

### 5.1 Team & Auth

- Invite flow: Admin enters email → invite record with expiring token → recipient sets password or links Google → becomes Member.
- Profiles: name, avatar, job title, contact info.
- Deactivation (not deletion) of members preserves task/activity history.

### 5.2 Clients & Project Tracker

- **Client**: company name, status (Active / Paused / Former), contacts (name, email, phone, role), free-form notes.
- **Project** (belongs to a client): description, start/due dates, status (Planning / In Progress / On Hold / Done), health flag (On Track / At Risk / Blocked), milestones.
- **Progress %**: auto-computed as completed tasks ÷ total tasks, with a manual-override toggle for judgment calls.
- Client page = header info + all projects with progress bars + activity timeline + meeting notes.

### 5.3 Tasks & Universal Assignment

- **Anyone can create a task and assign it to anyone**, including multiple assignees and themselves.
- Task fields: title, rich-text description, project (optional — personal tasks allowed), milestone (optional), priority (Low/Med/High/Urgent), status (To Do → In Progress → Review → Done), due date, checklist subtasks, comments with @mentions, attachments.
- Views:
  - **My Tasks** — the default landing view for a member
  - **Kanban board** per project (drag between status columns)
  - **By person** — pick a teammate, see their list
- Every change (status, assignee, due date) is written to the activity log.

### 5.4 Team Visibility — "who's doing what"

- **Team page**: one card per member — avatar, title, count of open tasks, and their current In Progress tasks with the client/project each belongs to.
- Clicking a member opens their profile: all assigned tasks (filterable by status), projects they're active on, and leave status.
- Everything is visible to everyone by design. The only private area is the vault.

### 5.5 Task Scheduler

- **Calendar** (day / week / month) of tasks by due/scheduled date, filterable by person or project.
- **Recurring tasks**: stored as an RRULE (e.g. "every Monday"); a daily cron materializes concrete task instances 30 days ahead, linked to their template.
- **Reminders**: notification + email before due date (default 24h, configurable per task); daily overdue digest to each member about their own overdue tasks.

### 5.6 Vault (per member)

Three item types, private by default:

1. **Files** — uploaded to R2 under the owner's namespace; access only via short-lived signed URLs.
2. **Notes** — rich text.
3. **Credentials** — username / password / API key / URL fields.

**Credential security (envelope encryption):**

- Each credential item gets a random 256-bit data key; secret fields are encrypted with AES-256-GCM.
- The data key is itself encrypted ("wrapped") by a master key held only in the hosting environment's secret store — never in the database or repo.
- Secrets are never included in list responses; the UI requires an explicit **click-to-reveal**, which calls a dedicated decrypt endpoint.
- Every reveal/edit is written to a **vault access log** visible to the item's owner.

**Sharing:** any vault item can be shared with specific members or the whole team, read-only or edit. Shared credentials remain click-to-reveal and access-logged.

### 5.7 Notifications

- In-app notification center (bell icon, unread count) + email via Resend.
- Triggers: task assigned to you · @mention in a comment · task due soon · status change on a task you created or are assigned to · vault item shared with you · new announcement.
- Per-user setting to mute email (in-app always on).

### 5.8 Dashboard (home)

- My tasks due today / overdue
- My In Progress list
- Pinned announcements
- Recent activity on projects I'm involved in

## 6. Phase-2 Modules (committed scope)

### 6.1 Time Tracking

- Start/stop timer on any task, plus manual entry ("2h yesterday").
- Reports: hours per person, per client, per project, per date range — the data source for invoicing and the weekly report.

### 6.2 Global Search

- One search box (keyboard shortcut `/`) across clients, projects, tasks, comments, announcements, and meeting notes using Postgres full-text search.
- Vault items are searchable **only** by their owner and people they're shared with.

### 6.3 Announcements Board

- Company-wide posts by any member; pinnable to the dashboard until a chosen date; triggers a notification.

### 6.4 Leave & Availability Calendar

- Members add their own leave entries (vacation / sick / other, date range, note). No approval workflow at this team size — visibility is the point.
- Leave overlays the task calendar and shows on member cards ("On leave until Thu").

### 6.5 Meeting Notes

- Dated rich-text notes attached to a client (title, attendees, body). Listed on the client page; included in global search.

### 6.6 Project & Task Templates

- Save any project or task (with its checklist) as a template; instantiate with one click (e.g. "New Client Onboarding" checklist).

### 6.7 Invoicing & Payment Tracking

- Invoice records per client (optionally linked to a project): number, amount, currency, issue/due dates, status (Draft / Sent / Paid / Overdue), paid date, notes.
- Client page shows outstanding balance; dashboard widget for overdue invoices.
- Record-keeping only — no payment processing or PDF generation in this phase.

### 6.8 Weekly Auto-Report

- Vercel Cron, Mondays 08:00: aggregates the past 7 days — tasks completed per person, project progress deltas, hours per client, overdue items — then emails all members and posts to the announcements board.
- Runs last in Phase 2 because it reads time-tracking data.

## 7. Data Model (Prisma sketch)

```
User            id, name, email, passwordHash?, avatarUrl, title, role(ADMIN|MEMBER), active
Invite          email, token, role, expiresAt, acceptedAt?
Client          name, status, notes
ClientContact   clientId, name, email, phone, role
Project         clientId, name, description, status, health, progressMode(AUTO|MANUAL), manualProgress?, startDate?, dueDate?
Milestone       projectId, title, dueDate?, completedAt?, order
Task            projectId?, milestoneId?, creatorId, title, description, priority, status, dueDate?, recurrenceRule?, recurringTemplateId?, order
TaskAssignee    taskId, userId
ChecklistItem   taskId, title, done, order
Comment         taskId, authorId, body, mentionedUserIds[]
Attachment      parentType(TASK|PROJECT|CLIENT), parentId, fileKey, fileName, size, uploadedById
TimeEntry       taskId, userId, startedAt, endedAt?, durationMins, note?
VaultItem       ownerId, type(FILE|NOTE|CREDENTIAL), name, fileKey?, noteBody?, encryptedBlob?, iv?, wrappedKey?
VaultShare      vaultItemId, sharedWithId?|wholeTeam, permission(READ|EDIT)
VaultAccessLog  vaultItemId, userId, action(VIEWED|REVEALED|EDITED), at
Announcement    authorId, title, body, pinnedUntil?
LeaveEntry      userId, type, startDate, endDate, note?
MeetingNote     clientId, authorId, date, title, attendees[], body
Invoice         clientId, projectId?, number, amountCents, currency, issuedDate, dueDate, status, paidDate?, notes?
Template        type(PROJECT|TASK), name, payload(json), createdById
Notification    userId, type, payload(json), readAt?
ActivityLog     actorId, entityType, entityId, action, meta(json), at
```

## 8. Security

- Invite-only registration; passwords hashed with argon2.
- All queries scoped through a session check; role checks on admin actions.
- Vault: envelope encryption as in §5.6; master key only in environment secrets; secrets excluded from logs and list endpoints; reveals audit-logged.
- Files: private R2 bucket, short-lived presigned URLs only, keys namespaced per owner.
- No sensitive data in URLs; CSRF protection via Server Actions' built-in origin checks.

## 9. Error Handling & Testing

- Mutations via Server Actions return typed `{ ok, error }` results; UI shows inline errors, never silent failures.
- Optimistic UI for task status/kanban moves with rollback on failure.
- Tests: unit tests for vault crypto (round-trip, tamper detection), progress computation, and RRULE materialization; integration tests for auth/invite flow and task assignment; e2e smoke (Playwright) for the critical path: login → create client → create project → assign task → complete → progress updates.

## 10. Build Phases

| Phase | Delivers |
|---|---|
| **1. Foundation** | Auth (invite, login, Google), member profiles, app shell/navigation, roles |
| **2. Clients & Projects** | Client CRUD, contacts, projects, milestones, progress %, health flags, activity timeline |
| **3. Tasks & Visibility** | Task CRUD, universal assignment, comments/@mentions, checklists, attachments, My Tasks, kanban, Team page |
| **4. Scheduler & Notifications** | Calendar views, recurring tasks, reminders, notification center + email |
| **5. Vault** | Files → notes → encrypted credentials → sharing → access log |
| **6. Phase-2 pack A** | Time tracking, global search, announcements |
| **7. Phase-2 pack B** | Leave calendar, meeting notes, templates, invoicing, weekly auto-report |
| **Later** | Client portal, Slack webhooks, WhatsApp (via Business API provider) |

Each phase ships usable — the team can start living in the tool from Phase 3 onward.

## 11. Success Criteria

- Any member can assign a task to any other member in under 15 seconds from anywhere in the app.
- The Team page answers "what is X working on right now?" in one click.
- A client's page answers "how is this client's work going?" without asking anyone.
- Credentials in the vault are unreadable in the database even with full DB access.
- Runs for under ~$20/month at 15 users.
