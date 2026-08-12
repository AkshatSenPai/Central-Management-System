/** How long a free-text field may be, in one place.
 *
 * Seven schemas — task and project descriptions, client notes, calendar event
 * descriptions, announcement bodies, comments and feedback — each carried
 * their own literal `4000`. Seven copies of a number that only ever means
 * "one long piece of writing" is seven chances for them to drift, and drift
 * here is invisible until somebody's paste is refused by one form and
 * accepted by the next.
 *
 * **20,000 characters, up from 4,000.** Roughly 3,000 words. Nothing in the
 * database needs this: every one of these columns is Postgres `text`, which
 * has no practical limit, so the cap is purely a guard against a runaway
 * paste and a reminder that a description is not a document. The old 4,000
 * was reached in ordinary use — a task description with a pasted spec in it —
 * which is the definition of a limit set too low.
 *
 * It is not unlimited, and should not become so. These fields are rendered in
 * list rows and notification payloads, and an unbounded one turns a single
 * paste into a page nobody can scroll past.
 */
export const LONG_TEXT_MAX = 20_000;

/** Every capped field says the same thing when it is exceeded.
 *
 * Zod's default for `.max()` is "String must contain at most 20000
 * character(s)", which names a constraint rather than an action and reads
 * like a stack trace. Worse, most of these fields had no message at all and
 * no `maxLength` on the input, so the only signal was a form that refused to
 * save — see the note in `docs/` about the contract form's "Invalid input".
 * Naming the number is the difference between "try again" and "cut 200
 * words". */
export const LONG_TEXT_MESSAGE = `Keep it under ${LONG_TEXT_MAX.toLocaleString("en-GB")} characters`;
