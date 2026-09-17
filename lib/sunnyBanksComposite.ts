/**
 * Server-side Sunny Banks shot-plate compositor — the Deck copy of
 * original Skidmarks Studio `plateCastIntoGen` (`src/lib/plateCast.ts`
 * + `generateFaceImage` in `src/lib/imageGen.ts`).
 *
 * Studio does **not** load a character onto a second Comfy node. The
 * LTX 2.3 IA2V graph has one LoadImage (`269`). Overlay is an xAI
 * Grok Imagine **edits** call with two reference images, then that
 * composed still is the plate uploaded to node `269` — same mapping
 * `src/lib/ltxCloudIa2v.ts` uses for `plateFile`.
 *
 * Server-only (fs). Do not import this from a client component.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSunnyBanksCompositePlatePrompt,
  getSunnyBanksLocation,
  resolveSunnyBanksStartImage,
  SUNNY_BANKS_DEFAULT_LOCATION_ID,
  SUNNY_BANKS_LOCATIONS,
  type SunnyBanksCharacterLock,
  type SunnyBanksLocationLock,
} from "@/lib/sunnyBanks";

const XAI_API_KEY_ENV_VAR = "XAI_API_KEY";
const XAI_IMAGE_MODEL_ENV_VAR = "XAI_IMAGE_MODEL";
const XAI_EDITS_URL = "https://api.x.ai/v1/images/edits";
const DEFAULT_XAI_IMAGE_MODEL = "grok-imagine-image-2.0";
const UPSTREAM_TIMEOUT_MS = 55_000;
const SUNNYBANKS_PUBLIC_PREFIX = "/skidmarks/sunnybanks/";

export type SunnyBanksCompositeOutcome =
  | { ok: true; dataUrl: string }
  | { ok: false; status: number; code: string; error: string };

function resolveXaiApiKey(): string | null {
  return process.env[XAI_API_KEY_ENV_VAR] || null;
}

function resolveXaiImageModel(): string {
  return process.env[XAI_IMAGE_MODEL_ENV_VAR] || DEFAULT_XAI_IMAGE_MODEL;
}

function mimeForExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function extractXaiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const err = (payload as { error?: unknown }).error;
  if (typeof err === "string") return err || null;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    return typeof message === "string" && message ? message : null;
  }
  return null;
}

function classifyXaiFailure(upstreamStatus: number): { httpStatus: number; code: string } {
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return { httpStatus: upstreamStatus, code: "auth_error" };
  }
  if (upstreamStatus === 429) return { httpStatus: 429, code: "rate_limited" };
  if (upstreamStatus === 402) return { httpStatus: 402, code: "payment_required" };
  if (upstreamStatus === 400 || upstreamStatus === 422) {
    return { httpStatus: 422, code: "invalid_request" };
  }
  return { httpStatus: 502, code: "upstream_error" };
}

/** Read a locked Sunny Banks public still as a data URL. Rejects any
 * path outside `public/skidmarks/sunnybanks/` so a body field cannot
 * point this at an arbitrary file. */
export async function readSunnyBanksPublicImageDataUrl(publicPath: string): Promise<string | null> {
  if (!publicPath.startsWith(SUNNYBANKS_PUBLIC_PREFIX)) return null;
  if (publicPath.includes("..")) return null;
  const abs = path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
  try {
    const bytes = await readFile(abs);
    return `data:${mimeForExt(abs)};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function resolveLocationLock(locationId: string): SunnyBanksLocationLock {
  return getSunnyBanksLocation(locationId) ?? SUNNY_BANKS_LOCATIONS[SUNNY_BANKS_DEFAULT_LOCATION_ID];
}

/**
 * Overlay the locked character hero onto the location canvas.
 * `locationDataUrl` is Image 1 (`startImageDataUrl` from the panel).
 * Image 2 is `resolveSunnyBanksStartImage` (hero card, never the sheet).
 * Returns the composed still that LTX node `269` should animate.
 *
 * A character with no plate (Hans today) is a skip, not a guess —
 * callers keep the location canvas as-is.
 */
export async function compositeSunnyBanksCharacterOntoLocation(opts: {
  locationDataUrl: string;
  character: SunnyBanksCharacterLock;
  locationId?: string;
}): Promise<SunnyBanksCompositeOutcome | { ok: true; dataUrl: string; skipped: true }> {
  const heroPath = resolveSunnyBanksStartImage(opts.character);
  if (!heroPath) {
    return { ok: true, dataUrl: opts.locationDataUrl, skipped: true };
  }

  const apiKey = resolveXaiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 501,
      code: "missing_api_key",
      error:
        `${XAI_API_KEY_ENV_VAR} is not set on the server — Sunny Banks plating (xAI Grok Imagine) is ` +
        "unavailable here. LTX will not run without a composed plate.",
    };
  }

  const heroDataUrl = await readSunnyBanksPublicImageDataUrl(heroPath);
  if (!heroDataUrl) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      error: `Could not load ${opts.character.name}'s hero still (${heroPath}).`,
    };
  }

  const location = resolveLocationLock(opts.locationId ?? "");
  const prompt = buildSunnyBanksCompositePlatePrompt(opts.character, location);

  // Same two-image edits payload Studio's generateFaceImage sends
  // (`images: [{ url, type: "image_url" }, …]` — location then person).
  const body: Record<string, unknown> = {
    model: resolveXaiImageModel(),
    prompt,
    response_format: "b64_json",
    images: [
      { url: opts.locationDataUrl, type: "image_url" },
      { url: heroDataUrl, type: "image_url" },
    ],
  };

  let res: Response;
  try {
    res = await fetch(XAI_EDITS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      code: timedOut ? "timeout" : "network_error",
      error: timedOut
        ? `xAI's Grok Imagine API did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
        : `Could not reach xAI's Grok Imagine API: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled by the !res.ok / no-image checks below.
  }

  if (!res.ok) {
    const message = extractXaiErrorMessage(payload);
    const { httpStatus, code } = classifyXaiFailure(res.status);
    return {
      ok: false,
      status: httpStatus,
      code,
      error: `xAI Grok Imagine returned ${res.status}${message ? `: ${message}` : "."}`,
    };
  }

  const successBody = (payload ?? {}) as { data?: unknown };
  const first = Array.isArray(successBody.data)
    ? (successBody.data[0] as Record<string, unknown> | undefined)
    : undefined;
  const b64 = first && typeof first.b64_json === "string" ? first.b64_json : null;
  if (b64) {
    const mimeType = first && typeof first.mime_type === "string" ? first.mime_type : "image/jpeg";
    return { ok: true, dataUrl: `data:${mimeType};base64,${b64}` };
  }

  return {
    ok: false,
    status: 502,
    code: "no_image",
    error: "xAI Grok Imagine succeeded but returned no image data.",
  };
}
