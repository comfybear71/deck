import { NextResponse } from "next/server";
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
 * alone. More than one reference is still rejected (this app only ever
 * sends a single optional continuity/master still).
 *
 * Submit → poll → download → re-encode as a `data:` URL, same
 * submit/poll/download shape as `lib/comfyCloud.ts`'s LTX path, just
 * for a still instead of a video. Never claims to be live without a
 * key: no `SIRAY_API_KEY` returns the same honest `501`/`missing_api_key`
 * shape every other Skidmarks provider route uses.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PROMPT_LENGTH = 2000;
const POLL_DEADLINE_MS = 45_000;

function isReferenceDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,.+/.test(value);
}

interface GenerateStillSirayRequestBody {
  prompt?: unknown;
  referenceImageDataUrls?: unknown;
}

export async function POST(request: Request) {
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

  // Missing / non-array → treat as no references (t2i). Cap at one.
  const rawReferences = Array.isArray(body.referenceImageDataUrls) ? body.referenceImageDataUrls : [];
  if (rawReferences.length > 1) {
    return NextResponse.json(
      {
        error: "This route accepts at most one reference image (optional continuity / master still).",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }
  if (rawReferences.length === 1 && !isReferenceDataUrl(rawReferences[0])) {
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

  const dataUrl = `data:${downloadResult.contentType};base64,${Buffer.from(downloadResult.bytes).toString("base64")}`;
  return NextResponse.json({ dataUrl });
}
