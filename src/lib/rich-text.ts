import { z } from "zod";

/** Comment bodies are plain text (spec 3c D1). Nothing in this file produces
 * HTML, or a string that will later be interpreted as HTML — it produces a
 * list of segments that the renderer turns into React elements, so React's
 * own escaping is the entire XSS story. There is deliberately nothing here to
 * sanitise, because there is nothing here to sanitise *against*.
 *
 * If someone ever adds markdown, this is the file that stops being safe by
 * construction, and the moment a sanitiser becomes mandatory. */

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Write something first").max(4000),
});

export type CommentInput = z.infer<typeof commentSchema>;

export type Mentionable = { id: string; name: string };

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "mention"; text: string; userId: string };

/** Matches a bare http(s) URL. Deliberately conservative: it stops at
 * whitespace and refuses common trailing punctuation, so "see https://x.com."
 * links the URL and leaves the full stop as text. */
const URL_RE = /https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/g;

/** Only http and https become links. A body containing `javascript:alert(1)`
 * renders as literal text — the scheme never reaches an href. This is belt and
 * braces: URL_RE cannot match it either. */
function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/** Longest name first, so "@Dana Reeve" wins over a hypothetical "@Dana"
 * rather than matching the short one and leaving " Reeve" as stray text.
 * Ties are broken by the member list's own order, which is alphabetical. */
function byNameLengthDesc(a: Mentionable, b: Mentionable): number {
  return b.name.length - a.name.length;
}

/** Finds the member mentioned at `index` (which must point at an "@"), or
 * null. Case-insensitive, because people do not capitalise reliably, and
 * bounded by a word edge so "@Dan" does not match member "Dana". */
function matchMentionAt(
  body: string,
  index: number,
  members: readonly Mentionable[]
): Mentionable | null {
  for (const m of members) {
    if (m.name.length === 0) continue;
    const candidate = body.slice(index + 1, index + 1 + m.name.length);
    if (candidate.toLowerCase() !== m.name.toLowerCase()) continue;
    // The character after the name must not be a word character, or "@Dana"
    // would match inside "@Danactive".
    const after = body[index + 1 + m.name.length];
    if (after !== undefined && /[\w'-]/.test(after)) continue;
    return m;
  }
  return null;
}

/** Splits a plain-text body into renderable segments.
 *
 * Mentions are resolved against the *live* member list rather than anything
 * stored on the comment, so renaming a member re-points their old mentions —
 * correct for an internal tool, where the question is "who is this" not "what
 * were they called in March".
 *
 * An "@Someone" who is not a member stays literal text. That is the honest
 * rendering: we did not record a mention, so we should not draw one.
 */
export function segmentBody(body: string, members: readonly Mentionable[]): TextSegment[] {
  const sorted = [...members].sort(byNameLengthDesc);
  const segments: TextSegment[] = [];
  let text = "";

  const flush = () => {
    if (text) segments.push({ kind: "text", text });
    text = "";
  };

  // URL positions are computed up front so the mention scan below can skip
  // them — without that, an "@" inside a query string would be read as a
  // mention and the URL would be torn in half.
  const urls = new Map<number, string>();
  for (const match of body.matchAll(URL_RE)) {
    if (match.index !== undefined) urls.set(match.index, match[0]);
  }

  let i = 0;
  while (i < body.length) {
    const url = urls.get(i);
    if (url) {
      flush();
      segments.push(
        isSafeHref(url)
          ? { kind: "link", text: url, href: url }
          : { kind: "text", text: url }
      );
      i += url.length;
      continue;
    }

    if (body[i] === "@") {
      const member = matchMentionAt(body, i, sorted);
      if (member) {
        flush();
        segments.push({
          kind: "mention",
          text: `@${body.slice(i + 1, i + 1 + member.name.length)}`,
          userId: member.id,
        });
        i += 1 + member.name.length;
        continue;
      }
    }

    text += body[i];
    i += 1;
  }

  flush();
  return segments;
}

/** The ids to store in `Comment.mentionedUserIds`.
 *
 * Deduplicated: mentioning someone three times in one comment is one mention,
 * and Phase 4 should not send three notifications for it. */
export function extractMentionedUserIds(body: string, members: readonly Mentionable[]): string[] {
  const ids = segmentBody(body, members)
    .filter((s): s is Extract<TextSegment, { kind: "mention" }> => s.kind === "mention")
    .map((s) => s.userId);
  return [...new Set(ids)];
}
