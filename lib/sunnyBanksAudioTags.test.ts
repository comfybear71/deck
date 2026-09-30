/**
 * Eleven v3 audio tags through the Sunnybank script parser (2026-09-30).
 *
 * The parser lives in `components/SkidmarksSunnyBanksPanel.tsx`; these
 * tests sit in their own file so they don't collide with other work on
 * that component's own test file. They pin the contract the Eleven v3
 * switch in `lib/elevenLabsSpeech.ts` relies on: inline `[whispers]`-
 * style tags stay in the spoken line (so ElevenLabs can perform them),
 * while the three picture directives keep being pulled out exactly as
 * before.
 */
import { describe, expect, it } from "vitest";
import {
  buildSunnyBanksHighlightSegments,
  formatSunnyBanksGodScript,
  parseSunnyBanksScriptBlock,
  sunnyBanksQueueChunks,
} from "@/components/SkidmarksSunnyBanksPanel";
import { sunnybankBeatTarget } from "./deckMediaPaths";

const TAGGED = "oi, here we go, [pause] [whispers] another bus load of suckers...";

describe("Sunnybank parser keeps inline audio tags in the spoken line", () => {
  it("a Speak row carries the tags verbatim", () => {
    const [chunk] = parseSunnyBanksScriptBlock(`Shazza: ${TAGGED}`);
    expect(chunk).toMatchObject({ characterName: "Shazza", kind: "speak", line: TAGGED });
  });

  it("picture directives on the same line still work, and aren't mistaken for audio tags", () => {
    const chunks = parseSunnyBanksScriptBlock(
      [
        "[Location: office_storefront]",
        "[Character Dazza: holding two beers]",
        "[Action: leans in close] Dazza: [whispers] don't tell Nan. [laughs]",
      ].join("\n")
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      characterName: "Dazza",
      kind: "speak",
      line: "[whispers] don't tell Nan. [laughs]",
      locationId: "office_storefront",
      action: "leans in close",
      appearanceModifier: "holding two beers",
    });
  });

  it("an audio tag is never taken as a [Character …] look or an [Action:]", () => {
    const [chunk] = parseSunnyBanksScriptBlock("Nan: [sighs] [sarcastic] lovely, just lovely.");
    expect(chunk.line).toBe("[sighs] [sarcastic] lovely, just lovely.");
    expect(chunk.action).toBeUndefined();
    expect(chunk.appearanceModifier).toBeUndefined();
  });

  it("a continuation line (no name) keeps its tags for the previous speaker", () => {
    const chunks = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("Shazza: right.\n[laughs] yeah nah."));
    expect(chunks.map((c) => [c.characterName, c.line])).toEqual([
      ["Shazza", "right."],
      ["Shazza", "[laughs] yeah nah."],
    ]);
  });

  it("⇥ Format does not break a line at an audio tag (only at picture tags and names)", () => {
    const formatted = formatSunnyBanksGodScript(`[Location: office_storefront] Shazza: ${TAGGED}`);
    expect(formatted.split("\n")).toEqual(["[Location: office_storefront]", `Shazza: ${TAGGED}`]);
  });

  it("audio tags draw as plain (spoken-line) text, not as a picture-tag colour", () => {
    const segments = buildSunnyBanksHighlightSegments(`Shazza: ${TAGGED}`);
    expect(segments.every((segment) => segment.kind === "plain")).toBe(true);
  });

  it("clip file names never carry the line (or its tags) — only episode, act, beat, speaker, kind", () => {
    const target = sunnybankBeatTarget({
      episodeSlug: "crash-lab-ep02",
      actId: "I",
      beatNumber: 3,
      characterName: "Shazza",
      kind: "speak",
    });
    expect(target?.name).toBe("crash-lab-ep02-act-i-beat-03-shazza-speak");
    expect(target?.name).not.toMatch(/whisper|pause|\[/);
  });
});
