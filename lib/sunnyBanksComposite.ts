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
  missingCastPictureMessage,
  resolveSunnyBanksStartImage,
  type SunnyBanksCharacterLock,
  type SunnyBanksLocationLock,
} from "@/lib/sunnyBanks";
import { missingXaiApiKeyMessage, resolveXaiApiKey } from "@/lib/xaiApiKey";
import { isAllowedTrainingImageUrl } from "@/lib/characterLoras";
import { XAI_EDIT_MAX_IMAGES } from "@/lib/shotCast";
import { buildSunnyBanksMultiCastPlatePrompt, type SunnyBanksShotCastMember } from "@/lib/sunnyBanksShotCast";

const XAI_IMAGE_MODEL_ENV_VAR = "XAI_IMAGE_MODEL";
const XAI_EDITS_URL = "https://api.x.ai/v1/images/edits";
const DEFAULT_XAI_IMAGE_MODEL = "grok-imagine-image-2.0";
const UPSTREAM_TIMEOUT_MS = 55_000;
const SUNNYBANKS_PUBLIC_PREFIX = "/skidmarks/sunnybanks/";

export type SunnyBanksCompositeOutcome =
  | { ok: true; dataUrl: string }
  | { ok: false; status: number; code: string; error: string };


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

/** Read a built-in location's repo picture as a data URL. Rejects any
 * path outside `public/skidmarks/sunnybanks/` so a body field cannot
 * point this at an arbitrary file. Locations only: a character's picture
 * never comes from the repo (2026-10-01). */
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

/** Biggest picture fetched from Blob for the overlay. */
const MAX_BLOB_PICTURE_BYTES = 8 * 1024 * 1024;

/**
 * A picture in Deck's own Vercel Blob store, as a data URL. Only Deck's
 * Blob host is ever fetched (https, no credentials, no port,
 * `isAllowedTrainingImageUrl`); anything else is `null`.
 */
export async function readSunnyBanksBlobPictureDataUrl(src: string): Promise<string | null> {
  if (!/^https:\/\//i.test(src) || !isAllowedTrainingImageUrl(src)) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BLOB_PICTURE_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** A location's picture: a built-in's repo file or a Deck Blob picture. */
async function readSunnyBanksLocationImageDataUrl(src: string): Promise<string | null> {
  if (src.startsWith("/")) return readSunnyBanksPublicImageDataUrl(src);
  return readSunnyBanksBlobPictureDataUrl(src);
}

/**
 * The place named in the compositing prompt. Only the name is used here
 * (the picture is `locationDataUrl`). A built-in by its key, or the name
 * the panel sent for a saved location (2026-09-30). Never quietly the
 * storefront: EP01's Park Site 4 beats were told they were at the
 * Office Storefront because `park_site_4` wasn't a built-in.
 */
export function resolveLocationLock(locationId: string, locationLabel?: string): SunnyBanksLocationLock {
  const label = locationLabel?.replace(/\s+/g, " ").trim().slice(0, 80) ?? "";
  const builtIn = getSunnyBanksLocation(locationId);
  if (builtIn) return label ? { ...builtIn, label } : builtIn;
  const fromId = locationId.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return { id: locationId, label: label || fromId || "the location in image 1", image: "" };
}

/**
 * Overlay the character's Cast card main picture onto the location
 * canvas. `locationDataUrl` is Image 1 (`startImageDataUrl` from the
 * panel). Image 2 is `resolveSunnyBanksStartImage`: the Cast card
 * picture, fetched from Deck's Blob, never a repo file. Returns the
 * composed still the video engine animates.
 *
 * No Cast card picture is an error (`missing_cast_picture`), never a
 * quiet skip onto the bare location (2026-10-01).
 */
export async function compositeSunnyBanksCharacterOntoLocation(opts: {
  locationDataUrl: string;
  character: SunnyBanksCharacterLock;
  locationId?: string;
  /** The saved location's name (2026-09-30), for a location that isn't a built-in. */
  locationLabel?: string;
  /** Per-beat prop/outfit text from `[Character Name: description]` —
   * fed into the xAI compositing prompt itself (not just LTX's later
   * motion prompt) so the STARTING FRAME already shows it. Fixes the
   * class of bug where a described prop (e.g. "holding two bottles")
   * only ever reached the motion prompt: the picture was already fixed
   * without it, so LTX had to invent the object out of nothing over
   * the clip, which is what morphed/duplicated. `undefined`/empty
   * leaves the prompt byte-identical to before this field existed. */
  appearanceOverride?: string;
  /** The shot's `[Action: …]` text (2026-10-01, silent holds), so the
   * start still shows the pose and what's held that the shot describes. */
  shotAction?: string;
}): Promise<SunnyBanksCompositeOutcome> {
  const picture = resolveSunnyBanksStartImage(opts.character);
  if (!picture) {
    return {
      ok: false,
      status: 400,
      code: "missing_cast_picture",
      error: missingCastPictureMessage(opts.character.name),
    };
  }

  const resolvedKey = resolveXaiApiKey();
  if (!resolvedKey) {
    return {
      ok: false,
      status: 501,
      code: "missing_api_key",
      error: missingXaiApiKeyMessage("Sunny Banks plating (xAI Grok Imagine)"),
    };
  }
  const apiKey = resolvedKey.key;

  const pictureDataUrl = await readSunnyBanksBlobPictureDataUrl(picture);
  if (!pictureDataUrl) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      error: `Could not load ${opts.character.name}'s Cast card picture (${picture}).`,
    };
  }

  const location = resolveLocationLock(opts.locationId ?? "", opts.locationLabel);
  const prompt = buildSunnyBanksCompositePlatePrompt(opts.character, location, opts.appearanceOverride, opts.shotAction);

  // Same two-image edits payload Studio's generateFaceImage sends
  // (`images: [{ url, type: "image_url" }, …]` — location then person).
  return postXaiEdit(apiKey, prompt, [opts.locationDataUrl, pictureDataUrl]);
}

/** One xAI `/v1/images/edits` call: `images` in the order given, one picture back. */
async function postXaiEdit(apiKey: string, prompt: string, imageDataUrls: readonly string[]): Promise<SunnyBanksCompositeOutcome> {
  const body: Record<string, unknown> = {
    model: resolveXaiImageModel(),
    prompt,
    response_format: "b64_json",
    images: imageDataUrls.map((url) => ({ url, type: "image_url" })),
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

/**
 * A shot with 2–4 Cast characters (2026-10-03, Stuart's multi-cast spec):
 * ONE xAI edits call, the location first, then each person's Cast card
 * main picture in cast order — at most five pictures, xAI's documented
 * cap ("up to five source images", docs.x.ai Multi-Image Editing,
 * checked 2026-10-03). The prompt is `buildSunnyBanksMultiCastPlatePrompt`:
 * exactly N people, each picture labelled with its name and place, all
 * mouths closed. Any person without a picture is refused before xAI is
 * called (`missing_cast_picture`).
 */
export async function compositeSunnyBanksCastOntoLocation(opts: {
  locationDataUrl: string;
  people: readonly SunnyBanksShotCastMember[];
  locationId?: string;
  locationLabel?: string;
  /** The talking row's speaker, or null on a silent row. */
  speaker?: string | null;
  /** Everyone who talks on this shared picture. */
  sceneSpeakers?: readonly string[];
  shotAction?: string;
}): Promise<SunnyBanksCompositeOutcome> {
  const people = opts.people.slice(0, XAI_EDIT_MAX_IMAGES - 1);
  const missing = people.find((p) => !p.pictureUrl);
  if (missing) {
    return { ok: false, status: 400, code: "missing_cast_picture", error: missingCastPictureMessage(missing.name) };
  }
  const resolvedKey = resolveXaiApiKey();
  if (!resolvedKey) {
    return {
      ok: false,
      status: 501,
      code: "missing_api_key",
      error: missingXaiApiKeyMessage("Sunny Banks plating (xAI Grok Imagine)"),
    };
  }
  const pictures: string[] = [];
  for (const person of people) {
    const dataUrl = await readSunnyBanksBlobPictureDataUrl(person.pictureUrl!);
    if (!dataUrl) {
      return {
        ok: false,
        status: 400,
        code: "invalid_request",
        error: `Could not load ${person.name}'s Cast card picture (${person.pictureUrl}).`,
      };
    }
    pictures.push(dataUrl);
  }
  const location = resolveLocationLock(opts.locationId ?? "", opts.locationLabel);
  const prompt = buildSunnyBanksMultiCastPlatePrompt({
    people,
    location,
    speaker: opts.speaker,
    sceneSpeakers: opts.sceneSpeakers,
    shotAction: opts.shotAction,
  });
  return postXaiEdit(resolvedKey.key, prompt, [opts.locationDataUrl, ...pictures]);
}

/**
 * The location canvas (Image 1): the `startImageDataUrl` the panel sends,
 * or (2026-09-30) the location's own picture when that's missing — a
 * built-in's repo file or a picture in Deck's own Blob store, read the
 * same guarded way as a character's picture. Anything else is "".
 */
export async function resolveBeatStartImage(startImageDataUrl: unknown, locationImage: unknown): Promise<string> {
  if (typeof startImageDataUrl === "string" && startImageDataUrl) return startImageDataUrl;
  if (typeof locationImage !== "string" || !locationImage.trim()) return "";
  return (await readSunnyBanksLocationImageDataUrl(locationImage.trim())) ?? "";
}
