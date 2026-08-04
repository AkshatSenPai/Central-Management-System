# In-app chat: direct messages and open channels

**Runs after:** the searchable combobox (`TODO.md` §3), then the R2 upload pipeline (§7 below). Chat text does not depend on either; the ordering is §14.
**Delivers:** work-context conversation inside the tool that records the work — 1:1 DMs and named open channels, with @mentions reusing the Phase 3c renderer and attachments arriving last.

## 1. Why now

Every phase so far has been about recording what happened. Phase 3c gave discussion a home on a task, and `src/lib/comment-service.ts` puts the reason a task changed next to the change. Nothing gives discussion a home when it is not about one task — "is anyone in tomorrow", "the Harlow invoice bounced", "who has the brief".

That conversation happens in WhatsApp, and it will keep happening there. **This is not a WhatsApp replacement and must not be designed as one.** It is the work-context half — the half where a message can say `@Dana` and mean a row in `User`, link to a task, and sit two clicks from the board it is about. The personal half stays where it is, which is why everything below refuses the features that would only make sense if the tool were trying to win the whole conversation.

Fifteen people. Desktop-first, because the studio works at desks and the phone already has a chat app on it.

## 2. Scope

**In:**

- 1:1 direct messages between any two active members.
- Named group channels, all of them open: anyone can see any channel, and opening one joins it.
- Plain-text messages with @mentions and bare-URL links, rendered by `PlainText` (`src/components/ui/plain-text.tsx`) exactly as comments and client notes are.
- Editing and deleting your own messages; an admin may delete anyone's.
- Unread counts per conversation, plus a total badge on a new sidebar **Chat** item.
- A notification row for a chat @mention, and only for that — see D6.
- Attachments on messages, **after** the pipeline in §7 exists.

**Out:**

- **Presence, typing indicators, read receipts.** Each one is a claim about what a colleague is doing right now, which is the surveillance half of a chat app and the half a fifteen-person studio does not need. Ruled out below (D1).
- **Push notifications and email on a message.** §5.7 of the master spec puts email behind Resend, and `TODO.md` §2 records the 100/day sandbox cap; a chat message is the worst possible use of that budget. The bell handles mentions and nothing else — D6.
- **Threaded replies, reactions, pinning, message search.** Global search covers names today (`src/lib/search-queries.ts`) and `TODO.md` §3 already carries "search over comments and client notes" as its own item; messages join that queue, not this phase.
- **Private or invite-only channels.** Ruled out below (D2).
- **Voice, video, calls, and any mobile-specific layout.** Desktop-first per D1; the app is responsive, which is not the same as designed for a thumb.
- **Rich text / markdown.** Inherited from 3c D1 and restated as D4.
- **Deleting a conversation.** No surface, no action, no route. A channel nobody uses is a row in a directory, which is cheaper than a delete path that has to decide what happens to fifteen people's unread counts.

## 3. Owner rulings

| # | Decision |
|---|---|
| **D1** | **Chat sits alongside WhatsApp, not instead of it.** This single sentence is what removes presence, typing indicators, read receipts, push notifications and mobile-first layout in one go — every one of them exists to make a chat app the *only* chat app. Building them would be building a worse WhatsApp with fifteen users on it. The rejected alternative is the ambitious one: full parity, then discovering the team still coordinates dinner on WhatsApp and now has two places to check for work. |
| **D2** | **All channels are open. There are no private channels and no invite flow.** Anyone can see every channel in the directory and join any of them: no invite, no request, no membership state machine, and no read check on a channel. This matches §5.4's "everything is visible to everyone by design. The only private area is the vault", and it deletes an entire permission model, a membership-request state machine and every "why can't I see #finance" conversation. **DMs are the exception and are private to their two participants** — a private *room* is a feature, a private *conversation between two named people* is what a DM is. If something genuinely cannot be said in the open, it belongs in a DM or outside the tool. |
| **D3** | **Membership is lazy, and opening is the only way to join.** An unjoined channel appears in the Browse list; opening it writes the `ConversationMember` row and stamps `lastReadAt` in the same write. There is no second, separate join — the **Join** label in the Browse directory is the link *into* the channel, which is why §8's service has `markConversationRead` and no `joinChannel` beside it. Nobody is pre-joined to anything and nobody has to be invited to anything. **An unjoined channel therefore contributes nothing to the badge**: unread is arithmetic over membership rows (§6), and a room you have never opened has none. Browse shows a channel's name and when it was last active, never an unread count. Both alternatives were rejected for the same reason: pre-joining everyone to every channel is fifteen people × every channel in a badge nobody can clear, and counting unjoined channels toward the badge is that same badge by another route. |
| **D4** | **Message bodies are plain text**, on the identical terms as 3c D1: line breaks preserved, bare URLs linked, `@Name` linked, and **no HTML generated anywhere**. `src/lib/rich-text.ts:3-10` states the property this depends on — the renderer emits React elements, so React's escaping is the whole XSS story. Markdown in chat was rejected for the same price as in comments: a parser plus a sanitiser, permanently, for bold text in a message. |
| **D5** | **Delivery is a polled `GET` Route Handler, not a Server Action.** Actions are POSTs — `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md:29`, "Behind the scenes, actions use the `POST` method, and only this HTTP method can invoke them" — and line 27 of the same file describes an invoked action returning "both the updated UI and new data in a single server roundtrip". That roundtrip is exactly what a thing running every five seconds must not do. A plain `GET` returning JSON costs one query and zero React tree. Full contract in §5. |
| **D6** | **Exactly one thing in chat writes a `Notification` row: a new `NotificationType.CHAT_MENTION`.** An ordinary message writes nothing to the bell, and neither does a DM — a mention only reaches the bell from a **channel**, for the two reasons §6 sets out. Unread is counted from `ConversationMember.lastReadAt` and shown as a sidebar badge, which is a different surface with a different meaning. **This is the ruling that keeps the bell meaningful** — fifteen people chatting would put a hundred rows a day into a panel whose empty state currently promises "assignments and mentions" (`src/components/shell/notification-bell.tsx:119-121`), and the first week of that is the week people stop reading it. Notifying on every message was rejected on those grounds and not on cost. |
| **D7** | **A deleted message is soft-deleted; a deleted comment is not.** `removeComment` (`src/lib/comment-service.ts:187-218`) hard-deletes the row, and that is right for a comment: it is one entry in a list. A message is one turn in a conversation, and a hole in a thread reads as a bug in the app rather than as somebody changing their mind. The row survives, the body stops rendering, and "Message deleted" takes its place. The cost is a `deletedAt` filter on every read path, which is written into the query contracts in §8 rather than left to be remembered. |
| **D8** | **Chat writes no `ActivityLog` rows, and `ActivityAction` gains no verbs.** The activity log answers "what happened to this client's work" and is read on client and project timelines. A chat message is not work product; three hundred `message.sent` rows a week would bury the four rows that matter on every timeline in the app. `describeActivity` is untouched, exactly as in Phase 3b. |
| **D9** | **Attachments are the last thing built, and only after the R2 pipeline exists for tasks, projects and clients.** No R2 code exists in `src/` at all today — a case-insensitive search for `attachment` across `src/` returns six hits, all string literals in `src/lib/activity.ts`, and not one Prisma call. The design is already written and must not be re-invented: **§6 and §7** of `docs/superpowers/specs/2026-08-02-phase-3c-comments-attachments-design.md` — §6 is the pipeline, §7 is the half that makes it safe, and reading only §6 builds a presign with no session check. Building it against messages first was rejected because it would exercise the polymorphic parent on its newest, least-settled surface. See §7 and §14. |
| **D10** | **The uniqueness of a DM is enforced by the database, not by a lookup.** `Conversation.directKey` is the two member ids sorted and joined, with `@unique` on it. Two people clicking "Message" on each other in the same second both attempt an insert; one wins, the other loses on the constraint and reads the winner back. A find-then-create in application code was rejected: it is the textbook race, and the window is exactly the moment two people decide to talk to each other. |

## 4. Data model

Three new models, one new enum, and one new member on each of two existing enums.

```prisma
enum ConversationKind {
  CHANNEL
  DIRECT
}

/// A room. One row per channel and one per pair of people, because a DM is a
/// two-person room and not a different kind of thing — sharing this table is
/// what lets the sidebar, the poller and the unread math each have one shape
/// instead of two. A separate DirectThread model was rejected: every read path
/// would have been written twice and the second copy would have drifted.
model Conversation {
  id   String           @id @default(cuid())
  kind ConversationKind

  /// Channels only; null on a DM, which is named by who is in it. Storing
  /// "Dana Reeve & Tom Iversen" would be a second copy of two names that a
  /// rename leaves stale, so the title is derived at read time by
  /// `conversationTitle` instead.
  ///
  /// Stored **lower-cased and without the leading "#"** — "design", never
  /// "#Design". The "#" is presentation, added by `conversationTitle`, and
  /// the case fold is what makes the unique index below case-insensitive
  /// without a citext column or a second normalised field. `channelSchema`
  /// (§8) is the only writer, and it trims first.
  name String?

  /// The sorted member ids of a DIRECT row, joined — "u1:u2". Unique, so two
  /// people opening a DM with each other simultaneously cannot create two
  /// threads for the same pair: the loser hits the constraint and reads the
  /// winner back. Null on channels, and Postgres treats nulls in a unique
  /// index as distinct, so every channel is free to have none. Deriving this
  /// at read time was rejected — the race is won or lost in the database, and
  /// application code cannot referee it.
  directKey String? @unique

  /// Denormalised, rewritten inside the same transaction as every message.
  /// The sidebar's query is "my conversations, most recent first"; without
  /// this column that is a join against Message plus a max() per row, on
  /// every poll, forever. One extra write per message buys it, and being in
  /// the transaction is what stops it drifting.
  lastMessageAt DateTime @default(now())

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members  ConversationMember[]
  messages Message[]

  /// Answers "can two channels be called the same thing" with no: they cannot.
  /// `name` alone is enough, and a composite @@unique([kind, name]) was
  /// rejected as a reason that does not survive being written down: every
  /// DIRECT row carries a null name, Postgres treats nulls in a unique index
  /// as distinct, and that is true of the single-column key too — so `kind`
  /// would buy nothing the null already buys. Since `name` is non-null only
  /// on CHANNEL rows, this constraint binds channels and nothing else.
  /// Uniqueness is case-insensitive because `name` is stored folded; see its
  /// comment above. `createChannel` catches the P2002 (§8).
  @@unique([name])

  /// The Browse directory's query: "every channel, most recently active
  /// first".
  @@index([kind, lastMessageAt])
}

/// One row per person per conversation — never one per message. That is the
/// entire reason a busy channel stays cheap: read state is a single timestamp
/// per member, where a per-message read receipt would be fifteen rows written
/// for every message sent, to render a number that is already derivable.
///
/// It carries state of its own, unlike TaskAssignee, which is why it has a
/// cuid rather than a composite @@id: `lastReadAt` is updated on every open,
/// and a row about a person's relationship to a room deserves a stable id to
/// address it by.
model ConversationMember {
  id String @id @default(cuid())

  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  conversationId String

  /// Cascades, the same decision as Notification.recipient: a deleted member's
  /// membership rows are meaningless. Their messages are not — see
  /// Message.sender, which deliberately does not cascade.
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId String

  /// Everything created after this is unread. Null means "joined and never
  /// opened", and counts every message the unread query's thirty-day floor
  /// reaches — see §6 of the chat design, which writes that floor as an
  /// expression rather than leaving it to be inferred here. A boolean
  /// `unread` flag was rejected because it cannot answer "how many", and a
  /// stored integer counter was rejected because it has to be decremented by
  /// somebody and will be wrong the first time that write is missed.
  ///
  /// The null state is reachable only through a join that does not open:
  /// today there is none (D3), so nothing in the app writes it. It is
  /// nullable anyway because the alternative — defaulting to `now()` — would
  /// silently mark a room read that nobody has looked at.
  lastReadAt DateTime?

  joinedAt DateTime @default(now())

  /// Joining twice is the same membership — D3's lazy join relies on this to
  /// be idempotent rather than careful.
  @@unique([conversationId, userId])

  /// The sidebar's first query: "my conversations", by userId alone.
  @@index([userId])
}

/// Plain text, never markdown or HTML (D4, inheriting spec 3c D1). The
/// renderer emits React elements, so React's escaping is the whole XSS story
/// and there is nothing to sanitise on the way in or out.
model Message {
  id String @id @default(cuid())

  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  conversationId String

  /// Not cascaded, unlike the membership row above. Deleting a person must not
  /// silently rewrite a conversation that fourteen other people remember
  /// having — the same reason ActivityLog.actor, Comment.author and
  /// Announcement.author are all required relations and therefore RESTRICT.
  /// (Notification.actor is not: it is optional, so its default action is
  /// SetNull, which that field's own comment argues for. Authorship is the
  /// property that restricts here, not the word "actor".)
  sender   User   @relation("MessageSender", fields: [senderId], references: [id])
  senderId String

  body String

  /// Denormalised at write time, the same rule as Comment.mentionedUserIds.
  /// This is NOT what draws the mention links — the renderer re-derives those
  /// from the body against the live member list, so a renamed member's old
  /// mentions still resolve. This array is what CHAT_MENTION notifies from.
  mentionedUserIds String[]

  /// Null until the first edit; its presence renders the "edited" marker.
  /// updatedAt cannot do that job because Prisma touches it on every write.
  editedAt DateTime?

  /// Soft delete, unlike Comment, which is removed outright (D7). A comment is
  /// one entry in a list and can vanish; a message is one turn in a
  /// conversation, and a hole in a thread reads as a bug rather than as
  /// somebody changing their mind. Every read path must filter on this — the
  /// query contracts in §8 name it rather than trusting memory.
  deletedAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  /// The thread read: "this conversation, in order".
  @@index([conversationId, createdAt])

  /// The poll, which cannot use the index above. Its window is `updatedAt >=
  /// since` (§5) rather than `createdAt >= since`, because an edit and a soft
  /// delete change a row without creating one — and a createdAt window would
  /// deliver the original body once and then never mention it again, so
  /// "Message deleted" would appear only on the deleting user's own screen.
  @@index([conversationId, updatedAt])
}
```

`User` gains `conversations ConversationMember[]` and `messages Message[] @relation("MessageSender")`. Neither name collides with the twelve relation fields already on `User` (`prisma/schema.prisma:14-40`), and `MessageSender` collides with none of the nine named relations in the schema.

`NotificationType` gains one member, written in the voice of its neighbours:

```prisma
  /// A chat @mention in a CHANNEL, and the only thing in chat that reaches
  /// the bell. An ordinary message deliberately writes nothing here — see the
  /// in-app chat design, D6. A DM writes nothing here either: its title is
  /// whoever the reader is not, so one row's meta cannot name it for both
  /// participants, and the DM's own unread badge already says everything the
  /// sentence would. entityType is CONVERSATION and entityId is the
  /// conversation, not the message, because a message has no page of its own.
  CHAT_MENTION
```

`AttachmentParent` gains `MESSAGE` — **but not in the same migration.** It lands with step 4 of §14, so the chat migration does not add an enum member that nothing writes.

## 5. Delivery

### The route

`src/app/(app)/chat/...` is server-rendered like every other page; only *new* messages arrive by poll. The poller is a `GET` Route Handler at **`src/app/api/chat/poll/route.ts`**, joining the one route handler the app already has (`src/app/api/auth/[...nextauth]/route.ts`).

Verified against the bundled docs for `next@16.2.12`:

- The file is `route.ts` and the export is a named method — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:8-18` for the minimal handler returning `Response.json(...)`, line 24 for the seven supported methods. The whole convention is framed on "the Web `Request` and `Response` APIs" (same file, line 6), so the 401 below is a plain `Response.json(body, { status: 401 })`.
- The parameter is typed `NextRequest`, "an extension of the Web `Request` API" — same file, lines 62-70, which print `import type { NextRequest } from 'next/server'` and `export async function GET(request: NextRequest)`. That is what makes `nextUrl` available.
- Query parameters come off `request.nextUrl.searchParams`, per the same file's "URL Query Parameters" section, lines 345-357.
- **No caching directive is needed and none is added.** `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:51` states Route Handlers are not cached by default and that caching a `GET` is the opt-*in*, via `export const dynamic = 'force-static'`. Writing that line here would be the bug. `route.md`'s version history records the change: in `v15.0.0-RC` "the default caching for `GET` handlers was changed from static to dynamic".

### The contract

```
GET /api/chat/poll?since=<ISO-8601>&conversationId=<cuid>
```

Both parameters optional. The response type and the row type it carries are declared once in `src/lib/chat.ts` and imported by both sides, so the handler and the client cannot disagree about them:

```ts
type ChatPollResponse = {
  cursor: string | null;              // feed straight back as `since` next time
  unreadTotal: number;
  rooms: RoomRow[];                   // ALWAYS the complete set — see below
  messages: MessageRow[];             // empty unless conversationId was given
  truncated: boolean;                 // the batch hit its cap; reload the route
};

type RoomRow = {
  id: string;
  kind: "CHANNEL" | "DIRECT";
  title: string;                      // conversationTitle(conv, viewerId)
  unread: number;
  lastMessageAt: string;
};
```

`MessageRow` and `MessageGroup` are written out in §8 beside the functions that consume them.

- **`cursor` is a server value and is never computed in the browser.** It is the newest `updatedAt` among the rows returned, or the `since` that came in when nothing was returned. Using `Date.now()` on the client instead would drop messages whenever the browser clock ran fast and re-deliver them whenever it ran slow, and neither failure would be visible in a code review.
- **The window is `updatedAt >= since`, not `createdAt >= since`, and not `>`.** Two separate decisions in one line:
  - **`updatedAt`, because a poll has to carry changes and not only arrivals.** Prisma stamps `@updatedAt` on create as well as on update, so a new message satisfies this window exactly as a `createdAt` one would — and an edit (`editedAt`) or a soft delete (`deletedAt`) re-enters it, which a `createdAt` window makes impossible. Without this, D7's "the body stops rendering and 'Message deleted' takes its place" happens only on the deleting user's own screen, and everyone else with the thread open keeps reading the original text until they reload. `mergeMessages` **replaces** a row it already holds rather than dropping it, which is the client half of the same rule.
  - **`>=`, because strictly-greater loses the second of two rows written in the same millisecond**, which at fifteen people is rare and therefore worse — it would be discovered as "a message went missing once". `>=` re-delivers the boundary row and `mergeMessages` replaces it with an identical copy. Re-delivering is the safe direction to fail.
- **The batch is capped at 200 rows, and it is the *oldest* 200 at or after `since`** — ordered by `updatedAt` ascending, not descending. The client therefore always holds a contiguous run and `truncated` is the only gap signal it ever has to understand. Past the cap, `truncated: true` and the client calls `router.refresh()` rather than stitching — the case is a tab left open over a weekend, and a full server render is both simpler and more correct than a partial catch-up. `router.refresh()` is the documented call for exactly this: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md:46` — "Refresh the current route. Making a new request to the server, re-fetching data requests, and re-rendering Server Components", and it "clears the Client Cache for the current route, but does **not** invalidate the server-side cache". That is the right property here rather than a limitation, because §5's first section establishes the thread page is uncached anyway, so the re-render genuinely re-queries and there is nothing server-side to invalidate.
- **A soft-deleted row is delivered, with an empty body.** The thread has to render "Message deleted" in its turn (D7), so the row must arrive; the body must not, because a deleted message's text has no business on fourteen other screens. `deletedAt` is set and `body` is `""` on the wire.
- With no `conversationId`, `messages` is empty and only the counts are computed. That is the shape every page other than an open thread uses.
- **`rooms` is the complete set of the caller's conversations on every poll, not a delta.** The client replaces its list rather than merging into it, so an absent id means "no longer mine" and never "unchanged". This is what makes being DMed mid-session work: `openDirect` writes the other person's `ConversationMember` row, so a room appears in their membership set with no navigation and no notification — and it can only appear in their rail if the poll carries enough to render it, which is why `RoomRow` carries `kind` and `title` and not just a count. At fifteen people the complete set is a few dozen rows; a delta protocol would be marginally cheaper and would have to define what an absent id means, which is the ambiguity that leaves a stale room sitting in a rail forever.

### Cadence

Two pure functions in `src/lib/chat.ts` are the whole policy, so it is a unit test rather than a browser observation. `pollDelayMs(state, consecutiveFailures)` answers "how long until the next poll"; `shouldPollImmediately(prev, next)` answers "does this state change deserve one right now". The second exists because the first cannot express it — a transition is not a state, and claiming one function covered both would have left that behaviour living untested inside a component.

| State | Delay |
|---|---|
| focused | 5 s |
| visible, not focused | 30 s |
| `document.visibilityState === "hidden"` | **stopped** — returns `null`, no timer |

Written as the expression it has to be implemented as, because "three failures double the delay" has at least three readings and none of them is testable:

```ts
type PollState = "focused" | "visible" | "hidden";

pollDelayMs("hidden", anyFailureCount) === null           // hidden always wins
pollDelayMs(state, failures) =
  Math.min(60_000, base(state) * 2 ** Math.max(0, failures - 2))
  where base("focused") = 5_000, base("visible") = 30_000
```

So failures 0, 1 and 2 are the plain cadence and the **third** failure is the first doubling: focused goes 5 s → 10 s → 20 s → 40 s → 60 s, and an unfocused tab reaches the ceiling on that first doubling because 30 s × 2 is already past it. That is intended — a tab nobody is looking at has earned the ceiling. One success resets `consecutiveFailures` to zero. `hidden` returns `null` regardless of the failure count: the failure branch is never reached, because there is no timer to back off.

`shouldPollImmediately(prev, next)` is true when `next` is not `"hidden"` and `prev` was — coming back to a tab and waiting thirty seconds for it to catch up reads as broken.

### Cost

Fifteen people polling flat out at 5 s for an eight-hour day is 15 × 8 × 720 ≈ **86,400 invocations a day**, about **1.9 M a month** over twenty-two working days. At the rates published when this was written, Vercel Pro includes 1 M invocations and prices further ones at roughly $0.60 per million — so even the naive version is **under a dollar a month**, and the backoff above cuts it to a fraction of that, since most of a working day is a tab that is unfocused or hidden. Re-check the rate at deploy time; the conclusion does not turn on it.

## 6. Unread, mentions and the bell

**Unread is arithmetic, not a table.** For each of my `ConversationMember` rows, a message is unread when it was created after `lastReadAt`, was not sent by me, and is not soft-deleted. Two queries, constant regardless of how many conversations I am in:

1. `conversationMember.findMany({ where: { userId } })` — my rooms and my `lastReadAt` values.
2. One `message.findMany` across those conversation ids, selecting `{ conversationId, senderId, createdAt }` only, floored as below.

**Unread is scoped to joined conversations, and only to those.** Query 1 is the whole universe: a channel I have never opened has no membership row, so it contributes nothing, and the badge does not move when I open it (D3, and the matching edge case in §9). There is deliberately no third query over unjoined channels — that is the "badge nobody can clear" D3 rejects, reintroduced as a scan.

**The floor, as an expression**, because prose does not survive this one. "The older of my earliest `lastReadAt` and thirty days ago" reads as `min()`, and `min()` fails twice: a single ninety-day-stale membership would make every room scan ninety days, so the thirty-day cap below would never bind at all; and it has no value for the case the floor exists to serve, since a null `lastReadAt` contributes no timestamp to a minimum. Written as code instead:

```ts
floor = max(thirtyDaysAgo, min(...myLastReadAt.map((t) => t ?? thirtyDaysAgo)))
```

— a null `lastReadAt` is treated **as the floor**, not as negative infinity, and the floor is never earlier than thirty days ago. So: if every room I am in was read inside the last month, the scan starts at the earliest of those reads; otherwise it starts thirty days ago.

`countUnreadByConversation` in `src/lib/chat.ts` does the counting in memory over whatever rows that query hands it, which is what makes the rule unit-testable — and also what makes the floor **invisible** to the pure test, because the function never sees what was excluded. The floor is therefore pinned in `tests/chat-queries.test.ts` instead (§11), not in `tests/chat.test.ts`.

**Accepted cost of the thirty-day floor:** a room left unread for longer than that reports only its last thirty days. The badge caps at "99+" anyway (`unreadBadge`, `src/lib/notifications.ts:102-105`), so the two are indistinguishable on screen.

**Mentions reuse Phase 3c wholesale.** `segmentBody` and `extractMentionedUserIds` (`src/lib/rich-text.ts:75-138`) are called with the same active-member list `mentionableMembers()` builds in `src/server/actions/comments.ts:30-36`. Consequences carry over unchanged and are not re-decided here: mentions re-derive against the live list so a renamed member's old mentions still resolve; a mention of a deactivated member stays literal text; duplicates are deduped.

**One notification type, and only from a channel.** `sendMessage` calls `notify` (`src/lib/notification-service.ts:33-58`) inside the same transaction as the insert, with `type: "CHAT_MENTION"`, `entityType: "CONVERSATION"`, `entityId` the **conversation** id, and `meta: { name: <the channel's title, "#design">, excerpt: <first line, 80 chars> }`. Self-mentions are dropped by `notify` itself (line 45), which already filters the actor out — no call-site check is added.

**A DIRECT conversation writes no `CHAT_MENTION` at all.** Two independent reasons, either of which is sufficient:

- **`meta` is one row's worth of display data shared by every recipient** — `notify` maps a single `meta` object across `createMany` (lines 48-57) — but a DM's title is viewer-dependent by design: `conversationTitle(conv, viewerId)` returns *the other person's* name, which is why §11's test 2 asserts a different answer for each of the two viewers. Storing the sender's view would render "Tom mentioned you in Dana Reeve" to Dana. There is no viewer-independent string to store.
- **There is nothing to tell them.** A DM has exactly one other participant, they are already badged by the DM itself, and the sentence would carry no information the sidebar has not already delivered.

**A mention of someone who is not in the conversation** is therefore ruled by kind, and the two answers are opposite on purpose:

- **In a channel it notifies.** Under D2 a channel is open, the bell link goes to `/chat/{conversationId}`, and opening it joins them (D3). Nothing leaks, because there was nothing private.
- **In a DM it notifies nobody, and is not stored.** `sendMessage` intersects the derived ids with the two participants **before** writing `Message.mentionedUserIds`, so the stored array and the notifications never disagree. Without that intersection, `@Priya` typed into a DM would write Priya a bell row carrying an eighty-character verbatim excerpt of a room D2 declares private to its two participants, naming both of them — and the link would then 404 on her (§10). The mention still *renders* as a link inside the DM, because the renderer re-derives from the body against the live member list and that is only ever seen by the two people in the room.

**`editMessage` inherits `updateComment`'s three rules verbatim**, because they are not obvious and an implementer who does not go and read `src/lib/comment-service.ts:126-182` will get all three wrong in the same direction. Stated here rather than left to be discovered:

1. **An unchanged body is a no-op.** Trimmed-equal to what is stored → return `ok`, write nothing, and `editedAt` stays null (`comment-service.ts:145`). Opening the editor and saving without typing must not mark a message "edited".
2. **`mentionedUserIds` is re-derived from the new body**, against the live member list, and re-stored (line 147) — under the same DIRECT intersection as above.
3. **Only the ids the edit *added* are notified** (lines 151-152). Fixing a typo in a message that already mentioned three people must not ping all three again; they were already told. In a DM this is moot, because the count is zero either way.

Three pure functions gain an arm each, and `notificationHref`'s union gains a member:

- `NotificationEntity` in `src/lib/notification-service.ts:15` gains `"CONVERSATION"`. Its doc comment states the rule this obeys: the union exists "so `notificationHref` stays exhaustive and a new kind cannot be added without deciding where clicking it goes".
- `notificationHref` (`src/lib/notifications.ts:87-98`) gains `case "CONVERSATION": return \`/chat/${n.entityId}\``. Note that the same function has **no `COMMENT` arm** despite `COMMENT` being in the union, so a COMMENT-typed row would fall through to `/dashboard`. That is latent rather than broken — nothing writes one — and it is **not** fixed here. It is recorded so the next reader knows it was seen, not missed.
- `notificationIcon` gains `case "CHAT_MENTION": return "forum"`.
- `describeNotification` gains `case "CHAT_MENTION": return \`${who} mentioned you in ${what}\`` — "in", not "on", because the object is a room rather than a task.

**The sidebar badge.** `NAV_ITEMS` (`src/components/shell/sidebar.tsx:12-28`) gains `{ href: "/chat", label: "Chat", icon: "forum" }`, positioned after Team and before Vault — chat belongs with people, and Settings keeps its `ruleAbove` boundary. `Sidebar` gains a `chatUnreadCount: number` prop beside `myTaskCount`, and the hard-coded `item.href === "/my-tasks"` branch at lines 114-118 **becomes a lookup keyed by href**. Two hard-coded branches is how a third gets written. `src/app/(app)/layout.tsx:29-45` gains one element in its existing `Promise.all` — `countChatUnread(prisma, session.user.id)`, itself the two queries above.

**How the polled number reaches that badge**, which is the part a wire contract does not answer on its own. `chatUnreadCount` is a *server-rendered* prop, recomputed only on navigation; `unreadTotal` arrives in the browser every few seconds. The two are joined by one client component and nothing else:

- **`<ChatPoller>` mounts in `src/app/(app)/layout.tsx`, beside `<Sidebar>` — not in `chat/layout.tsx`.** §5's counts-only response is "the shape every page other than an open thread uses", and it can only be that if the poller runs on every authenticated page. One poller, one timer, app-wide. It reads the open conversation id from `usePathname()` (`/chat/<id>` or nothing), which is why `conversationId` is a query parameter and not a mount-time prop.
- It holds `unreadTotal`, `rooms` and the open thread's `messages` in state and publishes them through a small client context, `ChatLiveContext`. `Sidebar` reads the live total and falls back to its `chatUnreadCount` prop until the first poll returns, so the first paint is server-correct and every paint after it is poll-correct. `conversation-list.tsx` reads `rooms` the same way, with the rail's server render as its initial value.
- **No `router.refresh()` on message arrival, and no `revalidatePath` on read.** Both would re-render the app shell as often as messages arrive, which is the objection §8 already raises against revalidating on send; the badge is a number in client state, and a number in client state does not need a server round trip to change. `router.refresh()` is reserved for the one case that genuinely needs a fresh server render — `truncated: true` (§5).
- The context lives in `src/components/chat/chat-live.tsx`, and `src/components/shell/sidebar.tsx` imports the hook from it. That is a shell → chat dependency and it is deliberate: the alternative is a second copy of the number lifted into the layout, which would have to be kept in step with this one.

**The collapsed rail still shows no counts.** The whole label-and-badge block sits inside `{collapsed ? null : (...)}` (`sidebar.tsx:107-120`) and stays there. A dot on a 60 px rail is a new visual vocabulary invented for one number, and the topbar bell already carries the things that cannot wait.

## 7. Attachments, and the pipeline that must exist first

Chat messages can carry files. Nothing about that is designed here, because it is designed already: **§6 *and* §7 of `docs/superpowers/specs/2026-08-02-phase-3c-comments-attachments-design.md`**. Both sections, and the split matters:

- **§6 Storage** (lines 102-112) — private bucket, direct browser → R2 presigned PUT, the two-step `requestUpload` / `confirmUpload` write, the `{parentType}/{parentId}/{cuid}/{sanitised filename}` key shape, and the 25 MB limit enforced in both places.
- **§7 Security** (lines 113-121) — presigned URLs minted **only after the caller's session is checked**, and expiring in 5 minutes (line 116); the upload URL bound to the exact key, content-type and content-length the client declared, so it cannot be reused to write something else (line 117); and `fileName` displayed but never used to build a key (line 118).

Read both. The three rules that make the presign safe rather than merely convenient are all in §7, and a pointer at §6 alone sends an implementer to build the pipeline without them. Do not restate either and do not re-derive either.

What this spec adds is three constraints on *when* and *how* it extends to messages:

- **The pipeline is a prerequisite, not a sub-task.** `TODO.md` §3 records the bucket and credentials as existing since 2026-08-03 while no code does; §2 of that file has the item moved out of "blocked". It gets built against tasks, projects and clients first, per D9.
- **`AttachmentParent` gains `MESSAGE` only at that point**, in its own migration.
- **Deleting a message deletes its R2 objects.** The database cannot cascade into a bucket — the `Attachment.parentId` comment (`prisma/schema.prisma:391-396`) says so in as many words, and the 3c spec calls this "the one place where a missed code path silently leaks storage". `deleteMessage` is a soft delete (D7), which makes this easier to get wrong, not harder: **the row survives and the objects must not.** The service deletes the objects and the `Attachment` rows outright while setting `deletedAt`, because a soft-deleted message renders as "Message deleted" and has nothing left to offer a download of.
- **The order is: bucket first, database second, and a bucket failure aborts.** A `DeleteObjects` call is not transactional with Postgres, so the order decides which way it fails. `deleteMessage` reads the message's `Attachment` rows, deletes those objects from R2, and only then commits the `deletedAt` stamp and the `Attachment` row deletion in one transaction. If the bucket call throws, it returns `err` and the message is left entirely intact — nothing has changed, and the user can press Delete again. The reverse order is the one that leaks: commit first and the objects are orphaned with no row left pointing at them, which makes them unreapable, because the `fileKey` is the only thing that could have found them. This is 3c §6's own direction to fail — an orphan object beats a broken download — applied to the one case where the orphan would be permanent.
- **`editMessage` never touches attachments.** Editing changes the body and nothing else; there is no remove-a-file-from-a-sent-message path in this phase, and adding one would be a second delete path against the same objects.
- **An admin deleting someone else's message deletes that message's objects too.** The files belong to the message, not to the uploader — a "Message deleted" placeholder with a live download under it would be the worst of both.

## 8. Surfaces, modules and routes

| Route | Purpose |
|---|---|
| `src/app/(app)/chat/layout.tsx` | The rail: my DMs, my channels, unread counts, "New channel" |
| `src/app/(app)/chat/page.tsx` | No thread open — renders the **Browse channels** directory and a prompt |
| `src/app/(app)/chat/[conversationId]/page.tsx` | One thread, server-rendered, `params: Promise<{ conversationId: string }>` and `searchParams: Promise<{ before?: string }>` |
| `src/app/api/chat/poll/route.ts` | §5 |

`params` is awaited, matching every existing dynamic page (`src/app/(app)/team/[memberId]/page.tsx:12-16`) and the documented shape at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md:44-48` and its note at line 64 that "the `params` prop is a promise". `searchParams` is a promise on the same terms — same file, lines 67-69 and the note at line 117.

One more file outside these four: **`src/app/(app)/team/[memberId]/page.tsx` gains the "Message" button**, which is the only surface `openDirect` has. Worth naming, because it means chat is not confined to `src/components/chat/` and `src/app/(app)/chat/` and a reviewer looking only there would miss it.

**Browse is the index page, not a sibling route.** `/chat/browse` would sit beside `/chat/[conversationId]` at the same level, and this repo's bundled docs contain no statement about which of a static and a dynamic segment wins there — so the design does not rely on one. The empty state of chat *is* the directory, which is also the better product answer: the first thing someone with no conversations sees is the list of rooms to join.

### Modules

Layer boundaries are the house rule, not a suggestion.

**`src/lib/chat.ts`** — pure, no Prisma, no React. This is the unit-tested surface:

```
messageSchema                                                   // z: body trimmed, 1..4000, explicit messages
channelSchema                                                   // z: name trimmed, "#" stripped, lower-cased, 1..40
directKey(a: string, b: string): string                         // sorted, joined ":"
conversationTitle(conv, viewerId): string                       // "#design" | the other person's name
countUnreadByConversation(messages, memberships, viewerId): Record<string, number>
groupMessages(rows: MessageRow[]): MessageGroup[]               // consecutive sender, 5-minute window
mergeMessages(existing, incoming): MessageRow[]                 // replace by id or pendingKey, sort by createdAt then id
nextCursor(previous: string | null, rows: MessageRow[]): string | null
pollDelayMs(state: PollState, consecutiveFailures: number): number | null
shouldPollImmediately(prev: PollState, next: PollState): boolean
```

It also declares the types both sides share, and they are written out here rather than left to be inferred from the function signatures — two implementers reading "`MessageRow`" produce two incompatible records, and the handler and the client are the two things this file exists to stop disagreeing:

```ts
type PollState = "focused" | "visible" | "hidden";

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;          // denormalised onto the wire; the client holds no member map
  body: string;                // "" when deletedAt is set — §5
  editedAt: string | null;     // non-null renders the "edited" marker
  deletedAt: string | null;    // non-null renders "Message deleted"
  createdAt: string;           // ISO-8601; ordering and grouping key
  pendingKey?: string;         // NEVER set by the server; see the composer rule below
};

type MessageGroup = {
  senderId: string;
  senderName: string;
  messages: MessageRow[];      // one turn: consecutive, same sender, inside five minutes
};
```

`ChatPollResponse` and `RoomRow` (§5) are declared here too — that is what "declared once and imported by both sides" means.

**`mergeMessages` is two rules, not one**, and both have to be pure or the optimistic path has no test:

1. An incoming row **removes** any existing row with the same `id`, or with the same `pendingKey` when the incoming row carries one — then every incoming row is appended and the result is sorted by `createdAt`, then `id`. "Replace", not "drop the duplicate": a row arriving with a newer `editedAt` or a set `deletedAt` has the same id it always had, and dropping it is what leaves the original text on fourteen screens forever.
2. `pendingKey` is how a send resolves. The composer's optimistic row has `id` and `pendingKey` both set to a client-minted key; on `ok: true` it merges `{ ...pendingRow, id: <returned>, createdAt: <returned> }` with `pendingKey` **still set**, which is what removes the old row. The next poll delivers the same row with no `pendingKey`, which replaces it by `id` and clears the field. If the poll wins the race and delivers the real row first, the list holds two rows for one message until the action returns — a fraction of a second, once, and then rule 1 removes both the pending row and the polled row in the same merge.

**Step 4 widens `MessageRow`; it does not add a parallel array.** The field is `attachments: AttachmentRow[]`, defaulting to `[]`, so `groupMessages` and `mergeMessages` are untouched and a message and its files cannot arrive out of step with each other.

`messageSchema` is declared here rather than reusing `commentSchema` (`src/lib/rich-text.ts:12-14`), which it otherwise matches in shape. The name asserts a comment, and a later change to comment limits must not silently change chat's. It also diverges in one visible way, deliberately: `commentSchema`'s `.max(4000)` carries **no message**, so the string a user sees is zod's own default — "Too big: expected string to have <=4000 characters", in nobody's voice and free to change on a minor bump, since both services surface `parsed.error.issues[0]?.message` straight through (`comment-service.ts:77`). `messageSchema` writes its own: `.max(4000, "That message is too long")`, locked in §13, which is what §11's test 8 asserts. Pinning a dependency's default string in a test suite would make a zod upgrade a copy change.

`channelSchema` is the write-side of `@@unique([name])`, and every part of it is load-bearing: **trim**, so " design" and "design" are the same channel; **strip a leading `#`**, because people type it and it is presentation (`conversationTitle` adds it back); **lower-case**, which is what makes uniqueness case-insensitive on a Postgres index that is not — without it `#Design` and `#design` both insert and produce two rooms nobody can tell apart in the rail; and **1..40**, with "Name the channel" and "That name is too long" as its two messages. **Any member may create a channel.** Gating creation on ADMIN would be the only permission check in a feature whose whole ruling (D2) is that it has none.

**`src/lib/chat-queries.ts`** — reads, prisma first. `listMyConversations`, `countChatUnread`, `listOpenChannels`, `getConversation`, `listMessages`.

D7 makes the soft-delete filter a silent bug rather than a loud one, so each function's doc comment names its own rule rather than trusting a blanket sentence — **and the rule is not the same for all of them**, which is exactly why a blanket sentence was the wrong thing to write:

- **Counting paths exclude soft-deleted rows.** `countChatUnread` and the poll's counts: a message somebody deleted is not something you have to read.
- **Thread-rendering paths include them, without their bodies.** `listMessages` and the poll's `messages` select the row so "Message deleted" can occupy its turn (D7, and §11's test 4 that the messages either side of it do not merge), with `body` emptied on the way out. Filtering them out here would put a hole in the thread, which is the thing D7 exists to prevent.
- **`listMyConversations` excludes a DM that has no messages** — see `openDirect` below.

`listMessages(db, conversationId, { before?: string, take = 50 })` — the newest `take` rows at or before `before`, returned **ascending** so the caller renders them in order. The thread page renders the newest 50 and, when a fiftieth-and-older exists, a **"Load earlier"** link to `?before={oldest rendered id}`; the page re-renders on the server with that window and the plain `/chat/{id}` link is the way back to the newest. That is the whole history story: no client fetch, no cursor state, no infinite scroll, and no `loading.tsx` (§9). Rendering a channel's entire year of traffic on every navigation was the alternative, and fifteen users is not a reason to do it — it is only a reason not to notice for a while.

**`src/lib/chat-service.ts`** — writes, returning `ActionResult` from `src/lib/action-result.ts`. `createChannel`, `openDirect`, `sendMessage`, `editMessage`, `deleteMessage`, `markConversationRead`. Six, not seven: **there is no `joinChannel`**, because under D3 opening is the only join and `markConversationRead` already writes exactly the row a join would.

- **`createChannel`** parses `channelSchema`, inserts, and catches **P2002** on `name` → `err("That channel already exists")`. The constraint is the check; a find-then-create would be D10's race with a different name on it. This is the P2002 sibling of the P2025 helper below, and it is written down because §13 locks every user-visible error and a constraint with no handler is a 500 in the shape of a design decision.
- **`openDirect`** writes the `Conversation` **and both `ConversationMember` rows in one transaction** — both, because `directKey` is meaningless without the pair it is derived from, and because the recipient's unread arithmetic (§6) needs a membership row to count against. On P2002 it reads the winner back (D10). Nobody's rail gains an empty room from this: **a DM with no messages appears in no rail at all**, `listMyConversations` filters it, and the creator is looking at it only because they were navigated there. Otherwise clicking "Message" on a colleague drops a thread they did not ask for at the top of their rail — `lastMessageAt` defaults to `now()`, so it would sort *above* their real conversations — reading "No messages yet." Re-opening later finds the same row by `directKey`, so nothing is lost by hiding it.
- **`sendMessage`** is one transaction: insert, bump `Conversation.lastMessageAt`, `notify` (channels only — §6). It returns **`ok({ id, createdAt })`**, matching `addComment`'s `ok({ id })`, because the composer needs both to resolve its optimistic row (§9).
- **`editMessage`** follows `updateComment`'s three rules verbatim; they are written out in §6 rather than left to be found.
- **`deleteMessage`** sets `deletedAt`; from step 4 it deletes the R2 objects first (§7).
- **`markConversationRead(db, { conversationId, userId })`** **upserts** the membership row with `lastReadAt: new Date()`. That single write is both halves of D3: for a channel the caller has never opened it *is* the lazy join, and for one they are already in it advances the timestamp. Idempotent by way of `@@unique([conversationId, userId])`, which is what lets this be careless rather than careful.

The P2025 race is handled with the `isRowGoneRace` helper already used at `src/lib/comment-service.ts:9-11`.

**`src/server/actions/chat.ts`** — `"use server"`, the standard `(_prev, formData)` and `(formData)` shapes, inputs read as `String(formData.get(x) ?? "")` with validation left to the service, `requireUser()` at the top, only `AuthError` converted to `err`. The file opens with the mandatory **Revalidation map** table, as `src/server/actions/comments.ts:1-19` does — and that table records one deliberate inversion of house habit:

- **`sendMessageAction` revalidates nothing.** The sender sees an optimistic bubble; everyone else, including the sender's other tabs, gets it from the next poll. Revalidating a path on every message would re-render a route sixty times a minute to deliver something already in flight. This is written down because an empty revalidation cell otherwise reads as an omission.
- **`markConversationReadAction` revalidates nothing either**, and this is the inversion that needs the most argument, because `src/server/actions/notifications.ts:35,52` does the opposite for the bell and for a good reason: that badge is server-rendered and has no other way to change. Chat's badge does — it is client state fed by the poll (§6) — and this action fires **on every delivery into a focused open thread**, not once per navigation. `revalidatePath("/", "layout")` on that cadence is `sendMessageAction`'s objection with a different verb: the whole app shell re-rendered as often as messages arrive. The drop is instant anyway, because the client zeroes the open room's count in `ChatLiveContext` the moment it fires and the next poll (≤5 s) confirms it from the database.
- **Who calls it, and how often.** `chat/[conversationId]/page.tsx` renders a client `<MarkRead conversationId>` that calls the action **on mount**, and **again whenever the poller delivers messages for the open conversation while `document.hasFocus()`**. Both halves matter: without the first, opening never clears; without the second, `lastReadAt` freezes at the moment of opening and the reader accumulates unread for the room they are sitting in and watching. It is deliberately a client effect and not a write during the page's server render — `revalidatePath` is documented as callable "in Server Functions and Route Handlers" (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md:13`) and "cannot be called in Client Components or Proxy" (line 15), but more to the point, writes live in a `-service.ts` behind an action in this codebase and a page render is not one.
- `createChannelAction` and `openDirectAction` revalidate `/chat`, because the Browse directory is server-rendered. Both then redirect into the conversation they made. There is no `joinChannelAction` — see the service list above.

**`src/components/chat/`** — `chat-rail.tsx`, `conversation-list.tsx`, `channel-directory.tsx`, `message-list.tsx`, `message-group.tsx`, `message-composer.tsx`, `message-actions.tsx`, `mark-read.tsx`, `chat-poller.tsx`, `chat-live.tsx`, plus the two forms the service functions would otherwise have no surface for:

- **`new-channel-form.tsx`** — the "New channel" dialog behind the rail's button, and the only caller of `createChannelAction`.
- **`new-direct-picker.tsx`** — the member picker behind "Message", excluding the viewer (§9), and the only caller of `openDirectAction`. It is **the first consumer of §14 step 1's combobox**, which is the only real link between that step and this phase and is worth saying out loud: the combobox is sequenced first because it is small and unrelated, not because chat waits on it, but this is where chat would have grown its own.

`chat-poller.tsx` and `chat-live.tsx` live here by domain even though they mount in `src/app/(app)/layout.tsx` (§6) — components are filed by what they are about, the same way `src/components/shell/` is, not by which layout renders them. Bodies render through `PlainText`, not a second renderer. Every control is a `ui/` primitive: gates 2, 3 and 4 fail on a raw `<button>`, `<input>` or `<textarea>` and on a local class constant, gate 1 fails on a hex colour or a `dark:` variant, gate 6 on a built-in Tailwind shadow, gate 9 on a raw icon span (`scripts/gates.mjs`).

## 9. Empty, loading and failing states

Every one of these is a literal string, locked in §13.

**Empty.** `/chat` with no memberships and no channels at all → `EmptyState` reading "No conversations yet. Create a channel or message a colleague." · `/chat` with channels I have not joined → the directory, no empty state. · A joined channel with no messages → "No messages yet." · A DM with no messages → the same string; a second one would say nothing new. Only its creator ever sees it, because an empty DM is in nobody's rail (§8, `openDirect`). · The Browse directory with every channel already joined → "You have joined every channel." **Browse lists the channels I am *not* in**, which is what makes that sentence true and what makes the directory shrink as you join things rather than becoming a second copy of the rail.

**Loading.** The rail and the thread are two indexed queries, and both render on the server on the first paint. **There is deliberately no `loading.tsx` under `/chat`.** Two reasons, both load-bearing: a skeleton would trade a sub-100 ms wait for a flash, and — see §12 — a `loading.tsx` is precisely the file that turns into a permanently blank screen in the QA browser. The composer is enabled immediately; there is nothing to wait for.

**Sending.** The message appears optimistically the moment Send is pressed, with a "Sending…" label. The optimistic row is a `MessageRow` whose `id` and `pendingKey` are both a client-minted key; `pendingKey` is the only field the server never sets, and its presence is what "unconfirmed" means.

- **On `ok: true`** the action returns `{ id, createdAt }` and the composer merges the confirmed row back through `mergeMessages`, still carrying its `pendingKey` — the two rules in §8. That is the whole reconciliation, and it collapses to one row whether the action or the poll got there first. Without it the sender sees their own message twice indefinitely: a client-minted id is one `mergeMessages` has never seen, so the polled row is appended beside it, and `sendMessageAction` revalidates nothing, so no server render ever comes along to correct it.
- **On `ok: false`** the bubble stays exactly where it is, dimmed, with the error text beneath it and a Retry — the error and the message it belongs to are in the same place, which is the per-item scoping rule Phase 3b applied to board cards and the 3a follow-up applied to checklist items. A conversation-level error banner would repeat the mistake those two fixed.

**Poll failure.** The first two consecutive failures are silent — a dropped request on a laptop lid is not news. From the third, the rail shows "Reconnecting…" and the delay backs off per §5. A success clears it. **No toast, ever**; the app has no toast system and chat is not the reason to acquire one.

**Edge cases, each with its answer:**

- Two people open a DM with each other simultaneously → D10; the loser reads the winner back and both land in the same thread.
- Two people create `#design` at the same moment → the same shape one level up: `@@unique([name])` decides it, the loser catches **P2002** and gets `err("That channel already exists")`. Case is not a way around it — `channelSchema` folds the name before the insert, so `#Design` is that same row.
- Two messages in the same millisecond → §5's `>=` window plus `mergeMessages` replacing by id.
- A message edited or deleted on another screen → §5's `updatedAt` window carries the changed row on the next poll, and `mergeMessages` replaces the copy the client holds rather than dropping it as a duplicate.
- A tab hidden for days → `truncated: true` and `router.refresh()` (`use-router.md:46`).
- Browser clock wrong → irrelevant; the cursor is a server value.
- Empty or whitespace-only body → `messageSchema` rejects with "Write something first", the string `commentSchema` already uses.
- Over 4,000 characters → `messageSchema`'s own message, "That message is too long" — explicit rather than zod's default (§8); the composer shows a `{n}/4000` counter from 3,800.
- An empty or 41-character channel name → "Name the channel" / "That name is too long", from `channelSchema`.
- Editing someone else's message → `err("Not your message")`. Author-only, no admin override on edit — an admin rewriting somebody's words is a worse power than deleting them.
- Deleting → author **or** admin, with `isAdmin: user.role === "ADMIN"` passed as data rather than checked at the door, exactly as `removeComment` does (`src/server/actions/comments.ts:99`).
- Editing or deleting a message twice from two tabs → P2025 → `err("Message not found")`.
- A DM with yourself → the member picker excludes the viewer, and `openDirect` returns `err("Pick someone else")` if one arrives anyway.
- A message mentioning nobody → no `notify` call reaches the database; `notify` no-ops on an empty recipient list without a round trip (`src/lib/notification-service.ts:45-46`).
- Mentioning a deactivated member → literal text, because the member list is `active: true` only.
- **Mentioning someone who is not in the conversation** → in a channel, they are notified and the bell link joins them on open (D2, D3); in a DM, the id is dropped before it is stored and nobody is notified (§6). The two answers differ because the rooms do.
- **Any mention inside a DM** → no `CHAT_MENTION` row, ever. §6 gives the two reasons.
- Opening a channel you have never opened → `markConversationRead` upserts the membership row with `lastReadAt` set, in one write. **The badge does not move**: an unjoined channel was never counted (D3, §6).
- Reading a thread while messages keep arriving → `<MarkRead>` re-fires on each delivery while the document has focus, so `lastReadAt` keeps up and the badge stays at zero for the room being read. Without that, the reader would accumulate unread for the conversation they are watching arrive.

## 10. Security

- Every action is behind `requireUser()` (`src/server/guards.ts`), and the poll route calls it too — Route Handlers are as reachable as Server Functions, and the doc's own warning about direct POSTs to actions (`07-mutating-data.md:32`) applies with more force to a `GET` anyone can type into a URL bar. No session → `Response.json({ error: "Not signed in" }, { status: 401 })`.
- **A DM the caller is not in returns 404, not 403.** 403 confirms the thread exists, which tells you two named colleagues are talking. 404 tells you nothing.
- **Channels have no read check by design** (D2) and must not grow one by accident; `getConversation` branches on `kind` and the branch is what the test pins.
- Message bodies are never HTML. D4, and `src/components/ui/plain-text.tsx` contains no `dangerouslySetInnerHTML` and must never contain one.
- The poll's `since` is parsed with `new Date` and rejected to null when invalid. **An absent or malformed `since` returns the newest `take` rows of the thread** — the same window `listMessages` gives the page — never a 500 and never an unbounded scan. That is the one place the poll reads newest-first; everything else about the batch is oldest-first and contiguous (§5).
- `mentionedUserIds` is derived server-side in the service, never accepted from the client, matching `addComment` (`src/lib/comment-service.ts:87`).
- **A DM's contents cannot be forwarded to a non-participant by mentioning them.** The bell is the only surface in chat that carries a message excerpt out of the room it was written in, and §6 closes it: a DIRECT conversation writes no `CHAT_MENTION`, and ids outside the pair are dropped before they are stored. Without that rule, typing a colleague's name into a DM would hand them eighty verbatim characters of it, the names of both participants, and a link that then 404s on them under the bullet above — a leak dressed as a notification.

## 11. Testing

Vitest only, `environment: "node"`, `include: ["tests/**/*.test.ts"]` (`vitest.config.ts`). **There is no jsdom and no `@testing-library` in `package.json`, and neither is being added.** Component rendering is not testable here; saying otherwise in a plan is how a phase acquires a dependency nobody approved.

`tests/chat.test.ts` — the pure module, and the reason so much logic was pushed into it:

1. `directKey` — the same pair in either order produces one string; two different pairs never collide.
2. `conversationTitle` — a channel returns its name with the "#" added at render; a DM returns the *other* member's name for each of the two viewers; a DM whose other member was deactivated still names them.
3. `countUnreadByConversation` — a null `lastReadAt` counts every message it is handed (the function is total over its input type even though D3 leaves nothing writing that state today); my own messages never count; soft-deleted messages never count; a conversation with nothing new is absent rather than zero; **a conversation with no membership row is absent no matter how many messages it has** — that is unjoined channels contributing nothing, pinned rather than assumed.
4. `groupMessages` — consecutive messages from one sender collapse; a different sender breaks the group; a gap over five minutes breaks it; a day boundary always breaks it; a deleted message occupies its turn and does not merge the two around it.
5. `mergeMessages` — an incoming row whose id the client already holds **replaces it in place**, so a row arriving with a newer `editedAt` or a set `deletedAt` updates the thread rather than being discarded as a duplicate, and is not appended beside it either; **a confirmed row carrying a `pendingKey` removes the optimistic row, so a resolved send is one row and not two — asserted in both orders**, action-then-poll and poll-then-action, since the second is the race that actually bites; ordering is by `createdAt` then `id`, so the same-millisecond pair is stable; an empty incoming batch returns the input unchanged.
6. `nextCursor` — advances to the newest `updatedAt` in the batch; returns the previous cursor unchanged on an empty batch; never returns a client-supplied value it was not given.
7. `pollDelayMs` — against the formula in §5, with the numbers written out: `("focused", 0) === 5_000`, `("focused", 2) === 5_000`, `("focused", 3) === 10_000`, `("focused", 5) === 40_000`, `("focused", 6) === 60_000` (the cap, not 80,000), `("visible", 0) === 30_000`, `("visible", 3) === 60_000`, and **`("hidden", n) === null` for n of 0 and 9 alike** — hidden wins over the failure branch. `shouldPollImmediately("hidden", "focused") === true`; `("focused", "visible") === false`.
8. `messageSchema` — empty and whitespace-only rejected with "Write something first"; 4,001 characters rejected with **"That message is too long"**, the explicit string, not zod's default; 4,000 accepted.
9. `channelSchema` — "  Design  " normalises to "design"; a typed "#design" normalises to the same; empty rejected with "Name the channel"; 41 characters rejected with "That name is too long"; 40 accepted.

`tests/notifications.test.ts` gains three cases, because §6 adds an arm to three functions that file already unit-tests one by one (lines 101, 158, 168) and none of the three would fail loudly if the arm were missed — `notificationHref` is typed `entityType: string` (`src/lib/notifications.ts:87`), so widening `NotificationEntity` enforces nothing at compile time, and all three have silent `default:` arms that render `/dashboard` and a generic sentence rather than throwing. A missed arm is a wrong link, not a red test, unless one is written:

- `notificationHref({ entityType: "CONVERSATION", entityId: "c1" })` is `/chat/c1`.
- `notificationIcon("CHAT_MENTION")` is `"forum"`.
- `describeNotification({ type: "CHAT_MENTION", actorName: "Dana", meta: { name: "#design" } })` is "Dana mentioned you in #design".

`tests/chat-service.test.ts` and `tests/chat-queries.test.ts` use the hand-rolled closure fakes already established in `tests/checklist-service.test.ts` — no `vi.fn`, `vi.spyOn` or `vi.mock` — with the fake that routes writes to separate `db` and `tx` sinks, so a `notify(db, …)` written outside the transaction lands in the wrong sink and fails rather than passing silently. What they pin:

- `sendMessage` writes the message, the `lastMessageAt` bump and the notification **in one transaction**, and a thrown error leaves all three absent.
- `sendMessage` writes zero notifications when the body mentions nobody, and none to the sender when it mentions the sender.
- `sendMessage` returns `ok({ id, createdAt })` — the composer's optimistic reconciliation (§9) is unimplementable without both.
- **`sendMessage` in a DIRECT conversation writes zero notifications**, including when the body mentions the other participant, and **a DM body mentioning a third party writes zero notifications and stores zero ids for them** — the leak in §6, pinned by counting rows rather than by reading the bell.
- A channel message mentioning someone with no membership row writes exactly one notification. The channel case and the DM case are opposite and both are tested, or the next reader will "fix" one of them.
- **`editMessage`** — an edit that adds one mention writes exactly one notification, to the added person only; an edit that changes only wording, leaving the mentions as they were, writes none; an edit to a body that trims equal to the stored one writes **nothing at all** and leaves `editedAt` null.
- `openDirect` writes the sorted `directKey` **and both membership rows in the same transaction**, and on a unique-constraint failure reads the existing row back instead of surfacing an error.
- `createChannel` normalises the name before inserting, and turns a P2002 into `err("That channel already exists")` rather than letting it escape as a 500.
- `markConversationRead` called twice for a channel the caller has never opened leaves **one** membership row and an advanced `lastReadAt` — the lazy join and the read stamp are one write (D3).
- `deleteMessage` sets `deletedAt` and does **not** call `delete`.
- `countChatUnread` excludes soft-deleted rows, excludes conversations with no membership row, and **floors its scan at the expression in §6** — the floor is invisible to `countUnreadByConversation`, which only ever sees the rows the query already handed it, so this is the only place it can be pinned. Three cases: every `lastReadAt` inside thirty days (floor is the earliest of them), one older than thirty days (floor is thirty days ago), one null (floor is thirty days ago).
- `listMessages` returns soft-deleted rows **with an empty body**, ascending, capped at `take`, and honours `before` — deliberately the opposite of `countChatUnread`'s filter, which is why §8 states the rule per function rather than once for the file.
- Both stay at their stated query counts.

Everything else — the poll actually firing, the optimistic bubble, drag-free scroll anchoring, the rail — is browser QA, and per §12 that QA is this phase's primary verification rather than a supplement to it.

## 12. Read this before any browser QA

**The embedded Claude Browser pane reports `document.visibilityState === "hidden"`.**

A visibility-gated poller in that pane is *correct* to do nothing, and will therefore look completely broken: no message ever arrives, no badge ever moves, and nothing throws. Chat is the first feature in this app whose core behaviour is gated on exactly the property that environment gets wrong.

The same artifact has already cost a full session once, on a different symptom — every route with a `loading.tsx` showing its skeleton forever, with the finished content parked in a `display: none` div where `querySelector` still finds it, so every scripted assertion passed while the screen was blank. It produced a confident and wrong diagnosis before it was caught. The write-ups are `TODO.md` §5 and `docs/superpowers/plans/visual-language-followups.md` (lines 43-59).

**Chat must be QA'd in real Chrome via `mcp__plugin_chrome-devtools-mcp`, and every measurement must assert `document.visibilityState === "visible"` alongside `location.pathname` before it is believed.** Two browser windows, two accounts, side by side — that is the only honest test of a poller.

## 13. Vocabulary lock

Exact strings. Everything from the 3a and 3b locks carries over unchanged.

- **Sidebar:** "Chat"
- **Rail headings:** "Direct messages" · "Channels" · "Browse channels"
- **Buttons and links:** "New channel" · "Message" · "Join" (the Browse row's link *into* a channel — opening is joining, D3) · "Send" · "Sending…" · "Retry" · "Edit" · "Delete" · "Load earlier"
- **Composer placeholder:** "Write a message"
- **New-channel field label:** "Channel name"
- **Empty states:** "No conversations yet. Create a channel or message a colleague." · "No messages yet." · "You have joined every channel."
- **Markers:** "edited" (reused from comments) · "Message deleted" · "Reconnecting…" · the composer counter, `{n}/4000`, shown from 3,800
- **Errors:** "Write something first" (reused from `commentSchema`) · "That message is too long" (`messageSchema`'s explicit max message — see §8 for why chat writes its own rather than surfacing zod's default) · "Name the channel" · "That name is too long" · "That channel already exists" (P2002 on `@@unique([name])`) · "Not your message" · "Message not found" · "Conversation not found" · "Pick someone else" · "Not signed in"
- **Notification sentence:** `{who} mentioned you in {conversation}` — and `{conversation}` is always a channel title, "#design", because a DIRECT conversation writes no notification at all (§6). That is what keeps this sentence viewer-independent, which is the only way one `meta` object can serve every recipient.

**New icon: `forum`, and only `forum`.** Added to `src/lib/icons.ts` and the font regenerated with `node scripts/fetch-icon-font.mjs` — gate 7 fails if it is declared and never rendered, gate 8 if the committed woff2 is stale. `attach_file` arrives with step 4 of §14 and not before, which is where `src/lib/icons.ts:60-74` already says it belongs.

**No new activity verbs.** `ActivityAction` and `describeActivity` are untouched — D8.

## 14. Sequencing

1. **The searchable combobox** (`src/components/ui/combobox.tsx`), the owner request already written up in `TODO.md` §3. It is unrelated to chat and small. **Deploy after this step** rather than holding the deployment for chat — `TODO.md` §1 is the next thing to do and nothing in it waits on any of the below.
2. **The R2 upload pipeline**, against tasks, projects and clients, exactly as **§6 and §7** of the 3c design specify — §7 is where the session check, the 5-minute expiry and the key/content-type/content-length binding live, and none of them is in §6. D9.
3. **Chat, text only.** Everything in §4 through §11 except `AttachmentParent.MESSAGE`.
4. **Chat attachments.** The second migration, the enum member, and the delete-the-objects path in §7.

Steps 3 and 4 are separate deployments. Step 3 is a complete, useful feature on its own; a studio that can talk to itself in the tool has gained the thing this spec is for, whether or not it can attach a PDF yet.

## 15. Success criteria

Nothing here is built. Every box is open, and each is a behaviour someone can watch rather than a step someone can tick.

- [ ] Two members in two real Chrome windows can hold a conversation, and a message appears on the other screen within five seconds without either page being reloaded.
- [ ] Closing focus on a tab slows delivery to thirty seconds; hiding the tab stops the requests entirely, confirmed in the network panel; returning delivers immediately.
- [ ] Anyone can see every channel in Browse, and opening one joins it with no invite and no request. The channel then leaves Browse and appears in the rail.
- [ ] Being DMed by someone mid-session makes the thread appear in the recipient's rail, named, **without a reload** — the case `RoomRow` carries `kind` and `title` for.
- [ ] Two people submitting the same channel name at the same moment produce one channel, and the loser sees "That channel already exists" rather than a 500.
- [ ] Two people clicking "Message" on each other at the same moment land in the same DM thread, and exactly one `Conversation` row exists for the pair.
- [ ] A DM is invisible to the thirteen people who are not in it, and its URL returns a 404 rather than a 403 for them.
- [ ] The sidebar Chat badge counts unread messages, drops to nothing when the thread is opened, and never counts the reader's own messages.
- [ ] An @mention writes exactly one `Notification` row per mentioned person, and an ordinary message writes none — verified by counting rows, not by looking at the bell.
- [ ] Clicking a chat mention in the bell opens that conversation.
- [ ] A deleted message leaves "Message deleted" in place, and the messages either side of it stay in their original order — **checked on the other window, without reloading it**, which is the case the `updatedAt` poll window exists for.
- [ ] An edited message shows "edited" on the other window within five seconds and without a reload; a non-author cannot edit it; an admin can delete it.
- [ ] The sender sees their own message exactly once — not twice while the poll catches up, and not twice after it.
- [ ] A body containing `<script>` renders as literal text and injects zero script elements.
- [ ] A failed send leaves the message on screen with its error and a working Retry.
- [ ] All Vitest suites pass; `npm run gates` 9/9; `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds.
- [ ] Attachments (step 4 only): a file sent in a message downloads again, and deleting that message removes the object from the bucket, verified by listing it.
