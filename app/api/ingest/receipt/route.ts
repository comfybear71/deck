import { NextResponse } from "next/server";
import {
  getLastSync,
  isIngestAuthorized,
  normalizeReceipt,
  recordReceipt,
} from "@/lib/overrides-server";

/** Debug/inspection GET — what the ingest store currently thinks "last sync" is. */
export async function GET() {
  return NextResponse.json({ lastSync: getLastSync() });
}

/**
 * POST /api/ingest/receipt — ingest one receipt email's essentials
 * (vendor, amount, currency, date, subject, source) and merge it into the
 * meter overrides the UI reads. See the README's "Mail -> Tab" section for
 * the intended IMAP -> POST loop and a sample curl.
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

  const receipt = normalizeReceipt(body);
  if ("error" in receipt) {
    return NextResponse.json({ error: receipt.error }, { status: 400 });
  }

  const { matched, meterId } = recordReceipt(receipt);

  return NextResponse.json({
    ok: true,
    receipt,
    matched,
    meterId,
    lastSync: getLastSync(),
  });
}
