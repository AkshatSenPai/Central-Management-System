import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { describeActivity, listActivityForExport } from "@/lib/activity";
import { toCsv, csvFilename } from "@/lib/csv";
import { parseDateInput, toDateInputValue } from "@/lib/dates";

/** The activity export: a date range in, a CSV out.
 *
 * A Route Handler rather than a Server Action because the deliverable is a
 * *file*. An action returns a value to the client and would mean building a
 * Blob and synthesising a click; a GET handler lets the browser download it
 * natively, which also means the form works with JavaScript off.
 *
 * **Admin-only.** The dashboard already shows everyone a ten-row recent feed,
 * but a whole-history bulk export of who did what and when is a different
 * capability, and it is the one worth scoping.
 *
 * Reading `request.url` is what makes this dynamic — per the bundled Route
 * Handlers guide, touching request properties stops prerendering, which is
 * exactly right for a per-request query.
 */

const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function bad(message: string, status = 400): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return bad("Sign in first", 401);
  if (session.user.role !== "ADMIN") return bad("Admins only", 403);

  const params = new URL(request.url).searchParams;

  // parseDateInput refuses anything that is not YYYY-MM-DD rather than
  // guessing, so a tampered `from=lol` is a 400 and never a silent full-table
  // scan from the epoch.
  const from = parseDateInput(params.get("from") ?? "");
  const toDay = parseDateInput(params.get("to") ?? "");
  if (!from || !toDay) return bad("Give a from and to date, both as YYYY-MM-DD");

  // The `to` day is inclusive to the person filling the form — "1st to the
  // 7th" must contain the 7th — so the half-open query bound is the start of
  // the day after.
  const to = new Date(toDay.getTime() + DAY_MS);
  if (to <= from) return bad("The end date must not be before the start date");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    return bad(`Keep the range under ${MAX_RANGE_DAYS} days`);
  }

  const clientId = params.get("clientId") || null;
  const actorId = params.get("actorId") || null;

  const rows = await listActivityForExport(prisma, { from, to, clientId, actorId });

  const header = [
    "at_utc",
    "date",
    "time",
    "actor",
    "actor_id",
    "action",
    "description",
    "entity_type",
    "entity_id",
    "client",
    "client_id",
    "meta_json",
  ];

  const body = rows.map((r) => [
    r.at.toISOString(),
    // The app pins every day boundary to Asia/Kolkata, so a row's calendar
    // day here must match the day it appears under in the UI. A raw UTC date
    // would put anything after 18:30 IST on the previous day in the file.
    toDateInputValue(r.at),
    r.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
    r.actorName,
    r.actorId,
    r.action,
    describeActivity({ actorName: r.actorName, action: r.action, meta: r.meta }),
    r.entityType,
    r.entityId,
    r.clientName,
    r.clientId,
    // The raw blob alongside the rendered sentence. Flattening meta into
    // columns would be lossy — it is where task titles and file names live,
    // and its shape differs per action — so the sentence is the readable
    // version and this is the faithful one. Nothing is lost by exporting.
    r.meta ? JSON.stringify(r.meta) : null,
  ]);

  const name = csvFilename(
    `activity-${toDateInputValue(from)}_${toDateInputValue(toDay)}${clientId ? "-client" : ""}`
  );

  return new Response(toCsv(header, body), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      // An audit export must never be served from a cache — the next request
      // for the same range is a different set of rows.
      "cache-control": "no-store",
    },
  });
}
