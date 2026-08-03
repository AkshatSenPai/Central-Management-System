import Link from "next/link";
import { segmentBody, type Mentionable } from "@/lib/rich-text";

/** Renders stored plain text as React elements: line breaks preserved, bare
 * URLs linked, `@Name` linked to that member's profile.
 *
 * There is no `dangerouslySetInnerHTML` here and there must never be one. The
 * body is split into segments by `segmentBody` and each becomes a text node,
 * an anchor or a mention link — so every character anyone typed passes through
 * React's escaping. That is spec 3c D1: safe from stored XSS by construction
 * rather than by sanitising.
 *
 * Extracted from CommentBody in Phase 4 so client notes get the same
 * treatment. A note reading "portal: https://… , ask @Dana for the login" is
 * far more useful when both of those are clickable, and duplicating the
 * renderer would have meant two places to get the escaping right.
 */
export function PlainText({
  body,
  members,
  className,
}: {
  body: string;
  members: readonly Mentionable[];
  className?: string;
}) {
  return (
    <p className={`whitespace-pre-wrap ${className ?? "text-[13px] leading-[1.55] text-[var(--text-2)]"}`}>
      {segmentBody(body, members).map((segment, i) => {
        if (segment.kind === "link") {
          return (
            <a
              key={i}
              href={segment.href}
              target="_blank"
              // noreferrer as well as noopener: the target page has no reason
              // to learn which client someone was reading when they clicked.
              rel="noopener noreferrer"
              className="font-medium text-[var(--accent)] hover:underline"
            >
              {segment.text}
            </a>
          );
        }
        if (segment.kind === "mention") {
          return (
            <Link
              key={i}
              href={`/team/${segment.userId}`}
              className="font-semibold text-[var(--accent)] hover:underline"
            >
              {segment.text}
            </Link>
          );
        }
        return <span key={i}>{segment.text}</span>;
      })}
    </p>
  );
}
