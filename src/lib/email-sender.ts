/** The one place this app sends email.
 *
 * **Nothing here may be called from inside a database transaction.** `notify()`
 * writes bell rows inside the caller's transaction on purpose — that is what
 * stops a rolled-back comment telling somebody they were mentioned — but a
 * network call in that position holds a Postgres connection open on a third
 * party's latency, and an email sent inside a transaction that then rolls back
 * cannot be recalled. So this module is deliberately unreachable from
 * `*-service.ts`: services return what should be sent, and the Server Action
 * hands it here through `next/server`'s `after()`, once the write is durable.
 *
 * `after()` is what keeps the user's request fast: it schedules work to run
 * once the response has been sent, and on Vercel it extends the function's
 * lifetime via `waitUntil` so the send is not killed mid-flight.
 *
 * Plain `fetch`, not the `resend` SDK. This needs exactly one endpoint with a
 * bearer token — no request signing, no streaming, no pagination — so an SDK
 * would be a dependency to upgrade forever in exchange for nothing. The R2
 * integration takes the opposite view for the opposite reason: S3 request
 * signing is genuinely hard and worth a library.
 */

const ENDPOINT = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  /** Both bodies are always sent. A text part is not decoration: some clients
   * refuse HTML outright, and a message with no text alternative scores worse
   * with spam filters — which for invite mail is the difference between
   * arriving and not. */
  html: string;
  text: string;
};

export type EmailOutcome =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not-configured" | "rejected" | "unreachable"; detail?: string };

/** Email is configured only when both halves are present.
 *
 * The from-address is env rather than a constant because it is a decision the
 * owner can change without a deploy, and because a wrong one fails in the
 * least helpful way possible — Resend rejects any address whose domain is not
 * verified, so a hardcoded guess would look like a broken integration rather
 * than a misconfiguration. */
function config(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export function isEmailConfigured(): boolean {
  return config() !== null;
}

/** Sends one message, and **never throws**.
 *
 * Every failure path returns an outcome instead. This runs inside `after()`,
 * where an exception has nobody to catch it and no user to show it to — and
 * more importantly, the mutation that triggered it has already committed. A
 * task really was assigned; failing to say so by email must not turn into an
 * error the caller could mistake for the assignment failing.
 *
 * With no API key it is a no-op that logs. That is what lets the whole feature
 * be built and exercised locally before the key exists, and it means a missing
 * key in one environment cannot break invites in it — the invite link is still
 * shown on screen to copy by hand. */
export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  const settings = config();
  if (!settings) {
    console.info(
      `email: not configured (RESEND_API_KEY and EMAIL_FROM), skipping "${message.subject}" to ${message.to}`
    );
    return { sent: false, reason: "not-configured" };
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: settings.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      // The body carries Resend's reason — an unverified domain, a malformed
      // from-address, the daily cap. Logged in full because the alternative is
      // "email silently stopped working" with nothing to search for.
      const detail = await response.text().catch(() => "");
      console.error(`email: rejected (${response.status}) for ${message.to} — ${detail}`);
      return { sent: false, reason: "rejected", detail };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: body?.id ?? null };
  } catch (e) {
    // DNS failure, timeout, Resend down. The mutation already happened, so
    // this is worth a log and nothing more.
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`email: unreachable for ${message.to} — ${detail}`);
    return { sent: false, reason: "unreachable", detail };
  }
}
