import { NextResponse } from "next/server";
import { deleteDeckItem, listDeckItems, putDeckItem, type DeckItemsFailure, type WriteDeckItemOutcome } from "@/lib/deckItems-server";
import { isDeckItemKind, isValidDeckItemId } from "@/lib/deckItems";

/**
 * GET/PUT/DELETE /api/deck/items — per-item saving (step 1: characters).
 * See `lib/deckItems.ts` and `lib/deckItems-server.ts`.
 *
 * - `GET ?kind=character` → the live items with their revisions, plus
 *   tombstones for deleted ones and whether the seed has run.
 * - `PUT { kind, itemId, expectedRevision, data }` → saves one item if it
 *   is still at `expectedRevision` (0 = new). 409 with the server's copy
 *   otherwise.
 * - `DELETE ?kind=character&itemId=…&expectedRevision=…` → soft delete.
 *   Only ever sent from a real delete tap.
 *
 * Same auth and owner handling as `/api/skidmarks/session` (no login;
 * one fixed studio owner). When the tables haven't been created yet this
 * answers 503 `tableMissing: true` and the client keeps saving the old
 * way; nothing here ever creates a table.
 */
export const runtime = "nodejs";

function failureResponse(outcome: DeckItemsFailure) {
  switch (outcome.reason) {
    case "unconfigured":
      return NextResponse.json({ ok: false, configured: false, ready: false, error: outcome.error });
    case "table-missing":
      return NextResponse.json(
        { ok: false, configured: true, ready: false, tableMissing: true, error: outcome.error },
        { status: 503 },
      );
    case "invalid":
      return NextResponse.json({ ok: false, error: outcome.error }, { status: 400 });
    default:
      return NextResponse.json({ ok: false, configured: true, error: outcome.error }, { status: 502 });
  }
}

function writeResponse(outcome: WriteDeckItemOutcome) {
  if (outcome.ok) return NextResponse.json({ ok: true, item: outcome.item });
  if ("conflict" in outcome) {
    return NextResponse.json(
      {
        ok: false,
        conflict: true,
        item: outcome.item,
        error: "Not saved: this item changed on the server since this device last saw it. The server's copy wins.",
      },
      { status: 409 },
    );
  }
  if ("notFound" in outcome) return NextResponse.json({ ok: false, notFound: true, error: "No such item." }, { status: 404 });
  return failureResponse(outcome);
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  if (!isDeckItemKind(kind)) return badRequest("Unknown or missing `kind`.");
  const outcome = await listDeckItems(kind);
  if (!outcome.ok) return failureResponse(outcome);
  return NextResponse.json({
    ok: true,
    configured: true,
    ready: true,
    seeded: outcome.seeded,
    items: outcome.items,
    deleted: outcome.deleted,
  });
}

interface PutBody {
  kind?: unknown;
  itemId?: unknown;
  expectedRevision?: unknown;
  data?: unknown;
}

export async function PUT(request: Request) {
  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return badRequest("Expected a JSON body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Expected a JSON object.");
  if (!isDeckItemKind(body.kind)) return badRequest("Unknown or missing `kind`.");
  if (!isValidDeckItemId(body.itemId)) return badRequest("Missing or malformed `itemId`.");
  const expectedRevision = body.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return badRequest("`expectedRevision` is required: the revision this device last saw, or 0 for a new item.");
  }
  return writeResponse(await putDeckItem(body.kind, body.itemId, body.data, expectedRevision));
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const itemId = params.get("itemId");
  if (!isDeckItemKind(kind)) return badRequest("Unknown or missing `kind`.");
  if (!isValidDeckItemId(itemId)) return badRequest("Missing or malformed `itemId`.");
  const rawRevision = params.get("expectedRevision");
  let expectedRevision: number | undefined;
  if (rawRevision !== null) {
    expectedRevision = Number(rawRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return badRequest("Malformed `expectedRevision`.");
  }
  return writeResponse(await deleteDeckItem(kind, itemId, expectedRevision));
}
