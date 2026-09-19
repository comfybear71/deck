import { describe, expect, it } from "vitest";
import {
  buildScriptSequenceHighlightSegments,
  canonicalizeScriptPartTitle,
  formatScriptSequencePartTitles,
  parseScriptSequence,
} from "./scriptSequence";

/** Stuart's own real "Liquid Horizon" script, verbatim (2026-09-14) —
 * the actual regression this parser exists for, not a hand-simplified
 * stand-in. Every part runs directly into the next with no separator,
 * exactly as pasted. */
const LIQUID_HORIZON_SCRIPT =
  "Part 1 (0:00 - 0:15) — The Liquid Horizon[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. A dense sheet of molten glass transitions into a playful, undulating pattern, continuously morphing and flowing across the frame like heavy mercury rippling under intense, shifting light. Smooth, surreal motion, trippy flowing physics, looping seamlessly into liquid glass ripples at the right edge." +
  "Part 2 (0:15 - 0:30) — The Mercury Vortex[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The liquid glass ripples from the previous scene begin to pull inward, forming a swirling, hypnotic vortex of heavy mercury. Sharp white specular reflections tear across deep black valleys as the fluid undulating patterns twist into a clockwise spiral." +
  "Part 3 (0:30 - 0:45) — Geometric Shards[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The mercury vortex destabilises, fractured by razor-sharp white crystalline lines. The fluid, undulating pattern morphs seamlessly into geometric, multi-faceted liquid shards that slide over one another like an abstract, moving monochrome jigsaw puzzle." +
  "Part 4 (0:45 - 1:00) — Digital Topology[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The moving shards melt backward, flattening into a trippy, continuous topological grid map. The valleys are pure ink-black, while the crests pulse with pure, bright white light, creating an undulating wireframe wave that ripples rhythmically across the screen." +
  "Part 5 (1:00 - 1:15) — Ferrofluid Spikes[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The topological grid compresses violently, erupting into a landscape of organic, hyper-detailed spikes resembling magnetic ferrofluid. The heavy mercury texture returns, with the spikes continuously rising, melting, and undulating in a trippy, rhythmic cadence." +
  "Part 6 (1:15 - 1:30) — The Silk Lattice[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The ferrofluid spikes soften and stretch out, morphing into long, continuous ribbons of pure white silk floating in a pitch-black void. The ribbons twist, overlap, and undulate smoothly, creating an optical illusion of endless depth." +
  "Part 7 (1:30 - 1:45) — Cellular Metamorphosis[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The silk ribbons dissolve at their edges into tiny, glistening liquid cells. A dense lattice of pure white bubbles continuously morphs, divides, and flows across the frame like a microscopic view of mercury lifeforms multiplying in high contrast." +
  "Part 8 (1:45 - 2:00) — The Molten Labyrinth[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The dividing cells stretch and connect, forming a shifting, trippy labyrinth of thick liquid channels. Heavy molten glass flows through these pure white corridors against a stark black background, undulating and pulsating to a steady rhythm." +
  "Part 9 (2:00 - 2:15) — Cascading Ribbons[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The walls of the labyrinth collapse into a downward vertical cascade. Parallel bands of pure white and deep black liquid slide past each other in opposing directions, creating an undulating, trippy waterfall effect of heavy mercury." +
  "Part 10 (2:15 - 2:30) — Concentric Echoes[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The vertical cascade ripples outward from the center, turning into expanding concentric rings of liquid glass. The ripples pulse across the frame, each wave morphing from smooth curves into jagged white lines before returning to a heavy, fluid mercury state." +
  "Part 11 (2:30 - 2:45) — The Shimmering Mist[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The concentric rings atomize into a heavy, undulating mist of micro-droplets. Billows of pure white smoke-like fluid contrast sharply against absolute black, morphing continuously like ink dropped into water in slow motion." +
  "Part 12 (2:45 - 3:00) — Fractal Tendrils[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The undulating fluid mist condenses back into sharp, solid structures, growing long, trippy fractal tendrils of pure white glass. The tendrils snake across the screen, twisting and morphing into heavy, reflective mercury veins." +
  "Part 13 (3:00 - 3:15) — Shifting Topography[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The fractal veins expand and fuse into a continuous, heavy liquid plane. The surface forms deep, undulating valleys and sharp, pure white peaks, moving across the frame like a rolling monochrome ocean under an invisible storm." +
  "Part 14 (3:15 - 3:30) — The Infinite Loom[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The liquid ocean planes weave together into an intricate, trippy textile-like grid. Threads of pure white molten glass slide horizontally and vertically, continuously morphing their thickness and undulating in a hypnotic, mechanical rhythm." +
  "Part 15 (3:30 - 3:45) — Plasma Turbulence[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The woven grid breaks down into a high-energy plasma state. Blob-like shapes of heavy mercury split apart and collide violently across the screen, maintaining a smooth, undulating, and trippy continuous flow." +
  "Part 16 (3:45 - 4:00) — The Singularity Loop[Duration: 15 seconds, 24fps slow-motion pacing]. High-contrast monochrome, deep black and pure white only, zero color. The turbulent plasma blobs slow down, pulling back toward the center of the frame. The entire visual space resolves back into the initial flat sheet of molten glass, undulating smoothly and looping perfectly back into the exact layout of Part 1.";

describe("parseScriptSequence", () => {
  it("real reported script: parses all 16 parts of Stuart's actual 'Liquid Horizon' sequence", () => {
    const parts = parseScriptSequence(LIQUID_HORIZON_SCRIPT);
    expect(parts).toHaveLength(16);
    expect(parts.map((p) => p.index)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("reads each part's own header start/end times, in whole seconds — not the [Duration: ...] bracket", () => {
    const parts = parseScriptSequence(LIQUID_HORIZON_SCRIPT);
    expect(parts[0]).toMatchObject({ startSec: 0, endSec: 15, title: "The Liquid Horizon" });
    expect(parts[4]).toMatchObject({ startSec: 60, endSec: 75, title: "Ferrofluid Spikes" });
    expect(parts[15]).toMatchObject({ startSec: 225, endSec: 240, title: "The Singularity Loop" });
  });

  it("every part spans exactly 15 real seconds, back to back with no gaps or overlaps", () => {
    const parts = parseScriptSequence(LIQUID_HORIZON_SCRIPT);
    for (const part of parts) {
      expect(part.endSec - part.startSec).toBe(15);
    }
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].startSec).toBe(parts[i - 1].endSec);
    }
  });

  it("strips the [Duration: ...] bracket out of the prompt text entirely", () => {
    const parts = parseScriptSequence(LIQUID_HORIZON_SCRIPT);
    for (const part of parts) {
      expect(part.prompt).not.toContain("[Duration");
      expect(part.prompt).not.toContain("24fps");
    }
  });

  it("keeps the real shot description as the prompt, starting right after the bracket", () => {
    const parts = parseScriptSequence(LIQUID_HORIZON_SCRIPT);
    expect(parts[0].prompt).toBe(
      "High-contrast monochrome, deep black and pure white only, zero color. A dense sheet of molten glass " +
        "transitions into a playful, undulating pattern, continuously morphing and flowing across the frame " +
        "like heavy mercury rippling under intense, shifting light. Smooth, surreal motion, trippy flowing " +
        "physics, looping seamlessly into liquid glass ripples at the right edge."
    );
  });

  it("returns an empty array for blank input, never throws", () => {
    expect(parseScriptSequence("")).toEqual([]);
    expect(parseScriptSequence("   \n  ")).toEqual([]);
  });

  it("skips a chunk with no recognizable header rather than guessing", () => {
    const parts = parseScriptSequence("just some random text with no Part markers at all");
    expect(parts).toEqual([]);
  });

  it("skips (rather than crashes on) a malformed header with end before start", () => {
    const parts = parseScriptSequence(
      "Part 1 (0:15 - 0:00) — Backwards[Duration: 15 seconds]. This one is broken." +
        "Part 2 (0:15 - 0:30) — Fine[Duration: 15 seconds]. This one is fine."
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].title).toBe("Fine");
  });

  it("accepts a bare-seconds time (no colon) as well as m:ss", () => {
    const parts = parseScriptSequence("Part 1 (0 - 15) — Bare Seconds[Duration: 15 seconds]. Text here.");
    expect(parts[0]).toMatchObject({ startSec: 0, endSec: 15 });
  });
});

/** 2026-09-16 real ask: a script from a different AI, pasted straight
 * in — markdown `###` headings (no trailing period after the bracket)
 * and a labelled `**Positive Prompt:**` / `**Negative Prompt:**` body
 * per part, instead of one continuous unlabelled blob. */
const LABELLED_SCRIPT =
  "### Part 1 (0:00 - 0:15) — Anchor Start [Duration: 15s]\n" +
  "**Positive Prompt:** Wide cinematic shot of a dark, foggy avenue. A shrouded silhouette walks into the mist.\n" +
  "**Negative Prompt:** humans, clear human details, faces, skin, open eyes, crowds\n" +
  "\n" +
  "### Part 2 (0:15 - 0:30) — Prompt 2 [Duration: 15s]\n" +
  "**Positive Prompt:** The camera tracks forward through the misty avenue.\n" +
  "**Negative Prompt:** humans, clear human details, faces, skin, sudden camera jumps\n" +
  "\n" +
  "### Part 3 (0:30 - 0:45) — No Negative Given [Duration: 15s]\n" +
  "**Positive Prompt:** A plain shot with no negative prompt written for it at all.\n" +
  "\n" +
  "### Part 4 (0:45 - 1:00) — Anchor End [Duration: 15s]\n";

describe("parseScriptSequence — labelled Positive/Negative Prompt format", () => {
  it("real reported script: parses all 4 parts of the labelled markdown format", () => {
    const parts = parseScriptSequence(LABELLED_SCRIPT);
    expect(parts).toHaveLength(4);
    expect(parts.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  it("reads the header's own start/end times and title, same as the original format", () => {
    const parts = parseScriptSequence(LABELLED_SCRIPT);
    expect(parts[0]).toMatchObject({ startSec: 0, endSec: 15, title: "Anchor Start" });
    expect(parts[1]).toMatchObject({ startSec: 15, endSec: 30, title: "Prompt 2" });
  });

  it("strips the **Positive Prompt:** label and keeps just the description as prompt", () => {
    const parts = parseScriptSequence(LABELLED_SCRIPT);
    expect(parts[0].prompt).toBe(
      "Wide cinematic shot of a dark, foggy avenue. A shrouded silhouette walks into the mist."
    );
    expect(parts[0].prompt).not.toContain("Positive Prompt");
    expect(parts[0].prompt).not.toContain("*");
  });

  it("splits the **Negative Prompt:** label out into its own field, label stripped", () => {
    const parts = parseScriptSequence(LABELLED_SCRIPT);
    expect(parts[0].negativePrompt).toBe("humans, clear human details, faces, skin, open eyes, crowds");
    expect(parts[1].negativePrompt).toBe("humans, clear human details, faces, skin, sudden camera jumps");
    expect(parts[0].negativePrompt).not.toContain("Negative Prompt");
  });

  it("leaves negativePrompt undefined (not an empty string) for a part that never wrote one", () => {
    const parts = parseScriptSequence(LABELLED_SCRIPT);
    expect(parts[2].negativePrompt).toBeUndefined();
    expect(parts[2].prompt).toBe("A plain shot with no negative prompt written for it at all.");
  });

  it("real case from Stuart's own paste: a heading with no body at all parses with an empty prompt, not skipped or crashed on", () => {
    const parts = parseScriptSequence(LABELLED_SCRIPT);
    expect(parts[3]).toMatchObject({ index: 4, title: "Anchor End", prompt: "" });
    expect(parts[3].negativePrompt).toBeUndefined();
  });

  it("real reported script (2026-09-16): Stuart's actual pasted 'shrouded silhouette' script parses in full, negative prompts included", () => {
    const real =
      "### Part 1 (0:00 - 0:15) — Anchor Start [Duration: 15s]\n" +
      "**Positive Prompt:** Wide cinematic shot of a dark, foggy avenue lined with tall, skeletal winter trees. A single shrouded, hunched silhouette in a heavy dark coat walks away from the camera into the thick, glowing blue mist. Locked static angle mimicking the reference image exactly. Low contrast, eerie atmosphere, slow-motion drifting fog.\n" +
      "**Negative Prompt:** humans, clear human details, faces, skin, open eyes, crowds, vibrant colors, cheerful elements, warm lighting, bright lights\n" +
      "\n" +
      "### Part 2 (0:15 - 0:30) — Prompt 2 [Duration: 15s]\n" +
      "**Positive Prompt:** The camera slowly tracks forward through the misty avenue of dark trees. The silhouette ahead recedes further into the heavy, cold blue haze.\n" +
      "**Negative Prompt:** humans, clear human details, faces, skin, open eyes, crowds, vibrant colors, cheerful elements, warm lighting, bright lights, sudden camera jumps\n" +
      "\n" +
      "### Part 20 (4:45 - 4:59) — Anchor End [Duration: 14s]\n";
    const parts = parseScriptSequence(real);
    expect(parts).toHaveLength(3);
    expect(parts[0].index).toBe(1);
    expect(parts[0].prompt.startsWith("Wide cinematic shot of a dark, foggy avenue")).toBe(true);
    expect(parts[0].negativePrompt).toBe(
      "humans, clear human details, faces, skin, open eyes, crowds, vibrant colors, cheerful elements, warm lighting, bright lights"
    );
    expect(parts[1].negativePrompt?.endsWith("sudden camera jumps")).toBe(true);
    // Part 20 — no description written under it at all, same as the real paste.
    expect(parts[2]).toMatchObject({ index: 20, title: "Anchor End", prompt: "" });
    expect(parts[2].negativePrompt).toBeUndefined();
  });

  it("still parses the original unlabelled Liquid Horizon format exactly as before — no negativePrompt anywhere", () => {
    const parts = parseScriptSequence(
      "Part 1 (0:00 - 0:15) — Title[Duration: 15 seconds]. Plain description, no labels at all." +
        "Part 2 (0:15 - 0:30) — Title2[Duration: 15 seconds]. Second plain description."
    );
    expect(parts).toHaveLength(2);
    expect(parts[0].prompt).toBe("Plain description, no labels at all.");
    expect(parts[0].negativePrompt).toBeUndefined();
  });
});

describe("canonicalizeScriptPartTitle / formatScriptSequencePartTitles", () => {
  it("canonicalizes known type words and Other Singer shapes", () => {
    expect(canonicalizeScriptPartTitle("vocal")).toBe("Vocal");
    expect(canonicalizeScriptPartTitle("INTRO")).toBe("Intro");
    expect(canonicalizeScriptPartTitle("other singer: jax")).toBe("Other Singer: jax");
    expect(canonicalizeScriptPartTitle("Other Singer (Nova)")).toBe("Other Singer: Nova");
    expect(canonicalizeScriptPartTitle("Other Singer")).toBe("Other Singer");
  });

  it("leaves unrecognized titles alone — Format never invents a type word", () => {
    expect(canonicalizeScriptPartTitle("The Liquid Horizon")).toBe("The Liquid Horizon");
    expect(canonicalizeScriptPartTitle("Geometric Shards")).toBe("Geometric Shards");
  });

  it("Format rewrites only the header type word — shot prose stays byte-identical", () => {
    const prose =
      "High-contrast monochrome. A dense sheet of molten glass. vocal mentioned in prose stays.";
    const raw =
      `Part 1 (0:00 - 0:15) — vocal[Duration: 15 seconds]. ${prose}` +
      `Part 2 (0:15 - 0:30) — INSTRUMENTAL[Duration: 15s]. ${prose}` +
      `Part 3 (0:30 - 0:45) — Other Singer (Jax)[Duration: 15s]. ${prose}` +
      `Part 4 (0:45 - 1:00) — The Liquid Horizon[Duration: 15s]. ${prose}`;
    const formatted = formatScriptSequencePartTitles(raw);
    expect(formatted).toContain("— Vocal[Duration: 15 seconds].");
    expect(formatted).toContain("— Instrumental[Duration: 15s].");
    expect(formatted).toContain("— Other Singer: Jax[Duration: 15s].");
    expect(formatted).toContain("— The Liquid Horizon[Duration: 15s].");
    // Prose untouched (including lowercase "vocal" inside the description).
    expect(formatted.split("]. ")[1]?.startsWith(prose)).toBe(true);
    const parts = parseScriptSequence(formatted);
    expect(parts.map((p) => p.title)).toEqual([
      "Vocal",
      "Instrumental",
      "Other Singer: Jax",
      "The Liquid Horizon",
    ]);
    expect(parts.every((p) => p.prompt === prose)).toBe(true);
  });

  it("Format is idempotent", () => {
    const raw =
      "Part 1 (0:00 - 0:15) — vocal[Duration: 15s]. Shot one." +
      "Part 2 (0:15 - 0:30) — Intro[Duration: 15s]. Shot two.";
    const once = formatScriptSequencePartTitles(raw);
    expect(formatScriptSequencePartTitles(once)).toBe(once);
  });

  it("Liquid Horizon unrecognized titles: Format is a no-op on titles and preserves parse", () => {
    const formatted = formatScriptSequencePartTitles(LIQUID_HORIZON_SCRIPT);
    expect(formatted).toBe(LIQUID_HORIZON_SCRIPT);
    expect(parseScriptSequence(formatted)).toHaveLength(16);
  });
});

describe("buildScriptSequenceHighlightSegments", () => {
  it("colours only known header type words; concatenating reconstructs raw", () => {
    const raw =
      "Part 1 (0:00 - 0:15) — Vocal[Duration: 15s]. A vocal in prose." +
      "Part 2 (0:15 - 0:30) — Mystery Title[Duration: 15s]. More text.";
    const segments = buildScriptSequenceHighlightSegments(raw);
    expect(segments.map((s) => s.text).join("")).toBe(raw);
    expect(segments.some((s) => s.kind === "vocal" && s.text === "Vocal")).toBe(true);
    expect(segments.some((s) => s.kind === "plain" && s.text.includes("Mystery Title"))).toBe(true);
    // Prose "vocal" stays plain.
    const proseSeg = segments.find((s) => s.text.includes("A vocal in prose"));
    expect(proseSeg?.kind).toBe("plain");
  });
});
