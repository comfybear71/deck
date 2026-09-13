/**
 * Client-side half of Skidmarks' plate-still generation — the "Generate"
 * option on `SkidmarksClipStub`'s empty-still placeholder. Unlike the
 * clip timeline's model tags (LTX/Grok/H3/Seedance — see `lib/skidmarks.ts`'s
 * `defaultSegmentModel`), which stay stubbed for actual video, generating a
 * *still* image calls a real backend: **xAI's Grok Imagine API**
 * (`app/api/skidmarks/generate-still/route.ts`, keyed via `XAI_API_KEY`).
 *
 * **Why xAI specifically**: it's already one of Stuart's "four lanes"
 * accounts (README, "The four lanes" — xAI API), it's the cheapest wired
 * option for this (per xAI's published pricing, a `grok-imagine-image-2.0`
 * still runs roughly one to a few cents, in line with Stuart's "plate
 * stills are OK cost-wise" — distinct from the *video* render pass, which
 * stays a stub everywhere in this build — see `SkidmarksClipTimeline`'s doc
 * comment), and its `/v1/images/edits` endpoint natively supports up to a
 * few reference images per call, which is exactly the mechanism this file
 * uses for both "continue from the previous clip's plate" and "keep this
 * vocalist's likeness/hallmarks locked" below — no second provider needed
 * for either.
 *
 * **Verified live in this sandbox, not just read from docs**: two real
 * calls against `https://api.x.ai/v1/...` with a real `XAI_API_KEY`
 * available in this environment —
 * 1. A plain text-to-image `POST /v1/images/generations` call (no
 *    reference image) returned a real `200` with `{ data: [{ b64_json,
 *    mime_type: "image/jpeg" }], usage }`.
 * 2. A `POST /v1/images/edits` call with Jack Ash's actual reference photo
 *    (see `SKIDMARKS_CHARACTER_LOCKS` below) as the single `image`
 *    reference, plus a prompt built the same way
 *    `buildPlateGenerationRequest` builds one here, also returned a real
 *    `200` — and the resulting image genuinely held the locked look: a
 *    fedora'd, fully shadow-faced silhouette with glowing neon-blue lips,
 *    matching the reference's desert-noir setting.
 * **What that does and doesn't prove**: it confirms the request shape
 * (endpoint, `model`, `image`/`images`, `response_format: "b64_json"`,
 * the `{ data: [{ b64_json, mime_type }] }` response shape) is real and
 * this exact prompt strategy can produce an on-character result — it does
 * **not** prove every future generation call holds the lock equally well
 * (this is a generative model, not a deterministic renderer — a given
 * prompt can still land off-character on some runs), and the two-reference-
 * image path (continuity *and* identity together, via the `images` array
 * — see `buildPlateGenerationRequest`) was implemented from xAI's own
 * documented request shape but was **not** separately live-tested here
 * (each real call costs Stuart real money; one wired single-image proof
 * plus the documented `images`/`<IMAGE_0>` array contract was judged
 * enough to ship, not enough to claim "verified" for that specific
 * two-image combination).
 *
 * **Honesty contract**, same shape as `lib/transcription.ts`: if the
 * server has no `XAI_API_KEY` configured, this returns `{ ok: false,
 * unconfigured: true }` — an expected "not wired up here" outcome, not an
 * error — so the UI can say so plainly instead of implying a real attempt
 * failed. A genuine request failure (network, upstream error, a bad
 * prompt) returns `{ ok: false, unconfigured: false }` with a real reason
 * string from the server.
 */

import {
  isLipSyncModel,
  readImageFileAsDataUrl,
  type SkidmarksMember,
  type SkidmarksModelId,
} from "./skidmarks";

/**
 * Stuart's locked look for specific recurring band-member characters,
 * keyed by **member id** (not name — a rename shouldn't silently drop the
 * lock, and a same-named member on some other band shouldn't silently pick
 * one up). Injected automatically by `buildPlateGenerationRequest`
 * whenever that member resolves as the vocalist on a Vocal clip (see
 * `resolveVocalistForPrompt`) — Stuart's ask was that a generic "person
 * singing" prompt must never quietly drop a character's non-negotiable
 * idiosyncrasies, so this isn't optional/toggle-gated, it's baked in
 * whenever that member is in frame.
 *
 * This is a small, hand-authored list, not an inferred one — a member
 * with no entry here (every member on every band except this one, today)
 * gets no hallmark text and no negative cues; nothing here guesses at a
 * "look" for a character Stuart hasn't explicitly locked.
 *
 * **Jack Ash** (`jack-ash-frontman`, the seeded Jack Ash band's frontman)
 * is the one locked character so far, per Stuart's reference photo
 * (`public/skidmarks/jack-ash-reference.jpg`, also seeded as this
 * member's `avatarImage` in `SEED_BANDS` — see `lib/skidmarks.ts` — so the
 * identity-reference wiring below has something to pass from a fresh
 * session without Stuart having to upload it first): a noir silhouette in
 * a fedora and suit, desert-noir setting, face **always** fully hidden in
 * shadow (no lit/visible eyes, brow, nose, cheeks, or jawline, ever — the
 * one follow-up lock Stuart added after the first pass only asked for
 * "idiosyncrasies preserved" in general), with glowing neon-blue lips as
 * the one feature that breaks through that darkness. Both the hallmark
 * text and the negative cues below encode that face-in-shadow rule
 * explicitly, not just "keep his usual vibe" — the live-verified render
 * in this file's doc comment above used this exact wording.
 */
export interface SkidmarksCharacterLock {
  /** Appended to the generation prompt whenever this member is the
   * resolved vocalist in frame — the character's own hallmarks, stated
   * as directly as the model needs, not just a name/mood. */
  promptHallmarks: string;
  /** A plain-language list of the specific mistakes this character can't
   * afford (e.g. showing a face that's supposed to always be hidden) —
   * xAI's Grok Imagine API has no dedicated negative-prompt parameter
   * (unlike some other image APIs), so this is woven into the same
   * prompt string as an explicit "do not show" clause rather than a
   * separate request field. */
  negativeCues?: string;
}

export const SKIDMARKS_CHARACTER_LOCKS: Record<string, SkidmarksCharacterLock> = {
  "jack-ash-frontman": {
    promptHallmarks:
      "Jack Ash's signature look, locked: a mysterious noir silhouette wearing a wide-brim fedora and a suit, " +
      "desert-noir atmosphere. His face stays entirely hidden in deep shadow at all times \u2014 no eyes, brow, " +
      "nose, cheeks, or jawline are ever lit or visible, even in close-up; he reads as a true silhouette. The one " +
      "feature that breaks through that darkness is his mouth: his lips glow a vivid neon blue, clearly visible " +
      "even though every other facial feature stays completely unlit and unseen.",
    negativeCues:
      "Jack Ash's face lit or visible, his eyes, brow, nose, cheeks, or jawline visible or out of shadow, no " +
      "fedora, his lips a normal skin tone instead of glowing neon blue",
  },
};

export function getSkidmarksCharacterLock(memberId: string): SkidmarksCharacterLock | undefined {
  return SKIDMARKS_CHARACTER_LOCKS[memberId];
}

/**
 * Picks "the single vocalist/lead" a Vocal clip should auto-include, per
 * Stuart's ask: if the band only has one named member, it's them,
 * unambiguously (matches both seed bands today — Jack Ash's sole member
 * *is* Jack Ash; Solar Rebel's sole member is Nova). With more than one
 * named member, prefers whichever one's `role` reads like the actual
 * vocalist/lead (`/vocal|lead|frontman|singer/i`); short of a match,
 * falls back to the first named member rather than guessing further. A
 * band with no named members yet (a fresh "+ Add member" blank) resolves
 * to `undefined` — nothing here invents a name to feature.
 */
export function resolveVocalistForPrompt(members: SkidmarksMember[]): SkidmarksMember | undefined {
  const named = members.filter((m) => m.name.trim().length > 0);
  if (named.length === 0) return undefined;
  if (named.length === 1) return named[0];
  const byRole = named.find((m) => /vocal|lead|frontman|singer/i.test(m.role ?? ""));
  return byRole ?? named[0];
}

/** Framing language keyed off the clip's routed model (`SkidmarksModelId`)
 * — per Stuart's product lock, "model routing stays automatic in code":
 * this build has exactly one real image backend (xAI, above), so a
 * clip's LTX/Grok/H3 tag doesn't select a *different* API here, it only
 * steers this same call's prompt phrasing toward that model's usual
 * framing style. Vocal clips tagged LTX Lip-sync get a tight,
 * camera-facing framing hint (lip-sync-oriented, per the product ask);
 * clips tagged H3 ("simple stills" per the product ask) get a plainer,
 * single-subject hint; everything else (Grok, the instrumental/B-roll
 * default, or a manually-set Seedance) gets a wider, dynamic
 * establishing-shot hint. */
function routingFramingHint(vocal: boolean, model: SkidmarksModelId): string {
  if (vocal && isLipSyncModel(model)) {
    return (
      "Tight cinematic close/medium framing centered on the vocalist's face and upper body, camera-facing, " +
      "lip-sync-ready composition, music-video still."
    );
  }
  if (model === "h3") {
    return "Simple, clean single-subject still, minimal composition.";
  }
  return "Wide dynamic cinematic music-video establishing shot, strong sense of place and camera angle.";
}

export interface PlateGenerationRequest {
  /** The full prompt sent to xAI \u2014 Stuart's own `shotPrompt` plus this
   * module's model-routing framing, continuity/identity reference notes,
   * and (when applicable) a locked character's hallmarks/negative cues. */
  prompt: string;
  /** Ordered to match the tags used inside `prompt` when there are two or
   * more (`<IMAGE_0>`, `<IMAGE_1>`, \u2026 \u2014 xAI's own documented
   * convention for its `images` array) \u2014 empty for a plain
   * text-to-image call. */
  referenceImageDataUrls: string[];
}

export interface BuildPlateGenerationRequestParams {
  /** Stuart's own words for this shot \u2014 always first in the built
   * prompt, never rewritten or dropped. */
  shotPrompt: string;
  vocal: boolean;
  model: SkidmarksModelId;
  bandName: string;
  /** The resolved vocalist (`resolveVocalistForPrompt`), if any \u2014 only
   * mentioned/locked when `vocal` is also true (an Instrumental/B-roll
   * clip can omit the artist entirely, per the product lock, even for a
   * band with an obvious single vocalist). */
  vocalist?: SkidmarksMember;
  /** The previous clip's still, only when "Use last plate" is checked
   * (or there's nothing else to continue from) \u2014 passed as an
   * identity/continuity reference so a multi-clip story (door \u2192
   * keyhole \u2192 Jack seated) can hold the same scene across shots. */
  continuityStillDataUrl?: string;
}

/**
 * Builds the one real generation request this feature ever sends \u2014
 * pure and synchronous (no network/File I/O), so it's fully unit-testable
 * (see `lib/plateGeneration.test.ts`) independent of whether a real
 * `XAI_API_KEY` is configured anywhere.
 *
 * Reference image order (and the `<IMAGE_0>`/`<IMAGE_1>` tags used in the
 * prompt when both are present) is always **continuity first, identity
 * second** \u2014 `app/api/skidmarks/generate-still/route.ts` maps a single
 * reference to xAI's `image` field and two-or-more to its `images` array
 * (mutually exclusive per xAI's API), so this function's ordering is the
 * single source of truth callers must not reorder.
 */
export function buildPlateGenerationRequest(
  params: BuildPlateGenerationRequestParams
): PlateGenerationRequest {
  const { shotPrompt, vocal, model, bandName, vocalist, continuityStillDataUrl } = params;

  const references: { role: "continuity" | "identity"; dataUrl: string }[] = [];
  if (continuityStillDataUrl) {
    references.push({ role: "continuity", dataUrl: continuityStillDataUrl });
  }
  // Identity reference only for a resolved vocalist who's actually in
  // frame (`vocal`) and who has a real picked photo (`avatarImage` \u2014
  // never a generated `look`, which is just a color swatch stand-in, not
  // real image data \u2014 see `SkidmarksLook` in `lib/skidmarks.ts`).
  if (vocal && vocalist?.avatarImage) {
    references.push({ role: "identity", dataUrl: vocalist.avatarImage });
  }

  const parts: string[] = [shotPrompt.trim(), routingFramingHint(vocal, model)];

  const tagPrefix = (index: number) => (references.length > 1 ? `<IMAGE_${index}> ` : "");
  references.forEach((ref, index) => {
    if (ref.role === "continuity") {
      parts.push(
        `Continue directly from ${tagPrefix(index)}the previous shot's plate \u2014 keep the same scene, ` +
          "setting, and lighting continuity."
      );
    } else {
      parts.push(
        `Use ${tagPrefix(index)}as the exact likeness/identity reference for ${vocalist?.name ?? "the vocalist"} ` +
          "\u2014 match their appearance precisely."
      );
    }
  });

  if (vocal && vocalist) {
    parts.push(`Feature ${vocalist.name}, the vocalist, in the scene.`);
    const lock = getSkidmarksCharacterLock(vocalist.id);
    if (lock) {
      parts.push(lock.promptHallmarks);
      if (lock.negativeCues) parts.push(`Do not show: ${lock.negativeCues}.`);
    }
  }

  parts.push(`Music video for ${bandName}. Photoreal cinematic still, one frame, no on-screen text, no watermark.`);

  return {
    prompt: parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(" "),
    referenceImageDataUrls: references.map((r) => r.dataUrl),
  };
}

export type PlateGenerationOutcome =
  | { ok: true; dataUrl: string }
  | { ok: false; unconfigured: boolean; message: string };

const GENERATE_STILL_ENDPOINT = "/api/skidmarks/generate-still";

interface GenerateStillRouteErrorBody {
  error?: string;
  code?: string;
}
interface GenerateStillRouteSuccessBody {
  dataUrl?: unknown;
}

/**
 * POSTs a built `PlateGenerationRequest` to `/api/skidmarks/generate-still`
 * and normalizes the response into the two honest outcomes above. Never
 * throws \u2014 a thrown `fetch` (offline, CORS) is caught and reported the
 * same way as any other real failure.
 */
export async function generatePlateStill(
  request: PlateGenerationRequest
): Promise<PlateGenerationOutcome> {
  let res: Response;
  try {
    res = await fetch(GENERATE_STILL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (err) {
    return {
      ok: false,
      unconfigured: false,
      message: err instanceof Error ? err.message : "Network error reaching the still-generation API.",
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. a platform-level error page) \u2014 the
    // status-code fallback below still gives Stuart a real message.
  }

  if (!res.ok) {
    const errBody = (body ?? {}) as GenerateStillRouteErrorBody;
    return {
      ok: false,
      unconfigured: errBody.code === "missing_api_key",
      message: errBody.error ?? `Still generation failed (HTTP ${res.status}).`,
    };
  }

  const okBody = (body ?? {}) as GenerateStillRouteSuccessBody;
  const dataUrl = typeof okBody.dataUrl === "string" ? okBody.dataUrl : "";
  if (!dataUrl) {
    return { ok: false, unconfigured: false, message: "Still generation succeeded but returned no image." };
  }
  return { ok: true, dataUrl };
}

/**
 * Resolves any image source \u2014 an already-a-data-URL avatar/still, or a
 * relative/absolute path like the seeded `/skidmarks/jack-ash-reference.jpg`
 * \u2014 into a guaranteed `data:` URL, so `generatePlateStill`'s caller
 * never has to special-case where a reference image actually came from. An
 * already-`data:` source returns as-is (no redundant refetch/recompress of
 * a still or avatar that's already been through this once); otherwise
 * fetches it and reuses `readImageFileAsDataUrl`'s same downscale-to-JPEG
 * pass the band cover/avatar pickers already apply to a picked photo, so a
 * reference image never balloons the request body for no benefit (Grok
 * Imagine reads it for likeness/composition, not pixel-level source
 * detail). Client-only (`fetch`, `FileReader`, `Image`, `canvas`); never
 * called from a server route.
 */
export async function resolvePlateReferenceDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not load reference image (HTTP ${res.status}).`);
  const blob = await res.blob();
  return readImageFileAsDataUrl(blob);
}
