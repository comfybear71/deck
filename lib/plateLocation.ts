/**
 * The locked place a plate's artist gets composited **into**.
 *
 * Why this exists — the real, repeatedly-reported bug it closes. Stuart
 * attaches his artist's own photo to a music-video plate and the render
 * comes back as somebody else: a woman with an afro when the photo is a
 * man with dreadlocks, a blend of the two, a stranger. Two rounds of
 * prompt-wording fixes did not hold it ("not one render was SOUL
 * REBEL").
 *
 * The cause is not a string. It is **what the model is being asked to
 * do**. Deck used to send one image (the artist's photo) plus a
 * paragraph of the director's own words, and ask for a finished scene.
 * Painting a scene means inventing every pixel in it — including the
 * person — and a long, specific paragraph describing someone is the
 * most concrete thing in the request, so that description wins and the
 * photo becomes a suggestion.
 *
 * The original Skidmarks repo — the one that holds an artist across a
 * whole song — never asks for that. Its plate call always carries
 * **two** locked images: image 1 is a real still of the place, image 2
 * is the person. The instruction is "put this person into this
 * picture." Nothing is invented, so nothing can drift. It refuses to
 * draw a plate at all when either image is missing (`resolvePlate
 * Background` throws `Scene "…" has no location still yet`;
 * `resolvePlateCastPath` throws `Will not plate a partial cast`). That
 * refusal is the feature.
 *
 * This module supplies Deck's missing half: the place. It generates one
 * **empty** establishing still — architecture, weather, materials and
 * light, no people at all — from the same shot prompt the plate itself
 * uses, and hands it back as image 1.
 *
 * **Cost**: one extra still (a couple of cents, `app/api/skidmarks/
 * generate-still/route.ts`, the cheap xAI image call — see AGENTS.md's
 * cost rules) per distinct scene, **not** per plate. A clip's shot
 * prompt is shared by every plate on its strip, so a door → keyhole →
 * Jack strip generates the place once and reuses it three times, and
 * re-generating a plate you did not like reuses it again. Only a plate
 * that actually has an artist to hold goes down this path at all;
 * person-less B-roll is untouched and still costs exactly one call.
 *
 * **The cache is per page load, deliberately.** It is a plain in-memory
 * `Map`, not a Neon field and not `localStorage` (AGENTS.md's hard lock
 * on the latter). Persisting a place still would mean a new stored
 * field, a new migration and a new thing to go stale against an edited
 * shot prompt; the whole downside of not persisting it is that a
 * refresh costs one more cheap still on the next generate. That trade
 * was taken on purpose. If a plate's place ever needs to survive a
 * refresh, that is a real feature with a real ask behind it, not
 * something to bolt on here.
 */

import { generatePlateStill, type PlateGenerationRequest } from "./plateGeneration";
import { downscaleDataUrlImage } from "./skidmarks";

/** Normalised cache key — the same scene text typed with different
 * spacing or casing is the same place, and re-generating one plate of a
 * clip must not re-bill the place still. */
export function locationStillCacheKey(sceneText: string): string {
  return sceneText.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface BuildLocationStillRequestParams {
  /** The clip's own shot prompt. Sent as the place notes rather than
   * parsed: whatever it says about a person is overridden by the
   * empty-of-people locks below, and whatever it says about the setting
   * is exactly what this still needs to show. Deliberately **not** run
   * through a "find the location words" heuristic — that would quietly
   * drop half a scene on any prompt shaped differently than expected. */
  sceneText: string;
  bandName: string;
}

/**
 * The empty-place still, ported in shape from the original Skidmarks
 * repo's `buildLocationPrompt` (`src/lib/imageGen.ts`).
 *
 * Every person-shaped instruction in here is load-bearing. Skidmarks'
 * own comment on this prompt records the lesson: naming people pulls
 * them into the frame. A place still with a stray figure in it is worse
 * than useless — the composite step would then have two people to
 * reconcile, which is the exact failure this whole change exists to
 * stop.
 */
export function buildLocationStillRequest(params: BuildLocationStillRequestParams): PlateGenerationRequest {
  const sceneText = params.sceneText.trim();
  const bandName = params.bandName.trim();

  const parts = [
    sceneText
      ? `Empty establishing location still of the setting described here: ${sceneText}`
      : "Empty establishing location still.",
    "Show the place only — architecture, landscape, furniture, weather, materials and light. Everything in frame must belong to that setting.",
    "Completely empty of people and animals. No person, no figure, no silhouette, no crowd, no passer-by, no one in the distance, no reflection of a person. Nobody at all.",
    "Ignore any description of a person, performer, singer or character above — they are cast separately onto this plate later and must not appear here.",
    bandName ? `Music video location for ${bandName}.` : "",
    "Photoreal cinematic still, one frame, no on-screen text, no watermark.",
  ];

  return {
    prompt: parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(" "),
    // The route length-validates this field, and this whole prompt is
    // auto-injected framing built around Stuart's own text rather than
    // text he typed — same split `buildPlateGenerationRequest` already
    // keeps (see AGENTS.md's prompt-length lock).
    shotPrompt: sceneText,
    referenceImageDataUrls: [],
    featuresLockedCharacter: false,
  };
}

/** Per-page-load store of already-generated place stills, keyed by
 * `locationStillCacheKey`. Module-level on purpose: see this file's doc
 * comment for why this is not persisted. */
const locationStills = new Map<string, string>();

export function getCachedLocationStill(sceneText: string): string | undefined {
  return locationStills.get(locationStillCacheKey(sceneText));
}

export function cacheLocationStill(sceneText: string, dataUrl: string): void {
  const key = locationStillCacheKey(sceneText);
  if (!key || !dataUrl) return;
  locationStills.set(key, dataUrl);
}

/** Test-only reset — the cache is module state, so one test's place
 * still would otherwise leak into the next. */
export function clearCachedLocationStills(): void {
  locationStills.clear();
}

export interface LocationStillOutcome {
  ok: boolean;
  /** The empty place still, ready to send as image 1. */
  dataUrl?: string;
  /** A real reason, straight from `generatePlateStill` \u2014 xAI's own
   * message, or the honest "no key configured here" one. */
  message?: string;
  unconfigured?: boolean;
}

/**
 * The place still for this scene: cached if one was already made this
 * page load, otherwise a fresh (cheap) generate.
 *
 * **A failure here fails the whole plate, deliberately.** The obvious
 * alternative \u2014 shrug and generate the plate without a locked place
 * \u2014 hands back exactly the drifting, invented-person plate this
 * change exists to stop, while looking like a success. The original
 * Skidmarks repo takes the same line and says so out loud: `Scene "\u2026"
 * has no location still yet`, `Will not plate a partial cast`. The
 * caller reports this message as the plate's own error, so nothing is
 * silently downgraded and nothing is charged for an image Stuart would
 * have rejected anyway.
 */
export async function resolveLocationStill(params: BuildLocationStillRequestParams): Promise<LocationStillOutcome> {
  const cached = getCachedLocationStill(params.sceneText);
  if (cached) return { ok: true, dataUrl: cached };

  const outcome = await generatePlateStill(buildLocationStillRequest(params));
  if (!outcome.ok) {
    return { ok: false, message: outcome.message, unconfigured: outcome.unconfigured };
  }

  // This still is only ever sent back up as a reference image, never
  // persisted, but an uncapped xAI response would still ride on every
  // subsequent plate POST for this scene \u2014 same reason the plate
  // still itself is capped (`downscaleDataUrlImage`). Falls back to the
  // full-size original if the re-encode itself trips.
  let dataUrl = outcome.dataUrl;
  try {
    dataUrl = await downscaleDataUrlImage(outcome.dataUrl);
  } catch {
    // Keep the original \u2014 see comment above.
  }
  cacheLocationStill(params.sceneText, dataUrl);
  return { ok: true, dataUrl };
}
