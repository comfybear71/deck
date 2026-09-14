import { describe, expect, it } from "vitest";
import { parseScriptSequence } from "./scriptSequence";

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
