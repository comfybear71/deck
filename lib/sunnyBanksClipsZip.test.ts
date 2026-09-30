import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planSunnyBanksClipsZip, sunnyBanksZipEpisodePart } from "./sunnyBanksClipsZip";
import { storeZipStream } from "./zipDownload";
import { POST } from "../app/api/skidmarks/sunnybank/clips-zip/route";

/**
 * The zip icon beside each act in CLIPS (2026-09-30): one zip of that
 * act's Done clips, built on the server, readable names in line order.
 */

const BLOB = "https://abc.public.blob.vercel-storage.com/deck/sunnybank/episodes/ep01-the-first-fleet/act-ii";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The system's own `unzip`, so the format is checked by something this file didn't write. */
function unzipped(bytes: Uint8Array): { listing: string; files: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "sunnybank-act-zip-"));
  try {
    const zipPath = join(dir, "act.zip");
    writeFileSync(zipPath, bytes);
    execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
    const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
    execFileSync("unzip", ["-o", zipPath, "-d", join(dir, "out")], { stdio: "pipe" });
    const files: Record<string, string> = {};
    for (const name of listing.trim().split("\n")) files[name] = readFileSync(join(dir, "out", name), "utf8");
    return { listing, files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("planSunnyBanksClipsZip", () => {
  it("names each clip ep01-act-ii-NN-who.mp4 in line order", () => {
    expect(sunnyBanksZipEpisodePart("ep01-the-first-fleet")).toBe("ep01");
    expect(sunnyBanksZipEpisodePart("EP 02: Drop Bears")).toBe("ep02");
    expect(sunnyBanksZipEpisodePart("The Big Wet")).toBe("the-big-wet");
    const plan = planSunnyBanksClipsZip({
      episode: "ep01-the-first-fleet",
      act: "II",
      clips: [
        { url: `${BLOB}/b12.mp4`, line: 12, character: "Ranger Bazza" },
        { url: `${BLOB}/b1.mp4`, line: 1, character: "Shazza" },
        { url: `${BLOB}/b3.mp4`, line: 3, character: "Unit 4S" },
        { url: `${BLOB}/b3b.mp4`, line: 3, character: "Unit 4S" },
      ],
    });
    expect(plan).toEqual({
      ok: true,
      zipName: "ep01-act-ii.zip",
      entries: [
        { name: "ep01-act-ii-01-shazza.mp4", url: `${BLOB}/b1.mp4` },
        { name: "ep01-act-ii-03-unit-4s.mp4", url: `${BLOB}/b3.mp4` },
        { name: "ep01-act-ii-03-unit-4s-2.mp4", url: `${BLOB}/b3b.mp4` },
        { name: "ep01-act-ii-12-ranger-bazza.mp4", url: `${BLOB}/b12.mp4` },
      ],
    });
  });

  it("only ever zips Deck's own saved clips", () => {
    const base = { episode: "ep01", act: "I" };
    expect(planSunnyBanksClipsZip({ ...base, clips: [] })).toMatchObject({ ok: false, error: /no Done clips/ });
    expect(planSunnyBanksClipsZip({ ...base, clips: [{ url: "http://169.254.169.254/latest", line: 1, character: "x" }] })).toMatchObject({ ok: false });
    expect(planSunnyBanksClipsZip({ ...base, clips: [{ url: "https://evil.test/a.mp4", line: 1, character: "x" }] })).toMatchObject({ ok: false });
    expect(planSunnyBanksClipsZip({ ...base, act: "../../x", clips: [{ url: `${BLOB}/a.mp4`, line: 1, character: "x" }] })).toMatchObject({ ok: false });
    expect(planSunnyBanksClipsZip({ ...base, clips: [{ url: `${BLOB}/a.mp4`, line: 0, character: "x" }] })).toMatchObject({ ok: false });
  });
});

describe("storeZipStream", () => {
  it("streams a real zip one entry at a time, leaving out what couldn't be read", async () => {
    const enc = new TextEncoder();
    const loads: number[] = [];
    const stream = storeZipStream(
      ["one.mp4", "gone.mp4", "two.mp4"],
      async (i) => {
        loads.push(i);
        return i === 1 ? null : enc.encode(`clip ${i}`);
      },
      (missing) => [{ name: "missing.txt", data: enc.encode(missing.join(",")) }],
    );
    const { files } = unzipped(await readAll(stream));
    expect(files).toEqual({ "one.mp4": "clip 0", "two.mp4": "clip 2", "missing.txt": "gone.mp4" });
    expect(loads).toEqual([0, 1, 2]);
  });
});

describe("POST /api/skidmarks/sunnybank/clips-zip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("takes the form the page submits and streams back the act as one attachment", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        if (url.endsWith("b2.mp4")) return new Response("nope", { status: 404 });
        return new Response(`video ${url.slice(-6)}`, { status: 200, headers: { "content-type": "video/mp4" } });
      }),
    );
    const form = new FormData();
    form.set(
      "request",
      JSON.stringify({
        episode: "ep01-the-first-fleet",
        act: "II",
        clips: [
          { url: `${BLOB}/b1.mp4`, line: 1, character: "Shazza" },
          { url: `${BLOB}/b2.mp4`, line: 2, character: "Dazza" },
          { url: `${BLOB}/b4.mp4`, line: 4, character: "Nan" },
        ],
      }),
    );
    const res = await POST(new Request("http://localhost/api/skidmarks/sunnybank/clips-zip", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ep01-act-ii.zip"');
    const { files } = unzipped(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["ep01-act-ii-01-shazza.mp4", "ep01-act-ii-04-nan.mp4", "missing.txt"]);
    expect(files["ep01-act-ii-01-shazza.mp4"]).toBe("video b1.mp4");
    expect(files["missing.txt"]).toMatch(/ep01-act-ii-02-dazza\.mp4: the clip host answered 404/);
    expect(fetched).toEqual([`${BLOB}/b1.mp4`, `${BLOB}/b2.mp4`, `${BLOB}/b4.mp4`]);
  });

  it("refuses a clip that isn't Deck's, without fetching anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(
      new Request("http://localhost/api/skidmarks/sunnybank/clips-zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episode: "ep01", act: "I", clips: [{ url: "https://evil.test/x.mp4", line: 1, character: "x" }] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
