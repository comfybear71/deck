import { afterAll, describe, expect, it } from "vitest";

/**
 * A **real** round trip against Neon — not the `@neondatabase/
 * serverless`-mocked unit tests in `lib/skidmarksSession-server.test.ts`.
 * This test actually opens a connection using whatever `DATABASE_URL`
 * (or `DATABASE_URL_UNPOOLED`) is set in the environment running it,
 * writes a real session row, reads it back, and asserts the studio
 * fields Stuart cares about (segments/plates/prompts/motion/
 * selections) survive byte-for-byte — proof this app's Neon wiring
 * actually works against a real database, not just against a mock.
 *
 * **Skips (does not fail, does not silently pass either) when no
 * connection string is configured** — this sandbox has no
 * `DATABASE_URL`, so this test is expected to skip here; it is *not*
 * expected to skip in any environment (e.g. CI, or a real Vercel/Neon
 * project) that has it set, per Stuart's "don't ship another problem
 * caused by not connecting Neon" ask. The skip reason is printed to the
 * console so it's never a quiet, easy-to-miss gap in a CI log.
 *
 * Uses its own, disposable `SKIDMARKS_STUDIO_OWNER_ID` (never the real
 * `"stuart"` row) and deletes that row in `afterAll` — this must be
 * safe to run against the *real* production Neon database without
 * touching Stuart's actual saved session.
 */
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
const TEST_OWNER_ID = `test-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!connectionString)("Neon session round trip (real DATABASE_URL)", () => {
  if (!connectionString) {
    // describe.skipIf already skips every `it` below; this just makes
    // the *why* impossible to miss in the console output.
    console.warn(
      "[skidmarksSession.neon-smoke.test.ts] SKIPPED \u2014 no DATABASE_URL/DATABASE_URL_UNPOOLED in this " +
        "environment. This must NOT be skipped in an environment that has Neon configured (CI/production)."
    );
  }

  afterAll(async () => {
    if (!connectionString) return;
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(connectionString);
    await sql`DELETE FROM skidmarks_sessions WHERE owner_id = ${TEST_OWNER_ID}`;
  });

  it("writes a real studio session (segments/plates/prompts/motion/selections) and reads the same data back", async () => {
    process.env.SKIDMARKS_STUDIO_OWNER_ID = TEST_OWNER_ID;
    const { loadSkidmarksSession, saveSkidmarksSession } = await import("./skidmarksSession-server");

    const studioSession = {
      bands: [
        {
          id: "band-1",
          name: "Jack Ash",
          tagline: "Dirt roads & bad decisions",
          coverSeed: 1,
          editIcon: "pencil",
          members: [{ id: "member-1", name: "Jack Ash", role: "Frontman", emoji: "\u{1F3B8}", looks: [] }],
        },
      ],
      removedSeedBandIds: [],
      session: {
        projectKind: "music-video",
        bandId: "band-1",
        mp3: {
          fileName: "talking-to-concrete.mp3",
          durationSec: 256,
          attachedAt: 1_700_000_000_000,
          attachId: "mp3-1",
          segmentsSource: "transcription",
          analysisStatus: "done",
          transcriptionStatus: "done",
          segments: [
            {
              id: "segment-1",
              startSec: 0,
              endSec: 40,
              label: "instrumental",
              model: "grok",
              shotPrompt: "A weathered door in a cracked concrete wall, neon-blue light bleeding through.",
              uncensoredPlateStills: false,
              selectedPlateId: "plate-2",
              instrumentalVideoModel: "h3",
              plates: [
                {
                  id: "plate-1",
                  still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "generated", createdAt: 1_700_000_001_000 },
                  motionPrompt: "Slow push through the door crack.",
                },
                {
                  id: "plate-2",
                  still: { dataUrl: "data:image/jpeg;base64,BBBB", source: "upload", createdAt: 1_700_000_002_000 },
                  motionPrompt: "Keyhole reveal, mild pulse on the light.",
                },
              ],
            },
          ],
        },
      },
    };

    const saveOutcome = await saveSkidmarksSession(studioSession);
    expect(saveOutcome.ok).toBe(true);

    const loadOutcome = await loadSkidmarksSession();
    expect(loadOutcome.configured).toBe(true);
    if (!loadOutcome.configured) return; // narrows for TS below; already asserted above

    const roundTripped = loadOutcome.state as typeof studioSession;
    expect(roundTripped).toEqual(studioSession);

    // Spell out the exact fields Stuart cares about, individually, so a
    // future partial-serialization regression fails with a pointed
    // message instead of one big opaque `toEqual` diff.
    const segment = roundTripped.session.mp3!.segments[0];
    expect(segment.shotPrompt).toBe(studioSession.session.mp3.segments[0].shotPrompt);
    expect(segment.selectedPlateId).toBe("plate-2");
    expect(segment.instrumentalVideoModel).toBe("h3");
    expect(segment.plates[0].still?.dataUrl).toBe("data:image/jpeg;base64,AAAA");
    expect(segment.plates[0].motionPrompt).toBe("Slow push through the door crack.");
    expect(segment.plates[1].still?.dataUrl).toBe("data:image/jpeg;base64,BBBB");
    expect(segment.plates[1].motionPrompt).toBe("Keyhole reveal, mild pulse on the light.");
  });

  it("overwrites (upserts) the same owner row rather than accumulating rows", async () => {
    process.env.SKIDMARKS_STUDIO_OWNER_ID = TEST_OWNER_ID;
    const { loadSkidmarksSession, saveSkidmarksSession } = await import("./skidmarksSession-server");

    await saveSkidmarksSession({ marker: "first-write" });
    await saveSkidmarksSession({ marker: "second-write" });

    const loadOutcome = await loadSkidmarksSession();
    expect(loadOutcome.configured).toBe(true);
    if (!loadOutcome.configured) return;
    expect(loadOutcome.state).toEqual({ marker: "second-write" });
  });
});
