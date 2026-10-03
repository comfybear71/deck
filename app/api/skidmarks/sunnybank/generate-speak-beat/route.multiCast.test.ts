import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

import { SUNNY_BANKS_CAST } from "@/lib/sunnyBanks";
import { POST } from "./route";

/**
 * Multi-cast shots through the speak-beat route (2026-10-03). Every
 * outside call is mocked: ElevenLabs, the Cast card picture fetches, xAI
 * edits, Comfy Cloud, Grok video and Vercel Blob. Nothing real is billed.
 */

function encodeTestMp3(durationSec: number): Uint8Array {
  const sampleRate = 22050;
  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const pcm = new Int16Array(Math.round(durationSec * sampleRate));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0x3fff);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const e = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (e.length) chunks.push(e);
  }
  const f = encoder.flush();
  if (f.length) chunks.push(f);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const TINY_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const BLOB = "https://abc123.public.blob.vercel-storage.com/deck/sunnybank";
const pic = (slug: string) => `${BLOB}/characters/${slug}/${slug}-picture-01.jpg`;
const PLATE_URL = `${BLOB}/episodes/ep05/act-v/ep05-act-v-beat-01-stuie-bloom-plate.png`;
const VOICE_STUIE = "AZnzlk1XvdvUeBnXmlld";
const VOICE_BLOOM = "21m00Tcm4TlvDq8ikWAM";
const ACTION =
  "Both men stay in frame the whole time, mouths closed. BLOOM, the man-bun guy front left, folds his arms and nods slowly; STUIE, on the right, scratches his head and shifts his weight. Camera holds, no cuts.";

const STUIE = { name: "Stuie", look: "thin bloke in a faded singlet", pictureUrl: pic("stuie"), position: "on the right" };
const BLOOM = { name: "Bloom", look: "long blond man-bun, grey harem pants", pictureUrl: pic("bloom"), position: "front left" };
const PLATE_TARGET = { folder: "deck/sunnybank/episodes/ep05/act-v", name: "ep05-act-v-beat-01-stuie-bloom-plate" };

function post(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/sunnybank/generate-speak-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function line1(extra: Record<string, unknown> = {}) {
  return {
    characterName: "Stuie",
    line: "Hello BLOOM",
    locationId: "park_site_4",
    locationLabel: "Park Site 4",
    startImageDataUrl: TINY_DATA_URL,
    action: ACTION,
    voiceId: VOICE_STUIE,
    characterCard: { name: "Stuie", look: STUIE.look, pictureUrl: STUIE.pictureUrl },
    cast: [STUIE, BLOOM],
    sceneSpeakers: ["Stuie", "Bloom"],
    plateTarget: PLATE_TARGET,
    ...extra,
  };
}

function line2(extra: Record<string, unknown> = {}) {
  return {
    characterName: "Bloom",
    line: "Namaste STUIE",
    locationId: "park_site_4",
    locationLabel: "Park Site 4",
    startImageDataUrl: TINY_DATA_URL,
    voiceId: VOICE_BLOOM,
    characterCard: { name: "Bloom", look: BLOOM.look, pictureUrl: BLOOM.pictureUrl },
    cast: [BLOOM, STUIE],
    sceneAction: ACTION,
    sceneSpeakers: ["Stuie", "Bloom"],
    scenePlateUrl: PLATE_URL,
    plateTarget: PLATE_TARGET,
    ...extra,
  };
}

describe("multi-cast shots in the speak-beat route", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  const xaiOk = () => json({ data: [{ b64_json: TINY_DATA_URL.split(",")[1], mime_type: "image/png" }] });
  const tts = () => new Response(new Blob([new Uint8Array(encodeTestMp3(2.5))]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  const comfyRun = () => {
    fetchMock
      .mockResolvedValueOnce(json({ name: "start.png", subfolder: "" }))
      .mockResolvedValueOnce(json({ name: "line.mp3", subfolder: "" }))
      .mockResolvedValueOnce(json({ prompt_id: "job-1" }))
      .mockResolvedValueOnce(json({ status: "completed", outputs: { "341": { images: [{ filename: "out.mp4", subfolder: "video", type: "output" }] } } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://storage.example.com/signed/clip.mp4" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9, 9]), { status: 200 }));
  };
  const urls = () => fetchMock.mock.calls.map(([u]) => String(u));
  const xaiCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/v1/images/edits"));
  const ltxPrompt = () => {
    const submit = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/prompt"));
    const graph = JSON.parse(submit![1].body as string).prompt as Record<string, { inputs?: Record<string, unknown> }>;
    return String(graph["340:319"]?.inputs?.value);
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "test-comfy-key");
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    vi.stubEnv("COMFY_URL", "");
    putMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("example 2, line 1: one xAI call (place, STUIE, BLOOM), the N-person prompt, the plate saved, STUIE lip-syncs and BLOOM listens", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(xaiOk());
    comfyRun();
    putMock
      .mockResolvedValueOnce({ url: PLATE_URL })
      .mockResolvedValueOnce({ url: `${BLOB}/episodes/ep05/act-v/ep05-act-v-beat-01-stuie-speak.mp4` });

    const res = await POST(post(line1()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plateUrl).toBe(PLATE_URL);
    expect(body.castNames).toEqual(["Stuie", "Bloom"]);

    // Pictures fetched in cast order, then ONE edits call with the place first.
    expect(urls().slice(1, 3)).toEqual([STUIE.pictureUrl, BLOOM.pictureUrl]);
    expect(xaiCalls()).toHaveLength(1);
    const xai = JSON.parse(xaiCalls()[0][1].body as string) as { prompt: string; images: { url: string }[] };
    expect(xai.images).toHaveLength(3);
    expect(xai.images[0].url).toBe(TINY_DATA_URL);
    expect(xai.images[1].url).toMatch(/^data:image\/jpeg;base64,/);
    expect(xai.prompt).toContain("Exactly 2 people in frame: Stuie and Bloom.");
    expect(xai.prompt).toContain("Image 2 (<IMAGE_1>) is Stuie, on the right");
    expect(xai.prompt).toContain("Image 3 (<IMAGE_2>) is Bloom, front left");
    expect(xai.prompt).toContain("All mouths closed.");
    expect(xai.prompt).toContain("Stuie and Bloom all talk in this scene");
    expect(xai.prompt).not.toContain("One person only");

    // The plate's readable name, then the clip's.
    expect(String(putMock.mock.calls[0][0])).toBe("deck/sunnybank/episodes/ep05/act-v/ep05-act-v-beat-01-stuie-bloom-plate.png");

    const prompt = ltxPrompt();
    expect(prompt).toContain('Stuie says: "Hello BLOOM"');
    expect(prompt).toContain(
      "Stuie, thin bloke in a faded singlet, on the right, is the only one speaking, mouth and jaw in clear sync with the audio. " +
        "Bloom, long blond man-bun, grey harem pants, front left, listens silently, lips pressed together, mouth closed the whole clip.",
    );
    // Gold first, untouched; the action after it.
    expect(prompt.startsWith("Use the provided start image as the first frame. Stuie,")).toBe(true);
    expect(prompt).toContain(ACTION);
  });

  it("example 2, line 2: the same plate is reused (no xAI call), roles flipped", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg());
    comfyRun();
    putMock.mockResolvedValueOnce({ url: `${BLOB}/episodes/ep05/act-v/ep05-act-v-beat-02-bloom-speak.mp4` });

    const res = await POST(post(line2()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plateUrl).toBe(PLATE_URL);
    expect(xaiCalls()).toHaveLength(0);
    expect(urls()[1]).toBe(PLATE_URL);
    expect(putMock).toHaveBeenCalledTimes(1);
    const prompt = ltxPrompt();
    expect(prompt).toContain('Bloom says: "Namaste STUIE"');
    expect(prompt).toContain("Bloom, long blond man-bun, grey harem pants, front left, is the only one speaking");
    expect(prompt).toContain("Stuie, thin bloke in a faded singlet, on the right, listens silently");
    // The scene's action shapes the plate only; line 2 has no motion text of its own.
    expect(prompt).not.toContain("scratches his head");
  });

  it("example 1 (silent, Grok): one plate with Ranger Bazza and Bloom; everyone animates, mouths closed", async () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    const bazza = SUNNY_BANKS_CAST["Ranger Bazza"];
    const bloomLook = "long blond man-bun, grey harem pants, back to camera, yoga tree pose, foreground";
    const action = "Ranger Bazza rising out of the muddy dam with a snorkel, holding up a ticket book… Camera still.";
    fetchMock
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(jpeg())
      .mockResolvedValueOnce(xaiOk())
      .mockResolvedValueOnce(json({ request_id: "grok-1" }))
      .mockResolvedValueOnce(json({ status: "done", video: { url: "https://vidgen.x.ai/v.mp4", duration: 5, respect_moderation: true } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));
    putMock.mockResolvedValueOnce({ url: `${BLOB}/plates/x.png` }).mockResolvedValueOnce({ url: `${BLOB}/clip.mp4` });

    const res = await POST(
      post({
        kind: "hold",
        characterName: "Ranger Bazza",
        startImageDataUrl: TINY_DATA_URL,
        locationId: "water_tank_dam",
        locationLabel: "Water Tank Dam",
        action,
        videoBackend: "grok",
        characterCard: { name: "Ranger Bazza", look: bazza.look, pictureUrl: pic("ranger-bazza") },
        cast: [
          { name: "Ranger Bazza", look: bazza.look, pictureUrl: pic("ranger-bazza") },
          { name: "Bloom", look: "long blond man-bun, grey harem pants", pictureUrl: pic("bloom"), position: "foreground", shotLook: bloomLook },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const xai = JSON.parse(xaiCalls()[0][1].body as string) as { prompt: string; images: unknown[] };
    expect(xai.images).toHaveLength(3);
    expect(xai.prompt).toContain("Exactly 2 people in frame: Ranger Bazza and Bloom.");
    expect(xai.prompt).toContain(`Shot-specific look for Bloom, this render only: ${bloomLook}.`);
    expect(xai.prompt).toContain(`This shot: ${action}.`);
    expect(xai.prompt).toContain("Where each person stands follows the shot text");
    const start = fetchMock.mock.calls.find(([u]) => String(u) === "https://api.x.ai/v1/videos/generations");
    const startBody = JSON.parse(start![1].body as string);
    // One start image, no reference_images: the engine call is unchanged.
    expect(startBody.image.url).toMatch(/^data:image\//);
    expect(startBody.reference_images).toBeUndefined();
    expect(startBody.prompt).toContain("Exactly 2 people in frame: Ranger Bazza and Bloom.");
    expect(startBody.prompt).toContain("every mouth stays closed the whole clip");
    expect(startBody.prompt).toContain("nobody talks");
    // Bloom's look never lands on Bazza's own look text.
    expect(startBody.prompt).not.toContain(`Ranger Bazza, ${bloomLook}`);
  });

  it("anyone in the shot with no Cast card picture: refused before anything is billed", async () => {
    const res = await POST(post(line1({ cast: [STUIE, { ...BLOOM, pictureUrl: undefined }] })));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_cast_picture");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a plate that fails after it was made still hands back plateUrl, so the retry reuses it", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(xaiOk());
    fetchMock.mockResolvedValueOnce(json({ error: "upload broke" }, 500));
    putMock.mockResolvedValueOnce({ url: PLATE_URL });
    const res = await POST(post(line1()));
    const body = await res.json();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.plateUrl).toBe(PLATE_URL);
  });

  it("location already has the people in it: no compositing, no picture needed, one person or several", async () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    for (const cast of [undefined, [STUIE, { ...BLOOM, pictureUrl: undefined }]]) {
      fetchMock.mockReset();
      putMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(json({ request_id: "grok-1" }))
        .mockResolvedValueOnce(json({ status: "done", video: { url: "https://vidgen.x.ai/v.mp4", duration: 5, respect_moderation: true } }))
        .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));
      putMock.mockResolvedValueOnce({ url: `${BLOB}/clip.mp4` });
      const res = await POST(
        post({
          kind: "hold",
          characterName: "Stuie",
          startImageDataUrl: TINY_DATA_URL,
          videoBackend: "grok",
          voiceId: VOICE_STUIE,
          characterCard: { name: "Stuie", look: STUIE.look },
          locationHasPeople: true,
          ...(cast ? { cast } : {}),
        }),
      );
      expect(res.status).toBe(200);
      expect(xaiCalls()).toHaveLength(0);
      const start = fetchMock.mock.calls.find(([u]) => String(u) === "https://api.x.ai/v1/videos/generations");
      expect(JSON.parse(start![1].body as string).image.url).toBe(TINY_DATA_URL);
    }
  });

  it("the old single-card request is unchanged: two images, the one-person prompt, no plate saved", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(xaiOk());
    comfyRun();
    putMock.mockResolvedValueOnce({ url: `${BLOB}/clip.mp4` });
    const res = await POST(
      post({
        characterName: "Shazza",
        line: "Oi",
        startImageDataUrl: TINY_DATA_URL,
        characterCard: { name: "Shazza", look: SUNNY_BANKS_CAST.Shazza.look, pictureUrl: pic("shazza") },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plateUrl).toBeUndefined();
    expect(body.castNames).toBeUndefined();
    const xai = JSON.parse(xaiCalls()[0][1].body as string) as { prompt: string; images: unknown[] };
    expect(xai.images).toHaveLength(2);
    expect(xai.prompt).toContain("One person only.");
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(ltxPrompt()).not.toContain("is the only one speaking");
  });

  it("a cast list without the row's own character is ignored (one-person shot)", async () => {
    fetchMock.mockResolvedValueOnce(tts()).mockResolvedValueOnce(jpeg()).mockResolvedValueOnce(xaiOk());
    comfyRun();
    putMock.mockResolvedValueOnce({ url: `${BLOB}/clip.mp4` });
    const res = await POST(post(line1({ cast: [BLOOM, { ...BLOOM, name: "Nan" }] })));
    expect(res.status).toBe(200);
    const xai = JSON.parse(xaiCalls()[0][1].body as string) as { images: unknown[] };
    expect(xai.images).toHaveLength(2);
  });
});
