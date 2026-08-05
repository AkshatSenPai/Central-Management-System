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

/** §7:118 is the security boundary this function exists for: "`fileName`
 * is displayed but never used to build the key; the key uses a sanitised
 * copy. A file called `../../etc/passwd` is a display string, not a path."
 * Three passes, each catching what the others cannot:
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
 * 2. Collapse any surviving run of two-or-more dots to one. Step 1 only
 *    catches `..` when it is a whole `/`-delimited segment; a name with no
 *    slash at all — `"..secret.pdf"`, or the all-dots `"..."` — still
 *    carries the token when it reaches this step, so it is neutralised
 *    again here, on the raw string, rather than trusted to have been
 *    handled already.
 * 3. Replace anything outside `[A-Za-z0-9._-]` with `_`. This catches the
 *    rest — spaces, `?`, `*`, accented and non-Latin characters — and pins
 *    the result to plain ASCII, which matters because this string ends up
 *    in an R2 key and a download URL, not just a filesystem that might
 *    tolerate more.
 *
 * A leading dot is then stripped — nothing this produces should read as a
 * dotfile — and an empty result falls back to a fixed name: a key segment
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
  const dotsCollapsed = flattened.replace(/\.{2,}/g, ".");
  const asciiOnly = dotsCollapsed.replace(/[^A-Za-z0-9._-]/g, "_");
  const noLeadingDot = asciiOnly.replace(/^\.+/, "");
  return noLeadingDot || FALLBACK_FILE_NAME;
}

/** §6:109's key shape: `{parentType}/{parentId}/{id}/{sanitised filename}`
 * — always exactly four segments. `id` is an attachment's own cuid, and is
 * what §6 gives as the reason "knowing a task id is not enough to guess a
 * key": `parentId` alone is a small space that can look sequential, but a
 * cuid is not guessable from it. `fileName` is passed through
 * `sanitiseFileName` and only that result reaches the returned string — see
 * §7:118 — so a traversal-shaped name can occupy the fourth segment under a
 * different string but can never add or remove one. */
export function buildFileKey(
  parentType: AttachmentParentType,
  parentId: string,
  id: string,
  fileName: string
): string {
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
 * near the boundary. */
export function formatFileSize(bytes: number): string {
  if (bytes < KILOBYTE) return `${bytes} B`;
  if (bytes < MEGABYTE) return `${(bytes / KILOBYTE).toFixed(1)} KB`;
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
