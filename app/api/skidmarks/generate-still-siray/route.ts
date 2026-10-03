import { NextResponse } from "next/server";
import { staleDeckPageResponse } from "@/lib/deckBuildServer";
import { parseDeckMediaTarget, type DeckMediaTarget } from "@/lib/deckMediaPaths";
import { putDeckMediaOrLegacy } from "@/lib/deckMediaPut";
import {
  resolveSirayCredentials,
  siraySubmitStillImage,
  sirayPollStillImage,
  sirayDownloadStill,
} from "@/lib/sirayClient";

/**
 * POST /api/skidmarks/generate-still-siray — the server half of the
 * Seedance/"17 positions" upgrade to Auto-plate (`lib/autoPlate.ts`,
 * `lib/sirayPositions.ts`). Given one character's locked master
 * reference still + a real camera-position prompt, calls Siray's
 * Seedream 4.5 ref2i-spicy model (`lib/sirayClient.ts`) and returns a
 * new, on-character angle — same `{ dataUrl }` success shape as
 * `app/api/skidmarks/generate-still/route.ts`'s xAI path, so the two
 * are interchangeable to every caller above `lib/plateGeneration.ts`.
 *
 * **Zero or one reference image.** With one reference this calls Siray's
 * Seedream 4.5 ref2i-spicy (same Auto-plate path as before). With zero
 * references it calls Seedream 4.5 t2i-spicy — text-to-image, no
 * reference — so a per-clip "Siray" still can run from the shot prompt
 * alone. Since 2026-09-30 up to four references are accepted: a Shorts
 * shot with more than one person in it sends one picture of each (in
 * the order its prompt names them). Every other caller still sends one.
 *
 * Submit → poll → download → re-encode as a `data:` URL, same
 * submit/poll/download shape as `lib/comfyCloud.ts`'s LTX path, just
 * for a still instead of a video. Never claims to be live without a
 * key: no `SIRAY_API_KEY` returns the same honest `501`/`missing_api_key`
 * shape every other Skidmarks provider route uses.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PROMPT_LENGTH = 2000;
/** One picture per person in a Shorts shot (`ADULT_SHORTS_MAX_PEOPLE_PER_SHOT`). */
const MAX_REFERENCES = 4;
// Seedream 4.5 at 2048² sometimes takes over a minute (live 2026-09-24: clip 10 still in_progress at 45s).
const POLL_DEADLINE_MS = 240_000;

function isReferenceDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,.+/.test(value);
}

interface GenerateStillSirayRequestBody {
  prompt?: unknown;
  referenceImageDataUrls?: unknown;
  /** Optional `{ folder, name }` in the readable `deck/` tree
   * (`lib/deckMediaPaths.ts`). Off-shape or missing → the old
   * `skidmarks/plate-stills/siray-…` path. */
  mediaTarget?: unknown;
}

export async function POST(request: Request) {
  const stalePage = staleDeckPageResponse(request);
  if (stalePage) return stalePage;
  const creds = resolveSirayCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "SIRAY_API_KEY is not set on the server — the Seedance angle-generation path is unavailable here. " +
          "Create a key at console.siray.ai/keys and set it as this project's SIRAY_API_KEY. If you just added " +
          "it, Vercel only applies environment variable changes to new deployments — redeploy the project for " +
          "this function to see it.",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  let body: GenerateStillSirayRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body with a `prompt` string.", code: "invalid_request" },
      { status: 400 }
    );
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Missing `prompt`.", code: "invalid_request" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt is too long — over ${MAX_PROMPT_LENGTH} characters.`, code: "invalid_request" },
      { status: 400 }
    );
  }

  // Missing / non-array → treat as no references (t2i). Up to four: one
  // per person in a Shorts shot (2026-09-30); every other caller sends one.
  const rawReferences = Array.isArray(body.referenceImageDataUrls) ? body.referenceImageDataUrls : [];
  if (rawReferences.length > MAX_REFERENCES) {
    return NextResponse.json(
      {
        error: `This route accepts at most ${MAX_REFERENCES} reference images (one per person in the shot).`,
        code: "invalid_request",
      },
      { status: 400 }
    );
  }
  if (!rawReferences.every(isReferenceDataUrl)) {
    return NextResponse.json(
      { error: "The reference image must be a `data:image/...;base64,...` URL.", code: "invalid_request" },
      { status: 400 }
    );
  }

  const submitResult = await siraySubmitStillImage(prompt, rawReferences, creds);
  if (!submitResult.ok) {
    return NextResponse.json({ error: submitResult.error, code: submitResult.code }, { status: submitResult.status });
  }

  const pollResult = await sirayPollStillImage(submitResult.taskId, creds, POLL_DEADLINE_MS);
  if (!pollResult.ok) {
    return NextResponse.json({ error: pollResult.error, code: pollResult.code }, { status: pollResult.status });
  }

  const downloadResult = await sirayDownloadStill(pollResult.outputUrl);
  if (!downloadResult.ok) {
    return NextResponse.json({ error: downloadResult.error, code: downloadResult.code }, { status: downloadResult.status });
  }

  // 2026-09-24: a 2048² Seedream PNG as base64 is several MB. Shipping
  // that to the phone and holding it in the session crashed Stuart's
  // Generate plates run mid-way and lost every plate. Save it to Blob
  // server-side and return the small https URL instead; fall back to the
  // data: URL only when no Blob store is connected.
  const saved = await saveStillToBlob(
    downloadResult.bytes,
    downloadResult.contentType,
    parseDeckMediaTarget(body.mediaTarget),
  );
  if (saved) return NextResponse.json({ dataUrl: saved, url: saved });

  const dataUrl = `data:${downloadResult.contentType};base64,${Buffer.from(downloadResult.bytes).toString("base64")}`;
  return NextResponse.json({ dataUrl });
}

async function saveStillToBlob(
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
  target: DeckMediaTarget | null,
): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const legacyPathname = `skidmarks/plate-stills/siray-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  try {
    const blob = await putDeckMediaOrLegacy(Buffer.from(bytes as ArrayBuffer), {
      target,
      ext,
      contentType,
      legacyPathname,
    });
    return blob.url;
  } catch {
    return null;
  }
}
