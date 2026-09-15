/**
 * Sunny Banks — the second real project kind (2026-09-15), a sibling to
 * Skidmarks' music-video flow, not a variant of it. An Australian
 * outback adult cartoon sitcom set at Sunnybank Caravan Park: 5–10
 * minute episodes, six locked recurring characters plus guests, no
 * song/MP3 anywhere in the picture — Stuart's own correction after the
 * first pass here assumed one. See AGENTS.md's "North star" section:
 * `"sunnybank"` has sat in `SkidmarksProjectKind` since this app's
 * first commit, disabled, waiting for exactly this.
 *
 * **This module is prompt/voice *gold*, not a reimplementation of the
 * old Skidmarks Studio's Sunny Banks pipeline** (`comfybear71/skidmarks`,
 * `docs/SUNNY_BANKS_IMAGE_MOTION_STANDARD.md` +
 * `docs/SUNNY_BANKS_IMAGE_MOTION_GOLD.json`) — that repo's own docs call
 * it "logged from Stuie... worked 100%... do not rebuild these." Every
 * string below (the look locks, the speaking-plate shape, the style
 * lock) is copied verbatim from that source, not reworded or "improved"
 * — a single dropped comma or reworded clause is exactly the kind of
 * change that repo's own doc explicitly warns against, and this app has
 * no way to re-verify a rewritten version against a real render before
 * Stuart's own money is spent on it.
 *
 * **Why every Speak beat is exactly one character, never two people
 * talking in the same shot**: not a simplification for v0, a hard
 * lesson already paid for. That old repo's own
 * `docs/SUNNY_BANKS_MULTI_CHARACTER_RESEARCH.md` audited its entire
 * 100-beat "worked 100%" gold corpus and found **zero** speaking beats
 * with two or more named people in frame — every multi-person beat in
 * the whole proven corpus is a silent hold ("All mouths stay closed").
 * Its own conclusion: "nobody has built the two-hander yet... not a
 * regression, a gap." So this module doesn't attempt one either — a
 * scene with two characters is a silent Hold plus two separate Speak
 * beats (an over-the-shoulder cut back and forth), the same shape that
 * repo's own real, working episodes already use.
 */

/** Verbatim style lock — appended to every Sunny Banks motion prompt,
 * Speak or Hold alike. Keep the spelling exactly as logged (the source
 * doc calls this out explicitly: "keep the spelling; this is the
 * working gold"). Never mixed with Skidmarks' own 3D/noir style lock —
 * different show, different look, on purpose. */
export const SUNNY_BANKS_STYLE_LOCK =
  "rubbery adult cartoon, thick black outlines, flat cel colour, big heads, noodly arms, sun-bleached Aussie " +
  "palette, dusty ochre, faded teal, heat haze. Not photographic, not soft Pixar, not photorealistic";

/** Verbatim global lock — the lip-sync/delivery instruction every beat
 * (Speak especially) carries, same "dication" typo and all as the
 * source doc's own logged gold (see `lib/clipGeneration.ts`'s
 * `VOCAL_LTX_PROMPT_LOCK` for the exact same typo preserved the same
 * way, for the exact same reason: this is proven wording, not prose to
 * tidy up). */
export const SUNNY_BANKS_GLOBAL_LOCK =
  "perfect lip sync, clear lip movement, citing the dialogue clearly, facial expressions and hand gestures are " +
  "lively, dication is perfect.";

export interface SunnyBanksCharacterLock {
  /** Exact display name, as `NAME says:` expects it in the speaking
   * plate. */
  name: string;
  /** Verbatim look lock from the gold table — inserted directly after
   * the character's name in the speaking/hold plate templates below.
   * Never invent a second costume; a character whose look genuinely
   * varies by episode (Dazza) keeps that ambiguity in the lock text
   * itself rather than this module guessing which one applies. */
  look: string;
  /** ElevenLabs voice id for this character's locked voice — Stuart's
   * own real ids, copied from his ElevenLabs account (2026-09-15), not
   * discoverable from the old Studio repo's committed code (voice ids
   * are runtime data in that app's own local character records, never
   * checked into git — confirmed by reading it before asking Stuart for
   * these directly). `undefined` means "no voice yet" — Hans doesn't
   * have one; a caller must treat that as a real, named gap rather than
   * silently picking a stand-in voice for him. */
  voiceId?: string;
  /** This character's real reference plate — a static asset shipped
   * with the app (`public/skidmarks/sunnybanks/...`), same convention
   * as Skidmarks' own `jack-ash-reference.jpg`: a real photo/plate
   * Stuart provided, not picked at runtime, so a fresh session already
   * has an identity reference without him having to upload one first.
   * Still resolves through the normal reference-resolution path
   * (`lib/plateGeneration.ts`'s `resolvePlateReferenceDataUrl`) before
   * ever reaching xAI/Comfy — same as any other reference image in this
   * app. `undefined` means no plate yet; a caller (the eventual cast-
   * strip UI) must offer Stuart an upload for that character rather
   * than rendering with no identity reference at all. */
  referenceImage?: string;
}

/**
 * The six locked series regulars, keyed by name (matches how a script
 * actually names a speaker — `NAME:`/`NAME says:` — not a synthetic id;
 * unlike Skidmarks' `SKIDMARKS_CHARACTER_LOCKS`, which keys by band-
 * member id because band members get renamed and re-cast, a Sunny Banks
 * cast is fixed and Stuart names beats by these exact names). Ranger
 * Bazza, not "Ranger Dan" — Grok's own relayed spec had the wrong name;
 * Stuart's own correction wins (2026-09-15).
 *
 * The two aliens (Unit 4S) share one voice/look entry — per Stuart's
 * own description they don't speak English at all ("yup yup... nah",
 * variable length depending on the scene) and only Nuggets understands
 * them; see `resolveSunnyBanksAlienLine`'s doc comment for how that
 * gets turned into real ElevenLabs input text rather than a literal
 * English line.
 */
export const SUNNY_BANKS_CAST: Record<string, SunnyBanksCharacterLock> = {
  Shazza: {
    name: "Shazza",
    look: "big blonde hair, leopard-print top, cigarette, arms folded",
    voiceId: "Vuun8WKmo2MZSUXgLPGw",
    referenceImage: "/skidmarks/sunnybanks/shazza-reference.jpg",
  },
  Dazza: {
    name: "Dazza",
    look:
      "as on that plate — early: tall messy blonde, blue shirt, beers, coins, or pink hair dryer depending " +
      "on the plate — later: wild mullet, stained blue singlet, stubbies, beer can",
    voiceId: "Kn29eGLhsovCLwKvKi2q",
    referenceImage: "/skidmarks/sunnybanks/dazza-reference.jpg",
  },
  Nan: {
    name: "Nan",
    look: "tiny elderly woman, hair bun, round glasses, purple housecoat, teacup, cricket bat",
    voiceId: "u57uR2xbwGdASNetz0GB",
    referenceImage: "/skidmarks/sunnybanks/nan-reference.jpg",
  },
  Hans: {
    name: "Hans",
    look: "German backpacker, safari outfit, cork hat, camera around neck",
    // No voice id yet — see this module's doc comment. Never guess
    // a stand-in here; a caller must surface this as a real gap.
  },
  Nuggets: {
    name: "Nuggets",
    look: "skinny teen, buzz cut, blue and yellow jersey, meat pie",
    voiceId: "URQwIuGxmxWfCgwXuDxA",
    referenceImage: "/skidmarks/sunnybanks/nuggets-reference.jpg",
  },
  "Ranger Bazza": {
    name: "Ranger Bazza",
    // Real reference plate (2026-09-15) shows tan/khaki ranger uniform,
    // sunglasses, moustache, whistle on a lanyard — no Akubra, no
    // hi-vis, no bike in frame. Left as Grok's originally relayed text
    // rather than silently overwritten — flagged to Stuart instead;
    // see the PR this landed in.
    look: "portly park ranger, oversized Akubra, high-vis vest, mountain bike",
    voiceId: "lT1zujgSfYwPzAlTNE9z",
    referenceImage: "/skidmarks/sunnybanks/ranger-bazza-reference.jpg",
  },
  "Unit 4S": {
    name: "Unit 4S",
    look: "short purple alien, antennae, bulging eyes, bucket hat, high-vis vest",
    voiceId: "9AMMyX2GM74yY0KQwYkF",
  },
};

export function getSunnyBanksCharacterLock(name: string): SunnyBanksCharacterLock | undefined {
  return SUNNY_BANKS_CAST[name];
}

/**
 * The aliens' own "language" (Stuart's exact description, 2026-09-15):
 * not English, not a fixed line — "yup yup" and "nah" repeated and
 * stretched out, however long or short the scene calls for, decided per
 * scene rather than a single fixed sample. This turns a scene's own
 * beat-length hint into real ElevenLabs input text built from exactly
 * those two sounds, rather than inventing alien dialogue or silently
 * feeding an English line to the "Unit 4S" voice (which would just
 * produce a voice reading English, not the yup-yup/nah sound Stuart
 * actually described).
 *
 * `intensitySec` is the beat's own rough target length in seconds
 * (whatever duration the script/beat parser already picked for this
 * beat) — longer beats get more repetitions and longer-drawn "naaaah"s,
 * matching "it all depends on the scene." This is a simple, honest
 * mapping, not a claim that the resulting audio will land on the target
 * duration exactly (ElevenLabs' own delivery pacing decides the real
 * length, same as any other line) — see `synthesizeSunnyBanksLine`'s
 * doc comment for how a mismatch there is handled.
 */
export function buildUnit4sLine(intensitySec: number): string {
  const clamped = Math.max(2, Math.min(30, Math.round(intensitySec || 0)));
  const reps = Math.max(1, Math.round(clamped / 4));
  const yups = Array.from({ length: reps }, () => "Yup yup").join(", ");
  const nahLength = Math.min(8, 2 + Math.floor(clamped / 6));
  const nah = "Na" + "a".repeat(nahLength) + "h";
  return `${yups}. ${nah}.`;
}

/**
 * Builds the mandatory speaking-plate motion prompt — verbatim shape
 * from the gold doc, `[NAME]`/`[look lock]`/`[the line]` substituted in.
 * No `[SPEECH]`, no `[VISUAL]` (the source doc calls out both by name as
 * things this show's prompts must never carry — that's Skidmarks' own
 * unrelated 3D-noir vocabulary). `line` is sent through as-is, quotes
 * and all, matching the worked example's own `NAME says: "..."` shape.
 */
export function buildSunnyBanksSpeakingPrompt(character: SunnyBanksCharacterLock, line: string): string {
  return (
    `Use the provided start image as the first frame. ${character.name}, ${character.look} is prominent, mouth ` +
    `and head move naturally while speaking, subtle gesture. Props and background stay exactly as the start ` +
    `image, nothing new enters frame. ${character.name} says: "${line.trim()}". Camera holds. Same person and ` +
    `objects as the start image. ${SUNNY_BANKS_STYLE_LOCK}`
  );
}

/**
 * Blob pathname for one rendered speak-beat clip — deliberately the
 * simplest thing that works for the pilot (Grok's own "smallest slice
 * that proves..." scope): one timestamped file per render, no per-beat
 * identity, no prune/overwrite invariant, no shelf/listing route. That's
 * a real, disclosed gap, not an oversight — once episodes/beats get a
 * real id (the next slice, once this pilot proves the render itself
 * works), this gets replaced with a per-beat pathname the same shape as
 * `lib/clipRenderBlob.ts`'s `buildClipRenderPathname`, not extended in
 * place. `characterName` is slugified (lowercased, non-alphanumeric
 * collapsed to `-`) since it can contain a space ("Ranger Bazza").
 */
export function buildSunnyBanksSpeakBeatPathname(characterName: string, timestampMs: number): string {
  const slug = characterName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "character";
  return `sunnybanks/speak-beats/${timestampMs}-${slug}.mp4`;
}

/**
 * Builds the hold-plate motion prompt (no dialogue) — a reaction, a
 * pause, or the "hard cut" fallback `app/api/skidmarks/sunnybank/
 * generate-speak-beat/route.ts` reaches for when server-side last-frame
 * extraction fails for a beat (continue from that beat's own locked
 * plate rather than aborting the whole episode — see this module's
 * module-level doc comment and `lib/serverVideoFrame.ts`, the same
 * server-side extraction Skidmarks' music-video chaining already uses;
 * Sunny Banks reuses it as-is, never the old client-side `<video>`
 * capture that failed live three times there).
 */
export function buildSunnyBanksHoldPrompt(character: SunnyBanksCharacterLock): string {
  return (
    `Use the provided start image as the first frame. ${character.name}, ${character.look} holds their pose, ` +
    `subtle idle motion, weight shift, breathing, heat haze, flies. Props and background stay exactly as the ` +
    `start image, nothing new enters frame. No dialogue. Camera holds, no cuts. Same person and objects as the ` +
    `start image. ${SUNNY_BANKS_STYLE_LOCK}`
  );
}
