import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn(), list: vi.fn() }));

import { DECK_BUILD_HEADER, deckBuildHeaders, STALE_PAGE_MESSAGE } from "./deckBuild";
import { staleDeckPageResponse } from "./deckBuildServer";
import { POST as generateStill } from "@/app/api/skidmarks/generate-still/route";
import { POST as generateClip } from "@/app/api/skidmarks/generate-clip/route";
import { POST as sirayStill } from "@/app/api/skidmarks/generate-still-siray/route";
import { POST as shortsClip } from "@/app/api/skidmarks/adult-shorts/render-clip/route";
import { POST as shortsTalking } from "@/app/api/skidmarks/adult-shorts/render-talking/route";
import { POST as sunnybankBeat } from "@/app/api/skidmarks/sunnybank/generate-speak-beat/route";

/** "This page is older than the server" guard (2026-10-03, EP05 Act V). */

const req = (headers: Record<string, string> = {}, body: unknown = { prompt: "x" }) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("deck build stamp", () => {
  it("no build id (local, tests): no header and no check", () => {
    vi.stubEnv("NEXT_PUBLIC_DECK_BUILD", "");
    expect(deckBuildHeaders()).toEqual({});
    expect(staleDeckPageResponse(req())).toBeNull();
  });

  it("the page sends its build; the same build passes, a missing or different one is refused", async () => {
    vi.stubEnv("NEXT_PUBLIC_DECK_BUILD", "abc1234");
    expect(deckBuildHeaders()).toEqual({ [DECK_BUILD_HEADER]: "abc1234" });
    expect(staleDeckPageResponse(req({ [DECK_BUILD_HEADER]: "abc1234" }))).toBeNull();
    for (const headers of [{}, { [DECK_BUILD_HEADER]: "0000000" }] as Record<string, string>[]) {
      const res = staleDeckPageResponse(req(headers))!;
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: STALE_PAGE_MESSAGE, code: "stale_page" });
    }
  });

  it("every paid render route refuses an old page before calling anything, in every genre", async () => {
    vi.stubEnv("NEXT_PUBLIC_DECK_BUILD", "abc1234");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const post of [generateStill, generateClip, sirayStill, shortsClip, shortsTalking, sunnybankBeat]) {
      const res = await post(req());
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("stale_page");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the voice test (▶ on a Cast card) is never blocked", async () => {
    vi.stubEnv("NEXT_PUBLIC_DECK_BUILD", "abc1234");
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sunnybankBeat(req({}, { kind: "voice-test", voiceId: "21m00Tcm4TlvDq8ikWAM", line: "G'day" }));
    expect(res.status).toBe(200);
  });
});
