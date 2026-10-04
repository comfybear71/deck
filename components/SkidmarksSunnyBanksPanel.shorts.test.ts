import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkidmarksState } from "@/lib/skidmarks";
import { SHORTS_STYLE_LOCK, SHORTS_TALKING_PLATE_LINE } from "@/lib/studioGenre";
import { buildEmptySunnyBanksLive } from "@/lib/sunnyBanksWorkspace";

/**
 * Shorts on the Sunny Banks/Skidmarks script studio (2026-10-04), end to
 * end: a Shorts script is read with the open episode's own Cast and
 * Locations, each row's request is built by the page's own code with
 * `genre: "shorts"`, and the real route makes plates on Siray (or Grok)
 * and silent clips on Siray (or Grok/H3). Every outside call is mocked:
 * nothing is billed and nothing is written. Neutral test content only.
 */

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({ put: (...args: unknown[]) => putMock(...args) }));

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck/shorts";
const EPISODE = "ep04-test-night";
const AVA_PIC = `${BLOB}/episodes/${EPISODE}/characters/ava/pictures/ava-picture-01.jpg`;
const AVA_VOICE = "21m00Tcm4TlvDq8ikWAM";
const AVA_LOOK = "woman in her thirties, short dark hair, denim jacket";
const PLATE = `${BLOB}/episodes/${EPISODE}/act-i/${EPISODE}-act-i-beat-01-ava-plate.png`;

const STATE = {
  bands: [],
  session: { projectKind: "adult-shorts", bandId: null, mp3: null, scriptSequenceDraft: null },
  removedSeedBandIds: [],
  adultShorts: {
    ageConfirmed: true,
    editor: "script",
    character: { name: "", look: "", referenceUrls: [] },
    shots: [],
    saved: [],
    currentSavedId: null,
  },
  shortsStudio: { live: { ...buildEmptySunnyBanksLive("shorts"), mediaSlug: EPISODE }, workspaces: [], saveSeq: 0 },
  rosterExtras: {
    "music-video": [],
    "sunny-banks": [],
    "adult-shorts": [
      { id: "chr_ava", name: "Ava", look: AVA_LOOK, episode: EPISODE, createdAt: 1, pictureUrls: [AVA_PIC], fictionalAdultConfirmed: true },
      // Another episode's person never shows up in this one.
      { id: "chr_other", name: "Zed", look: "", episode: "ep09-elsewhere", createdAt: 2, pictureUrls: [AVA_PIC], fictionalAdultConfirmed: true },
    ],
  },
  locations: {
    locations: [
      { id: "loc_adult_shorts_beach_bar", genre: "adult-shorts", key: "beach_bar", name: "Beach Bar", episode: EPISODE, pictureUrl: `${BLOB}/episodes/${EPISODE}/locations/beach-bar.png`, createdAt: 1 },
      { id: "loc_adult_shorts_far_away", genre: "adult-shorts", key: "far_away", name: "Far Away", episode: "ep09-elsewhere", pictureUrl: `${BLOB}/locations/far.png`, createdAt: 2 },
    ],
  },
  characterLoras: {
    characters: [
      {
        id: "clora_ava",
        name: "Ava",
        slug: "ava",
        sourceKey: "asx:chr_ava",
        status: "idle",
        trainingImageUrls: [],
        version: 1,
        createdAt: "2026-10-04T00:00:00.000Z",
        voiceId: AVA_VOICE,
        referenceUrl: AVA_PIC,
      },
    ],
  },
} as unknown as SkidmarksState;

vi.mock("@/lib/skidmarks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skidmarks")>();
  return { ...actual, getSkidmarksSnapshot: () => STATE };
});

const { parseSunnyBanksScriptBlock, sunnyBanksQueueChunks, sunnyBanksRowBeatArgs, sunnyBanksBeatRequestBody, inStudioGenre, plateFailedMessage } =
  await import("./SkidmarksSunnyBanksPanel");
const { resolveSunnyBanksRowCast } = await import("@/lib/sunnyBanksShotCast");
const { sunnyBanksCastCards, resolveSunnyBanksSpeaker, sunnyBanksSpeakerRequestExtras } = await import("@/lib/sunnyBanksVoices");
const { studioLocationList } = await import("@/lib/sunnyBanksLocations");
const { POST } = await import("@/app/api/skidmarks/sunnybank/generate-speak-beat/route");

const SCRIPT = [
  "[Location: beach_bar]",
  "[Action: Ava faces the camera at the bar, head level, warm evening light]",
  "Ava: Nice night for it. [pause]",
  "[Location: beach_bar]",
  "[Action: Ava sips her drink and watches the waves]",
  "Ava:",
].join("\n");

const TINY_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type Row = ReturnType<typeof sunnyBanksQueueChunks>[number];

function rows(script = SCRIPT): Row[] {
  return inStudioGenre("shorts", () => sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(script)));
}

function requestFor(
  all: Row[],
  index: number,
  opts: { videoBackend?: "ltx" | "grok" | "h3" | "siray"; plateOnly?: boolean; rowPlateUrl?: string; plateEngine?: "siray" | "grok"; sirayTaskId?: string } = {},
) {
  const chunk = all[index];
  const lock = resolveSunnyBanksSpeaker(chunk.characterName, STATE, "shorts");
  const rowCast = resolveSunnyBanksRowCast(
    {
      kind: chunk.kind,
      characterName: chunk.characterName,
      cutaway: chunk.kind === "hold" && !lock,
      action: chunk.action,
      sceneAction: chunk.sceneAction,
      castNames: chunk.castNames,
      castLooks: chunk.castLooks,
      sceneSpeakers: chunk.sceneSpeakers,
      appearanceModifier: chunk.appearanceModifier,
    },
    sunnyBanksCastCards(STATE, "shorts"),
  );
  const location = studioLocationList(STATE, "shorts").find((l) => l.id === chunk.locationId)!;
  const args = sunnyBanksRowBeatArgs({
    chunk,
    characterName: lock?.name ?? chunk.characterName,
    speaker: sunnyBanksSpeakerRequestExtras(lock, "shorts"),
    location,
    startImageDataUrl: TINY_DATA_URL,
    rowCast,
    videoBackend: opts.videoBackend ?? "ltx",
    act: "I",
    episodeSlug: EPISODE,
    rowNumber: index + 1,
    sceneFirstRowNumber: index + 1,
    genre: "shorts",
    rowPlateUrl: opts.rowPlateUrl,
    plateOnly: opts.plateOnly,
    plateEngine: opts.plateEngine,
    sirayTaskId: opts.sirayTaskId,
  });
  return sunnyBanksBeatRequestBody(args);
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/sunnybank/generate-speak-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("a Shorts script on the page", () => {
  it("reads Ava and beach_bar from this episode's own Cast and Locations only", () => {
    expect(rows().map((r) => [r.kind, r.characterName, r.locationId])).toEqual([
      ["speak", "Ava", "beach_bar"],
      ["hold", "Ava", "beach_bar"],
    ]);
    expect(sunnyBanksCastCards(STATE, "shorts").map((c) => c.name)).toEqual(["Ava"]);
    expect(studioLocationList(STATE, "shorts").map((l) => l.id)).toEqual(["beach_bar"]);
  });

  it("the request names the show, the Shorts episode folder, Ava's voice and picture", () => {
    expect(requestFor(rows(), 0)).toMatchObject({
      genre: "shorts",
      characterName: "Ava",
      line: "Nice night for it. [pause]",
      voiceId: AVA_VOICE,
      characterCard: { name: "Ava", pictureUrl: AVA_PIC },
      mediaTarget: { folder: `deck/shorts/episodes/${EPISODE}/act-i`, name: `${EPISODE}-act-i-beat-01-ava-speak` },
    });
  });

  it("Make plate sends plateOnly with its own plate name; a later render sends the plate back", () => {
    const plate = requestFor(rows(), 0, { plateOnly: true, plateEngine: "siray" });
    expect(plate).toMatchObject({
      plateOnly: true,
      plateEngine: "siray",
      plateTarget: { folder: `deck/shorts/episodes/${EPISODE}/act-i`, name: `${EPISODE}-act-i-beat-01-ava-plate` },
    });
    const render = requestFor(rows(), 0, { rowPlateUrl: PLATE, plateEngine: "grok" });
    expect(render.plateUrl).toBe(PLATE);
    expect(render.plateEngine).toBe("grok");
    expect(render).not.toHaveProperty("plateOnly");
  });

  it("a plain one-click request carries none of the new fields", () => {
    const body = requestFor(rows(), 0);
    for (const key of ["plateOnly", "plateUrl", "plateEngine", "sirayTaskId", "plateTarget"]) expect(body).not.toHaveProperty(key);
  });

  it("a refused plate is said plainly, and says no clip was billed", () => {
    expect(plateFailedMessage("Siray's generation failed: content policy.")).toBe(
      "Plate not made: Siray's generation failed: content policy. No clip was rendered or billed. Change the shot and make the plate again.",
    );
  });
});

describe("a Shorts row through the real route (every outside call mocked)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  const call = (part: string) => fetchMock.mock.calls.find(([u]) => String(u).includes(part));

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "test-comfy-key");
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    vi.stubEnv("SIRAY_API_KEY", "test-siray-key");
    vi.stubEnv("COMFY_URL", "");
    putMock.mockReset();
    putMock.mockImplementation(async (pathname: string) => ({ url: `https://abc123.public.blob.vercel-storage.com/${pathname}` }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Make plate on a talking row: one Siray still (adult lock, head level, mouth visible), saved, no voice, no video", async () => {
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(json({ data: { task_id: "still-1" } }))
      .mockResolvedValueOnce(json({ data: { status: "SUCCESS", outputs: ["https://siray.example/out.jpg"] } }))
      .mockResolvedValueOnce(jpeg());
    const res = await POST(post(requestFor(rows(), 0, { plateOnly: true })));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plateUrl).toMatch(new RegExp(`/deck/shorts/episodes/${EPISODE}/act-i/${EPISODE}-act-i-beat-01-ava-plate`));
    expect(body.plateEngine).toBe("siray");
    const submit = JSON.parse(call("/v1/images/generations/async")![1].body as string) as { prompt: string; images: string[] };
    expect(submit.prompt).toContain(SHORTS_STYLE_LOCK);
    expect(submit.prompt).toMatch(/\badult\b[a-z ]{0,12}, clearly over 25/i);
    expect(submit.prompt).toContain(SHORTS_TALKING_PLATE_LINE);
    expect(submit.images).toHaveLength(2);
    // Nothing else: no voice, no Grok, no Comfy.
    expect(call("text-to-speech")).toBeUndefined();
    expect(call("api.x.ai")).toBeUndefined();
    expect(call("/api/prompt")).toBeUndefined();
  });

  it("the Plates switch on Grok makes the same plate on Grok instead", async () => {
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(json({ data: [{ b64_json: TINY_DATA_URL.split(",")[1], mime_type: "image/png" }] }));
    const res = await POST(post(requestFor(rows(), 0, { plateOnly: true, plateEngine: "grok" })));
    expect(res.status).toBe(200);
    expect(call("/v1/images/edits")).toBeDefined();
    expect(call("siray")).toBeUndefined();
  });

  it("a refused Siray plate stops before anything else is made", async () => {
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(json({ data: { task_id: "still-2" } }))
      .mockResolvedValueOnce(json({ data: { status: "FAILURE", fail_reason: "content policy" } }));
    const res = await POST(post(requestFor(rows(), 1, { videoBackend: "siray" })));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.plateFailed).toBe(true);
    expect(String(body.error)).toMatch(/content policy/);
    expect(call("/v1/video/generations")).toBeUndefined();
  });

  it("the silent row on Siray from its plate: submits and answers pending, then the check-back saves the clip", async () => {
    fetchMock.mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(json({ data: { task_id: "vid-1" } }));
    const first = await POST(post(requestFor(rows(), 1, { videoBackend: "siray", rowPlateUrl: PLATE })));
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ pending: true, sirayTaskId: "vid-1", videoBackend: "siray" });
    // Its plate was used as it is: no new plate.
    expect(String(fetchMock.mock.calls[0][0])).toBe(PLATE);
    expect(call("/v1/images")).toBeUndefined();
    const submitted = JSON.parse(call("/v1/video/generations")![1].body as string) as { prompt: string };
    expect(submitted.prompt).toMatch(/\badult\b[a-z ]{0,12}, clearly over 25/i);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json({ data: { status: "SUCCESS", outputs: ["https://siray.example/v.mp4"] } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));
    const second = await POST(post(requestFor(rows(), 1, { videoBackend: "siray", rowPlateUrl: PLATE, sirayTaskId: "vid-1" })));
    const done = await second.json();
    expect(second.status).toBe(200);
    expect(done.videoBackend).toBe("siray");
    // Checked back on the same task; nothing was submitted or plated again.
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/video/generations/vid-1");
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/v1/video/generations"))).toBe(false);
    const paths = putMock.mock.calls.map(([p]) => String(p));
    expect(paths.at(-1)).toMatch(new RegExp(`^deck/shorts/episodes/${EPISODE}/act-i/${EPISODE}-act-i-beat-02-ava-hold`));
  });

  it("Try with Grok: the same silent row on Grok", async () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(json({ request_id: "grok-1" }))
      .mockResolvedValueOnce(json({ status: "done", video: { url: "https://vidgen.x.ai/v.mp4", duration: 5, respect_moderation: true } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));
    const res = await POST(post(requestFor(rows(), 1, { videoBackend: "grok", rowPlateUrl: PLATE })));
    expect(res.status).toBe(200);
    expect((await res.json()).videoBackend).toBe("grok");
    expect(call("siray")).toBeUndefined();
  });

  it("[SIRAY] on Sunny Banks is refused before anything is billed", async () => {
    const res = await POST(
      post({ kind: "hold", characterName: "Crowd", videoBackend: "siray", locationId: "office_storefront", startImageDataUrl: TINY_DATA_URL }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a plate for a cutaway is refused: there's nobody to plate", async () => {
    const res = await POST(
      post({ genre: "shorts", kind: "hold", characterName: "Crowd", plateOnly: true, locationId: "beach_bar", startImageDataUrl: TINY_DATA_URL }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("no_plate_needed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
