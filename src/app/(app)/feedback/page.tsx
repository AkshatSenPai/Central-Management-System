import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listFeedback, countOpenFeedback } from "@/lib/feedback-queries";
import {
  FEEDBACK_KIND_BADGE,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_BADGE,
  FEEDBACK_STATUS_LABEL,
  feedbackSummary,
  parseFeedbackStatusFilter,
} from "@/lib/feedback";
import { shortDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { FeedbackStatusControl } from "@/components/feedback/feedback-status-control";
import { FeedbackDeleteButton } from "@/components/feedback/feedback-delete-button";
import { FeedbackStatusFilter } from "@/components/feedback/feedback-status-filter";

/** Somewhere for the team to say how the CMS is working for them.
 *
 * Visibility is asymmetric and deliberate: a member sees their own
 * submissions, an admin sees the studio's. `listFeedback` builds that from an
 * explicit `isAdmin` flag rather than trusting this page to remember a filter.
 *
 * Everyone can reach the page — the submit box is the point — so unlike
 * /all-tasks there is no role redirect, only a narrower list. */
export default async function FeedbackPage(props: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  const viewerId = session.user.id;

  const raw = await props.searchParams;
  const status = parseFeedbackStatusFilter(raw.status);

  const rows = await listFeedback(prisma, { viewerId, isAdmin, status });
  const open = countOpenFeedback(rows);

  return (
    <div className="mx-auto max-w-[860px] space-y-5 px-6 pb-10 pt-5">
      <PageHeader
        title="Feedback"
        subtitle={
          isAdmin
            ? feedbackSummary(rows.length, open)
            : "Suggestions, problems and praise you have sent."
        }
        action={<FeedbackForm />}
      />

      {/* The filter is admin-only. A member's own list is a handful of rows
          they wrote themselves; a control that narrows three items to two is
          clutter, not a feature. */}
      {isAdmin ? <FeedbackStatusFilter status={status} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          message={
            status
              ? "Nothing matches this filter."
              : isAdmin
                ? "Nobody has sent anything yet."
                : "You have not sent anything yet. Use Give feedback above — it goes straight to an admin."
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const canDelete = isAdmin || row.authorId === viewerId;
            return (
              <SectionCard
                key={row.id}
                title={isAdmin ? row.authorName : FEEDBACK_KIND_LABEL[row.kind]}
                meta={shortDate(row.createdAt)}
                action={
                  <>
                    <Badge kind={FEEDBACK_KIND_BADGE[row.kind]}>
                      {FEEDBACK_KIND_LABEL[row.kind]}
                    </Badge>
                    {isAdmin ? (
                      <FeedbackStatusControl feedbackId={row.id} status={row.status} />
                    ) : (
                      <Badge kind={FEEDBACK_STATUS_BADGE[row.status]}>
                        {FEEDBACK_STATUS_LABEL[row.status]}
                      </Badge>
                    )}
                  </>
                }
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    {isAdmin ? (
                      <InitialsAvatar initials={row.authorInitials} shape="circle" size={28} />
                    ) : null}
                    {/* Plain text, not <PlainText>. Feedback is prose about
                        the app, not a client note, and running it through the
                        @mention parser would turn a sentence like "the @ button
                        is confusing" into a broken link to nobody. */}
                    <p className="min-w-0 whitespace-pre-wrap text-sm leading-[1.6] text-[var(--text-2)]">
                      {row.body}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* Names who answered it. "Acknowledged" with nobody
                        against it is how a queue becomes everyone-assumed-
                        someone-else's job. */}
                    <span className="text-xs text-[var(--text-3)]">
                      {row.resolvedByName && row.resolvedAt
                        ? `${FEEDBACK_STATUS_LABEL[row.status]} by ${row.resolvedByName} on ${shortDate(row.resolvedAt)}`
                        : "Not yet triaged"}
                    </span>
                    {canDelete ? <FeedbackDeleteButton feedbackId={row.id} /> : null}
                  </div>
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}

      {isAdmin && rows.length > 0 ? (
        <p className="text-xs text-[var(--text-3)]">
          Statuses: {FEEDBACK_STATUSES.map((s) => FEEDBACK_STATUS_LABEL[s]).join(" · ")}. Declining
          something is a decision, not a rejection — it keeps New meaning &ldquo;nobody has looked
          at this yet&rdquo;.
        </p>
      ) : null}
    </div>
  );
}
