import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPlateGenerationRequest,
  generatePlateStill,
  getSkidmarksCharacterLock,
  resolveVocalistForPrompt,
} from "./plateGeneration";
import type { SkidmarksMember } from "./skidmarks";

function member(overrides: Partial<SkidmarksMember>): SkidmarksMember {
  return { id: "member-id", name: "", emoji: "", looks: [], ...overrides };
}

describe("resolveVocalistForPrompt", () => {
  it("resolves to undefined for a band with no named members yet", () => {
    expect(resolveVocalistForPrompt([member({ id: "blank" })])).toBeUndefined();
    expect(resolveVocalistForPrompt([])).toBeUndefined();
  });

  it("resolves the sole named member unambiguously, matching both seed bands", () => {
    const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
    expect(resolveVocalistForPrompt([jackAsh])).toBe(jackAsh);

    const nova = member({ id: "solar-rebel-vocals", name: "Nova", role: "Vocals" });
    expect(resolveVocalistForPrompt([nova])).toBe(nova);
  });

  it("prefers a member whose role reads like the vocalist/lead over other named members", () => {
    const drummer = member({ id: "drummer", name: "Rusty", role: "Drums" });
    const singer = member({ id: "singer", name: "Mo", role: "Lead vocals" });
    expect(resolveVocalistForPrompt([drummer, singer])).toBe(singer);
  });

  it("falls back to the first named member when no role matches", () => {
    const first = member({ id: "a", name: "Alex", role: "Bass" });
    const second = member({ id: "b", name: "Bo", role: "Synth" });
    expect(resolveVocalistForPrompt([first, second])).toBe(first);
  });

  it("skips blank members when picking the fallback", () => {
    const blank = member({ id: "blank" });
    const named = member({ id: "named", name: "Rio", role: "Guitar" });
    expect(resolveVocalistForPrompt([blank, named])).toBe(named);
  });
});

describe("getSkidmarksCharacterLock", () => {
  it("locks Jack Ash's face-in-shadow, glowing neon-blue-lips look", () => {
    const lock = getSkidmarksCharacterLock("jack-ash-frontman");
    expect(lock).toBeDefined();
    expect(lock?.promptHallmarks.toLowerCase()).toContain("neon blue");
    expect(lock?.promptHallmarks.toLowerCase()).toContain("shadow");
    expect(lock?.promptHallmarks.toLowerCase()).toContain("fedora");
    // The follow-up lock: never a lit/visible face, even in close-up.
    expect(lock?.promptHallmarks.toLowerCase()).toContain("hidden in deep shadow at all times");
    expect(lock?.negativeCues?.toLowerCase()).toContain("face lit or visible");
    expect(lock?.negativeCues?.toLowerCase()).toContain("normal skin tone");
  });

  it("returns undefined for any member without an explicit lock", () => {
    expect(getSkidmarksCharacterLock("solar-rebel-vocals")).toBeUndefined();
    expect(getSkidmarksCharacterLock("some-new-member-id")).toBeUndefined();
  });
});

const BAND_NAME = "Jack Ash";
const JACK_ASH_AVATAR = "data:image/jpeg;base64,jackAshPhotoBytes";

describe("buildPlateGenerationRequest", () => {
  it("always leads with Stuart's own shot prompt, verbatim", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "a door creaks open in an empty hallway",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
    });
    expect(prompt.startsWith("a door creaks open in an empty hallway")).toBe(true);
  });

  it("an Instrumental/B-roll clip has no vocalist mention and no reference images at all", () => {
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "a door creaks open in an empty hallway",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    // The band name itself is expected in every prompt ("Music video for
    // Jack Ash.") — what must NOT happen on an Instrumental/B-roll clip
    // is the vocalist being *featured*/locked-in as a character.
    expect(prompt).not.toContain("the vocalist");
    expect(prompt).not.toContain("Do not show:");
    expect(prompt).not.toContain("neon blue");
    expect(prompt).toContain("Wide dynamic cinematic music-video establishing shot");
    expect(referenceImageDataUrls).toEqual([]);
  });

  it("routes a Vocal + LTX Lip-sync clip to tight camera-facing framing", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "singing into a vintage microphone",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "generic-singer", name: "Rio" }),
    });
    expect(prompt).toContain("Tight cinematic close/medium framing");
    expect(prompt).toContain("lip-sync-ready");
    expect(prompt).toContain("Feature Rio, the vocalist, in the scene.");
  });

  it("does not apply the tight lip-sync framing to a Vocal clip manually set to a non-lip-sync model", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "singing into a vintage microphone",
      vocal: true,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "generic-singer", name: "Rio" }),
    });
    expect(prompt).not.toContain("lip-sync-ready");
    expect(prompt).toContain("Wide dynamic cinematic music-video establishing shot");
    // The vocalist auto-include rule is about `vocal`, not the model tag.
    expect(prompt).toContain("Feature Rio, the vocalist, in the scene.");
  });

  it("routes an H3-tagged still to plain, single-subject framing", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "a lone chair in an empty room",
      vocal: false,
      model: "h3",
      bandName: BAND_NAME,
    });
    expect(prompt).toContain("Simple, clean single-subject still");
  });

  it("mentions a generic vocalist by name without inventing hallmarks they were never locked with", () => {
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "singing under a spotlight",
      vocal: true,
      model: "ltx-lipsync",
      bandName: "Solar Rebel",
      vocalist: member({ id: "solar-rebel-vocals", name: "Nova" }),
    });
    expect(prompt).toContain("Feature Nova, the vocalist, in the scene.");
    expect(prompt).not.toContain("Do not show:");
    expect(referenceImageDataUrls).toEqual([]); // no avatarImage set on this fixture
  });

  it("locks Jack Ash's hallmarks and negative cues into the prompt whenever he's the resolved vocalist", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "singing into a vintage microphone on a desert highway at night",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(prompt).toContain("Feature Jack Ash, the vocalist, in the scene.");
    expect(prompt.toLowerCase()).toContain("neon blue");
    expect(prompt.toLowerCase()).toContain("hidden in deep shadow at all times");
    expect(prompt).toContain("Do not show:");
    expect(prompt.toLowerCase()).toContain("face lit or visible");
  });

  it("passes Jack Ash's avatarImage as a single identity reference, untagged, when it's the only reference", () => {
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "singing on a desert highway at night",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(referenceImageDataUrls).toEqual([JACK_ASH_AVATAR]);
    expect(prompt).not.toContain("<IMAGE_0>");
    expect(prompt).toContain("exact likeness/identity reference for Jack Ash");
  });

  it("never sends an identity reference for a vocalist with no picked avatarImage", () => {
    const { referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "singing on a desert highway at night",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash" }),
    });
    expect(referenceImageDataUrls).toEqual([]);
  });

  it("passes the previous clip's still as a single continuity reference, untagged, when used alone", () => {
    const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "the same hallway, a hand reaching for the doorknob",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      continuityStillDataUrl: previousPlate,
    });
    expect(referenceImageDataUrls).toEqual([previousPlate]);
    expect(prompt).not.toContain("<IMAGE_0>");
    expect(prompt).toContain("Continue directly from the previous shot's plate");
  });

  it("combines continuity (first) and identity (second) into a tagged `images` order for Jack Ash", () => {
    const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "Jack steps out from behind the door, seated now, singing",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
      continuityStillDataUrl: previousPlate,
    });

    // Continuity always first, identity second — the single source of
    // truth `app/api/skidmarks/generate-still/route.ts` relies on to map
    // this array onto xAI's own `images` order.
    expect(referenceImageDataUrls).toEqual([previousPlate, JACK_ASH_AVATAR]);
    expect(prompt).toContain("<IMAGE_0>");
    expect(prompt).toContain("<IMAGE_1>");
    expect(prompt).toContain("Continue directly from <IMAGE_0> the previous shot's plate");
    expect(prompt).toContain("Use <IMAGE_1> as the exact likeness/identity reference for Jack Ash");
    // The character lock still applies on top of the continuity/identity notes.
    expect(prompt.toLowerCase()).toContain("neon blue");
  });

  it("always names the band in the final prompt", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "a keyhole, lit from behind",
      vocal: false,
      model: "grok",
      bandName: "Solar Rebel",
    });
    expect(prompt).toContain("Music video for Solar Rebel.");
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("generatePlateStill", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a real success with the dataUrl the route reported", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { dataUrl: "data:image/jpeg;base64,AAAA" }));

    const outcome = await generatePlateStill({ prompt: "a desert highway at night", referenceImageDataUrls: [] });

    expect(outcome).toEqual({ ok: true, dataUrl: "data:image/jpeg;base64,AAAA" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/generate-still");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "a desert highway at night",
      referenceImageDataUrls: [],
    });
  });

  it("reports the honest 'unconfigured' outcome for a missing_api_key response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(501, { error: "XAI_API_KEY is not set on the server.", code: "missing_api_key" })
    );

    const outcome = await generatePlateStill({ prompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: true,
      message: "XAI_API_KEY is not set on the server.",
    });
  });

  it("reports a real failure honestly, distinct from 'unconfigured'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: "xAI Grok Imagine returned 401: Incorrect API key provided.", code: "auth_error" })
    );

    const outcome = await generatePlateStill({ prompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "xAI Grok Imagine returned 401: Incorrect API key provided.",
    });
  });

  it("reports a real network error honestly (no fetch success to parse)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await generatePlateStill({ prompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "Failed to fetch" });
  });

  it("reports a real failure if a 200 response is somehow missing dataUrl", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    const outcome = await generatePlateStill({ prompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "Still generation succeeded but returned no image.",
    });
  });
});
