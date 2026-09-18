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
   * than rendering with no identity reference at all.
   *
   * For five of the six regulars this is a **turnaround sheet** (several
   * poses on one canvas — live-QA, 2026-09-17: sending that sheet to
   * LTX as the Hold/Speak first frame animated a grid of Shazzas). Keep
   * it as the character bible; the start still LTX actually animates is
   * `heroImage` when set. Unit 4S's plate is already a single figure, so
   * it has no separate hero file. */
  referenceImage?: string;
  /** Single-subject start still — one cropped cell from `referenceImage`,
   * minted once into `public/skidmarks/sunnybanks/*-hero.jpg`, never a
   * runtime canvas crop (iPhone Safari first; magic bounding boxes in
   * the panel are how this would silently drift the next time a sheet is
   * replaced). Hold and Speak, and the cast thumbnails, use this so what
   * Stuart sees is what LTX holds. `undefined` falls back to
   * `referenceImage` via `resolveSunnyBanksStartImage`. */
  heroImage?: string;
  /** `true` for a one-episode special guest (Hans, 2026-09-15's real
   * correction) rather than one of the six locked series regulars.
   * Never shown in an always-on "the cast" strip — a guest only ever
   * belongs to whichever specific episode features them, and there's no
   * episode model yet to scope that to. Kept in this same table rather
   * than a separate one since the lock mechanism itself (name, look,
   * voice, reference plate) works identically either way — see this
   * module's own doc comment. */
  guest?: boolean;
}

/**
 * The six locked series regulars, plus Hans (a one-episode special
 * guest, not a regular — Stuart's own correction, 2026-09-15; kept in
 * this same table since the lock mechanism itself — name, look, voice,
 * reference plate — works identically for a guest as a regular, just
 * without the expectation he ever reappears), keyed by name (matches
 * how a script actually names a speaker — `NAME:`/`NAME says:` — not a
 * synthetic id; unlike Skidmarks' `SKIDMARKS_CHARACTER_LOCKS`, which
 * keys by band-member id because band members get renamed and re-cast,
 * a Sunny Banks cast is fixed and Stuart names beats by these exact
 * names). Ranger Bazza, not "Ranger Dan" — Grok's own relayed spec had
 * the wrong name; Stuart's own correction wins (2026-09-15).
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
    // Top row, 2nd body from left on the 1248×832 sheet (arms folded,
    // cigarette — the gold look). Extract { left: 358, top: 74, width: 258, height: 400 }.
    heroImage: "/skidmarks/sunnybanks/shazza-hero.jpg",
  },
  Dazza: {
    name: "Dazza",
    look:
      "as on that plate — early: tall messy blonde, blue shirt, beers, coins, or pink hair dryer depending " +
      "on the plate — later: wild mullet, stained blue singlet, stubbies, beer can",
    voiceId: "Kn29eGLhsovCLwKvKi2q",
    referenceImage: "/skidmarks/sunnybanks/dazza-reference.jpg",
    // Front-left full figure on the 1168×784 sheet. Extract { left: 20, top: 8, width: 290, height: 470 }.
    heroImage: "/skidmarks/sunnybanks/dazza-hero.jpg",
  },
  Nan: {
    name: "Nan",
    look: "tiny elderly woman, hair bun, round glasses, purple housecoat, teacup, cricket bat",
    voiceId: "u57uR2xbwGdASNetz0GB",
    referenceImage: "/skidmarks/sunnybanks/nan-reference.jpg",
    // Front-left full figure (bat + teacup + bunny slippers). Extract { left: 40, top: 20, width: 260, height: 420 }.
    heroImage: "/skidmarks/sunnybanks/nan-hero.jpg",
  },
  Hans: {
    name: "Hans",
    look: "German backpacker, safari outfit, cork hat, camera around neck",
    guest: true,
    // No voice id yet — see this module's doc comment. Never guess
    // a stand-in here; a caller must surface this as a real gap.
  },
  Nuggets: {
    name: "Nuggets",
    look: "skinny teen, buzz cut, blue and yellow jersey, meat pie",
    voiceId: "URQwIuGxmxWfCgwXuDxA",
    referenceImage: "/skidmarks/sunnybanks/nuggets-reference.jpg",
    // Front-left full figure with pie. Extract { left: 30, top: 8, width: 280, height: 500 }.
    heroImage: "/skidmarks/sunnybanks/nuggets-hero.jpg",
  },
  "Ranger Bazza": {
    name: "Ranger Bazza",
    // Stuart's own confirmation (2026-09-15): both looks are real, not a
    // stale/wrong description — same "as on that plate" ambiguity-
    // preserving shape as Dazza's own entry above, since this module
    // never guesses which one a given scene means.
    look:
      "as on that plate — portly build either way: tan/khaki ranger uniform, sunglasses, moustache, whistle " +
      "on a lanyard, or oversized Akubra, high-vis vest, mountain bike",
    voiceId: "lT1zujgSfYwPzAlTNE9z",
    referenceImage: "/skidmarks/sunnybanks/ranger-bazza-reference.jpg",
    // Top row, 2nd body from left (¾, whistle) on the 1248×832 sheet.
    // Extract { left: 390, top: 90, width: 250, height: 430 }.
    heroImage: "/skidmarks/sunnybanks/ranger-bazza-hero.jpg",
  },
  "Unit 4S": {
    name: "Unit 4S",
    // Real reference plate (2026-09-15): bucket hat + antennae + bulging
    // eyes confirmed, but no high-vis vest in frame — holding a pair of
    // thongs instead. Updated to match the real art, not the originally
    // relayed text.
    look: "short purple alien, antennae, bulging eyes, teal bucket hat, holding a pair of thongs, bare feet",
    voiceId: "9AMMyX2GM74yY0KQwYkF",
    referenceImage: "/skidmarks/sunnybanks/unit-4s-reference.jpg",
  },
};

export function getSunnyBanksCharacterLock(name: string): SunnyBanksCharacterLock | undefined {
  return SUNNY_BANKS_CAST[name];
}

/**
 * The still the cast strip shows, and compositor **Image 2** (the
 * single cast card). Prefers the single-subject `heroImage` so a
 * turnaround sheet never reaches the compositor or LTX (live QA:
 * Shazza Hold animated every cell on `shazza-reference.jpg`; original
 * Skidmarks AGENTS.md: do not hand the sheet to `plateCastIntoGen`).
 * Falls back to `referenceImage` when there is no hero file (Unit 4S,
 * Hans). Keyed by the character's own lock, never a synthetic
 * `characterId`. When a location is selected, LTX's first frame is the
 * composed plate (`buildSunnyBanksCompositePlatePrompt`), not this
 * hero still alone.
 */
export function resolveSunnyBanksStartImage(character: SunnyBanksCharacterLock): string | undefined {
  return character.heroImage ?? character.referenceImage;
}

/**
 * Shot-plate compositor prompt — copied from original Skidmarks Studio
 * `plateCastIntoGen` / `buildPlatePrompt` (`comfybear71/skidmarks`,
 * `src/lib/plateCast.ts`) for the n=1, first-pass case. That repo does
 * NOT overlay a second image in the LTX graph. LTX node `269` is a
 * single LoadImage of the **already composed** plate. Overlay is xAI
 * `/v1/images/edits` with two references:
 *   Image 1 / `<IMAGE_0>` = locked empty location (the canvas)
 *   Image 2 / `<IMAGE_1>` = single hero/cast card (never the sheet)
 * `generate-speak-beat` is the caller (Studio's gen-plate + LTX in one
 * route). Gold Hold/Speak strings stay untouched — they already assume
 * the start image has both the person and the place.
 */
export function buildSunnyBanksCompositePlatePrompt(
  character: SunnyBanksCharacterLock,
  location: SunnyBanksLocationLock,
  appearanceOverride?: string
): string {
  const trimmedOverride = appearanceOverride?.trim() || "";
  const heldProp = /\b(cigarette|pie|teacup|cricket bat|thongs|beer|camera|whistle)\b/i.test(
    character.look
  );
  // An override changes what's held/worn on purpose, so the base
  // "don't change their clothes" line (below) would directly contradict
  // it — swap in a narrower instruction that still forbids anything
  // *not* named by the override (no free-for-all just because one prop
  // changed).
  const propLine = trimmedOverride
    ? "Only the object(s)/outfit named in the shot-specific override below — do not invent anything beyond what it names."
    : heldProp
      ? "Only the held object named in the look lock. Do not invent extra objects."
      : "Keep any held prop already visible in <IMAGE_1>. Do not invent a phone or extra objects.";
  const bodyLine = trimmedOverride
    ? "Keep the same body pose, body, and face identity from image 2 — same person, do not turn them into a different person, do not invent a second person, no passer-by. Change only what the shot-specific override below explicitly names."
    : "Keep the EXACT body pose, clothes, and body from image 2. Same face from image 2. Do not stand them up. Do not change their clothes. Do not invent a second person. No passer-by. No extra body in the distance.";

  const lines = [
    SUNNY_BANKS_STYLE_LOCK,
    "<IMAGE_0> is the LOCKED background — keep that exact place, lighting and materials. Do not move the camera. Do not replace the location with a photo street. Remove any people or crowds already in image 1 — empty place only.",
    "<IMAGE_1> is the person — same face identity, hair, age and body from image 2. Do not turn them into a different person.",
    "Place that same person from image 2 into image 1.",
    bodyLine,
    "One person only. Only that person in frame, no one else appears. Empty of extra people and animals.",
    "MEDIUM SHOT framing: figure large in frame, dead centre horizontally. Keep the locked place from image 1 behind them. One person only.",
    `Staging / tweak: ${character.name}, ${character.look}, at ${location.label}.`,
    propLine,
    "No captions, no watermarks, no name tags. Keep any signage that is already part of the locked place in image 1.",
  ];
  if (trimmedOverride) {
    lines.push(`Shot-specific override for this render only: ${trimmedOverride}.`);
  }
  return lines.join("\n\n");
}

/**
 * Locked park plates — Stuart's own full-frame location stills
 * (2026-09-17), not generated here. Empty of cast on purpose: they are
 * compositor **Image 1** (the location canvas). `generate-speak-beat`
 * overlays the character hero as Image 2, then sends the composed
 * still to LTX node `269`. Keyed by a stable id the Locations
 * `<select>` stores (`selectedLocationId`), never a synthetic
 * `characterId`. Not a pose picker and not a sequencer — one native
 * dropdown, one clip at a time.
 *
 * These files are already 1280×720, so `letterboxImageForLtxIa2v` is a
 * no-op on them (source aspect already 16:9).
 */
export type SunnyBanksLocationId =
  | "water_tank_dam"
  | "main_entrance_sign"
  | "site_laundry"
  | "office_storefront"
  | "tin_shed_mower"
  | "caravan_interior";

export interface SunnyBanksLocationLock {
  id: SunnyBanksLocationId;
  label: string;
  image: string;
}

export const SUNNY_BANKS_DEFAULT_LOCATION_ID: SunnyBanksLocationId = "office_storefront";

export const SUNNY_BANKS_LOCATIONS: Record<SunnyBanksLocationId, SunnyBanksLocationLock> = {
  water_tank_dam: {
    id: "water_tank_dam",
    label: "Water Tank Dam",
    image: "/skidmarks/sunnybanks/water-tank-dam.jpg",
  },
  main_entrance_sign: {
    id: "main_entrance_sign",
    label: "Main Entrance Sign",
    image: "/skidmarks/sunnybanks/main-entrance-sign.jpg",
  },
  site_laundry: {
    id: "site_laundry",
    label: "Site Laundry Machines",
    image: "/skidmarks/sunnybanks/site-laundry.jpg",
  },
  office_storefront: {
    id: "office_storefront",
    label: "Office Storefront",
    image: "/skidmarks/sunnybanks/office-storefront.jpg",
  },
  tin_shed_mower: {
    id: "tin_shed_mower",
    label: "Tin Shed & Mower",
    image: "/skidmarks/sunnybanks/tin-shed-mower.jpg",
  },
  caravan_interior: {
    id: "caravan_interior",
    label: "Fibro Caravan Interior",
    image: "/skidmarks/sunnybanks/caravan-interior.jpg",
  },
};

export function getSunnyBanksLocation(id: string): SunnyBanksLocationLock | undefined {
  return SUNNY_BANKS_LOCATIONS[id as SunnyBanksLocationId];
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
 * Extra sentence appended *after* the gold Speak/Hold template for
 * Dazza only. His look lock lists alternate held objects ("beers,
 * coins, or pink hair dryer" / later "beer can") — live QA: LTX
 * treated that "or" as permission to morph or drop the prop mid-clip.
 * Gold look/voice/style strings stay verbatim (Jack-Ash hallmark
 * pattern: append, never rewrite the proven template). Shazza's
 * field-for-field gold `toBe(...)` test must keep matching exactly.
 */
export const SUNNY_BANKS_HELD_OBJECT_LOCK =
  "Held objects stay locked and static for the full duration — whatever is in the character's hands in the start image must not morph, swap, or disappear.";

function accessoryLockSuffix(character: SunnyBanksCharacterLock): string {
  if (character.name !== "Dazza") return "";
  return (
    ` ${SUNNY_BANKS_HELD_OBJECT_LOCK} Dazza's beers, coins, pink hair dryer, or beer can remain exactly as ` +
    `shown in the start image, without morphing or disappearing over the clip.`
  );
}

/**
 * Builds the mandatory speaking-plate motion prompt — verbatim shape
 * from the gold doc, `[NAME]`/`[look lock]`/`[the line]` substituted in.
 * No `[SPEECH]`, no `[VISUAL]` (the source doc calls out both by name as
 * things this show's prompts must never carry — that's Skidmarks' own
 * unrelated 3D-noir vocabulary). `line` is sent through as-is, quotes
 * and all, matching the worked example's own `NAME says: "..."` shape.
 * Dazza gets `accessoryLockSuffix` after the gold string so held
 * objects cannot morph mid-clip; every other character is unchanged.
 */
export function buildSunnyBanksSpeakingPrompt(character: SunnyBanksCharacterLock, line: string): string {
  return (
    `Use the provided start image as the first frame. ${character.name}, ${character.look} is prominent, mouth ` +
    `and head move naturally while speaking, subtle gesture. Props and background stay exactly as the start ` +
    `image, nothing new enters frame. ${character.name} says: "${line.trim()}". Camera holds. Same person and ` +
    `objects as the start image. ${SUNNY_BANKS_STYLE_LOCK}` +
    accessoryLockSuffix(character)
  );
}

/**
 * Fixed Hold length — not a picker. Matches the director-brain default
 * (~5s) and sits inside LTX's `[2, 15]`s audio/duration window
 * (`MIN_LTX_AUDIO_INPUT_SEC` / `MAX_LTX_CLIP_DURATION_SEC` on the
 * speak-beat route). Speak beats still take their duration from the
 * real ElevenLabs audio; Holds have no speech, so this is the one
 * number the silent-MP3 + graph duration both use.
 */
export const SUNNY_BANKS_HOLD_DURATION_SEC = 5;

/**
 * Automatic, invisible settle lead-in — Stuart's explicit ask
 * (2026-09-18): "implied... built in... I don't need to see it."
 * Folded into the SAME Speak beat's own audio/prompt whenever that
 * beat carries an `appearanceModifier` (the character is stepping into
 * a prop/look/outfit that differs from their locked default), instead
 * of a second, separately-billed silent Hold clip inserted by hand.
 * Not a picker, not a per-beat override, not an env var — one fixed
 * number, same lock discipline as `SUNNY_BANKS_HOLD_DURATION_SEC`
 * above. See `lib/silentMp3.ts`'s `prependSilenceToMp3` and
 * `generate-speak-beat/route.ts`'s Speak branch for where this is
 * actually used.
 */
export const SUNNY_BANKS_SETTLE_LEAD_SEC = 1.5;

function slugifySunnyBanksCharacterName(characterName: string): string {
  return characterName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "character";
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
  return `sunnybanks/speak-beats/${timestampMs}-${slugifySunnyBanksCharacterName(characterName)}.mp4`;
}

/** Same timestamped-file shape as a speak beat, under its own prefix so
 * a Hold never collides with a Speak of the same character in the same
 * millisecond. Same disclosed gap (no per-beat identity / prune). */
export function buildSunnyBanksHoldBeatPathname(characterName: string, timestampMs: number): string {
  return `sunnybanks/hold-beats/${timestampMs}-${slugifySunnyBanksCharacterName(characterName)}.mp4`;
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
 *
 * Wording is gold and stays as-is. It already assumes the start image
 * is **one** person ("Same person and objects as the start image") —
 * the 2026-09-17 multi-Shazza Hold was the sheet being that start
 * image, not this string asking for a crowd. Callers must pass
 * `resolveSunnyBanksStartImage`, not the bible sheet.
 */
export function buildSunnyBanksHoldPrompt(character: SunnyBanksCharacterLock): string {
  return (
    `Use the provided start image as the first frame. ${character.name}, ${character.look} holds their pose, ` +
    `subtle idle motion, weight shift, breathing, heat haze, flies. Props and background stay exactly as the ` +
    `start image, nothing new enters frame. No dialogue. Camera holds, no cuts. Same person and objects as the ` +
    `start image. ${SUNNY_BANKS_STYLE_LOCK}` +
    accessoryLockSuffix(character)
  );
}
