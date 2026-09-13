import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  upload: (...args: unknown[]) => uploadMock(...args),
}));

import {
  addSkidmarksArchivedSong,
  archiveSkidmarksSession,
  buildArchiveZip,
  fetchArchiveSnapshot,
  fetchSkidmarksArchiveIndex,
  generateArchiveId,
  removeSkidmarksArchivedSong,
  uploadArchiveSnapshot,
  type SkidmarksArchivedSong,
  type SkidmarksArchiveSnapshot,
} from "./skidmarksArchive";
import { createMp3Attachment, type SkidmarksBand } from "./skidmarks";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const BAND: SkidmarksBand = {
  id: "jack-ash",
  name: "Jack Ash",
  tagline: "Dirt roads & bad decisions",
  coverSeed: 1,
  editIcon: "pencil",
  members: [],
};

describe("generateArchiveId", () => {
  it("returns a non-empty string", () => {
    expect(typeof generateArchiveId()).toBe("string");
    expect(generateArchiveId().length).toBeGreaterThan(0);
  });

  it("returns a different id on each call", () => {
    expect(generateArchiveId()).not.toBe(generateArchiveId());
  });
});

describe("uploadArchiveSnapshot", () => {
  beforeEach(() => {
    uploadMock.mockReset();
  });

  it("uploads the snapshot as JSON under this feature's own archive pathname prefix", async () => {
    uploadMock.mockResolvedValueOnce({ url: "https://x.public.blob.vercel-storage.com/skidmarks/archive/abc/snapshot.json" });

    const snapshot: SkidmarksArchiveSnapshot = { band: BAND, mp3: createMp3Attachment("song.mp3", 120) };
    const outcome = await uploadArchiveSnapshot("abc", snapshot);

    expect(outcome).toEqual({ ok: true, url: "https://x.public.blob.vercel-storage.com/skidmarks/archive/abc/snapshot.json" });
    const [pathname, , options] = uploadMock.mock.calls[0];
    expect(pathname).toBe("skidmarks/archive/abc/snapshot.json");
    expect(options).toMatchObject({ access: "public", handleUploadUrl: "/api/skidmarks/blob-upload", contentType: "application/json" });
  });

  it("reports an honest failure rather than throwing", async () => {
    uploadMock.mockRejectedValueOnce(new Error("No read-write token found."));
    const outcome = await uploadArchiveSnapshot("abc", { band: BAND, mp3: createMp3Attachment("song.mp3", 120) });
    expect(outcome).toEqual({ ok: false, message: "No read-write token found." });
  });
});

describe("fetchSkidmarksArchiveIndex / addSkidmarksArchivedSong / removeSkidmarksArchivedSong", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the real archived songs the route reports", async () => {
    const song: SkidmarksArchivedSong = {
      id: "song-1",
      bandId: "jack-ash",
      bandName: "Jack Ash",
      fileName: "talking-to-concrete.mp3",
      archivedAt: 1000,
      durationSec: 256,
      clipCount: 7,
      renderedPlateCount: 1,
      snapshotUrl: "https://x/skidmarks/archive/song-1/snapshot.json",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: true, songs: [song] }));

    const outcome = await fetchSkidmarksArchiveIndex();
    expect(outcome).toEqual({ ok: true, songs: [song] });
  });

  it("returns the honest unconfigured outcome without throwing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: false, songs: [], error: "Vercel Blob is not configured." }));
    const outcome = await fetchSkidmarksArchiveIndex();
    expect(outcome).toEqual({ ok: false, songs: [], message: "Vercel Blob is not configured." });
  });

  it("posts an add action with the song payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, songs: [] }));
    const song: SkidmarksArchivedSong = {
      id: "song-1",
      bandId: "jack-ash",
      bandName: "Jack Ash",
      fileName: "song.mp3",
      archivedAt: 1000,
      durationSec: 60,
      clipCount: 1,
      renderedPlateCount: 0,
      snapshotUrl: "https://x/snapshot.json",
    };
    const outcome = await addSkidmarksArchivedSong(song);
    expect(outcome).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/archive");
    expect(JSON.parse(init.body as string)).toEqual({ action: "add", song });
  });

  it("posts a remove action with just the id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, songs: [] }));
    const outcome = await removeSkidmarksArchivedSong("song-1");
    expect(outcome).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ action: "remove", id: "song-1" });
  });

  it("reports an honest failure when the route itself errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: "Vercel Blob is not configured." }));
    const outcome = await removeSkidmarksArchivedSong("song-1");
    expect(outcome).toEqual({ ok: false, message: "Vercel Blob is not configured." });
  });
});

describe("fetchArchiveSnapshot", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses a real snapshot", async () => {
    const snapshot: SkidmarksArchiveSnapshot = { band: BAND, mp3: createMp3Attachment("song.mp3", 60) };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, snapshot));
    const outcome = await fetchArchiveSnapshot("https://x/snapshot.json");
    expect(outcome).toEqual({ ok: true, snapshot });
  });

  it("reports an honest failure for a malformed snapshot", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { notASnapshot: true }));
    const outcome = await fetchArchiveSnapshot("https://x/snapshot.json");
    expect(outcome.ok).toBe(false);
  });

  it("reports an honest failure for a real HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const outcome = await fetchArchiveSnapshot("https://x/snapshot.json");
    expect(outcome).toEqual({ ok: false, message: "Downloading the archived snapshot returned HTTP 404." });
  });
});

describe("archiveSkidmarksSession", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    uploadMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads the snapshot, then adds the resulting song to the index, carrying forward the mp3's own audioUrl", async () => {
    uploadMock.mockResolvedValueOnce({ url: "https://x/skidmarks/archive/some-id/snapshot.json" });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, songs: [] }));

    const mp3 = { ...createMp3Attachment("song.mp3", 60), audioUrl: "https://x/skidmarks/mp3-audio/a.mp3" };
    const outcome = await archiveSkidmarksSession(BAND, mp3, 2);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.song.bandName).toBe("Jack Ash");
    expect(outcome.song.audioUrl).toBe("https://x/skidmarks/mp3-audio/a.mp3");
    expect(outcome.song.renderedPlateCount).toBe(2);
    expect(outcome.song.snapshotUrl).toBe("https://x/skidmarks/archive/some-id/snapshot.json");

    const [, init] = fetchMock.mock.calls[0];
    const posted = JSON.parse(init.body as string);
    expect(posted.action).toBe("add");
    expect(posted.song.id).toBe(outcome.song.id);
  });

  it("reports an honest failure without ever calling the index route when the snapshot upload itself fails", async () => {
    uploadMock.mockRejectedValueOnce(new Error("No read-write token found."));
    const outcome = await archiveSkidmarksSession(BAND, createMp3Attachment("song.mp3", 60), 0);
    expect(outcome.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildArchiveZip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bundles a manifest, every filled plate's still, and (when available) rendered clips + audio into a real zip", async () => {
    const mp3 = createMp3Attachment("song.mp3", 40);
    mp3.audioUrl = "https://x/skidmarks/mp3-audio/a.mp3";
    mp3.segments = [
      {
        ...mp3.segments[0],
        startSec: 0,
        endSec: 40,
        plates: [
          { id: "plate-1", still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "generated", createdAt: 1 } },
          { id: "plate-2" },
        ],
      },
    ];
    const song: SkidmarksArchivedSong = {
      id: "song-1",
      bandId: "jack-ash",
      bandName: "Jack Ash",
      fileName: "song.mp3",
      archivedAt: Date.now(),
      durationSec: 40,
      clipCount: 1,
      renderedPlateCount: 0,
      snapshotUrl: "https://x/snapshot.json",
      audioUrl: mp3.audioUrl,
    };

    fetchMock
      // audio fetch
      .mockResolvedValueOnce(new Response(new TextEncoder().encode("fake mp3 bytes")))
      // renders listing (fetchPersistedClipRenders -> /api/skidmarks/clip-renders)
      .mockResolvedValueOnce(jsonResponse(200, { configured: true, renders: [] }));

    const outcome = await buildArchiveZip(song, { band: BAND, mp3 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");

    const dir = mkdtempSync(join(tmpdir(), "skidmarks-archive-zip-test-"));
    const zipPath = join(dir, "project.zip");
    writeFileSync(zipPath, outcome.zipBytes);
    try {
      execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
      const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
      expect(listing).toContain("manifest.txt");
      expect(listing).toContain("plates/01a_instrumental.jpg");
      expect(listing).toContain("audio/song.mp3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never throws, and still produces a valid manifest-only zip when audio/renders aren't available", async () => {
    const mp3 = createMp3Attachment("song.mp3", 40);
    const song: SkidmarksArchivedSong = {
      id: "song-1",
      bandId: "jack-ash",
      bandName: "Jack Ash",
      fileName: "song.mp3",
      archivedAt: Date.now(),
      durationSec: 40,
      clipCount: mp3.segments.length,
      renderedPlateCount: 0,
      snapshotUrl: "https://x/snapshot.json",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: true, renders: [] }));

    const outcome = await buildArchiveZip(song, { band: BAND, mp3 });
    expect(outcome.ok).toBe(true);
  });
});
