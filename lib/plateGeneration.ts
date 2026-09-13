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
 * stills are OK cost-wise" — distinct from an actual *video* render,
 * which costs meaningfully more per tap. The whole-song "Generate Clips"
 * button (`SkidmarksClipTimeline`) still stays a stub — but a clip's own
 * plate strip now has a real, explicit, one-clip-at-a-time video render
 * past it too, on this same xAI key: see
 * `components/SkidmarksClipRender.tsx` and
 * `app/api/skidmarks/generate-clip/route.ts`), and its `/v1/images/edits`
 * endpoint natively supports up to a
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
 * whenever that member is in frame. **Follow-up**: also injected on an
 * *Instrumental/B-roll* clip when either (a) Stuart's own shot prompt
 * names the locked character directly, or (b) the plate continues from
 * the one right before it (his "door → keyhole → Jack seated" case is
 * Instrumental, not Vocal, and its later plates lean on both signals —
 * see `buildPlateGenerationRequest`'s `characterInFrame`); a generic
 * Instrumental clip that never triggers either signal still
 * auto-features/locks no one, unchanged from the original lock.
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
      "Jack Ash's signature look, locked, non-negotiable: a mysterious noir silhouette wearing a wide-brim " +
      "black fedora and a suit, desert-noir atmosphere. His face stays entirely hidden in deep shadow at all " +
      "times \u2014 no eyes, brow, nose, cheeks, or jawline are ever lit or visible, even in close-up, even in " +
      "a brightly lit or backlit scene; he reads as a true silhouette, never as a normally-lit person. The one " +
      "feature that breaks through that darkness is his mouth: his lips glow a vivid neon blue, clearly visible " +
      "even though every other facial feature stays completely unlit and unseen. This lock is not optional and " +
      "applies to every plate he appears in, Vocal or Instrumental: he must match this exact reference photo's " +
      "build, wardrobe, and silhouette \u2014 never a different or generic-looking man, and never bare-headed.",
    negativeCues:
      "Jack Ash's face lit or visible, his eyes, brow, nose, cheeks, or jawline visible or out of shadow, no " +
      "fedora, his lips a normal skin tone instead of glowing neon blue, a fully lit face, a bare head with no " +
      "fedora, any recognizable facial features visible in light, a different or generic-looking person instead " +
      "of matching the reference photo's identity",
  },
};

export function getSkidmarksCharacterLock(memberId: string): SkidmarksCharacterLock | undefined {
  return SKIDMARKS_CHARACTER_LOCKS[memberId];
}

/**
 * Follow-up fix, signal 1 of 2 (see `buildPlateGenerationRequest`'s
 * `characterInFrame` for signal 2, plate continuity): whether a
 * **locked** character (Jack Ash today) is named in Stuart's own
 * free-text shot prompt for a clip — used to carry his identity
 * reference + hallmark lock onto an *Instrumental* plate that features
 * him (his "door \u2192 keyhole \u2192 Jack seated" case is a 40-second
 * Instrumental clip, not a Vocal one; the live bug this fixes: Stuart
 * typed "Looking through the keyhole \u2026 we can see Jack Ash sitting
 * in a dim room \u2026", generated plate 3, and got back a fully-lit,
 * fedora-less, wrong-looking face — the first pass at this only ever
 * locked a Vocal clip's auto-included vocalist, so this exact
 * Instrumental plate silently dropped the lock and the identity photo
 * both). Matches on the character's first name as a whole word,
 * case-insensitively, since that's how Stuart actually phrases it ("Jack
 * seated, backlit"), not always the full "Jack Ash". Gated on the member
 * actually having a lock, so a generic Instrumental clip naming an
 * un-locked member is unaffected.
 */
export function shotPromptMentionsLockedCharacter(shotPrompt: string, member: SkidmarksMember): boolean {
  if (!getSkidmarksCharacterLock(member.id)) return false;
  const firstName = member.name.trim().split(/\s+/)[0];
  if (!firstName) return false;
  const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(shotPrompt);
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
  /** **Client-side bookkeeping only \u2014 not read by `app/api/skidmarks/
   * generate-still/route.ts`.** The exact `characterInFrame` fact this
   * request resolved: whether *this* generation actually features a
   * locked character (Jack Ash today). The caller (`SkidmarksClipStub`/
   * `SkidmarksAutoPlate`) stores this straight onto the resulting
   * still's own `featuresLockedCharacter` (`lib/skidmarks.ts`) so a
   * *later* plate that continues from this one can correctly resolve
   * `continuityFeaturesLockedCharacter` \u2014 the fix for the door \u2192
   * keyhole \u2192 Jack chain (see `BuildPlateGenerationRequestParams`'s
   * `continuityFeaturesLockedCharacter` doc comment). Harmless if sent
   * to the server along with everything else (an unread extra field),
   * but genuinely belongs to the client's own bookkeeping, not the
   * wire contract the server actually validates against. Optional so a
   * hand-rolled request built without going through
   * `buildPlateGenerationRequest` (a test, a future caller) still
   * satisfies this interface \u2014 `buildPlateGenerationRequest` itself
   * always sets it. */
  featuresLockedCharacter?: boolean;
  /** Stuart's own, unmodified shot-prompt text \u2014 the same string
   * `prompt` above leads with, sent separately so
   * `app/api/skidmarks/generate-still/route.ts` can length-validate
   * *only* what Stuart actually typed against its `MAX_PROMPT_LENGTH`,
   * not the auto-injected routing/continuity/character-lock text this
   * module appends on top. Without this, a legitimately-short shot
   * prompt on a locked character (Jack Ash's hallmarks + negative cues
   * alone run several hundred characters) could get rejected as "too
   * long" for text Stuart never wrote a word of \u2014 see this module's
   * `buildPlateGenerationRequest` for where the two diverge. */
  shotPrompt: string;
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
  /** The resolved vocalist (`resolveVocalistForPrompt`), if any. Only
   * "featured"/mentioned by name (the "Feature X, the vocalist" line)
   * when `vocal` is also true (an Instrumental/B-roll clip can still
   * omit the artist entirely, per the product lock, even for a band
   * with an obvious single vocalist) — *except* that a **locked**
   * character (Jack Ash) still gets his identity reference + hallmark
   * lock on an Instrumental clip either naming him directly or
   * continuing from the plate before it (the "door \u2192 keyhole \u2192
   * Jack seated" follow-up fix — see `buildPlateGenerationRequest`'s
   * `characterInFrame`). */
  vocalist?: SkidmarksMember;
  /** The previous clip's still, only when "Use last plate" is checked
   * (or there's nothing else to continue from) \u2014 passed as an
   * identity/continuity reference so a multi-clip story (door \u2192
   * keyhole \u2192 Jack seated) can hold the same scene across shots. */
  continuityStillDataUrl?: string;
  /** Whether the still `continuityStillDataUrl` points at is *itself*
   * already known to feature a locked character (`lib/skidmarks.ts`'s
   * `SkidmarksPlateStill.featuresLockedCharacter`) \u2014 signal 2 of
   * `characterInFrame`'s two triggers on an Instrumental clip (see this
   * function's doc comment). Only meaningful when `continuityStillDataUrl`
   * is also set; ignored otherwise. **Live-QA fix**: this must be the
   * *source* still's own resolved fact, never inferred from "a
   * continuity reference exists at all" \u2014 continuing from a plate
   * that never featured the locked character (the door \u2192 keyhole
   * case: keyhole continues from door, and neither shows anyone) must
   * never inject his identity/lock just because *some* continuity image
   * happens to be attached. */
  continuityFeaturesLockedCharacter?: boolean;
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
  const { shotPrompt, vocal, model, bandName, vocalist, continuityStillDataUrl, continuityFeaturesLockedCharacter } =
    params;

  // "In frame" for identity/lock purposes: a Vocal clip's auto-included
  // vocalist always counts (unchanged). An Instrumental/B-roll clip only
  // counts when a *locked* character (Jack Ash today) is genuinely part
  // of this shot — two signals, either one is enough:
  //  1. Stuart's own shot prompt names them directly (the "door \u2192
  //     keyhole \u2192 Jack seated" case \u2014 see
  //     `shotPromptMentionsLockedCharacter`'s doc comment).
  //  2. This plate continues from a plate that *itself* already featured
  //     them ("Use last plate" checked \u2014 `continuityStillDataUrl` set
  //     \u2014 *and* `continuityFeaturesLockedCharacter` true) \u2014 a later
  //     shot in the same story beat ("he stands, still in shadow") that
  //     never re-says the name shouldn't silently drop the lock either.
  //     Live-QA fix: signal 2 used to fire on *any* continuity reference
  //     at all, regardless of what it showed \u2014 the door \u2192 keyhole
  //     case (keyhole continues from door; neither names or shows
  //     anyone) wrongly inherited the lock purely because "Use last
  //     plate" happened to be checked. It's now gated on the *source*
  //     still's own resolved fact instead, so continuing from a
  //     person-less shot stays person-less.
  // Both signals are gated on the character actually having a lock, so
  // a generic Instrumental clip for an un-locked member/band still never
  // auto-features/locks anyone \u2014 the lock text only *constrains* how
  // that character looks if he's the subject, it never forces him into a
  // shot that wasn't going to feature anyone, so applying it on signal 2
  // alone (no literal name mention yet) costs nothing on a shot that
  // truly has no one in it.
  const lockedVocalist = vocalist && getSkidmarksCharacterLock(vocalist.id) ? vocalist : undefined;
  const instrumentalCastMention =
    !vocal &&
    !!lockedVocalist &&
    (shotPromptMentionsLockedCharacter(shotPrompt, lockedVocalist) ||
      (Boolean(continuityStillDataUrl) && Boolean(continuityFeaturesLockedCharacter)));
  const characterInFrame = (vocal && !!vocalist) || instrumentalCastMention;

  const references: { role: "continuity" | "identity"; dataUrl: string }[] = [];
  if (continuityStillDataUrl) {
    references.push({ role: "continuity", dataUrl: continuityStillDataUrl });
  }
  // Identity reference for whichever member is "in frame" above, as long
  // as they have a real picked photo (`avatarImage` \u2014 never a
  // generated `look`, which is just a color swatch stand-in, not real
  // image data \u2014 see `SkidmarksLook` in `lib/skidmarks.ts`).
  if (characterInFrame && vocalist?.avatarImage) {
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
          "\u2014 match their appearance, build, and wardrobe precisely; this is a specific person, not a " +
          "generic stand-in."
      );
    }
  });

  if (vocal && vocalist) {
    parts.push(`Feature ${vocalist.name}, the vocalist, in the scene.`);
  }
  // The character lock itself applies whenever they're "in frame" per
  // `characterInFrame` above \u2014 Vocal-clip vocalist (as before) *or*
  // an Instrumental clip that names a locked character \u2014 not just
  // the Vocal case the "Feature \u2026 the vocalist" line above is
  // scoped to.
  if (characterInFrame && vocalist) {
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
    shotPrompt: shotPrompt.trim(),
    referenceImageDataUrls: references.map((r) => r.dataUrl),
    featuresLockedCharacter: characterInFrame,
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
