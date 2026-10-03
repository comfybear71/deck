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
 * **Look locks rewritten (2026-09-30, Stuart approved):** the gold look
 * strings named alternate outfits and loose props ("as on that plate —
 * … beers, coins, or pink hair dryer depending on the plate"), and EP01
 * rendered Dazza as a coin with his face on it — the prompt drew the
 * prop as the subject. Each look is now one clear description of the
 * character, with a prop kept only when it's part of them, phrased as
 * held or worn. The Speak and Hold template shapes, style lock and
 * global lock below are still the verbatim gold.
 *
 * **Pictures come only from the Cast card (2026-10-01, Stuart):** this
 * table has no pictures at all any more. The old repo stills
 * (`public/skidmarks/sunnybanks/*-hero.jpg` / `*-reference.jpg`) are
 * deleted: EP02 Act I row 16 put the old Dazza hero, holding a rocket
 * launcher, into a Grok silent hold even though his Cast card pictures
 * all show empty hands. Every render now uses the character's Cast card
 * main picture (`castPicture`, filled in by `lib/sunnyBanksVoices.ts`),
 * and a character without one shows a red hint and doesn't render.
 *
 * **No held things in the looks (2026-10-01, Stuart approved):** EP02
 * Act II row 1 asked for Nuggets "hands in pockets" and got him holding
 * a meat pie, because his look said "meat pie held in both hands". The
 * looks now describe body, face, hair and clothes only; what a character
 * holds comes from their Cast card picture, or from the shot's own
 * `[Action: …]` / `[Character Name: …]` text. Every look passes
 * `stripHeldProps` from `lib/characterRoster.ts` unchanged, the same rule
 * the Cast card and training pictures are drawn with.
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
 *
 * **Update 2026-10-03 (multi-cast shots):** Stuart asked for the
 * two-hander, so it is now built on top of the unchanged gold prompts:
 * each Speak beat is still one voice and one speaker, but its start
 * picture can hold up to four Cast characters (one shared plate per
 * scene, `lib/sunnyBanksShotCast.ts`), and the speak prompt gets
 * "<speaker> is the only one speaking … <other> listens silently, mouth
 * closed" appended. Untested against a paid render when this was
 * written; one-person beats are exactly as before.
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
  /** Look lock — inserted directly after the character's name in the
   * speaking/hold plate templates below. One clear description of the
   * character (2026-09-30): no "either / or / depending on the plate"
   * wording and no loose props — a prop appears only when it's part of
   * the character, phrased as held or worn ("cigarette in her mouth"),
   * never as a bare noun a prompt could draw as the subject (EP01's
   * coin-faced Dazza). Since 2026-10-01 nothing held and no arm pose at
   * all: the Cast card picture and the shot's own text decide those. A
   * per-shot change goes in `[Character Name: …]`, never here. */
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
  /** The character's Cast card main picture (Deck's Blob), filled in at
   * run time from their card by `lib/sunnyBanksVoices.ts` — never set in
   * `SUNNY_BANKS_CAST` (2026-10-01: no built-in or repo pictures).
   * `undefined` = no Cast card picture yet: the row shows a red hint and
   * doesn't render, never a quiet fallback. */
  castPicture?: string;
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
    look:
      "middle-aged woman, huge curly blonde hair, gold hoop earrings, leopard-print singlet top, frayed denim shorts",
    voiceId: "Vuun8WKmo2MZSUXgLPGw",
  },
  Dazza: {
    name: "Dazza",
    // One look (2026-09-30). The old lock listed
    // "beers, coins, or pink hair dryer" and EP01 drew him as a coin.
    look:
      "skinny adult bloke, wild spiky blonde hair, bulging eyes, gap-toothed grin, tattooed forearm, " +
      "stained faded blue singlet, torn brown shorts, bare feet",
    voiceId: "Kn29eGLhsovCLwKvKi2q",
  },
  Nan: {
    name: "Nan",
    look:
      "tiny elderly woman, grey hair in a bun, round glasses, purple floral housecoat, pink bunny slippers",
    voiceId: "u57uR2xbwGdASNetz0GB",
  },
  Hans: {
    name: "Hans",
    look: "slim German backpacker, cork hat with dangling corks, khaki safari shirt, big canvas backpack",
    guest: true,
    // No voice id yet — see this module's doc comment. Never guess
    // a stand-in here; a caller must surface this as a real gap.
  },
  Nuggets: {
    name: "Nuggets",
    // Stuart (2026-09-29): Nuggets is a grown adult, just drawn cartoonish.
    look:
      "skinny adult bloke in his late twenties, bald head, freckles, worried wide eyes, blue and yellow polo " +
      "shirt, blue shorts, white socks, brown work boots",
    voiceId: "URQwIuGxmxWfCgwXuDxA",
  },
  "Ranger Bazza": {
    name: "Ranger Bazza",
    // One look (2026-09-30). The old lock
    // offered a second outfit (Akubra, high-vis vest, mountain bike);
    // a scene that wants it says so with `[Character Ranger Bazza: …]`.
    look:
      "portly middle-aged park ranger, short brown hair, dark sunglasses, bushy moustache, short-sleeved khaki " +
      "ranger shirt, khaki trousers, brown belt",
    voiceId: "lT1zujgSfYwPzAlTNE9z",
  },
  "Unit 4S": {
    name: "Unit 4S",
    look: "skinny purple alien, two antennae, big round bulging eyes, wide toothy grin, teal bucket hat, bare feet",
    voiceId: "9AMMyX2GM74yY0KQwYkF",
  },
};

export function getSunnyBanksCharacterLock(name: string): SunnyBanksCharacterLock | undefined {
  return SUNNY_BANKS_CAST[name];
}

/**
 * Compositor **Image 2**: the character's Cast card main picture, and
 * nothing else (2026-10-01, Stuart: "only our new character images plus
 * 15 LoRA trained images, nothing else"). There is no built-in or repo
 * fallback: `undefined` means the character has no Cast card picture
 * yet, and callers must say so and not render. When a location is
 * selected, the first frame is the composed plate
 * (`buildSunnyBanksCompositePlatePrompt`), not this picture alone.
 */
export function resolveSunnyBanksStartImage(character: SunnyBanksCharacterLock): string | undefined {
  const picture = character.castPicture?.trim();
  return picture ? picture : undefined;
}

/** The red note on a row (and the route's refusal) when a character has no Cast card picture. */
export function missingCastPictureMessage(name: string): string {
  return `${name} has no Cast card picture yet. Add one on their Cast card; this shot won't render until then.`;
}

/**
 * Shot-plate compositor prompt — copied from original Skidmarks Studio
 * `plateCastIntoGen` / `buildPlatePrompt` (`comfybear71/skidmarks`,
 * `src/lib/plateCast.ts`) for the n=1, first-pass case. That repo does
 * NOT overlay a second image in the LTX graph. LTX node `269` is a
 * single LoadImage of the **already composed** plate. Overlay is xAI
 * `/v1/images/edits` with two references:
 *   Image 1 / `<IMAGE_0>` = locked empty location (the canvas)
 *   Image 2 / `<IMAGE_1>` = the character's Cast card main picture
 * `generate-speak-beat` is the caller (Studio's gen-plate + LTX in one
 * route). Image 2 is always the Cast card main picture. Gold Hold/Speak strings stay untouched — they already assume
 * the start image has both the person and the place.
 */
export function buildSunnyBanksCompositePlatePrompt(
  character: SunnyBanksCharacterLock,
  location: SunnyBanksLocationLock,
  appearanceOverride?: string,
  /** The shot's own `[Action: …]` text (2026-10-01): silent holds send it
   * so the start still already shows what the shot describes (pose,
   * what's in their hands), not only the later motion prompt. */
  shotAction?: string
): string {
  const trimmedOverride = appearanceOverride?.trim() || "";
  const trimmedAction = shotAction?.replace(/\s+/g, " ").trim() || "";
  const shotText = Boolean(trimmedOverride || trimmedAction);
  // What's held (2026-10-01, Stuart): the shot's own text when it has
  // some, otherwise the Cast card picture. The look text never names a
  // held thing any more (EP02 Act II row 1's meat pie came from it).
  const propLine = shotText
    ? "Held objects: only what this shot's text below names. Do not copy any object from image 2 that the text doesn't name. Do not invent anything beyond what it names."
    : "Held objects: only what image 2 already shows in their hands; if its hands are empty, keep them empty. Do not invent a phone or extra objects.";
  // A silent shot's action sets the framing (2026-10-01): "Wide … walks
  // away … side on" lost to a forced medium shot, dead centre.
  const framingLine = trimmedAction
    ? "Framing follows this shot's text below. Keep the locked place from image 1 behind them. One person only."
    : "MEDIUM SHOT framing: figure large in frame, dead centre horizontally. Keep the locked place from image 1 behind them. One person only.";
  // An action says how they stand and move, so the pose comes from it,
  // not image 2. An override alone keeps the pose (as before).
  const bodyLine = trimmedAction
    ? "Keep the same body, clothes, and face identity from image 2 — same person, do not turn them into a different person, do not invent a second person, no passer-by. Pose and anything held follow this shot's text below."
    : trimmedOverride
      ? "Keep the same body pose, body, and face identity from image 2 — same person, do not turn them into a different person, do not invent a second person, no passer-by. Change only what the shot-specific override below explicitly names."
      : "Keep the EXACT body pose, clothes, and body from image 2. Same face from image 2. Do not stand them up. Do not change their clothes. Do not invent a second person. No passer-by. No extra body in the distance.";

  const lines = [
    SUNNY_BANKS_STYLE_LOCK,
    "<IMAGE_0> is the LOCKED background — keep that exact place, lighting and materials. Do not move the camera. Do not replace the location with a photo street. Remove any people or crowds already in image 1 — empty place only.",
    "<IMAGE_1> is the person — same face identity, hair, age and body from image 2. Do not turn them into a different person.",
    "Place that same person from image 2 into image 1.",
    bodyLine,
    "One person only. Only that person in frame, no one else appears. Empty of extra people and animals.",
    framingLine,
    `Staging / tweak: ${character.name}, ${character.look}, at ${location.label}.`,
    propLine,
    "No captions, no watermarks, no name tags. Keep any signage that is already part of the locked place in image 1.",
  ];
  if (trimmedAction) {
    lines.push(`This shot: ${trimmedAction}.`);
  }
  if (trimmedOverride) {
    lines.push(`Shot-specific override for this render only: ${trimmedOverride}.`);
  }
  return lines.join("\n\n");
}

/**
 * Locked park plates — Stuart's own full-frame location stills
 * (2026-09-17), not generated here. Empty of cast on purpose: they are
 * compositor **Image 1** (the location canvas). `generate-speak-beat`
 * overlays the character's Cast card picture as Image 2, then sends the composed
 * still to LTX node `269`. Keyed by a stable id the Locations
 * `<select>` stores (`selectedLocationId`), never a synthetic
 * `characterId`. Not a pose picker and not a sequencer — one native
 * dropdown, one clip at a time.
 *
 * These files are already 1280×720, so `letterboxImageForLtxIa2v` is a
 * no-op on them (source aspect already 16:9).
 */
export type SunnyBanksBuiltInLocationId =
  | "water_tank_dam"
  | "main_entrance_sign"
  | "site_laundry"
  | "office_storefront"
  | "tin_shed_mower"
  | "caravan_interior"
  | "park_site_4"
  | "office_booth"
  | "rock_art_outcrop";

/**
 * A location's key: one of the built-ins above, or one Stuart saved on
 * the Locations row (2026-09-30, `lib/deckLocations.ts`). Any key is
 * kept as it is (never quietly turned into the default); a key that
 * isn't in the saved list shows a warning on its row instead.
 */
export type SunnyBanksLocationId = string;

export interface SunnyBanksLocationLock {
  id: SunnyBanksLocationId;
  label: string;
  /** A repo file (`/skidmarks/sunnybanks/...`) or a Deck Blob URL. */
  image: string;
  /** The picture already has the people in it (2026-10-03, the Locations
   * row's "don't add Cast" tick): used as the start picture as it is. */
  peopleInPicture?: true;
}

export const SUNNY_BANKS_DEFAULT_LOCATION_ID: SunnyBanksLocationId = "office_storefront";

/**
 * The built-in list. The Locations row and the renderer use it until
 * Stuart's saved locations are in (`deck_items` kind `location`), so
 * nothing changes before the seed. The last three (2026-09-30) are
 * Stuart's own pictures: EP01's Park Site 4 scene rendered on the
 * storefront because `park_site_4` wasn't a known key.
 */
export const SUNNY_BANKS_LOCATIONS: Record<SunnyBanksBuiltInLocationId, SunnyBanksLocationLock> = {
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
  park_site_4: {
    id: "park_site_4",
    label: "Park Site 4",
    image: "/skidmarks/sunnybanks/park-site-4.jpg",
  },
  office_booth: {
    id: "office_booth",
    label: "Site Office Booth",
    image: "/skidmarks/sunnybanks/office-booth.jpg",
  },
  rock_art_outcrop: {
    id: "rock_art_outcrop",
    label: "Rock Art Outcrop",
    image: "/skidmarks/sunnybanks/rock-art-outcrop.jpg",
  },
};

/** A built-in location by its key. For the saved list, use `lib/sunnyBanksLocations.ts`. */
export function getSunnyBanksLocation(id: string): SunnyBanksLocationLock | undefined {
  return Object.prototype.hasOwnProperty.call(SUNNY_BANKS_LOCATIONS, id)
    ? SUNNY_BANKS_LOCATIONS[id as SunnyBanksBuiltInLocationId]
    : undefined;
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
 * Dazza only. His old look lock listed alternate held objects ("beers,
 * coins, or pink hair dryer" / later "beer can") — live QA: LTX
 * treated that "or" as permission to morph or drop the prop mid-clip.
 * It no longer names any object (2026-09-30: naming "coins" is what
 * turned him into one); it only says whatever is in his hands in the
 * start image stays put. The gold template itself is unchanged
 * (Jack-Ash hallmark pattern: append, never rewrite the proven
 * template).
 */
export const SUNNY_BANKS_HELD_OBJECT_LOCK =
  "Held objects stay locked and static for the full duration — whatever is in the character's hands in the start image must not morph, swap, or disappear.";

function accessoryLockSuffix(character: SunnyBanksCharacterLock): string {
  if (character.name !== "Dazza") return "";
  return (
    ` ${SUNNY_BANKS_HELD_OBJECT_LOCK} Whatever Dazza is holding stays exactly as shown in the start image, ` +
    `without morphing or disappearing over the clip.`
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
export function buildSunnyBanksHoldPrompt(character: SunnyBanksCharacterLock, shotAction?: string): string {
  // A silent shot with its own `[Action: …]` (2026-10-01): the action
  // (appended after this by the caller) sets framing and movement, so
  // "holds their pose, subtle idle motion" and "Camera holds" are left
  // out. EP02 Act II row 1 asked for a wide walk away, side on, and got
  // Nuggets standing still facing the camera.
  if (shotAction?.trim()) {
    return (
      `Use the provided start image as the first frame. ${character.name}, ${character.look}. Heat haze, flies. ` +
      `Props and background stay exactly as the start image, nothing new enters frame. No dialogue. No cuts. ` +
      `Same person and objects as the start image. ${SUNNY_BANKS_STYLE_LOCK}` +
      accessoryLockSuffix(character)
    );
  }
  return (
    `Use the provided start image as the first frame. ${character.name}, ${character.look} holds their pose, ` +
    `subtle idle motion, weight shift, breathing, heat haze, flies. Props and background stay exactly as the ` +
    `start image, nothing new enters frame. No dialogue. Camera holds, no cuts. Same person and objects as the ` +
    `start image. ${SUNNY_BANKS_STYLE_LOCK}` +
    accessoryLockSuffix(character)
  );
}
