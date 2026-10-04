import { describe, expect, it } from "vitest";
import { uploadEpisodeExtra, type BlobClientUpload } from "./episodeExtrasUpload";

/**
 * The Extras upload never throws and never leaves the row stuck
 * (2026-10-04, after Stuart's upload on Windows Chrome blanked the
 * screen). Blob is mocked: nothing is uploaded or written.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com";
const FOLDER = "deck/skidmarks/episodes/ep00-cornish-arsehole";
const file = (name: string, type: string, size = 1000) => ({ name, type, size }) as unknown as File;
const base = { name: "ACT 1 scene02", placement: "6 and 7", episodeFolder: FOLDER, takenIds: [] as string[] };

describe("uploading an extra", () => {
  it("a 300 MB mp4 goes straight to Blob in parts through the token route, never through a function body", async () => {
    const calls: Array<{ pathname: string; options: Record<string, unknown> }> = [];
    const uploadImpl = (async (pathname: string, _body: unknown, options: Record<string, unknown>) => {
      calls.push({ pathname, options });
      return { url: `${BLOB}/${pathname}`, pathname };
    }) as unknown as BlobClientUpload;
    const outcome = await uploadEpisodeExtra({ ...base, file: file("big.mp4", "video/mp4", 300 * 1024 * 1024), uploadImpl });
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe(`${FOLDER}/extras/act-1-scene02.mp4`);
    expect(calls[0].options).toMatchObject({ handleUploadUrl: "/api/skidmarks/blob-upload", multipart: true, contentType: "video/mp4" });
  });

  it("Stuart's small files (1.34 MB and 2.44 MB) go up in one piece", async () => {
    for (const size of [1407585, 2562228]) {
      let multipart: unknown;
      const uploadImpl = (async (pathname: string, _b: unknown, o: { multipart?: boolean }) => {
        multipart = o.multipart;
        return { url: `${BLOB}/${pathname}`, pathname };
      }) as unknown as BlobClientUpload;
      expect((await uploadEpisodeExtra({ ...base, file: file("scene.mp4", "video/mp4", size), uploadImpl })).ok).toBe(true);
      expect(multipart).toBe(false);
    }
  });

  it("progress after the upload has finished is ignored (the card no longer sticks at 100%)", async () => {
    const seen: number[] = [];
    let late: ((p: { percentage: number }) => void) | null = null;
    const uploadImpl = (async (pathname: string, _b: unknown, o: { onUploadProgress: (p: { percentage: number }) => void }) => {
      o.onUploadProgress({ percentage: 40.4 });
      o.onUploadProgress({ percentage: Number.NaN });
      o.onUploadProgress({ percentage: 140 });
      late = o.onUploadProgress;
      return { url: `${BLOB}/${pathname}`, pathname };
    }) as unknown as BlobClientUpload;
    const outcome = await uploadEpisodeExtra({ ...base, file: file("a.mp4", "video/mp4"), uploadImpl, onProgress: (p) => seen.push(p) });
    expect(outcome.ok).toBe(true);
    late!({ percentage: 100 });
    expect(seen).toEqual([40, 100]);
  });

  it("an answer with no pathname still saves under the name it asked for; one with no address is a plain error", async () => {
    const noPath = (async (pathname: string) => ({ url: `${BLOB}/${pathname}` })) as unknown as BlobClientUpload;
    const a = await uploadEpisodeExtra({ ...base, file: file("a.mp4", "video/mp4"), uploadImpl: noPath });
    expect(a.ok && a.extra.pathname).toBe(`${FOLDER}/extras/act-1-scene02.mp4`);

    const noUrl = (async () => ({})) as unknown as BlobClientUpload;
    expect(await uploadEpisodeExtra({ ...base, file: file("a.mp4", "video/mp4"), uploadImpl: noUrl })).toEqual({
      ok: false,
      error: "The upload didn't come back with a file address. Nothing was saved; try again.",
    });
    const nothing = (async () => undefined) as unknown as BlobClientUpload;
    expect((await uploadEpisodeExtra({ ...base, file: file("a.mp4", "video/mp4"), uploadImpl: nothing })).ok).toBe(false);
  });

  it("whatever Blob throws (an Error, a string, an object, a too-big answer) comes back as one plain line, never a throw", async () => {
    const throwing = (value: unknown) => (async () => {
      throw value;
    }) as unknown as BlobClientUpload;
    const cases: unknown[] = [
      new Error("Vercel Blob: Failed to retrieve the client token"),
      "Request Entity Too Large",
      { status: 413 },
      new Error(`x${" long".repeat(200)}`),
    ];
    for (const value of cases) {
      const outcome = await uploadEpisodeExtra({ ...base, file: file("a.mp4", "video/mp4"), uploadImpl: throwing(value) });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toMatch(/^The upload didn't finish/);
        expect(outcome.error).toMatch(/Nothing was saved; try again\.$/);
        expect(outcome.error.length).toBeLessThan(260);
      }
    }
  });
});
