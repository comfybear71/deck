import { NextResponse } from "next/server";
import { loadSkidmarksSession, saveSkidmarksSession } from "@/lib/skidmarksSession-server";

/**
 * GET/PUT /api/skidmarks/session — the live edit session's Neon-backed
 * read/write endpoint (see `lib/skidmarksSession-server.ts`'s module
 * doc comment for the full picture: one durable row, keyed by a fixed
 * single-tenant owner id, full-replace on every write). Client side,
 * `lib/skidmarks.ts` calls `GET` once per page load (hydration) and
 * `PUT` on a short debounce after every local mutation (see that
 * module's doc comment for the race guards on both directions) — this
 * route itself is a thin, honest pass-through with no business logic
 * of its own beyond request-shape validation.
 *
 * **Never claims to be configured when it isn't** — same
 * `{ configured: false, error }` shape `app/api/skidmarks/archive/
 * route.ts`/`app/api/skidmarks/clip-renders/route.ts` already use for
 * an unconnected Vercel Blob store, not a bare 500. A `PUT` failure is
 * `{ ok: false, error }` instead — distinct wording, same honesty.
 */
export const runtime = "nodejs";

export async function GET() {
  const outcome = await loadSkidmarksSession();
  if (!outcome.configured) {
    return NextResponse.json({ configured: false, state: null, error: outcome.error });
  }
  return NextResponse.json({
    configured: true,
    state: outcome.state,
    updatedAt: outcome.updatedAt,
    revision: outcome.revision,
  });
}

interface SessionPutBody {
  state?: unknown;
  /** The `revision` this client last read from `GET` (or got back from
   * its own previous `PUT`). Present = conditional write: the save is
   * refused if the row has moved on since, so a device holding a stale
   * copy cannot silently overwrite newer work from another device.
   * Omitted = unconditional, the pre-2026-09-18 behaviour, kept only so
   * an older client build in a still-open tab keeps saving rather than
   * hard-failing on deploy. */
  expectedRevision?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function PUT(request: Request) {
  let body: SessionPutBody;
  try {
    body = (await request.json()) as SessionPutBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  if (!isPlainObject(body) || !isPlainObject(body.state)) {
    return NextResponse.json({ ok: false, error: "Missing or malformed `state`." }, { status: 400 });
  }

  const expectedRevision =
    typeof body.expectedRevision === "number" && Number.isFinite(body.expectedRevision)
      ? body.expectedRevision
      : undefined;

  const outcome = await saveSkidmarksSession(body.state, expectedRevision);
  if (!outcome.ok) {
    // A conflict is not a server fault and not worth retrying — the
    // client has to reconcile. `409` so that's unambiguous on the wire.
    if ("conflict" in outcome && outcome.conflict) {
      return NextResponse.json(
        {
          ok: false,
          conflict: true,
          configured: true,
          revision: outcome.revision,
          updatedAt: outcome.updatedAt,
          error: outcome.error,
        },
        { status: 409 }
      );
    }
    // `configured: false` (Neon not connected here) is an honest,
    // expected outcome, not a server error — 200, same as GET's own
    // `configured: false` shape. A real query failure after the
    // connection resolved (`configured: true`) is a genuine 502.
    return NextResponse.json(
      { ok: false, configured: outcome.configured, error: outcome.error },
      { status: outcome.configured ? 502 : 200 }
    );
  }

  return NextResponse.json({ ok: true, updatedAt: outcome.updatedAt, revision: outcome.revision });
}
