import { NextResponse } from "next/server";
import {
  getLastSync,
  getOverridesSnapshot,
  isIngestAuthorized,
  normalizeReceipt,
  recordReceipt,
} from "@/lib/overrides-server";

/** Debug/inspection GET — current overrides + receipt log, no UI needed. */
export async function GET() {
  return NextResponse.json({
    overrides: getOverridesSnapshot(),
    lastSync: getLastSync(),
  });
}

/**
 * POST /api/ingest/meters — batch variant of /api/ingest/receipt, for a
 * morning job that IMAP-fetches several `_PROJECTS` receipts at once and
 * wants to POST them in one request. Body: `{ "receipts": [...] }` (or a
 * bare array). Each item is validated independently; one bad item doesn't
 * fail the whole batch.
 */
export async function POST(request: Request) {
  if (!isIngestAuthorized(request.headers.get("x-deck-ingest-key"))) {
    return NextResponse.json(
      { error: "Invalid or missing x-deck-ingest-key." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const items = Array.isArray(body)
    ? body
    : Array.isArray((body as { receipts?: unknown } | null)?.receipts)
      ? (body as { receipts: unknown[] }).receipts
      : null;

  if (!items) {
    return NextResponse.json(
      { error: "Body must be { receipts: [...] } or a bare array of receipts." },
      { status: 400 }
    );
  }

  const results = items.map((item) => {
    const receipt = normalizeReceipt(item);
    if ("error" in receipt) {
      return { ok: false as const, error: receipt.error };
    }
    const { matched, meterId } = recordReceipt(receipt);
    return { ok: true as const, receipt, matched, meterId };
  });

  return NextResponse.json({
    ok: true,
    ingested: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    lastSync: getLastSync(),
  });
}
