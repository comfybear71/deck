import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import type { SkidmarksState } from "@/lib/skidmarks";
import { SKIDMARKS_STYLE_LOCK } from "@/lib/studioGenre";
import { SUNNY_BANKS_LOOK } from "@/lib/sunnyBanks";

/**
 * Skidmarks on the Sunny Banks structure, end to end (2026-10-04): a
 * Skidmarks script is read with the Skidmarks Cast and Locations, each
 * row's request is built by the page's own code with `genre: "skidmarks"`,
 * and the real route renders it in the Skidmarks look into
 * `deck/skidmarks/episodes/<episode>/…`. Every outside call is mocked:
 * nothing is billed and nothing is written.
 */

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({ put: (...args: unknown[]) => putMock(...args) }));

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck/skidmarks";
const DAP_PIC = `${BLOB}/characters/dap/dap-reference.jpg`;
const SPARROW_PIC = `${BLOB}/characters/sparrow/sparrow-reference.jpg`;
const DAP_VOICE = "21m00Tcm4TlvDq8ikWAM";
const EPISODE = "cornish-arsehole";
const DAP_LOOK = "skinny man, white tracksuit, white beanie";

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
  rosterExtras: { "music-video": [], "sunny-banks": [], "adult-shorts": [] },
  skidmarksEpisodes: {
    episodes: [],
    cast: [
      { id: "c_dap", name: "DAP", role: "antihero", look: DAP_LOOK, fictionalAdultConfirmed: true, createdAt: 1 },
      { id: "c_sparrow", name: "Sparrow", role: "supporting", look: "a small brown sparrow", fictionalAdultConfirmed: true, createdAt: 2, isAnimal: true },
    ],
  },
  locations: {
    locations: [
      { id: "loc_skidmarks_town_street", genre: "skidmarks", key: "town_street", name: "Town Street", pictureUrl: `${BLOB}/locations/town-street.png`, createdAt: 1 },
    ],
  },
  characterLoras: {
    characters: [
      card("DAP", "sk:c_dap", DAP_VOICE, DAP_PIC),
      card("Sparrow", "sk:c_sparrow", undefined, SPARROW_PIC),
      // A Sunny Banks card with a voice must never show up in Skidmarks.
      card("Shazza", "sb:shazza", "AZnzlk1XvdvUeBnXmlld"),
    ],
  },
} as unknown as SkidmarksState;

vi.mock("@/lib/skidmarks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skidmarks")>();
  return { ...actual, getSkidmarksSnapshot: () => STATE };
});

const { parseSunnyBanksScriptBlock, sunnyBanksQueueChunks, sunnyBanksRowBeatArgs, sunnyBanksBeatRequestBody, inStudioGenre } = await import(
  "./SkidmarksSunnyBanksPanel"
);
const { resolveSunnyBanksRowCast } = await import("@/lib/sunnyBanksShotCast");
const { sunnyBanksCastCards, resolveSunnyBanksSpeaker, sunnyBanksSpeakerRequestExtras } = await import("@/lib/sunnyBanksVoices");
const { sunnyBanksLocationList } = await import("@/lib/sunnyBanksLocations");
const { POST } = await import("@/app/api/skidmarks/sunnybank/generate-speak-beat/route");

const SCRIPT = [
  "=== ACT I — SCENE 1 — TOWN STREET ===",
  "[Location: town_street]",
  "[Action: DAP struts down the high street eating a pasty]",
  "DAP: Alright, my lover?",
  "[Location: town_street]",
  "[Cast: DAP, Sparrow]",
  "[Action: the sparrow lands on the pasty and DAP glares at it]",
  "DAP:",
].join("\n");

const TINY_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function encodeTestMp3(durationSec: number): Uint8Array {
  const rate = 22050;
  const enc = new Mp3Encoder(1, rate, 64);
  const pcm = new Int16Array(Math.round(durationSec * rate));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0x3fff);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const e = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (e.length) parts.push(e);
  }
  const f = enc.flush();
  if (f.length) parts.push(f);
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of parts) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

type Row = ReturnType<typeof sunnyBanksQueueChunks>[number];

function rows(script = SCRIPT): Row[] {
  return inStudioGenre("skidmarks", () => sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(script)));
}

function requestFor(all: Row[], index: number, videoBackend: "ltx" | "grok" | "h3" = "ltx") {
  const chunk = all[index];
  const lock = resolveSunnyBanksSpeaker(chunk.characterName, STATE, "skidmarks");
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
    sunnyBanksCastCards(STATE, "skidmarks"),
  );
  const location = sunnyBanksLocationList(STATE.locations, "skidmarks").find((l) => l.id === chunk.locationId)!;
  const args = sunnyBanksRowBeatArgs({
    chunk,
    characterName: lock?.name ?? chunk.characterName,
    speaker: sunnyBanksSpeakerRequestExtras(lock, "skidmarks"),
    location,
    startImageDataUrl: TINY_DATA_URL,
    rowCast,
    videoBackend,
    act: "I",
    episodeSlug: EPISODE,
    rowNumber: index + 1,
    sceneFirstRowNumber: index + 1,
    genre: "skidmarks",
  });
  return { rowCast, body: sunnyBanksBeatRequestBody(args) };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/sunnybank/generate-speak-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("a Skidmarks script on the page", () => {
  it("reads DAP from the Skidmarks Cast and town_street from the Skidmarks Locations", () => {
    const all = rows();
    expect(all.map((r) => [r.kind, r.characterName, r.locationId])).toEqual([
      ["speak", "DAP", "town_street"],
      ["hold", "DAP", "town_street"],
    ]);
    expect(all[1].castNames).toEqual(["DAP", "Sparrow"]);
  });

  it("a Sunny Banks name is not a Skidmarks speaker", () => {
    const all = rows("[Location: town_street]\nShazza: You right?");
    expect(all.some((r) => r.characterName === "Shazza")).toBe(false);
  });

  it("the request names the show and the Skidmarks episode folder", () => {
    const { body } = requestFor(rows(), 0);
    expect(body).toMatchObject({
      genre: "skidmarks",
      characterName: "DAP",
      line: "Alright, my lover?",
      locationId: "town_street",
      locationLabel: "Town Street",
      voiceId: DAP_VOICE,
      characterCard: { name: "DAP", look: DAP_LOOK, pictureUrl: DAP_PIC },
      mediaTarget: { folder: `deck/skidmarks/episodes/${EPISODE}/act-i`, name: `${EPISODE}-act-i-beat-01-dap-speak` },
    });
  });

  it("the multi-character hold carries DAP and the Sparrow with their own pictures", () => {
    const { rowCast, body } = requestFor(rows(), 1, "grok");
    expect(rowCast.cast.names).toEqual(["DAP", "Sparrow"]);
    expect(rowCast.cast.missingPicture).toEqual([]);
    expect((body.cast as Array<{ name: string; pictureUrl: string }>).map((p) => [p.name, p.pictureUrl])).toEqual([
      ["DAP", DAP_PIC],
      ["Sparrow", SPARROW_PIC],
    ]);
    expect(body.genre).toBe("skidmarks");
    expect(body.videoBackend).toBe("grok");
  });
});

describe("a Skidmarks row through the real route (every outside call mocked)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  const xaiOk = () => json({ data: [{ b64_json: TINY_DATA_URL.split(",")[1], mime_type: "image/png" }] });
  const tts = () => new Response(new Blob([new Uint8Array(encodeTestMp3(2.5))]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  const xaiPrompt = () => {
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/v1/images/edits"));
    return (JSON.parse(call![1].body as string) as { prompt: string }).prompt;
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "test-comfy-key");
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    vi.stubEnv("COMFY_URL", "");
    putMock.mockReset();
    putMock.mockImplementation(async (pathname: string) => ({ url: `https://abc123.public.blob.vercel-storage.com/${pathname}` }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("DAP's talking row: his voice, his picture on Town Street, the Skidmarks look, saved under deck/skidmarks/episodes", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(xaiOk());
    fetchMock
      .mockResolvedValueOnce(json({ name: "start.png", subfolder: "" }))
      .mockResolvedValueOnce(json({ name: "line.mp3", subfolder: "" }))
      .mockResolvedValueOnce(json({ prompt_id: "job-1" }))
      .mockResolvedValueOnce(json({ status: "completed", outputs: { "341": { images: [{ filename: "out.mp4", subfolder: "video", type: "output" }] } } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://storage.example.com/signed/clip.mp4" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9, 9]), { status: 200 }));

    const res = await POST(post(requestFor(rows(), 0).body));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/v1/text-to-speech/${DAP_VOICE}`);
    expect(String(fetchMock.mock.calls[1][0])).toBe(DAP_PIC);

    const plate = xaiPrompt();
    expect(plate).toContain(SKIDMARKS_STYLE_LOCK);
    expect(plate).toContain("Town Street");
    expect(plate).not.toContain(SUNNY_BANKS_LOOK.styleLock);
    expect(plate).not.toMatch(/heat haze|Aussie|rubbery/i);

    const submit = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/prompt"));
    const graph = JSON.parse(submit![1].body as string).prompt as Record<string, { inputs?: Record<string, unknown> }>;
    const motion = String(graph["340:319"]?.inputs?.value);
    expect(motion).toContain('DAP says: "Alright, my lover?"');
    expect(motion).toContain(SKIDMARKS_STYLE_LOCK);
    expect(motion).not.toMatch(/heat haze|flies|rubbery/i);

    const paths = putMock.mock.calls.map(([p]) => String(p));
    expect(paths.at(-1)).toMatch(new RegExp(`^deck/skidmarks/episodes/${EPISODE}/act-i/${EPISODE}-act-i-beat-01-dap-speak`));
    expect(paths.every((p) => !p.startsWith("deck/sunnybank") && !p.startsWith("sunnybanks/"))).toBe(true);
    expect(body.persisted).toBe(true);
  });

  it("the DAP + Sparrow silent shot on Grok: one plate with both, Skidmarks look, both files in the episode folder", async () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(xaiOk())
      .mockResolvedValueOnce(json({ request_id: "grok-1" }))
      .mockResolvedValueOnce(json({ status: "done", video: { url: "https://vidgen.x.ai/v.mp4", duration: 5, respect_moderation: true } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));

    const res = await POST(post(requestFor(rows(), 1, "grok").body));
    expect(res.status).toBe(200);
    const plate = xaiPrompt();
    expect(plate).toContain("DAP and Sparrow");
    expect(plate).toContain(SKIDMARKS_STYLE_LOCK);
    expect(plate).not.toMatch(/heat haze|Aussie|rubbery/i);
    const start = fetchMock.mock.calls.find(([u]) => String(u) === "https://api.x.ai/v1/videos/generations");
    const startBody = JSON.parse(start![1].body as string);
    expect(startBody.prompt).toContain(SKIDMARKS_STYLE_LOCK);
    expect(startBody.prompt).not.toMatch(/heat haze|flies|rubbery/i);
    const paths = putMock.mock.calls.map(([p]) => String(p));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).toMatch(new RegExp(`^deck/skidmarks/episodes/${EPISODE}/act-i/`));
  });

  it("a Sunny Banks name sent as Skidmarks is refused before anything is billed", async () => {
    const res = await POST(
      post({ genre: "skidmarks", characterName: "Shazza", line: "You right?", locationId: "town_street", locationLabel: "Town Street", startImageDataUrl: TINY_DATA_URL }),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Skidmarks/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
