/** The R2 client and the three presigning operations the attachment
 * pipeline is built on: `presignPut`, `presignGet`, `deleteObjects`. This
 * file wraps `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` against
 * Cloudflare R2's S3-compatible API and has no logic of its own beyond that
 * wrapping — no Prisma import, no React import, matching `attachment.ts`'s
 * rule that the pure/tested layer and the third-party-service layer never
 * mix in one file.
 *
 * Deliberately untested. Every function here either asks the AWS SDK to
 * build a signed URL or asks R2 to delete objects — a test would have to
 * mock the SDK to run offline, at which point it asserts "the mock was
 * called with these arguments," not that R2 actually accepts the URL. The
 * real verification is a browser pass: upload a file, confirm the object
 * lands in the bucket, download it back through a presigned GET, delete it,
 * confirm it's gone. */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** §7:116: both the upload URL and the download URL expire in 5 minutes.
 * One constant for both, not two copies of `5 * 60`, because the spec gives
 * a single number for "presigned URLs" and letting PUT and GET drift apart
 * later would be an accident, not a decision. */
const PRESIGN_EXPIRY_SECONDS = 5 * 60;

/** Reads one required env var, throwing a message that names the variable
 * — never its value, so a thrown error can never leak a credential — and
 * says what to do about it. Mirrors `src/lib/prisma.ts`'s
 * `DATABASE_URL` check for the same reason: an `S3Client` built with
 * `undefined` credentials does not fail here, it fails minutes from now on
 * the first real request, with a signature-mismatch error that points
 * nowhere near a missing env var. Failing at module load, by name, is what
 * turns that into a one-line fix instead of a debugging session. */
function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local (see R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) with the values from the Cloudflare R2 dashboard.`
    );
  }
  return value;
}

interface R2Handle {
  client: S3Client;
  bucket: string;
}

/** R2 has no region — object storage is global per account, and the SDK's
 * `region` field exists only because the S3 API shape requires one. `"auto"`
 * is R2's own documented value for it, not a guess at an AWS region name
 * that happens to work, so it is a literal here rather than a fifth env var
 * nobody would ever set to anything else.
 *
 * `requestChecksumCalculation`/`responseChecksumValidation` are pinned to
 * `"WHEN_REQUIRED"` rather than left at the SDK's default
 * (`"WHEN_SUPPORTED"`). Verified by decoding an actual presigned PUT URL:
 * left at the default, `getSignedUrl` adds `x-amz-checksum-crc32` and
 * `x-amz-sdk-checksum-algorithm` query parameters computed against
 * *this command's* (bodyless, at presign time) payload — i.e. the CRC32 of
 * nothing. Cloudflare R2 documents S3 request checksum validation for
 * uploads it receives, so a browser PUT of any real, non-empty file would
 * then carry a checksum hint that no longer matches the bytes actually
 * sent, and no one on the browser side has a way to recompute it — the SDK
 * that could is over on the server, and never sees the body either.
 * `"WHEN_REQUIRED"` stops the SDK from attaching a checksum unless a command
 * explicitly asks for one, which none here do. */
function createR2Client(accountId: string, accessKeyId: string, secretAccessKey: string): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function createR2Handle(): R2Handle {
  const accountId = readEnv("R2_ACCOUNT_ID");
  const accessKeyId = readEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("R2_SECRET_ACCESS_KEY");
  const bucket = readEnv("R2_BUCKET");
  return { client: createR2Client(accountId, accessKeyId, secretAccessKey), bucket };
}

// Same module-level-singleton shape as `src/lib/prisma.ts`: cached on
// `globalThis` outside production so a dev-mode hot reload reuses the one
// client instead of constructing (and re-validating env for) a fresh one
// on every edit.
const globalForR2 = globalThis as unknown as { r2?: R2Handle };
const r2 = globalForR2.r2 ?? createR2Handle();
if (process.env.NODE_ENV !== "production") globalForR2.r2 = r2;

/** Presigns a PUT for a direct browser-to-R2 upload (§6: routing bytes
 * through a Server Action would hit Next's body limits and burn server
 * memory on a file the server has no reason to see).
 *
 * §7:117 requires the URL be "bound to the exact key, content-type and
 * content-length the client declared, so it cannot be reused to write
 * something else." Two different mechanisms make that true, confirmed by
 * decoding the `X-Amz-SignedHeaders` query parameter of an actual signed
 * URL this function produced:
 *
 * - **content-length**: signed for free. `ContentLength` on the command
 *   becomes a `Content-Length` header on the underlying request, and
 *   `@aws-sdk/s3-request-presigner`'s `S3RequestPresigner` does not treat
 *   that header as unsignable, so it lands in `X-Amz-SignedHeaders`
 *   (`content-length;host`) with no extra option. This is the enforcement
 *   half of §6:110's 25 MB cap — `validateUpload` (Task 1) is the advice
 *   half, and a client that lies to this half about size gets a signature
 *   that only matches the size it declared here, not whatever it actually
 *   sends.
 * - **content-type**: signed only on request. `S3RequestPresigner`
 *   unconditionally adds `"content-type"` to its `unsignableHeaders` set —
 *   read straight from the installed package's `presigner.js`, not
 *   guessed — so by default `getSignedUrl` leaves it out of
 *   `X-Amz-SignedHeaders` entirely and a client could PUT any content-type
 *   through an unmodified URL. `@smithy/types`' `RequestSigningArguments`
 *   documents `signableHeaders` as the override: "values passed here
 *   override those provided via unsignableHeaders, allowing them to be
 *   signed." Passing `signableHeaders: new Set(["content-type"])` below is
 *   what moves it into `X-Amz-SignedHeaders`
 *   (`content-length;content-type;host`) — verified by constructing a real
 *   `PutObjectCommand` against a fake endpoint and decoding the resulting
 *   URL's query string with and without this option. */
export async function presignPut(input: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: r2.bucket,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
  });
  return getSignedUrl(r2.client, command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    signableHeaders: new Set(["content-type"]),
  });
}

/** Presigns a GET for one download click. The bucket is private and stays
 * private (§6/§7) — this is the only way a stored file is ever read, so a
 * URL is minted fresh per click rather than cached: caching one would just
 * be caching a capability that outlives the click that asked for it, right
 * up until its 5-minute expiry. */
export async function presignGet(input: { key: string }): Promise<string> {
  const command = new GetObjectCommand({ Bucket: r2.bucket, Key: input.key });
  return getSignedUrl(r2.client, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

/** S3's (and R2's, which mirrors the API) `DeleteObjects` accepts at most
 * 1000 keys per call — a hard API limit, not a performance suggestion.
 * `deleteObjects` is used both for a single attachment (always 1 key) and
 * Task 6's parent-delete sweeps (every attachment under a deleted task,
 * project or client, which is unbounded by anything this function can see),
 * so the batching lives here rather than at either call site: both callers
 * get the 1000-key guarantee for free instead of one of them quietly
 * assuming a small N because it usually is one. */
const DELETE_BATCH_LIMIT = 1000;

/** Thrown by `deleteObjects` on any failure. A plain `Error` subclass, not a
 * new shape — every existing catch (`instanceof Error`, `.message`) keeps
 * working unchanged — but it adds `failedKeys`, added for
 * `deleteAttachmentObjectsFor` (`attachment-service.ts`), which needs to log
 * exactly which objects survived a partial sweep failure rather than
 * parsing them back out of a human-readable message string.
 *
 * `failedKeys` is populated only for a *confirmed* per-key refusal — R2
 * responded and named exactly which keys it would not delete. It is
 * `undefined` for the other throw below, where a batch's `send()` call
 * itself failed: in that case R2's own response, the only source of truth
 * for which keys in that batch actually committed, never arrived at all,
 * and inventing a list would misreport an unknown outcome as a known one —
 * the same distinction this function's own doc comment already draws
 * between the two failure shapes, now carried on the error instead of only
 * in prose. */
export class R2DeleteObjectsError extends Error {
  readonly failedKeys?: string[];

  constructor(message: string, failedKeys?: string[], options?: ErrorOptions) {
    super(message, options);
    this.name = "R2DeleteObjectsError";
    this.failedKeys = failedKeys;
  }
}

/** Deletes every object at `keys`. Returns early on an empty array — the
 * common case for a task with no attachments — rather than sending R2 a
 * `DeleteObjects` call with zero `Objects`, which is a wasted round trip
 * for a request that has nothing to do.
 *
 * Batches are sent one at a time, not via `Promise.all`, but — this is the
 * point a prior version of this function got wrong — every batch is still
 * attempted. Throwing out of the loop as soon as one batch reported a
 * per-key failure meant a 2,500-key sweep with two bad keys in batch 1
 * never even tried batches 2 and 3: the caller learned "something failed"
 * while 1,500 deletable objects sat untouched and unretried. §6:111 calls
 * this exact path "the one place where a missed code path silently leaks
 * storage" — stopping early was itself a missed code path, just one this
 * file introduced instead of a caller. Failures are now collected across
 * every batch and reported once at the end, so the thrown message can say
 * how many of the total actually failed rather than how many were merely
 * never tried.
 *
 * `Quiet: true` asks R2 to report only failures. The default (`false`)
 * returns a `Deleted` entry for every key that succeeded — a list this
 * function has no reader for, since success is the silent case and failure
 * is the one worth collecting. A partial failure — R2 accepts the request
 * but refuses some keys — is not silently swallowed: `Errors` is still
 * populated in quiet mode, and every key named there is added to a running
 * list rather than causing an immediate throw, so the batch after it still
 * gets its turn.
 *
 * A batch whose `send()` call itself throws (a network failure, a timeout,
 * an unreachable R2) is handled differently from a per-key `Errors` entry,
 * deliberately: it aborts the whole sweep immediately rather than
 * continuing to the next batch. Reasoning:
 * - A per-key error is a *known, bounded* outcome — R2 responded, named
 *   exactly which keys it refused, and every other key in that batch is
 *   confirmed gone. The next batch is an independent request against the
 *   same still-reachable service and has every reason to succeed on its
 *   own merits.
 * - A thrown `send()` is an *unknown* outcome for that entire batch — the
 *   request may have failed before R2 saw it, or R2 may have processed it
 *   and the response never arrived; this function cannot tell which keys
 *   in that batch, if any, were actually deleted. Folding that ambiguity
 *   into the same "confirmed failed" list as a real per-key `Errors` entry
 *   would misreport it.
 * - If the cause is systemic (R2 unreachable, credentials rejected), every
 *   later batch is likely to fail the same way for the same reason, so
 *   attempting them buys nothing but N more multi-second timeouts stacked
 *   in sequence — and this function is called synchronously from a Server
 *   Action sweeping a deleted task/project/client (§6:111), which has its
 *   own execution-time budget. Running out that budget mid-loop fails the
 *   whole request anyway, just without a clean thrown `Error` the caller
 *   could have caught — worse than failing fast with one. */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  const failedKeys: string[] = [];
  let attempted = 0;

  for (let start = 0; start < keys.length; start += DELETE_BATCH_LIMIT) {
    const batch = keys.slice(start, start + DELETE_BATCH_LIMIT);
    let result;
    try {
      result = await r2.client.send(
        new DeleteObjectsCommand({
          Bucket: r2.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        })
      );
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      const remaining = keys.length - attempted - batch.length;
      // No `failedKeys` here, deliberately — see the class's own doc
      // comment. This batch's outcome is unknown, not confirmed-failed.
      throw new R2DeleteObjectsError(
        `deleteObjects: request to R2 failed before it responded (${reason}). ` +
          `${attempted} of ${keys.length} object(s) were attempted before this batch ` +
          `(${failedKeys.length} confirmed failed so far); this batch's ${batch.length} ` +
          `object(s) have an unknown outcome, and ${remaining} were never attempted.`,
        undefined,
        { cause }
      );
    }
    attempted += batch.length;
    if (result.Errors && result.Errors.length > 0) {
      for (const error of result.Errors) failedKeys.push(error.Key ?? "(unknown key)");
    }
  }

  if (failedKeys.length > 0) {
    throw new R2DeleteObjectsError(
      `deleteObjects: R2 refused to delete ${failedKeys.length} of ${keys.length} requested object(s): ${failedKeys.join(", ")}`,
      failedKeys
    );
  }
}
