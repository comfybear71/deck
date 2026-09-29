/**
 * Client half of the one-tap LoRA flow on the Characters screen
 * (2026-09-29). Browser-only (`fetch`, `Image`, canvas via
 * `readImageFileAsDataUrl`): it asks the existing Siray still route for
 * each training picture, shrinks the result to a 1600px JPEG, stores it
 * in Deck's Blob store, and starts training through the train route.
 * Nothing here spends money on its own — the Characters screen only
 * calls it after Stuart confirms a tap.
 */

import {
  AUTO_PICTURE_TARGET,
  CHARACTER_LORA_BLOB_HOST_SUFFIX,
  nextTrainingVersion,
  type CharacterLoraEntry,
} from "./characterLoras";
import { uploadSkidmarksMemberPhoto } from "./memberPhotoBlob";
import { resolvePlateReferenceDataUrl } from "./plateGeneration";
import { readImageFileAsDataUrl } from "./skidmarks";

const TRAINING_PICTURE_MAX_DIMENSION = 1600;
const SIRAY_STILL_ENDPOINT = "/api/skidmarks/generate-still-siray";

export class AutoLoraError extends Error {
  /** A problem retrying won't fix (a missing key, a refused prompt). */
  constructor(
    message: string,
    public readonly permanent: boolean,
  ) {
    super(message);
  }
}

function isDeckBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(CHARACTER_LORA_BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/** Any picture (static app path, data URL, Blob URL) as a 1600px JPEG in Deck's Blob store. */
export async function toTrainingPicture(src: string): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) throw new AutoLoraError(`A picture couldn't be loaded (HTTP ${res.status}).`, false);
  const blob = await res.blob();
  const dataUrl = await readImageFileAsDataUrl(blob, TRAINING_PICTURE_MAX_DIMENSION, 0.9);
  const up = await uploadSkidmarksMemberPhoto(dataUrl);
  if (!up.ok) throw new AutoLoraError(up.message || "A picture couldn't be saved.", false);
  return up.url;
}

/** Keeps a picture that's already a Blob JPEG/PNG as is; converts anything else. */
export async function ensureTrainingPicture(src: string): Promise<string> {
  return isDeckBlobUrl(src) ? src : toTrainingPicture(src);
}

/**
 * One Siray picture (US$0.04). With a reference it copies that character
 * into the prompt's new angle; without one it draws from the words alone
 * (used only for a first face). Returns the Blob URL of a 1600px JPEG.
 */
export async function makeSirayPicture(prompt: string, referenceDataUrl: string | null): Promise<string> {
  let res: Response;
  try {
    res = await fetch(SIRAY_STILL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, referenceImageDataUrls: referenceDataUrl ? [referenceDataUrl] : [] }),
    });
  } catch {
    throw new AutoLoraError("Couldn't reach Siray. Check the connection.", false);
  }
  const json = (await res.json().catch(() => ({}))) as { url?: string; dataUrl?: string; error?: string; code?: string };
  if (!res.ok) {
    const permanent = res.status === 501 || res.status === 400 || res.status === 401 || res.status === 403 || res.status === 402;
    throw new AutoLoraError(json.error || `Siray didn't make the picture (HTTP ${res.status}).`, permanent);
  }
  const out = json.url || json.dataUrl;
  if (!out) throw new AutoLoraError("Siray finished but sent no picture back.", false);
  return toTrainingPicture(out);
}

export async function referenceDataUrlFor(src: string): Promise<string> {
  return resolvePlateReferenceDataUrl(src);
}

/** Starts Replicate training for a card. Returns the patch to apply to the card. */
export async function startCharacterTraining(entry: CharacterLoraEntry): Promise<Partial<CharacterLoraEntry>> {
  const version = nextTrainingVersion(entry);
  const res = await fetch("/api/skidmarks/character-lora/train", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: entry.name,
      slug: entry.slug,
      subjectWord: entry.subjectWord,
      imageUrls: entry.trainingImageUrls,
      fictionalAdultConfirmed: entry.fictionalAdultConfirmed,
      trainingStyle: entry.trainingStyle,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { trainingId?: string; error?: string };
  if (!res.ok || !json.trainingId) {
    throw new AutoLoraError(json.error || `Training didn't start (HTTP ${res.status}).`, res.status === 503 || res.status === 400);
  }
  return {
    status: "training",
    version,
    replicateTrainingId: json.trainingId,
    error: null,
    importedToComfy: false,
    autoPictureTarget: null,
    awaitingReview: false,
  };
}

export { AUTO_PICTURE_TARGET };
