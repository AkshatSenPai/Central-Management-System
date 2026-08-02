import Link from "next/link";
import { segmentBody, type Mentionable } from "@/lib/rich-text";

/** Renders a plain-text comment body as React elements.
 *
 * There is no `dangerouslySetInnerHTML` here and there must never be one. The
 * body is split into segments by `segmentBody` and each segment becomes a
 * text node, an anchor or a mention link — so every character a user typed
 * passes through React's escaping. That is the whole of spec 3c D1: the app
 * is safe from stored XSS by construction rather than by sanitising.
 *
 * `whitespace-pre-wrap` is what preserves the line breaks someone typed
 * without turning them into markup. */
export function CommentBody({
  body,
  members,
}: {
  body: string;
  members: readonly Mentionable[];
}) {
  const segments = segmentBody(body, members);

  return (
    <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-[var(--text-2)]">
      {segments.map((segment, i) => {
        if (segment.kind === "link") {
          return (
            <a
              key={i}
              href={segment.href}
              target="_blank"
              // noreferrer as well as noopener: the target page has no reason
              // to learn which task someone was reading when they clicked.
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
