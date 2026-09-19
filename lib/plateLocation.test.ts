import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLocationStillRequest,
  cacheLocationStill,
  clearCachedLocationStills,
  getCachedLocationStill,
  locationStillCacheKey,
  resolveLocationStill,
} from "./plateLocation";
import { attachSkidmarksMp3, createMp3Attachment, selectSkidmarksBand } from "./skidmarks";

const SCENE =
  "a woman with a huge afro and gold hoop earrings leaning on the bonnet of a rusted car outside a roadside motel at dusk";

describe("buildLocationStillRequest", () => {
  it("asks for the place and nothing else", () => {
    const { prompt } = buildLocationStillRequest({ sceneText: SCENE, bandName: "Solar Rebel" });
    expect(prompt).toContain(SCENE);
    expect(prompt).toContain("Empty establishing location still");
    expect(prompt).toContain("Music video location for Solar Rebel.");
  });

  /**
   * The load-bearing half. A place still with a stray figure in it is
   * worse than useless: the composite step would then have two people
   * to reconcile, which is the exact failure this feature exists to
   * stop. The original Skidmarks repo's own comment on this prompt
   * records the lesson — naming people pulls them into the frame — and
   * this scene text names one in detail.
   */
  it("bans every person from the frame, including the one the scene text describes", () => {
    const { prompt } = buildLocationStillRequest({ sceneText: SCENE, bandName: "Solar Rebel" });
    const lower = prompt.toLowerCase();
    expect(lower).toContain("completely empty of people and animals");
    expect(lower).toContain("no silhouette");
    expect(lower).toContain("no one in the distance");
    expect(lower).toContain("ignore any description of a person");
  });

  it("sends no reference images and never claims to feature a locked character", () => {
    const request = buildLocationStillRequest({ sceneText: SCENE, bandName: "Solar Rebel" });
    expect(request.referenceImageDataUrls).toEqual([]);
    expect(request.featuresLockedCharacter).toBe(false);
  });

  /** The route length-validates `shotPrompt`, never the merged prompt —
   * same split `buildPlateGenerationRequest` keeps (AGENTS.md's
   * prompt-length lock). */
  it("keeps Stuart's own text separate from the injected framing", () => {
    const request = buildLocationStillRequest({ sceneText: `  ${SCENE}  `, bandName: "Solar Rebel" });
    expect(request.shotPrompt).toBe(SCENE);
    expect(request.prompt.length).toBeGreaterThan(request.shotPrompt.length);
  });

  it("still builds something sendable with no scene text or band name", () => {
    const { prompt } = buildLocationStillRequest({ sceneText: "   ", bandName: "  " });
    expect(prompt).toContain("Empty establishing location still.");
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("Music video location for");
  });
});

describe("locationStillCacheKey", () => {
  /** A clip's plates share one shot prompt, so this is what keeps a
   * door → keyhole → Jack strip on one place still instead of three,
   * and what keeps a re-generate from re-billing it. */
  it("treats the same scene typed differently as the same place", () => {
    expect(locationStillCacheKey("  A Roadside   Motel ")).toBe(locationStillCacheKey("a roadside motel"));
    expect(locationStillCacheKey("a roadside motel")).not.toBe(locationStillCacheKey("a dive bar alley"));
  });
});

describe("resolveLocationStill", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearCachedLocationStills();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCachedLocationStills();
  });

  function respondWith(dataUrl: string) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ dataUrl }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
  }

  it("generates the place once and reuses it for every later plate of the same scene", async () => {
    respondWith("data:image/jpeg;base64,placeBytes");

    const first = await resolveLocationStill({ sceneText: SCENE, bandName: "Solar Rebel" });
    expect(first.ok).toBe(true);
    expect(first.dataUrl).toBe("data:image/jpeg;base64,placeBytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second plate on the same clip's strip: no second paid call.
    const second = await resolveLocationStill({ sceneText: `  ${SCENE.toUpperCase()}  `, bandName: "Solar Rebel" });
    expect(second.dataUrl).toBe("data:image/jpeg;base64,placeBytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Deliberate: shrugging and generating the plate without a locked
   * place hands back exactly the drifting, invented-person plate this
   * change exists to stop, while looking like a success. The original
   * Skidmarks repo refuses out loud for the same reason ("Will not
   * plate a partial cast").
   */
  it("reports a real failure rather than quietly carrying on without a place", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "xAI rate limit reached." }), { status: 429 })
    );
    const outcome = await resolveLocationStill({ sceneText: SCENE, bandName: "Solar Rebel" });
    expect(outcome.ok).toBe(false);
    expect(outcome.dataUrl).toBeUndefined();
    expect(outcome.message).toContain("rate limit");
    // A failure must not be cached — the next tap gets a real retry.
    expect(getCachedLocationStill(SCENE)).toBeUndefined();
  });

  it("passes the honest 'no key configured here' outcome straight through", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "missing_api_key", error: "XAI_API_KEY is not configured." }), {
        status: 501,
      })
    );
    const outcome = await resolveLocationStill({ sceneText: SCENE, bandName: "Solar Rebel" });
    expect(outcome.ok).toBe(false);
    expect(outcome.unconfigured).toBe(true);
  });

  it("serves a hand-seeded cache entry without calling anything", async () => {
    cacheLocationStill(SCENE, "data:image/jpeg;base64,alreadyHave");
    const outcome = await resolveLocationStill({ sceneText: SCENE, bandName: "Solar Rebel" });
    expect(outcome.dataUrl).toBe("data:image/jpeg;base64,alreadyHave");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * Rule 2's "in-memory place-still cache" clause, verified as the real
 * cross-module wire it actually is — `lib/skidmarks.ts` never imports
 * this module directly (that would be circular; see
 * `registerSkidmarksIdentityWipeListener`'s doc comment there), so this
 * is the one test that actually exercises the registration this module
 * performs at load time, not just the cache's own clear function in
 * isolation.
 */
describe("identity wipe integration (lib/skidmarks.ts band/song switches)", () => {
  afterEach(() => {
    clearCachedLocationStills();
    selectSkidmarksBand("jack-ash"); // leave a real seed band active for any other suite
  });

  it("a band switch clears a cached place still — a new artist must never inherit the previous one's cached scene", () => {
    cacheLocationStill(SCENE, "data:image/jpeg;base64,cachedPlace");
    expect(getCachedLocationStill(SCENE)).toBe("data:image/jpeg;base64,cachedPlace");

    selectSkidmarksBand("solar-rebel");

    expect(getCachedLocationStill(SCENE)).toBeUndefined();
  });

  it("attaching a new song clears a cached place still too", () => {
    selectSkidmarksBand("solar-rebel");
    cacheLocationStill(SCENE, "data:image/jpeg;base64,cachedPlace");

    attachSkidmarksMp3(createMp3Attachment("a-new-song.mp3", 120));

    expect(getCachedLocationStill(SCENE)).toBeUndefined();
  });
});
