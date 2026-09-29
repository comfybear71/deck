import { NextResponse } from "next/server";
import { listSkidmarksSessionBackups, restoreSkidmarksSessionBackup } from "@/lib/skidmarksSession-server";

/**
 * GET /api/skidmarks/session/backups lists past saves (newest first).
 * POST { id } puts one back, written as a new save on top so it can be
 * undone too. Backs the "Restore an earlier save" list (2026-09-30).
 */
export const runtime = "nodejs";

export async function GET() {
  const outcome = await listSkidmarksSessionBackups();
  if (!outcome.ok) {
    return NextResponse.json(outcome, { status: outcome.configured ? 502 : 200 });
  }
  return NextResponse.json(outcome);
}

export async function POST(request: Request) {
  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }
  const id = typeof body?.id === "number" && Number.isInteger(body.id) && body.id > 0 ? body.id : null;
  if (id === null) {
    return NextResponse.json({ ok: false, error: "Missing or malformed `id`." }, { status: 400 });
  }
  const outcome = await restoreSkidmarksSessionBackup(id);
  if (!outcome.ok) {
    const status = outcome.configured ? (outcome.error === "That earlier save wasn't found." ? 404 : 502) : 200;
    return NextResponse.json(outcome, { status });
  }
  return NextResponse.json({ ok: true, updatedAt: outcome.updatedAt, revision: outcome.revision });
}
