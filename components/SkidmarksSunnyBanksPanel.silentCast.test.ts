import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pilotOpenSkidmarksStudio } from "@/lib/skidmarksEpisodeCast.fixtures";
import type { SkidmarksState } from "@/lib/skidmarks";
import { SUNNY_BANKS_CAST } from "@/lib/sunnyBanks";
import { shortsShotCast } from "@/lib/shortsCast";

/**
 * Silent Cast characters with no voice (2026-10-04, the Skidmarks
 * sparrow). Live, a bird shot written as `[Cast: Sparrow]` … `Crowd:`
 * rendered on Grok with a random bird: `Crowd:` never sends Cast
 * pictures, and a card with no voice ID couldn't have its own row.
 *
 * Now `Sparrow:` with nothing after the colon is Sparrow's own silent row
 * even with no voice ID, and its render gets the Sparrow Cast card
 * picture on the location. Talking still needs a voice. Same shared code
 * for Sunny Banks and Skidmarks. Every outside call is mocked: nothing is
 * billed and nothing is written.
 */

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({ put: (...args: unknown[]) => putMock(...args) }));

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck";
const DAP_PIC = `${BLOB}/skidmarks/characters/dap/dap-reference.jpg`;
const SPARROW_PIC = `${BLOB}/skidmarks/characters/sparrow/sparrow-reference.jpg`;
const KEV_PIC = `${BLOB}/sunnybank/characters/kev/kev-1.jpg`;
const DAP_VOICE = "21m00Tcm4TlvDq8ikWAM";
const EPISODE = "cornish-arsehole";

function card(name: string, sourceKey: string, voiceId?: string, referenceUrl?: string) {
  return {
    id: `clora_${name.toLowerCase()}`,
    name,
    slug: name.toLowerCase(),
    sourceKey,
    status: "idle",
    trainingImageUrls: [],
    version: 1,
    createdAt: "2026-10-04T00:00:00.000Z",
    ...(voiceId ? { voiceId } : {}),
    ...(referenceUrl ? { referenceUrl } : {}),
  };
}

const STATE = {
  bands: [],
  session: { projectKind: "skidmarks", bandId: null, mp3: null, scriptSequenceDraft: null },
  removedSeedBandIds: [],
  rosterExtras: {
    "music-video": [],
    "sunny-banks": [{ id: "chr_kev", name: "Kev", look: "", pictureUrls: [KEV_PIC], fictionalAdultConfirmed: true, createdAt: 1 }],
    "adult-shorts": [],
  },
  // The pilot is open: its Cast is every card from before episodes had their own (2026-10-04).
  skidmarksStudio: pilotOpenSkidmarksStudio(),
  skidmarksEpisodes: {
    episodes: [],
    cast: [
      { id: "c_dap", name: "DAP", role: "antihero", look: "skinny man, white tracksuit", fictionalAdultConfirmed: true, createdAt: 1 },
      { id: "c_sparrow", name: "Sparrow", role: "supporting", look: "", fictionalAdultConfirmed: true, createdAt: 2, isAnimal: true },
    ],
  },
  locations: {
    locations: [
      { id: "loc_skidmarks_park", genre: "skidmarks", key: "park", name: "Park", pictureUrl: `${BLOB}/skidmarks/locations/park.png`, createdAt: 1 },
    ],
  },
  characterLoras: {
    characters: [
      card("DAP", "sk:c_dap", DAP_VOICE, DAP_PIC),
      // The live Sparrow card: a picture, no voice ID.
      card("Sparrow", "sk:c_sparrow", undefined, SPARROW_PIC),
      // A Sunny Banks "+" character with a picture and no voice.
      card("Kev", "sbx:chr_kev"),
    ],
  },
} as unknown as SkidmarksState;

vi.mock("@/lib/skidmarks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skidmarks")>();
  return { ...actual, getSkidmarksSnapshot: () => STATE };
});

const { parseSunnyBanksScriptBlock, sunnyBanksQueueChunks, sunnyBanksRowBeatArgs, sunnyBanksBeatRequestBody, inStudioGenre, isSunnyBanksLocationCutaway } =
  await import("./SkidmarksSunnyBanksPanel");
const { resolveSunnyBanksRowCast } = await import("@/lib/sunnyBanksShotCast");
const { sunnyBanksCastCards, resolveSunnyBanksSpeaker, sunnyBanksSpeakerRequestExtras, sunnyBanksSpeakerNames, sunnyBanksSpeakerList } =
  await import("@/lib/sunnyBanksVoices");
const { sunnyBanksLocationList } = await import("@/lib/sunnyBanksLocations");
const { SUNNY_BANKS_GOD_SCRIPT_RULES } = await import("@/lib/sunnyBanksGodScriptGuide");
const { POST } = await import("@/app/api/skidmarks/sunnybank/generate-speak-beat/route");

type Genre = "skidmarks" | "sunnybank";
type Row = ReturnType<typeof sunnyBanksQueueChunks>[number];

/** The bird shot, written the new way. */
const SPARROW_SHOT = [
  "[Location: park]",
  "[Action: The sparrow on the park railing spots someone off screen, eyes go huge, then flaps away fast. Camera still. Semi-photoreal 3D]",
  "Sparrow:",
].join("\n");

/** The bird shot as it was written live (4 Oct 2026). */
const LIVE_CROWD_SHOT = [
  "[Location: park]",
  "[Cast: Sparrow]",
  "[Action: The sparrow on the park railing spots someone off screen, eyes go huge, then flaps away fast. Camera still.]",
  "Crowd:",
].join("\n");

const TINY_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function rows(script: string, genre: Genre = "skidmarks"): Row[] {
  return inStudioGenre(genre, () => sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(script)));
}

function requestFor(all: Row[], index: number, genre: Genre = "skidmarks", videoBackend: "ltx" | "grok" | "h3" = "grok") {
  const chunk = all[index];
  const lock = resolveSunnyBanksSpeaker(chunk.characterName, STATE, genre);
  const cutaway = inStudioGenre(genre, () => isSunnyBanksLocationCutaway(chunk));
  const rowCast = resolveSunnyBanksRowCast(
    {
      kind: chunk.kind,
      characterName: chunk.characterName,
      cutaway,
      action: chunk.action,
      sceneAction: chunk.sceneAction,
      castNames: chunk.castNames,
      castLooks: chunk.castLooks,
      sceneSpeakers: chunk.sceneSpeakers,
      appearanceModifier: chunk.appearanceModifier,
    },
    sunnyBanksCastCards(STATE, genre),
  );
  const location = sunnyBanksLocationList(STATE.locations, genre).find((l) => l.id === chunk.locationId)!;
  const args = sunnyBanksRowBeatArgs({
    chunk,
    characterName: lock?.name ?? chunk.characterName,
    speaker: sunnyBanksSpeakerRequestExtras(lock, genre),
    location,
    startImageDataUrl: TINY_DATA_URL,
    rowCast,
    videoBackend,
    act: "I",
    episodeSlug: EPISODE,
    rowNumber: index + 1,
    sceneFirstRowNumber: index + 1,
    genre,
  });
  return { lock, cutaway, rowCast, body: sunnyBanksBeatRequestBody(args) };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/sunnybank/generate-speak-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("a silent Cast character with no voice gets their own row (Skidmarks)", () => {
  it("`Sparrow:` with nothing after it is Sparrow's silent row, in any capitals", () => {
    for (const name of ["Sparrow", "SPARROW", "sparrow"]) {
      const all = rows(SPARROW_SHOT.replace("Sparrow:", `${name}:`));
      expect(all.map((r) => [r.kind, r.characterName, r.locationId])).toEqual([["hold", "Sparrow", "park"]]);
      expect(inStudioGenre("skidmarks", () => isSunnyBanksLocationCutaway(all[0]))).toBe(false);
    }
  });

  it("Sparrow is matched and offered with no voice; an unnamed line still goes to the first voiced character", () => {
    expect(sunnyBanksSpeakerNames(STATE, "skidmarks")).toEqual(expect.arrayContaining(["DAP", "Sparrow"]));
    const list = sunnyBanksSpeakerList(STATE, "skidmarks");
    expect(list.map((c) => c.name)).toEqual(["DAP", "Sparrow"]);
    expect(list[1].voiceId).toBeUndefined();
    expect(rows("[Location: park]\nAlright then.")[0].characterName).toBe("DAP");
  });

  it("the silent row carries the Sparrow Cast card picture and no voice", () => {
    const { lock, rowCast, body } = requestFor(rows(SPARROW_SHOT), 0);
    expect(lock).toMatchObject({ name: "Sparrow", castPicture: SPARROW_PIC });
    expect(lock?.voiceId).toBeUndefined();
    expect(rowCast.cast.isMulti).toBe(false);
    expect(rowCast.cast.missingPicture).toEqual([]);
    expect(body).toMatchObject({
      kind: "hold",
      genre: "skidmarks",
      characterName: "Sparrow",
      locationId: "park",
      videoBackend: "grok",
      characterCard: { name: "Sparrow", pictureUrl: SPARROW_PIC },
    });
    expect(body).not.toHaveProperty("voiceId");
    expect(String(body.action)).toMatch(/flaps away fast/);
  });

  it("extra people still add up: [Cast: Sparrow, DAP] on Sparrow's silent row sends both pictures", () => {
    const { rowCast, body } = requestFor(rows(SPARROW_SHOT.replace("[Location: park]", "[Location: park]\n[Cast: Sparrow, DAP]")), 0);
    expect(rowCast.cast.names).toEqual(["Sparrow", "DAP"]);
    expect((body.cast as Array<{ name: string; pictureUrl: string }>).map((p) => [p.name, p.pictureUrl])).toEqual([
      ["Sparrow", SPARROW_PIC],
      ["DAP", DAP_PIC],
    ]);
  });

  it("`Crowd:` stays a place shot with no Cast picture, even with [Cast: Sparrow] (unchanged)", () => {
    const all = rows(LIVE_CROWD_SHOT);
    expect(all.map((r) => [r.kind, r.characterName])).toEqual([["hold", "Crowd"]]);
    const { lock, cutaway, rowCast, body } = requestFor(all, 0);
    expect(lock).toBeUndefined();
    expect(cutaway).toBe(true);
    expect(rowCast.cast.members).toEqual([]);
    expect(body).not.toHaveProperty("cast");
    expect(body).not.toHaveProperty("characterCard");
  });

  it("the Cheat Sheet's silent character example reads as Sparrow's silent row", () => {
    const rule = SUNNY_BANKS_GOD_SCRIPT_RULES.find((r) => r.title.includes("silent character"))!;
    expect(rule.example).toContain("Sparrow:");
    const all = rows(rule.example!);
    expect(all.map((r) => [r.kind, r.characterName, r.locationId])).toEqual([["hold", "Sparrow", "park"]]);
    expect(requestFor(all, 0).lock?.castPicture).toBe(SPARROW_PIC);
  });
});

describe("Sunny Banks: the same shared code", () => {
  it("a '+' character with no voice gets a silent row with their Cast card picture", () => {
    const all = rows("[Location: office_storefront]\n[Action: Kev sweeps the floor. Camera still.]\nKev:", "sunnybank");
    expect(all.map((r) => [r.kind, r.characterName])).toEqual([["hold", "Kev"]]);
    const { lock, cutaway, body } = requestFor(all, 0, "sunnybank");
    expect(cutaway).toBe(false);
    expect(lock).toMatchObject({ name: "Kev", look: "as in their picture", castPicture: KEV_PIC });
    expect(lock?.voiceId).toBeUndefined();
    expect(body).toMatchObject({ characterName: "Kev", characterCard: { name: "Kev", pictureUrl: KEV_PIC } });
    expect(body).not.toHaveProperty("voiceId");
  });

  it("the built-in cast is unchanged: same names, same voices, Shazza still first for an unnamed line", () => {
    const plain = { characterLoras: { characters: [] } } as unknown as SkidmarksState;
    expect(sunnyBanksSpeakerNames(plain).sort()).toEqual(Object.keys(SUNNY_BANKS_CAST).sort());
    expect(sunnyBanksSpeakerList(plain).map((c) => [c.name, c.voiceId])).toEqual(
      Object.values(SUNNY_BANKS_CAST).map((c) => [c.name, c.voiceId]),
    );
    // A built-in's card with no voice is still the built-in voice.
    expect(resolveSunnyBanksSpeaker("Dazza", STATE)?.voiceId).toBe(SUNNY_BANKS_CAST.Dazza.voiceId);
    expect(rows("[Location: office_storefront]\nNobody said who.", "sunnybank")[0].characterName).toBe(Object.values(SUNNY_BANKS_CAST)[0].name);
  });
});

describe("Shorts already sends pictures for silent shots, no voice needed", () => {
  it("a person with no voice is in the shot with their picture", () => {
    const cast = shortsShotCast([{ name: "Sparrow", look: "", referenceUrls: [SPARROW_PIC] }], {});
    expect(cast.members).toEqual([expect.objectContaining({ name: "Sparrow", picture: SPARROW_PIC })]);
    expect(cast.missingPicture).toEqual([]);
  });
});

describe("through the real route (every outside call mocked)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  const xaiOk = () => json({ data: [{ b64_json: TINY_DATA_URL.split(",")[1], mime_type: "image/png" }] });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    vi.stubEnv("COMFY_URL", "");
    putMock.mockReset();
    putMock.mockImplementation(async (pathname: string) => ({ url: `https://abc123.public.blob.vercel-storage.com/${pathname}` }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Sparrow's silent shot on Grok: the Sparrow picture goes onto the park plate, no ElevenLabs call", async () => {
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(xaiOk())
      .mockResolvedValueOnce(json({ request_id: "grok-1" }))
      .mockResolvedValueOnce(json({ status: "done", video: { url: "https://vidgen.x.ai/v.mp4", duration: 5, respect_moderation: true } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));

    const res = await POST(post(requestFor(rows(SPARROW_SHOT), 0).body));
    expect(res.status).toBe(200);
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls).toContain(SPARROW_PIC);
    expect(urls.some((u) => u.includes("elevenlabs"))).toBe(false);
    const edit = fetchMock.mock.calls.find(([u]) => String(u).includes("/v1/images/edits"));
    expect(edit).toBeTruthy();
    expect(JSON.parse(edit![1].body as string).prompt).toContain("Sparrow");
    const start = fetchMock.mock.calls.find(([u]) => String(u) === "https://api.x.ai/v1/videos/generations");
    expect(JSON.parse(start![1].body as string).prompt).toMatch(/flaps away fast/);
  });

  it("a talking row for Sparrow (no voice) is refused clearly before anything is billed", async () => {
    const all = rows("[Location: park]\nSparrow: Tweet tweet!");
    expect(all.map((r) => [r.kind, r.characterName])).toEqual([["speak", "Sparrow"]]);
    const res = await POST(post(requestFor(all, 0, "skidmarks", "ltx").body));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("missing_voice");
    expect(body.error).toBe(
      'Sparrow has no voice yet, so they can\'t say a line. Add a voice ID on their Cast card, or leave nothing after "Sparrow:" for a silent shot.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("a Sunny Banks '+' character with no voice: talking is refused the same way", async () => {
    const all = rows("[Location: office_storefront]\nKev: G'day.", "sunnybank");
    const res = await POST(post(requestFor(all, 0, "sunnybank", "ltx").body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_voice");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
