import { NextResponse } from "next/server";
import { buildGrokPrompt, normalizeAskInput } from "@/lib/deck-ask";
import { getRecentAsks, recordAsk } from "@/lib/deck-ask-server";

/** Debug/inspection GET — recent queued asks, optionally `?project=` filtered and `?limit=` capped. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get("project") ?? undefined;
  const limitParam = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 200)
      : 50;

  return NextResponse.json({ asks: getRecentAsks(limit, project) });
}

/**
 * POST /api/deck/ask — queue one "Ask Grok" request from a graph node's
 * detail sheet (Propfolio's `AskGrokPanel` for now; the shape is generic
 * enough for other project nodes later — see the README's "Ask Grok (v0
 * stub)" section). Stores it via `lib/deck-ask-server.ts` and returns a
 * ready-to-paste prompt for Grok Bot (QA Engineer). This route never calls
 * Grok itself — it's a queue + copy-prompt, deliberately not a live
 * `grokbot://` compose deep link or an outbound API call.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = normalizeAskInput(body);
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const ask = recordAsk(input);
  const prompt = buildGrokPrompt(ask);

  return NextResponse.json({ ok: true, ask, prompt });
}
