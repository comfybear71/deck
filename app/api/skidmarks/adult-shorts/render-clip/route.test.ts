import { beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.fn();
const poll = vi.fn();
vi.mock("@/lib/sirayClient", () => ({
  clampSirayI2vDurationSec: (n: number) => Math.round(n),
  resolveSirayCredentials: () => ({ apiKey: "k" }),
  siraySubmitVideoAsync: (...a: unknown[]) => submit(...a),
  sirayPollVideoAsync: (...a: unknown[]) => poll(...a),
  sirayDownloadVideo: vi.fn(),
}));
vi.mock("@/lib/videoFrame16x9", () => ({
  padFrameTo16x9: async (bytes: Uint8Array, mimeType: string) => ({ bytes, mimeType, padded: false }),
}));

import { POST } from "./route";

const PROMPT = "laughing. Adult woman, clearly over 25, fictional AI-created character. No sexual acts shown.";
const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("adult shorts render-clip", () => {
  beforeEach(() => {
    submit.mockReset();
    poll.mockReset();
  });

  it("returns the task id straight after submitting, without waiting on Siray", async () => {
    submit.mockResolvedValue({ ok: true, taskId: "t1" });
    const res = await POST(req({ prompt: PROMPT, startImageUrl: "data:image/png;base64,AAAA", durationSec: 5 }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ pending: true, sirayTaskId: "t1" });
    expect(poll).not.toHaveBeenCalled();
  });

  it("resumes an existing task instead of submitting a new one", async () => {
    poll.mockResolvedValue({ ok: false, code: "timeout", status: 504, error: "still going" });
    const res = await POST(req({ prompt: PROMPT, sirayTaskId: "t1", durationSec: 5 }));
    expect(res.status).toBe(202);
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledWith("t1", expect.anything(), expect.any(Number));
  });

  it("rejects a prompt without the adult lock", async () => {
    const res = await POST(req({ prompt: "laughing", startImageUrl: "data:image/png;base64,AAAA" }));
    expect(res.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("adult shorts render-clip: anyone can star (2026-09-30)", () => {
  beforeEach(() => submit.mockReset());
  it("accepts the lock for a man, anyone, or a group, and still refuses a prompt with none", async () => {
    submit.mockResolvedValue({ ok: true, taskId: "t2" });
    for (const lock of [
      "Adult man, clearly over 25, fictional AI-created character.",
      "Adult person, clearly over 25, fictional AI-created character.",
      "Everyone shown is an adult, clearly over 25, a fictional AI-created character.",
    ]) {
      const res = await POST(req({ prompt: `arm wrestling. ${lock}`, startImageUrl: "data:image/png;base64,AAAA", durationSec: 5 }));
      expect(res.status).toBe(202);
    }
    const res = await POST(req({ prompt: "arm wrestling, clearly over 25", startImageUrl: "data:image/png;base64,AAAA", durationSec: 5 }));
    expect(res.status).toBe(400);
  });
});
