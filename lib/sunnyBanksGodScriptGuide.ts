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
 * **Cast and location lists are derived from `SUNNY_BANKS_CAST` and
 * `SUNNY_BANKS_LOCATIONS`, never retyped** — a new location or a
 * renamed regular updates this guide automatically instead of quietly
 * going stale. The rules themselves are prose and do have to be kept in
 * step with the parser by hand; `lib/sunnyBanksGodScriptGuide.test.ts`
 * runs this guide's own worked example through the real parser so a
 * parser change that breaks the documented shape fails a test rather
 * than silently teaching the wrong format.
 *
 * Not a validator and not a linter — this is documentation. Checking a
 * pasted script against these rules is a separate job nobody has asked
 * for yet.
 */

import { SUNNY_BANKS_CAST, SUNNY_BANKS_LOCATIONS } from "./sunnyBanks";

/** The six series regulars, in cast-strip order. Hans is in
 * `SUNNY_BANKS_CAST` as a one-episode guest with no locked voice, so he
 * cannot speak a beat and is deliberately not listed here — same rule
 * the always-on cast strip already follows. */
export function listSunnyBanksSpeakingCast(): string[] {
  return Object.values(SUNNY_BANKS_CAST)
    .filter((character) => !!character.voiceId)
    .map((character) => character.name);
}

/** `[Location: id]` takes the id, not the human label — the panel's own
 * dropdown stores the same id. Both are listed so a draft can be read
 * back by a person. */
export function listSunnyBanksLocationIds(): { id: string; label: string }[] {
  return Object.values(SUNNY_BANKS_LOCATIONS).map((location) => ({
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
    title: "There are exactly three tags",
    body: [
      "Anything else in square brackets is not a tag. It becomes dialogue and the character says those words out loud in a paid clip.",
      "No [Outfit:], no [silence], no [beat], no [SFX]. Coloured = understood. White = it will be spoken.",
    ],
    example: "[Location: office_storefront]\n[Character Shazza: holding a rusty tin]\n[Action: counts a stack of bills]",
  },
  {
    title: "Silence is an empty name",
    body: [
      "A name with nothing after the colon is a silent hold. That is the only way to write silence — never [silence].",
    ],
    example: "Shazza: Are you kidding me?   ← speaks\nShazza:                        ← silent hold",
  },
  {
    title: "A tag is used up by the next row",
    body: [
      "[Character ...] and [Action: ...] attach to the next row and are then cleared. If the look carries on, repeat the tag.",
      "Tag a look, write a silent hold, then write dialogue — and the dialogue renders at the character's plain default look.",
    ],
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
  "Dazza: Yeah nah, told ya it'd work.",
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
export function buildSunnyBanksGodScriptPrompt(): string {
  const cast = listSunnyBanksSpeakingCast().join(", ");
  const locations = listSunnyBanksLocationIds()
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

2. THERE ARE EXACTLY THREE BRACKET TAGS. Nothing else in square brackets
   is understood:
      [Location: <id>]
      [Character <Name>: <description>]
      [Action: <text>]
   Any other bracketed text — [Outfit: ...], [silence], [beat], [SFX],
   [pause], stage directions — is NOT a tag. It is treated as dialogue
   and the character will literally say those words out loud in a paid
   clip. Never invent a tag.

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

=== THE CAST (use these names exactly, including capitals) ===

   ${cast}

   Any other name (e.g. "Crowd:") with an empty line after it renders a
   location shot with no character in it. Any other name WITH dialogue
   is rejected — only the cast above can speak.

=== THE LOCATIONS (use the id on the left, exactly) ===

${locations}

   A [Location: id] stays in effect until the next [Location: id]. Do
   not repeat it for consecutive lines in the same place.

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

=== WHAT [Action: ...] IS FOR ===

   Movement during the clip — what the character does while the camera
   holds. Keep it to one continuous motion. No cuts, no camera moves, no
   scene changes.

   Good:  [Action: counts a thick stack of bills, wetting her thumb]
   Bad:   [Action: she counts the money, then walks outside and drives off]

=== A CORRECT EXAMPLE ===

${SUNNY_BANKS_GOD_SCRIPT_EXAMPLE}

=== END OF FORMAT ===

Output the script as plain text only. No markdown code fences, no
commentary, no explanation before or after. Just the script.`;
}
