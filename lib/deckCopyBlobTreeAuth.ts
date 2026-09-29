/**
 * ONE-OFF — remove together with `app/api/deck/admin/copy-blob-tree/`.
 *
 * Auth for the one-off copy route. Deck has no login and no owner/admin
 * auth of its own (the only key anywhere is `DECK_INGEST_KEY` for
 * `/api/ingest/*`, which isn't set in Vercel and fails open when unset),
 * and no new env var should be needed. So the route is unlocked by a
 * proof derived from a secret that is already there: the password in
 * Deck's own Neon connection string (`DATABASE_URL`, or
 * `DATABASE_URL_UNPOOLED` when that's the only one — exactly the string
 * `lib/db.ts` connects with).
 *
 * Why that secret: whoever knows the Deck database password can already
 * rewrite every Deck row directly, which is far more than this route's
 * one guarded update. The route's Blob side is a fixed, no-overwrite,
 * no-delete copy of the bundled plan. So the key adds no new power to
 * anyone who has it.
 *
 * The password itself never travels: the caller sends
 *   Authorization: Bearer <hex HMAC-SHA256(key = DB password, message = COPY_BLOB_TREE_PROOF_MESSAGE)>
 * and the server compares that (constant time) with its own. The proof
 * only unlocks this route, and dies with it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COPY_BLOB_TREE_PROOF_MESSAGE = "deck:copy-blob-tree:v1";

/** Password from a `postgres://user:password@host/db` string, or `null`. */
export function connectionPassword(connectionString: string | null | undefined): string | null {
  if (!connectionString) return null;
  try {
    const pw = decodeURIComponent(new URL(connectionString).password);
    return pw.length >= 8 ? pw : null;
  } catch {
    return null;
  }
}

/** The hex proof for a connection string, or `null` when it has no usable password. */
export function copyBlobTreeProof(connectionString: string | null | undefined): string | null {
  const pw = connectionPassword(connectionString);
  return pw ? createHmac("sha256", pw).update(COPY_BLOB_TREE_PROOF_MESSAGE).digest("hex") : null;
}

/**
 * `true` only when `authorization` is `Bearer <proof>` and matches the
 * proof for `connectionString`. Anything missing or malformed is `false`.
 */
export function isCopyBlobTreeAuthorized(authorization: string | null | undefined, connectionString: string | null | undefined): boolean {
  const expected = copyBlobTreeProof(connectionString);
  if (!expected || !authorization) return false;
  const m = /^Bearer\s+([0-9a-f]{64})\s*$/i.exec(authorization);
  if (!m) return false;
  const a = Buffer.from(m[1].toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
