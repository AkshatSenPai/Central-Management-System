/** Email bodies, as pure functions.
 *
 * No Prisma, no session, no `fetch` — a template takes plain values and
 * returns strings, so every one of them unit-tests without a database or a
 * network. `email.ts` is the only thing that sends.
 *
 * **Everything interpolated into HTML goes through `escapeHtml`.** These
 * messages carry member names, task titles and comment text, all of which are
 * written by people. An unescaped `<` from a task called "fix <div> overflow"
 * silently mangles the layout; an unescaped quote inside an attribute is worse.
 *
 * Deliberately plain HTML with inline styles and no images: `<style>` blocks
 * are stripped by several clients, external CSS never loads, and a remote
 * image both breaks on load-blocking and doubles as a tracking pixel — which
 * is the thing we turned off at the sending domain on purpose.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

/** The five characters that change meaning inside HTML.
 *
 * `&` must be replaced first or it would double-escape the entities the later
 * replacements introduce. Both quote forms are covered because these strings
 * are also interpolated into attributes. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const TEXT = "#1a1a1f";
const MUTED = "#5c5c6b";
const BORDER = "#e4e4e9";
const ACCENT = "#4b53c9";

/** One shell for every message, so they cannot drift into looking like mail
 * from three different companies.
 *
 * A table wrapper rather than a bare div: Outlook on Windows renders through
 * Word's engine, which ignores `max-width` on a div and would run the text the
 * full width of a maximised window. */
function shell(input: { heading: string; body: string; footer?: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f6f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f6f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;">
<tr><td style="padding:28px 28px 24px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0 0 18px 0;font-size:13px;font-weight:700;letter-spacing:-0.01em;color:${TEXT};">Meridian Ops</p>
<h1 style="margin:0 0 14px 0;font-size:19px;line-height:1.35;font-weight:600;color:${TEXT};">${input.heading}</h1>
${input.body}
</td></tr>
</table>
${
  input.footer
    ? `<p style="max-width:520px;margin:14px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.5;color:${MUTED};text-align:center;">${input.footer}</p>`
    : ""
}
</td></tr>
</table>
</body></html>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 14px 0;font-size:14.5px;line-height:1.6;color:${TEXT};">${html}</p>`;
}

/** A link styled as a button.
 *
 * The URL is also printed in full beneath it by every caller, because a button
 * is useless in a client that blocks HTML, and because a link somebody can see
 * before clicking is the honest way to send one. */
function button(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;"><tr><td style="background:${ACCENT};border-radius:8px;">
<a href="${safeHref}" style="display:inline-block;padding:10px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/** The invite. The one email whose failure has a visible fallback: the sender
 * still sees the link on screen to send by hand, which is exactly how invites
 * worked before this existed. */
export function inviteEmail(input: {
  inviteUrl: string;
  inviterName: string;
  expiresInDays: number;
}): RenderedEmail {
  const who = escapeHtml(input.inviterName);
  const days = input.expiresInDays;
  const dayWord = days === 1 ? "day" : "days";

  const html = shell({
    heading: "You have been invited to Meridian Ops",
    body: [
      paragraph(`${who} has invited you to join the studio's operations app.`),
      button(input.inviteUrl, "Accept the invite"),
      paragraph(
        `<span style="color:${MUTED};font-size:13px;">Or paste this into your browser:</span><br>` +
          `<a href="${escapeHtml(input.inviteUrl)}" style="font-size:12.5px;color:${ACCENT};word-break:break-all;">${escapeHtml(input.inviteUrl)}</a>`
      ),
    ].join("\n"),
    footer: `This invite expires in ${days} ${dayWord}. If you were not expecting it, you can ignore this email.`,
  });

  const text = [
    `${input.inviterName} has invited you to join Meridian Ops, the studio's operations app.`,
    ``,
    `Accept the invite:`,
    input.inviteUrl,
    ``,
    `This invite expires in ${days} ${dayWord}. If you were not expecting it, you can ignore this email.`,
  ].join("\n");

  return { subject: `${input.inviterName} invited you to Meridian Ops`, html, text };
}
