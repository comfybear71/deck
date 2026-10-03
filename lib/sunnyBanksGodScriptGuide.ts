/**
 * The God Script format, written down — an on-page cheat sheet plus the
 * same rules as one copy-pasteable prompt for whatever LLM Stuart is
 * drafting scripts with.
 *
 * Why this file exists: the format is enforced by
 * `parseSunnyBanksScriptBlock` in `components/SkidmarksSunnyBanksPanel
 * .tsx`, and getting it wrong costs a real paid render — a line that
 * isn't a recognised tag is read aloud by ElevenLabs and animated by
 * LTX. Live QA (2026-09-18): a drafted Act IV used `[Outfit: ...]` and
 * `[silence]`, neither of which is a real tag, and arrived as one
 * unbroken line. Every one of those would have billed a clip of the
 * character reading the tag text out loud.
 *
 * **Cast and location lists are derived, never retyped** — from the
 * saved characters (`sunnyBanksSpeakerList`: the built-in cast with any
 * voice saved on their card, plus characters added with "+") and the
 * Locations row (`sunnyBanksLocationList`: saved locations, or the
 * built-ins until there are some), 2026-09-30. Hans used to be left out
 * because his voice is on his card, not in `SUNNY_BANKS_CAST`. Left out,
 * both fall back to the built-in tables. The rules themselves are prose and do have to be kept in
 * step with the parser by hand; `lib/sunnyBanksGodScriptGuide.test.ts`
 * runs this guide's own worked example through the real parser so a
 * parser change that breaks the documented shape fails a test rather
 * than silently teaching the wrong format.
 *
 * **Voice tags (2026-09-30).** Speech now goes through ElevenLabs'
 * Eleven v3 (`lib/elevenLabsSpeech.ts`), which performs inline audio
 * tags — `[whispers]`, `[laughs]`, `[short pause]` — instead of reading
 * them out. So "anything else in brackets is spoken aloud" is no longer
 * true *inside a spoken line*: the parser leaves those brackets in the
 * line and v3 treats them as delivery. The picture tags are
 * unchanged by that (a fourth, `[Cast: A, B]`, arrived 2026-10-03 with
 * multi-cast shots, see `lib/shotCast.ts`). A voice tag on its own line, or in front of the `Name:`,
 * is still a trap (it becomes a spoken row for the previous speaker),
 * so the rules say "after the colon".
 *
 * Not a validator and not a linter — this is documentation. Checking a
 * pasted script against these rules is a separate job nobody has asked
 * for yet.
 */

import { resolveSunnyBanksStartImage, SUNNY_BANKS_CAST, SUNNY_BANKS_LOCATIONS, type SunnyBanksCharacterLock } from "./sunnyBanks";

/** A character as the guide needs it: name, voice, and a picture to plate. */
type GuideCharacter = Pick<SunnyBanksCharacterLock, "name" | "voiceId"> & Partial<SunnyBanksCharacterLock>;

/** Who can speak a line: every saved character with a voice, in cast-strip
 * order (`sunnyBanksSpeakerList(state)` from the panel). Left out, the
 * built-in cast with a locked voice. */
export function listSunnyBanksSpeakingCast(characters?: readonly GuideCharacter[]): string[] {
  const list = characters ?? Object.values(SUNNY_BANKS_CAST);
  return list.filter((character) => !!character.voiceId).map((character) => character.name);
}

/** Saved characters with no voice yet, and what they can do: a silent
 * hold if they have a picture, nothing until they have one. */
export function listSunnyBanksNonSpeakingCast(characters?: readonly GuideCharacter[]): { name: string; note: string }[] {
  const list = characters ?? Object.values(SUNNY_BANKS_CAST);
  return list
    .filter((character) => !character.voiceId)
    .map((character) => ({
      name: character.name,
      note: resolveSunnyBanksStartImage(character as SunnyBanksCharacterLock)
        ? "no voice yet, silent holds only"
        : "no voice or picture yet, can't be used",
    }));
}

/** `[Location: id]` takes the id, not the human label — the panel's own
 * dropdown stores the same id. Both are listed so a draft can be read
 * back by a person. */
export function listSunnyBanksLocationIds(
  /** The Locations row's list (`sunnyBanksLocationList`); the built-ins when left out. */
  locations: readonly { id: string; label: string }[] = Object.values(SUNNY_BANKS_LOCATIONS),
): { id: string; label: string }[] {
  return locations.map((location) => ({
    id: location.id,
    label: location.label,
  }));
}

/** One card per rule on the on-page cheat sheet. `body` lines render as
 * separate paragraphs; `example` renders in the same monospace block
 * the script textarea uses, so a rule and its shape sit together. */
export interface SunnyBanksGuideRule {
  title: string;
  body: string[];
  example?: string;
}

export const SUNNY_BANKS_GOD_SCRIPT_RULES: SunnyBanksGuideRule[] = [
  {
    title: "One thing per line",
    body: [
      "Every tag and every spoken line needs its own real line break. The script is parsed line by line — a block pasted with no breaks becomes ONE clip of the whole thing read aloud.",
      "Pasted from somewhere else and it all ran together? Tap Format.",
    ],
  },
  {
    title: "There are exactly four picture tags",
    body: [
      "[Location: …], [Character …], [Action: …] and [Cast: …] change the picture. Each goes on its own line and is never spoken.",
      "Don't invent more: no [Outfit:], no [SFX:], no [silence]. Coloured = a picture tag. White = the spoken line.",
    ],
    example: "[Location: office_storefront]\n[Character Shazza: holding a rusty tin]\n[Action: counts a stack of bills]",
  },
  {
    title: "Up to four people in one shot",
    body: [
      "A shot can hold up to four Cast characters, each matching their own Cast card picture. Name them and they're in: [Cast: Stuie, Bloom] says exactly who. Without [Cast:], anyone named in the [Action: …], or given their own [Character Name: …] look, is added to the speaker.",
      "[Character Name: …] with the speaker's own name is still the speaker's look. With another Cast name, that look goes to that person only.",
      "Names match Cast cards in any capitals (STUIE = Stuie). Names inside the spoken words don't add anyone. Everyone in the shot needs a Cast card picture, or the row turns red and won't render. The row shows who's in it: Stuie + Bloom.",
    ],
    example:
      "[Location: water_tank_dam]\n[Character Bloom: long blond man-bun, grey harem pants, back to camera, yoga tree pose, foreground]\n[Action: Ranger Bazza rising out of the muddy dam with a snorkel, holding up a ticket book. Camera still.]\nRanger Bazza:",
  },
  {
    title: "Two people talking in one shot",
    body: [
      "Put both lines straight under one [Action: …] (or [Cast: …]) with no tag between them. They become one scene: one shared picture with both people, used for each line. Each line, only the speaker's mouth moves; the other listens, mouth closed.",
      "Say where each one stands in the [Action: …] (front left, on the right). A tag between two lines starts a new shot, so put [Location: …] above each line when you want them separate.",
    ],
    example:
      "[Location: park_site_4]\n[Action: Both men stay in frame, mouths closed. BLOOM, front left, folds his arms; STUIE, on the right, scratches his head. Camera holds, no cuts.]\nSTUIE: Hello BLOOM\nBLOOM: Namaste STUIE",
  },
  {
    title: "Voice tags go inside the line, after the colon",
    body: [
      "Any other [word] inside a spoken line tells the voice how to say it (ElevenLabs v3): [whispers], [laughs], [sighs], [shouts], [sarcastic], [excited], [short pause], [long pause]. It isn't read out.",
      "Always after the Name: — a voice tag on its own line or before the name becomes its own clip. They stay white in the box. A voice that was never trained on a delivery may do it weakly.",
    ],
    example: "Shazza: oi, here we go, [short pause] [whispers] another bus load of suckers...",
  },
  {
    title: "Silence is an empty name",
    body: [
      "A name with nothing after the colon is a silent hold. That is the only way to write silence — never [silence].",
    ],
    example: "Shazza: Are you kidding me?   ← speaks\nShazza:                        ← silent hold",
  },
  {
    title: "[Character …] on a talking line is a still pose",
    body: [
      "On a line with dialogue, describe a still pose only: standing or sitting, where they are, what they're holding. Movement goes in a silent hold (Name: with nothing after it) with an [Action: …].",
      "For the same character in the same scene, repeat the tag word for word on every line, so their look and props don't shift between clips.",
    ],
    example:
      "[Character Shazza: standing behind the counter, holding a clipboard]\nShazza: Right, who's next?\n[Character Shazza: standing behind the counter, holding a clipboard]\nShazza: Don't all rush at once.\n[Action: slams the clipboard down and storms out]\nShazza:",
  },
  {
    title: "A tag is used up by the next row",
    body: [
      "[Character ...] and [Action: ...] attach to the next row and are then cleared. If the look carries on, repeat the tag.",
      "Tag a look, write a silent hold, then write dialogue — and the dialogue renders at the character's plain default look.",
    ],
  },
  {
    title: "[GROK], [LTX] or [H3] picks the video engine",
    body: [
      "Talking lines always render on LTX, so the lips match the voice. Silent holds and Crowd cutaways render on Grok, or on H3 with the switch above Render.",
      "Type [GROK], [LTX] or [H3] on a line (after the Name:, or alone on the line above it) to choose for that row. It shows red, is never spoken, and each row shows its engine. On a talking line only [LTX] counts: [GROK] and [H3] are ignored, with a note on the row.",
    ],
    example: "Ranger Bazza: [H3]\nCrowd: [LTX]\n[GROK]\nShazza:",
  },
  {
    title: "A line with no name continues the last speaker",
    body: [
      "Stray prose lines are not ignored — they become spoken words for whoever spoke last. Don't leave notes to yourself in the script.",
    ],
  },
  {
    title: "Location sticks until you change it",
    body: [
      "[Location: id] stays in effect for every following row until the next [Location: id]. No need to repeat it.",
      "Use an id from the Locations list below (the Locations row). An id that isn't on it gets a red warning on its row and won't render until you add that location or fix the tag.",
    ],
  },
  {
    title: "Describe the picture, not the feeling",
    body: [
      "[Character ...] builds the clip's first frame, so write what is visible.",
      "Good: sitting cross-legged behind the table, a pile of $50 notes in front of her. Bad: feeling triumphant about the money.",
    ],
  },
  {
    title: "One continuous motion per Action",
    body: [
      "[Action: ...] is what happens while the camera holds. No cuts, no camera moves, no going somewhere else.",
      "Good: counts a thick stack of bills, wetting her thumb. Bad: counts the money, then walks outside and drives off.",
    ],
  },
  {
    title: "Headers are free",
    body: [
      "Headers never render a clip, so use as many as you like.",
      "The only line that starts with # is # EPISODE:. Don't write # Act II or any other # heading — start an act with === ACT II ===.",
    ],
    example: "# EPISODE: The Payoff\n=== ACT I ===\n=== ACT IV — THE PAYOFF ===\n=== ANY OTHER LABEL ===",
  },
];

/** The worked example carried by both the cheat sheet and the prompt.
 * `lib/sunnyBanksGodScriptGuide.test.ts` runs this through the real
 * `parseSunnyBanksScriptBlock`, so it cannot drift into teaching a
 * shape the parser no longer reads. Note the repeated `[Character ...]`
 * — that is rule 4 being demonstrated, not a copy/paste slip. */
export const SUNNY_BANKS_GOD_SCRIPT_EXAMPLE = [
  "# EPISODE: The Payoff",
  "",
  "=== ACT IV — SCENE A1 — THE PAYOFF ===",
  "[Location: office_storefront]",
  "[Character Shazza: casual, sitting cross-legged on the floor behind the empty table, a massive pile of $50 notes spread out in front of her]",
  "[Action: aggressively counts a thick stack of bills, wetting her thumb and grinning widely]",
  "Shazza:",
  "[Character Shazza: casual, sitting cross-legged on the floor behind the empty table, a massive pile of $50 notes spread out in front of her]",
  "Shazza: Are you bloody kidding me?! We made an absolute killing on this stuff!",
  "Dazza: [laughs] Yeah nah, told ya it'd work.",
].join("\n");

/**
 * The same rules as one plain-text prompt to hand an LLM that's drafting
 * the next batch of scripts. Built rather than stored so the cast and
 * location lists come straight from the real locks.
 *
 * Deliberately blunt about cost — an LLM that invents `[Outfit:]`
 * because it reads naturally is not making a formatting mistake, it is
 * spending money on a clip of someone reading the word "Outfit" aloud.
 */
export function buildSunnyBanksGodScriptPrompt(
  /** The Locations row's list; the built-ins when left out. */
  locationList?: readonly { id: string; label: string }[],
  /** The saved characters (`sunnyBanksSpeakerList(state)`); the built-in cast when left out. */
  characters?: readonly GuideCharacter[],
): string {
  const cast = listSunnyBanksSpeakingCast(characters).join(", ");
  const nonSpeaking = listSunnyBanksNonSpeakingCast(characters);
  const nonSpeakingText =
    nonSpeaking.length === 0
      ? ""
      : `\n\n   Not speaking yet: ${nonSpeaking.map((c) => `${c.name} (${c.note})`).join(", ")}.`;
  const locations = listSunnyBanksLocationIds(locationList)
    .map(({ id, label }) => `   ${id.padEnd(20)} — ${label}`)
    .join("\n");

  return `You are writing scripts in a strict format called a "God Script" for an
animated show called Sunny Banks. The script is pasted into a tool that
parses it line by line and turns each line into a rendered video clip.
Every clip costs real money, so a malformed line wastes a paid render.

Follow these rules exactly. Do not improvise new syntax.

=== HARD RULES ===

1. ONE THING PER LINE. Every tag and every spoken line gets its own line
   with a real line break. Never run tags together on one line. A block
   with no line breaks becomes a single clip of the entire text read
   aloud.

2. THERE ARE EXACTLY FOUR PICTURE TAGS, each on its own line:
      [Location: <id>]
      [Character <Name>: <description>]
      [Action: <text>]
      [Cast: <Name>, <Name>]
   Never invent another picture tag — no [Outfit: ...], [SFX: ...],
   [silence], [Scene: ...] or other stage directions on their own line.
   Anything the parser doesn't recognise on its own line becomes
   dialogue for the previous speaker and costs a paid clip.

   VOICE TAGS are different: short delivery cues INSIDE a spoken line,
   AFTER the "Name:", e.g.
      Shazza: oi, here we go, [short pause] [whispers] another bus load of suckers...
   The voice engine (ElevenLabs Eleven v3) performs them instead of
   saying them. Good ones: [whispers], [laughs], [chuckles], [sighs],
   [shouts], [sarcastic], [excited], [nervous], [short pause],
   [long pause]. Use them sparingly, only for how the words sound —
   never for movement, props or sound effects (that is [Action: ...]).
   Never put a voice tag on its own line or before the name.

3. A SPOKEN LINE is:      Name: dialogue goes here
   A SILENT HOLD is:      Name:
   (the name, a colon, and nothing after it). That is the ONLY way to
   write silence. Never write [silence].

4. [Character ...] and [Action: ...] apply to THE NEXT ROW ONLY and are
   then cleared. If the same look or action must continue onto the next
   spoken line, repeat the tag before that line. This matters: if you
   tag a look, then write a silent hold, then write dialogue, the
   dialogue renders with the character's plain default appearance.

5. A line with no "Name:" prefix continues the previous speaker's
   dialogue. Do not leave stray prose lines around — they become spoken
   words.

6. NO "#" LINES except "# EPISODE: Title". Never write "# Act II",
   "# Scene" or any other markdown heading. Start an act with
   === ACT II ===.

7. VIDEO ENGINE TAGS [GROK], [LTX] and [H3] are optional. Leave them
   out unless asked: the tool already renders talking lines on LTX and
   silent holds on Grok or H3. Written after the "Name:" (or alone on
   the line above), one picks the engine for that row. On a talking
   line only [LTX] counts; [GROK] and [H3] are ignored. They are never
   spoken.

=== THE CAST (use these names exactly, including capitals) ===

   ${cast}${nonSpeakingText}

   Any other name (e.g. "Crowd:") with an empty line after it renders a
   location shot with no character in it. Any other name WITH dialogue
   is rejected — only the cast above can speak.

=== THE LOCATIONS (use the id on the left, exactly) ===

${locations}

   A [Location: id] stays in effect until the next [Location: id]. Do
   not repeat it for consecutive lines in the same place.

   Use only the ids above. An id that isn't in this list gets a red
   warning in the tool and WILL NOT RENDER until that location is added.

=== HEADERS ===

   # EPISODE: Title Here          sets the episode name
   === ACT I ===                  starts an act (I, II, III, IV ...)
   === ACT III — THE CON ===      an act with a title, same thing
   === ANY OTHER LABEL ===        a scene marker, renders nothing

   Headers are not clips. Use them freely.

=== WHAT [Character ...] IS FOR ===

   Each cast member has a locked default look. [Character Name: ...] is
   how you change it for one shot — a prop in their hands, a different
   outfit, an injury, a pose. Write it as a plain physical description
   of what is visible. It is fed to the image generator that builds the
   clip's first frame, so describe the picture, not the intent.

   Good:  [Character Shazza: sitting cross-legged on the floor behind an
          empty table, a huge pile of $50 notes spread in front of her]
   Bad:   [Character Shazza: feeling triumphant about the money]

   On a TALKING line, [Character ...] is a STILL POSE only: standing or
   sitting, where they are, what they are holding. No movement. For the
   same character in the same scene, repeat the exact same words every
   time, so their look and props don't shift from clip to clip. Put
   movement in a silent hold (Name: with nothing after it) with an
   [Action: ...] instead.

=== WHAT [Action: ...] IS FOR ===

   Movement during the clip — what the character does while the camera
   holds. Keep it to one continuous motion. No cuts, no camera moves, no
   scene changes.

   Good:  [Action: counts a thick stack of bills, wetting her thumb]
   Bad:   [Action: she counts the money, then walks outside and drives off]

=== MORE THAN ONE PERSON IN A SHOT ===

   A shot can hold up to four cast members, each kept to their own
   picture. [Cast: Name, Name] on the line above says exactly who is in
   it. Without it, the speaker plus anyone named in that shot's
   [Action: ...] or given their own [Character Name: ...] look is in it.
   Names inside the spoken words never add anyone.

   TWO PEOPLE TALKING IN ONE SHOT: put both spoken lines straight under
   one [Action: ...] with no tag between them. They share one picture;
   on each line only the speaker talks and the other keeps their mouth
   closed. Say where each one stands (front left, on the right).

      [Location: park_site_4]
      [Action: Both men stay in frame, mouths closed. BLOOM, front left, folds his arms; STUIE, on the right, scratches his head. Camera holds, no cuts.]
      STUIE: Hello BLOOM
      BLOOM: Namaste STUIE

   To keep lines as separate shots, put a tag (e.g. [Location: id])
   above each one.

=== A CORRECT EXAMPLE ===

${SUNNY_BANKS_GOD_SCRIPT_EXAMPLE}

=== END OF FORMAT ===

Output the script as plain text only. No markdown code fences, no
commentary, no explanation before or after. Just the script.`;
}
