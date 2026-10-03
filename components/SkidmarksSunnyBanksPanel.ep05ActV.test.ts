import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import type { SkidmarksState } from "@/lib/skidmarks";

/**
 * Regression for Stuart's live test of multi-cast shots (EP05 "The
 * Influencer Influx", Act V, 3 Oct 2026, 3:17–3:19 PM Darwin time).
 *
 * What happened: rows 11–13 were rendered from a Safari tab opened before
 * PR #240 went live (3:13 PM), so the page sent the OLD one-person
 * requests. The saved rows have no `castNames`/`plateUrl`, no shared
 * picture exists in Blob, and each clip's first frame holds one Cast
 * picture only (row 12: Stuie alone; row 13: Bloom alone). LTX then
 * invented a second "man-bun guy" mid-clip from the [Action:] text.
 *
 * These tests use his exact script text and his real Cast card shapes
 * (STUIE / BLOOM in capitals, as saved), build each row's request with
 * the page's own code (`sunnyBanksRowBeatArgs` + `sunnyBanksBeatRequestBody`),
 * and send it through the real route with every outside call mocked.
 */

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({ put: (...args: unknown[]) => putMock(...args) }));

const BLOB = "https://klpgwmpsxnp9aoca.public.blob.vercel-storage.com/deck/sunnybank";
const STUIE_PIC = `${BLOB}/characters/me/pictures/me-picture-01.jpg`;
const BLOOM_PIC = `${BLOB}/characters/bloom/pictures/bloom-picture-01.jpg`;
const BAZZA_PIC = `${BLOB}/characters/ranger-bazza/ranger-bazza-reference.jpg`;
const EPISODE = "ep05-the-influencer-influx";
const ACT_FOLDER = `deck/sunnybank/episodes/${EPISODE}/act-v`;

function card(name: string, sourceKey: string, voiceId?: string, referenceUrl?: string) {
  return {
    id: `clora_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    slug: name.toLowerCase(),
    sourceKey,
    status: "idle",
    trainingImageUrls: [],
    version: 1,
    createdAt: "2026-10-03T00:00:00.000Z",
    ...(voiceId ? { voiceId } : {}),
    ...(referenceUrl ? { referenceUrl } : {}),
  };
}

// Stuart's saved Cast cards (deck_items + rosterExtras, read 3 Oct 2026).
const STATE = {
  bands: [],
  session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null },
  removedSeedBandIds: [],
  rosterExtras: {
    "music-video": [],
    "sunny-banks": [
      { id: "chr_41a99148-5e6e-4217-8316-e84cc3d1fd12", name: "BLOOM", look: "", pictureUrls: [BLOOM_PIC], fictionalAdultConfirmed: true, createdAt: 1790929694203 },
      { id: "chr_f55c3393-8998-4f9b-86fa-f072fc7d6b9e", name: "STUIE", look: "", pictureUrls: [STUIE_PIC], fictionalAdultConfirmed: true, createdAt: 1790999994247 },
    ],
    "adult-shorts": [],
  },
  characterLoras: {
    characters: [
      card("BLOOM", "sbx:chr_41a99148-5e6e-4217-8316-e84cc3d1fd12", "lT1ah51J1RXqbKF0Ek0u", BLOOM_PIC),
      card("STUIE", "sbx:chr_f55c3393-8998-4f9b-86fa-f072fc7d6b9e", "6JW9wKJ4dFVlcj9kOzTQ", STUIE_PIC),
      card("Ranger Bazza", "sb:ranger_bazza", undefined, BAZZA_PIC),
    ],
  },
} as unknown as SkidmarksState;

vi.mock("@/lib/skidmarks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skidmarks")>();
  return { ...actual, getSkidmarksSnapshot: () => STATE };
});

const { parseSunnyBanksScriptBlock, sunnyBanksQueueChunks, sunnyBanksRowBeatArgs, sunnyBanksBeatRequestBody } = await import(
  "./SkidmarksSunnyBanksPanel"
);
const { resolveSunnyBanksRowCast } = await import("@/lib/sunnyBanksShotCast");
const { sunnyBanksCastCards, resolveSunnyBanksSpeaker, sunnyBanksSpeakerRequestExtras } = await import("@/lib/sunnyBanksVoices");
const { sunnyBanksLocationList } = await import("@/lib/sunnyBanksLocations");
const { POST } = await import("@/app/api/skidmarks/sunnybank/generate-speak-beat/route");

/** Stuart's Act V text from Scene 6 down, exactly as saved (DB, 3 Oct 2026). */
const ACT_V_TAIL =
  "=== ACT V \u2014 SCENE 6 \u2014 PARK SITE 4 ===\n[Location: park_site_4]\n[Action: Both men stay in frame the whole time, mouths closed. BLOOM, the man-bun guy front left, folds his arms and nods slowly; STUIE, on the right, scratches his head and shifts his weight. Camera holds, no cuts. rubbery adult cartoon, thick black outlines, flat cel colour.]\nCrowd: [GROK]\n[Location: park_site_4]\n\n[Location: water_tank_dam]\n[Character Bloom: long blond man-bun, grey harem pants, back to camera, yoga tree pose, foreground]\n[Action: Ranger Bazza rising out of the muddy dam with a snorkel, holding up a ticket book, Bloom in the foreground with his back to camera doing a yoga tree pose. Camera still. Flat 2D Aussie cartoon style, bold outlines, simple flat colours. Not realistic, not photo]\nRanger Bazza:\n[Location: water_tank_dam]\n\n=== ACT V \u2014 SCENE 7\u2014 PARK SITE 4 ===\n[Location: park_site_4]\n[Action: Both men stay in frame the whole time, mouths closed. BLOOM, the man-bun guy front left, folds his arms and nods slowly; STUIE, on the right, scratches his head and shifts his weight. Camera holds, no cuts. Flat 2D Aussie cartoon style, bold outlines, simple flat colours. Not realistic, not photo]\nSTUIE: [friendly] Hello BLOOM [pause]\nBLOOM: [dreamy] Namaste STUIE [pause]\n[Location: park_site_4]";

// Nine single-Stuie lines come first in his Act V, so these rows are 10–13.
const FIRST_ROW_NUMBER = 10;

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

function rows(): Row[] {
  return sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(ACT_V_TAIL));
}

/** One row's request, built exactly the way Render builds it. */
function requestFor(all: Row[], index: number, opts: { scenePlateUrl?: string; videoBackend?: "ltx" | "grok" | "h3" } = {}) {
  const chunk = all[index];
  const lock = resolveSunnyBanksSpeaker(chunk.characterName, STATE);
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
    sunnyBanksCastCards(STATE),
  );
  const location = sunnyBanksLocationList(null).find((l) => l.id === chunk.locationId)!;
  const first = chunk.sceneKey ? all.findIndex((r) => r.sceneKey === chunk.sceneKey) : index;
  const args = sunnyBanksRowBeatArgs({
    chunk,
    characterName: lock?.name ?? chunk.characterName,
    speaker: sunnyBanksSpeakerRequestExtras(lock),
    location,
    startImageDataUrl: TINY_DATA_URL,
    rowCast,
    videoBackend: opts.videoBackend ?? "ltx",
    act: "V",
    episodeSlug: EPISODE,
    rowNumber: FIRST_ROW_NUMBER + index,
    sceneFirstRowNumber: FIRST_ROW_NUMBER + first,
    scenePlateUrl: opts.scenePlateUrl,
  });
  return { rowCast, body: sunnyBanksBeatRequestBody(args) };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/skidmarks/sunnybank/generate-speak-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("EP05 Act V, Stuart's exact text: who is in each row", () => {
  it("row 11 is Ranger Bazza + BLOOM (Bloom's look stays on Bloom); rows 12–13 are one scene, STUIE + BLOOM, flipped", () => {
    const all = rows();
    expect(all.map((r) => r.characterName)).toEqual(["Crowd", "Ranger Bazza", "STUIE", "BLOOM"]);
    expect(requestFor(all, 0).rowCast.cast.isMulti).toBe(false);
    const r11 = requestFor(all, 1, { videoBackend: "grok" });
    expect(r11.rowCast.cast.names).toEqual(["Ranger Bazza", "BLOOM"]);
    expect(r11.body.appearanceModifier).toBeUndefined();
    const r12 = requestFor(all, 2);
    const r13 = requestFor(all, 3);
    expect(all[2].sceneKey).toBeDefined();
    expect(all[3].sceneKey).toBe(all[2].sceneKey);
    expect(r12.rowCast.cast.names).toEqual(["STUIE", "BLOOM"]);
    expect(r13.rowCast.cast.names).toEqual(["BLOOM", "STUIE"]);
    expect(r12.rowCast.cast.missingPicture).toEqual([]);
  });

  it("the page's request for row 12 carries both people, both pictures, and where the shared picture goes", () => {
    const { body } = requestFor(rows(), 2);
    expect(body).toMatchObject({
      characterName: "STUIE",
      line: "[friendly] Hello BLOOM [pause]",
      locationId: "park_site_4",
      sceneSpeakers: ["STUIE", "BLOOM"],
      plateTarget: { folder: ACT_FOLDER, name: `${EPISODE}-act-v-beat-12-stuie-bloom-plate` },
    });
    expect((body.cast as Array<{ name: string; pictureUrl: string; position?: string }>).map((p) => [p.name, p.pictureUrl, p.position])).toEqual([
      ["STUIE", STUIE_PIC, "on the right"],
      ["BLOOM", BLOOM_PIC, "front left"],
    ]);
    expect(body.scenePlateUrl).toBeUndefined();
  });
});

describe("EP05 Act V through the real route (every outside call mocked)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  const xaiOk = () => json({ data: [{ b64_json: TINY_DATA_URL.split(",")[1], mime_type: "image/png" }] });
  const tts = () => new Response(new Blob([new Uint8Array(encodeTestMp3(2.4))]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  const comfy = () =>
    fetchMock
      .mockResolvedValueOnce(json({ name: "start.png", subfolder: "" }))
      .mockResolvedValueOnce(json({ name: "line.mp3", subfolder: "" }))
      .mockResolvedValueOnce(json({ prompt_id: "job-1" }))
      .mockResolvedValueOnce(json({ status: "completed", outputs: { "341": { images: [{ filename: "o.mp4", subfolder: "video", type: "output" }] } } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://storage.example.com/c.mp4" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 }));
  const xaiCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/v1/images/edits"));
  const xaiBody = () => JSON.parse(xaiCalls()[0][1].body as string) as { prompt: string; images: { url: string }[] };
  const ltxPrompt = () => {
    const submit = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/prompt"));
    return String((JSON.parse(submit![1].body as string).prompt as Record<string, { inputs?: Record<string, unknown> }>)["340:319"]?.inputs?.value);
  };
  const PLATE = `${BLOB}/episodes/${EPISODE}/act-v/${EPISODE}-act-v-beat-12-stuie-bloom-plate.png`;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "k");
    vi.stubEnv("XAI_API_KEY", "k");
    vi.stubEnv("COMFY_URL", "");
    vi.stubEnv("NEXT_PUBLIC_DECK_BUILD", "");
    putMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("row 12 (STUIE): one xAI call with the park, STUIE's card, BLOOM's card; plate saved; STUIE talks, BLOOM listens", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(xaiOk());
    comfy();
    putMock.mockResolvedValueOnce({ url: PLATE }).mockResolvedValueOnce({ url: `${BLOB}/x.mp4` });
    const res = await POST(post(requestFor(rows(), 2).body));
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.castNames).toEqual(["STUIE", "BLOOM"]);
    expect(out.plateUrl).toBe(PLATE);
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.slice(1, 3)).toEqual([STUIE_PIC, BLOOM_PIC]);
    expect(xaiCalls()).toHaveLength(1);
    expect(xaiBody().images).toHaveLength(3);
    expect(xaiBody().prompt).toContain("Exactly 2 people in frame: STUIE and BLOOM.");
    expect(xaiBody().prompt).toContain("Image 2 (<IMAGE_1>) is STUIE, on the right");
    expect(xaiBody().prompt).toContain("Image 3 (<IMAGE_2>) is BLOOM, front left");
    expect(String(putMock.mock.calls[0][0])).toBe(`${ACT_FOLDER}/${EPISODE}-act-v-beat-12-stuie-bloom-plate.png`);
    // A card with no written look adds nothing ("as in their picture" stays out).
    expect(xaiBody().prompt).toContain("Staging: STUIE, on the right; BLOOM, front left, at Park Site 4.");
    expect(ltxPrompt()).not.toContain("as in their picture, on the right");
    expect(ltxPrompt()).toContain("STUIE, on the right, is the only one speaking");
    expect(ltxPrompt()).toContain("BLOOM, front left, listens silently, lips pressed together, mouth closed the whole clip.");
  });

  it("row 13 (BLOOM) reuses row 12's picture: no xAI call, BLOOM talks, STUIE listens", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg());
    comfy();
    putMock.mockResolvedValueOnce({ url: `${BLOB}/y.mp4` });
    const res = await POST(post(requestFor(rows(), 3, { scenePlateUrl: PLATE }).body));
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.plateUrl).toBe(PLATE);
    expect(xaiCalls()).toHaveLength(0);
    expect(String(fetchMock.mock.calls[1][0])).toBe(PLATE);
    expect(ltxPrompt()).toContain("BLOOM, front left, is the only one speaking");
    expect(ltxPrompt()).toContain("STUIE, on the right, listens silently");
  });

  it("row 11 (Ranger Bazza on Grok): one picture with the dam, Bazza's card and BLOOM's card", async () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(xaiOk())
      .mockResolvedValueOnce(json({ request_id: "g" }))
      .mockResolvedValueOnce(json({ status: "done", video: { url: "https://vidgen.x.ai/v.mp4", duration: 5, respect_moderation: true } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));
    putMock.mockResolvedValueOnce({ url: `${BLOB}/p11.png` }).mockResolvedValueOnce({ url: `${BLOB}/v11.mp4` });
    const res = await POST(post(requestFor(rows(), 1, { videoBackend: "grok" }).body));
    expect(res.status).toBe(200);
    expect((await res.json()).castNames).toEqual(["Ranger Bazza", "BLOOM"]);
    expect(fetchMock.mock.calls.slice(0, 2).map(([u]) => String(u))).toEqual([BAZZA_PIC, BLOOM_PIC]);
    expect(xaiBody().images).toHaveLength(3);
    expect(xaiBody().prompt).toContain("Exactly 2 people in frame: Ranger Bazza and BLOOM.");
    expect(xaiBody().prompt).toContain("Shot-specific look for BLOOM, this render only: long blond man-bun");
  });

  it("what actually happened: the old page's one-person request makes a one-picture plate (Stuie alone)", async () => {
    // The pre-#240 page sent no cast fields, only STUIE's card.
    const { body } = requestFor(rows(), 2);
    const oldBody = Object.fromEntries(
      Object.entries(body).filter(([k]) => !["cast", "sceneSpeakers", "sceneAction", "scenePlateUrl", "plateTarget"].includes(k)),
    );
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(xaiOk());
    comfy();
    putMock.mockResolvedValueOnce({ url: `${BLOB}/z.mp4` });
    const res = await POST(post(oldBody));
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.castNames).toBeUndefined();
    expect(out.plateUrl).toBeUndefined();
    expect(xaiBody().images).toHaveLength(2);
    expect(xaiBody().prompt).toContain("One person only.");
  });

  it("the fix: a page from an older build is refused before anything is billed, with 'reload the page'", async () => {
    vi.stubEnv("NEXT_PUBLIC_DECK_BUILD", "5beb02e");
    const { body } = requestFor(rows(), 2);
    const stale = await POST(post(body));
    expect(stale.status).toBe(409);
    const out = await stale.json();
    expect(out.code).toBe("stale_page");
    expect(out.error).toContain("Reload the page");
    const otherBuild = await POST(post(body, { "x-deck-build": "bdc4da1" }));
    expect(otherBuild.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("a page from the same build goes through", async () => {
    vi.stubEnv("NEXT_PUBLIC_DECK_BUILD", "5beb02e");
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg());
    comfy();
    putMock.mockResolvedValueOnce({ url: `${BLOB}/y.mp4` });
    const res = await POST(post(requestFor(rows(), 3, { scenePlateUrl: PLATE }).body, { "x-deck-build": "5beb02e" }));
    expect(res.status).toBe(200);
  });
});
