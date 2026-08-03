import { PlainText } from "@/components/ui/plain-text";
import type { Mentionable } from "@/lib/rich-text";

/** A comment body. The rendering itself lives in <PlainText>, shared with
 * client notes — see that file for why there is no HTML anywhere in this
 * path. This wrapper exists only to pin the comment's own type scale. */
export function CommentBody({
  body,
  members,
}: {
  body: string;
  members: readonly Mentionable[];
}) {
  return (
    <PlainText
      body={body}
      members={members}
      className="text-[13px] leading-[1.55] text-[var(--text-2)]"
    />
  );
}
