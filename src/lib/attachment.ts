/** Pure attachment helpers — key shape, name sanitisation, and the
 * client-side size check the R2 upload pipeline is built on. This is the
 * only unit-testable surface the whole feature has: everything downstream
 * (Task 2's AWS SDK calls, Task 3's Server Actions, the upload component)
 * either wraps a real bucket or renders to a DOM this repo's tests cannot
 * mount. No Prisma import, no React import, no AWS import — every rule that
 * must not drift between what a caller sends R2 and what this file allows
 * through belongs here, in a function a plain fixture can exercise. */

/** Mirrors the `AttachmentParent` Prisma enum (schema.prisma:465) as a
 * string-literal union instead of importing it — this file takes no Prisma
 * import, the same rule `task.ts`'s `TaskStatus` follows for the `TaskStatus`
 * enum, so a test fixture here never needs a generated Prisma client to
 * exist. */
export const ATTACHMENT_PARENT_TYPES = ["TASK", "PROJECT", "CLIENT"] as const;
export type AttachmentParentType = (typeof ATTACHMENT_PARENT_TYPES)[number];

/** §6:110. 25 MB, written as the multiplication rather than the product so
 * a diff that changes one factor stays legible — `25 * 1024 * 1024` reads
 * as "25 megabytes" where `26214400` reads as a number nobody can eyeball
 * without a calculator. Enforced here (Task 1's `validateUpload`) and again
 * in the presigned URL's own content-length condition (Task 3): §6:110 says
 * a client-side check alone is advice, so this constant is not this file's
 * only reader, and this file is not the only gate. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const FALLBACK_FILE_NAME = "file";

/** Cloudflare R2 (and S3, which it mirrors) caps an object key at 1024 UTF-8
 * bytes total. This file's sanitised output is always plain ASCII — the
 * character-whitelist pass in `sanitiseFileName` guarantees it — so byte
 * length and JS string length are the same number here, no multi-byte
 * accounting required.
 *
 * 255 is the classic per-component filename limit most real filesystems
 * already enforce (ext4, NTFS, HFS+), so a name would typically have had to
 * fit inside it to exist on a normal disk in the first place — this picks
 * a limit that matches an existing convention rather than an arbitrary
 * shorter one invented for this file alone. It also leaves enormous
 * headroom in the 1024-byte key budget: `buildFileKey`'s other three
 * segments are `parentType` (<= 7 bytes, `"PROJECT"`), and two ids —
 * Prisma's default `cuid()` is 25 characters, and even a generous 64-byte
 * allowance for some future non-cuid id scheme — plus three `"/"`
 * separators, comfortably under 200 bytes together. That leaves well over
 * 500 bytes of slack even after this 255-byte cap, so the two limits are
 * nowhere near colliding. */
const MAX_FILENAME_BYTES = 255;

/** Truncates a name that is already ASCII-only and dot/slash-clean down to
 * `maxLength`, keeping the extension rather than the tail of the base name
 * — losing `"...Q4 Financial Summary (Final Draft, reviewed).pdf"`'s `.pdf`
 * to a blunt slice would turn a recognisable document into an untyped blob.
 * A trailing fragment is judged an "extension" only if it leaves a real
 * base before it and isn't implausibly long (`.pdf`, `.tar.gz`'s `.gz`,
 * yes; forty characters of no dots because the whole name was one long
 * word, no) — otherwise the cut falls at the very end, treating the name as
 * having no extension worth preserving. */
function truncateFileName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  const dotIndex = name.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && name.length - dotIndex <= 11;
  const extension = hasExtension ? name.slice(dotIndex) : "";
  const base = hasExtension ? name.slice(0, dotIndex) : name;
  const keptBaseLength = Math.max(maxLength - extension.length, 1);
  return `${base.slice(0, keptBaseLength)}${extension}`;
}

/** Collapses any run of two-or-more dots to one, then strips a leading or
 * trailing dot. Applied twice by `sanitiseFileName` below — once to the
 * freshly-flattened name, and again after truncation — because truncation
 * is itself a string cut, and a cut can recreate exactly the pattern the
 * first pass removed: slicing a base string like `"abc."` right before an
 * appended `".pdf"` would otherwise leave `"abc..pdf"`, reintroducing the
 * `..` this whole file exists to keep out. Trailing dots get the same
 * treatment as leading ones — Windows silently drops a trailing dot on
 * write, which makes a key ending in one a latent footgun for any tool
 * that materialises it, and there is no reason to treat that edge
 * differently from the leading one already being stripped. */
function collapseAndTrimDots(s: string): string {
  return s.replace(/\.{2,}/g, ".").replace(/^\.+|\.+$/g, "");
}

/** §7:118 is the security boundary this function exists for: "`fileName`
 * is displayed but never used to build the key; the key uses a sanitised
 * copy. A file called `../../etc/passwd` is a display string, not a path."
 *
 * 1. Fold `\` into `/` (so a Windows-shaped `"a\b.pdf"` gets the same
 *    treatment as `"a/b.pdf"`), split on `/`, and drop every segment that
 *    is exactly `""`, `"."` or `".."` before rejoining what is left with
 *    `"_"`. This is what turns `"../../etc/passwd"` into `"etc_passwd"`
 *    rather than a slash-free but still dot-littered string — dropping
 *    whole traversal segments keeps the parts of the name worth keeping
 *    legible, which a single blanket character filter cannot do, because
 *    `.` is itself a legal and common filename character and can't just be
 *    forbidden outright.
 * 2. Replace anything outside `[A-Za-z0-9._-]` with `_`. This catches
 *    spaces, `?`, `*`, accented and non-Latin characters, and pins the
 *    result to plain ASCII, which matters because this string ends up in
 *    an R2 key and a download URL, not just a filesystem that might
 *    tolerate more.
 * 3. `collapseAndTrimDots` — see its own comment. Step 1 only catches `..`
 *    when it is a whole `/`-delimited segment; a name with no slash at all
 *    — `"..secret.pdf"`, or the all-dots `"..."` — still carries the token
 *    when it reaches this step, so it is neutralised again here, on the
 *    raw string, rather than trusted to have been handled already.
 * 4. `truncateFileName` to `MAX_FILENAME_BYTES` (see its own comment for
 *    the 1024-byte R2 key budget this is sized against), then
 *    `collapseAndTrimDots` a second time — truncation is the one
 *    remaining step that can recreate a `..` or an edge dot at the cut
 *    boundary, so the same pass that guarantees the invariant the first
 *    time runs again after the one operation that could undo it.
 *
 * An empty result at the end falls back to a fixed name: a key segment
 * cannot be empty, and `sanitiseFileName("")` or `sanitiseFileName("...")`
 * would otherwise hand `buildFileKey` one. A hash was considered for that
 * fallback and rejected — the sanitised name is what a user sees in a
 * download URL, and "file" says more about a name that was thrown away
 * entirely than a hex string would. */
export function sanitiseFileName(name: string): string {
  const flattened = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .join("_");
  const asciiOnly = flattened.replace(/[^A-Za-z0-9._-]/g, "_");
  const trimmed = collapseAndTrimDots(asciiOnly);
  const truncated = truncateFileName(trimmed, MAX_FILENAME_BYTES);
  const final = collapseAndTrimDots(truncated);
  return final || FALLBACK_FILE_NAME;
}

/** `parentId` and `id` are meant to be strict identifiers — a Prisma row id
 * and this attachment's own server-generated cuid — never user-facing text
 * the way `fileName` is. `sanitiseFileName` exists because a display
 * string needs a readable fallback to clean up into; an id that fails this
 * check is not that. It is a bug in the caller: a lookup that returned the
 * wrong thing, a route param passed through unvalidated, the wrong
 * variable copy-pasted into the wrong argument. `validateEventTimes`
 * elsewhere in this repo makes the same call for the same reason — a
 * malformed value earns a rejection, not a guess at what was meant (see
 * `dates.ts`'s `parseTimeInput` comment on refusing `"25:99"` rather than
 * clamping it). Throwing here is that same refusal, aimed at a caller
 * instead of a user, so a bug surfaces immediately as a stack trace or a
 * failing test rather than as a key that silently points somewhere nobody
 * intended.
 *
 * Sanitising `parentId`/`id` the way `fileName` is sanitised was considered
 * and rejected: a "cleaned" `parentId` no longer matches the real row it
 * was supposed to identify, so the resulting key would still be wrong —
 * just wrong in a way nothing flags, instead of wrong in a way that fails
 * loudly the first time it happens. */
function assertSafeKeySegment(segment: string, label: string): void {
  if (segment.includes("/") || segment.includes("\\") || segment.includes("..")) {
    throw new Error(`buildFileKey: ${label} is not a safe key segment: ${JSON.stringify(segment)}`);
  }
}

/** §6:109's key shape: `{parentType}/{parentId}/{id}/{sanitised filename}`
 * — always exactly four segments. `id` is an attachment's own cuid, and is
 * what §6 gives as the reason "knowing a task id is not enough to guess a
 * key": `parentId` alone is a small space that can look sequential, but a
 * cuid is not guessable from it. `fileName` is passed through
 * `sanitiseFileName` and only that result reaches the returned string — see
 * §7:118 — so a traversal-shaped name can occupy the fourth segment under a
 * different string but can never add or remove one.
 *
 * `parentId` and `id` get no such rewriting — `assertSafeKeySegment` throws
 * instead, per its own comment above. The four-segment guarantee would
 * otherwise rest entirely on `parentType` being the only argument this
 * function actually defends, leaving `parentId` and `id` free to add
 * segments of their own if a future caller ever passes something
 * unvalidated through either. */
export function buildFileKey(
  parentType: AttachmentParentType,
  parentId: string,
  id: string,
  fileName: string
): string {
  assertSafeKeySegment(parentId, "parentId");
  assertSafeKeySegment(id, "id");
  return `${parentType}/${parentId}/${id}/${sanitiseFileName(fileName)}`;
}

const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;

/** Contract: below 1 KB, a whole-number byte count ("512 B"); at 1 KB and
 * above, one decimal place in the largest binary unit that is still >= 1
 * ("1.0 KB", "25.0 MB") — no GB tier, because nothing this app stores gets
 * near one; the size this function is most often printed next to is
 * `MAX_UPLOAD_BYTES` itself, 25 MB. Binary (1024-based) throughout, to match
 * how `MAX_UPLOAD_BYTES` is itself defined, rather than pairing a decimal
 * MB display with a binary constant and letting the two quietly disagree
 * near the boundary.
 *
 * The KB/MB decision is made on the *rounded* kilobyte value, not the raw
 * byte count: `1024 * 1024 - 1` bytes is a hair under 1 MB, but dividing by
 * 1024 and rounding to one decimal place first gives exactly `1024.0`,
 * which belongs in the MB tier ("1.0 MB") even though the unrounded byte
 * count is still technically below the MEGABYTE threshold. Comparing raw
 * bytes against that threshold would print `"1024.0 KB"` — a number that
 * reads as a full megabyte while claiming to still be kilobytes. */
export function formatFileSize(bytes: number): string {
  if (bytes < KILOBYTE) return `${bytes} B`;
  const roundedKb = Math.round((bytes / KILOBYTE) * 10) / 10;
  if (roundedKb < KILOBYTE) return `${roundedKb.toFixed(1)} KB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/** The client-side half of §6:110's twice-enforced 25 MB limit — "because a
 * client-side check alone is advice." The presigned URL's own
 * content-length condition (Task 3) is the enforcement; this is the early,
 * friendly rejection before a request is even made, so a user finds out
 * before waiting on a network round trip.
 *
 * The over-limit message states the limit but deliberately not the file's
 * own size. `formatFileSize` rounds to one decimal place, so a file one
 * byte over `MAX_UPLOAD_BYTES` prints identically to the limit itself
 * ("25.0 MB" on both sides of the message) — the one case where the
 * message matters most would read as the app contradicting itself
 * ("it says 25 MB and the limit is 25 MB — why won't it upload?"). Dropping
 * the actual size removes that collision by construction, rather than
 * chasing more decimal places that only push the same problem to a smaller
 * gap, and costs little: the user already knows roughly how big their own
 * file is from the picker they just used it in.
 *
 * Also rejects a zero-byte (and, defensively, negative) size on its own.
 * The spec is silent on this; the ruling is to reject. An accepted
 * zero-byte upload produces a row pointing at an empty object — nothing a
 * "download" (§2: "a file is a name, a size and a download") does anything
 * useful with — and zero is also the shape an unrelated form bug (nothing
 * chosen yet, size defaulting to 0) would produce, so rejecting turns that
 * into a clear message instead of a silent phantom attachment. Revisit only
 * if a real workflow needs a deliberate placeholder file — none does today. */
export function validateUpload(fileName: string, sizeBytes: number): string | null {
  if (sizeBytes <= 0) return `${fileName} is empty`;
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return `${fileName} is too large — the limit is ${formatFileSize(MAX_UPLOAD_BYTES)}`;
  }
  return null;
}
