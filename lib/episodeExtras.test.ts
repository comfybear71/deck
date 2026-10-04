import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  episodeExtraExtensionFor,
  episodeExtraFileSlug,
  episodeExtraPathname,
  episodeExtraPlacementSlug,
  episodeExtraZipItems,
  episodeExtraZipName,
  episodeExtrasFor,
  episodeExtrasZipEntries,
  episodeFolderFor,
  isEpisodeExtraPathname,
  nextEpisodeExtraFileSlug,
  normalizeEpisodeExtrasState,
  songEpisodeFolder,
  suggestedEpisodeExtraName,
  withEpisodeExtraAdded,
  withEpisodeExtraEdited,
  withEpisodeExtraRemoved,
  type EpisodeExtra,
} from "./episodeExtras";
import { uploadEpisodeExtra, type BlobClientUpload } from "./episodeExtrasUpload";
import { normalizeSkidmarksState as normalizeState, sessionHasSubstantiveContent } from "./skidmarks";
import { planShortsClipsZip } from "./shortsClipsZip";
import { buildSunnyBanksEpisodeBundle } from "./sunnyBanksEpisodeBundle";

/**
 * Episode Extras (2026-10-04): outside files kept with an episode, the
 * same in every genre. Nothing here touches the network or storage:
 * uploads and fetches are mocked.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com";
const SK_FOLDER = "deck/skidmarks/episodes/cornish-arsehole";

function extra(over: Partial<EpisodeExtra> = {}): EpisodeExtra {
  return {
    id: "container-drop",
    name: "container drop",
    placement: "Act III between 8 and 9",
    url: `${BLOB}/${SK_FOLDER}/extras/container-drop.mp4`,
    pathname: `${SK_FOLDER}/extras/container-drop.mp4`,
    ext: "mp4",
    kind: "video",
    originalFileName: "IMG_0412.MOV",
    sizeBytes: 12_000_000,
    createdAt: 1_791_100_000_000,
    ...over,
  };
}

function unzipList(bytes: Uint8Array): { names: string[]; files: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "episode-extras-zip-"));
  try {
    const zipPath = join(dir, "episode.zip");
    writeFileSync(zipPath, bytes);
    execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
    const names = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n");
    execFileSync("unzip", ["-o", zipPath, "-d", join(dir, "out")], { stdio: "pipe" });
    const files: Record<string, string> = {};
    for (const name of names) files[name] = readFileSync(join(dir, "out", name), "utf8");
    return { names, files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("readable Blob paths, with -2, -3 on a clash", () => {
  it("files an extra under the episode's own folder in every genre", () => {
    expect(episodeExtraPathname(episodeFolderFor("skidmarks", "cornish-arsehole")!, "container-drop", "mp4")).toBe(
      "deck/skidmarks/episodes/cornish-arsehole/extras/container-drop.mp4",
    );
    expect(episodeFolderFor("sunnybank", "ep05-the-big-wet")).toBe("deck/sunnybank/episodes/ep05-the-big-wet");
    expect(episodeFolderFor("shorts", "ep01-blonde-girl-1")).toBe("deck/shorts/episodes/ep01-blonde-girl-1");
    expect(songEpisodeFolder("CRACK HAUL.mp3")).toBe("deck/music-video/songs/crack-haul");
    expect(episodeFolderFor("skidmarks", "")).toBeNull();
    expect(songEpisodeFolder(null)).toBeNull();
  });

  it("names the file after the typed name, then -2, -3 for a name already used; never a random tag", () => {
    expect(episodeExtraFileSlug("Container Drop!", [])).toBe("container-drop");
    expect(episodeExtraFileSlug("container drop", ["container-drop"])).toBe("container-drop-2");
    expect(episodeExtraFileSlug("container drop", ["container-drop", "container-drop-2"])).toBe("container-drop-3");
    expect(episodeExtraFileSlug("   ", [])).toBe("extra");
    // Blob already has the file (an extra deleted earlier keeps it): the next name in the run.
    expect(nextEpisodeExtraFileSlug("container-drop", [])).toBe("container-drop-2");
    expect(nextEpisodeExtraFileSlug("container-drop-2", ["container-drop"])).toBe("container-drop-3");
  });

  it("the upload token only accepts an episode's extras folder with a known type", () => {
    expect(isEpisodeExtraPathname(`${SK_FOLDER}/extras/container-drop.mp4`)).toBe(true);
    expect(isEpisodeExtraPathname("deck/shorts/episodes/ep01-x/extras/scream.wav")).toBe(true);
    expect(isEpisodeExtraPathname("deck/music-video/songs/crack-haul/extras/drone.mov")).toBe(true);
    expect(isEpisodeExtraPathname(`${SK_FOLDER}/act-i/container-drop.mov`)).toBe(false);
    expect(isEpisodeExtraPathname(`${SK_FOLDER}/extras/container-drop.exe`)).toBe(false);
    expect(isEpisodeExtraPathname(`${SK_FOLDER}/extras/Container Drop.mp4`)).toBe(false);
    expect(isEpisodeExtraPathname("deck/extras/x.mp4")).toBe(false);
    expect(isEpisodeExtraPathname(`deck/../extras/x.mp4`)).toBe(false);
  });

  it("knows an iPhone .MOV, a Windows .wav, and a file with only a type", () => {
    expect(episodeExtraExtensionFor("IMG_0412.MOV", "video/quicktime")).toBe("mov");
    expect(episodeExtraExtensionFor("drop.wav", "")).toBe("wav");
    expect(episodeExtraExtensionFor("clip", "video/mp4")).toBe("mp4");
    expect(episodeExtraExtensionFor("clip.m4v", "")).toBe("mp4");
    expect(episodeExtraExtensionFor("song.mp3", "audio/mpeg")).toBe("mp3");
    expect(episodeExtraExtensionFor("photo.jpg", "image/jpeg")).toBeNull();
    expect(suggestedEpisodeExtraName("container_drop_final.mp4")).toBe("container drop final");
  });
});

describe("saving and loading the list (session state, every device)", () => {
  it("survives a save and reload with the session", () => {
    const saved = withEpisodeExtraAdded(null, SK_FOLDER, extra());
    const reloaded = normalizeState(JSON.parse(JSON.stringify({ bands: [], session: {}, episodeExtras: saved })));
    expect(episodeExtrasFor(reloaded.episodeExtras, SK_FOLDER)).toEqual([extra()]);
    expect(sessionHasSubstantiveContent(reloaded)).toBe(true);
    // An older session without the field loads as "none yet".
    expect(normalizeState({ bands: [], session: {} }).episodeExtras).toBeNull();
  });

  it("drops anything off-shape, and keeps the first of two with the same file name", () => {
    const loaded = normalizeEpisodeExtrasState({
      byEpisode: {
        [SK_FOLDER]: [extra(), extra({ name: "dupe" }), { id: "Bad Id", url: "x" }, extra({ id: "evil", url: "javascript:alert(1)" })],
        "not/a/deck/folder": [extra()],
      },
    });
    expect(loaded?.byEpisode[SK_FOLDER].map((x) => x.name)).toEqual(["container drop"]);
    expect(Object.keys(loaded!.byEpisode)).toEqual([SK_FOLDER]);
  });

  it("edits the name and placement without moving the file, and deletes", () => {
    let state = withEpisodeExtraAdded(null, SK_FOLDER, extra());
    state = withEpisodeExtraEdited(state, SK_FOLDER, "container-drop", { name: "  Big Container Drop ", placement: "Act IV after 2" });
    expect(state.byEpisode[SK_FOLDER][0]).toMatchObject({
      name: "Big Container Drop",
      placement: "Act IV after 2",
      pathname: `${SK_FOLDER}/extras/container-drop.mp4`,
    });
    state = withEpisodeExtraRemoved(state, SK_FOLDER, "container-drop");
    expect(state.byEpisode[SK_FOLDER]).toBeUndefined();
  });
});

describe("uploading (Blob client upload mocked)", () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size }) as unknown as File;

  it("sends the file straight to Blob under its readable name and returns the extra", async () => {
    const calls: { pathname: string; options: Record<string, unknown> }[] = [];
    const uploadImpl = (async (pathname: string, _body: unknown, options: Record<string, unknown>) => {
      calls.push({ pathname, options });
      return { url: `${BLOB}/${pathname}`, pathname };
    }) as unknown as BlobClientUpload;
    const outcome = await uploadEpisodeExtra({
      file: file("IMG_0412.MOV", "video/quicktime", 30 * 1024 * 1024),
      name: "container drop",
      placement: "Act III between 8 and 9",
      episodeFolder: SK_FOLDER,
      takenIds: [],
      now: 5,
      uploadImpl,
    });
    expect(calls[0].pathname).toBe(`${SK_FOLDER}/extras/container-drop.mov`);
    expect(calls[0].options).toMatchObject({ access: "public", handleUploadUrl: "/api/skidmarks/blob-upload", contentType: "video/quicktime", multipart: true });
    expect(outcome).toEqual({
      ok: true,
      extra: {
        id: "container-drop",
        name: "container drop",
        placement: "Act III between 8 and 9",
        url: `${BLOB}/${SK_FOLDER}/extras/container-drop.mov`,
        pathname: `${SK_FOLDER}/extras/container-drop.mov`,
        ext: "mov",
        kind: "video",
        originalFileName: "IMG_0412.MOV",
        sizeBytes: 30 * 1024 * 1024,
        createdAt: 5,
      },
    });
  });

  it("a name taken in the episode starts at -2; one Blob already holds moves on to -3", async () => {
    const tried: string[] = [];
    const uploadImpl = (async (pathname: string) => {
      tried.push(pathname);
      if (pathname.endsWith("container-drop-2.mp3")) throw new Error("Vercel Blob: This blob already exists, use `allowOverwrite: true`");
      return { url: `${BLOB}/${pathname}`, pathname };
    }) as unknown as BlobClientUpload;
    const outcome = await uploadEpisodeExtra({
      file: file("drop.mp3", "audio/mpeg"),
      name: "container drop",
      placement: "",
      episodeFolder: SK_FOLDER,
      takenIds: ["container-drop"],
      uploadImpl,
    });
    expect(tried).toEqual([`${SK_FOLDER}/extras/container-drop-2.mp3`, `${SK_FOLDER}/extras/container-drop-3.mp3`]);
    expect(outcome.ok && outcome.extra.id).toBe("container-drop-3");
    expect(outcome.ok && outcome.extra.kind).toBe("audio");
  });

  it("refuses a picture or an unnamed extra before anything is uploaded, and says when storage isn't there", async () => {
    const uploadImpl = vi.fn(async () => {
      throw new Error("Vercel Blob: No token found. Either configure the `BLOB_READ_WRITE_TOKEN` environment variable");
    }) as unknown as BlobClientUpload;
    const base = { placement: "", episodeFolder: SK_FOLDER, takenIds: [], uploadImpl };
    expect(await uploadEpisodeExtra({ ...base, file: file("a.jpg", "image/jpeg"), name: "x" })).toMatchObject({ ok: false });
    expect(await uploadEpisodeExtra({ ...base, file: file("a.mp4", "video/mp4"), name: "  " })).toMatchObject({ ok: false });
    expect(uploadImpl).not.toHaveBeenCalled();
    expect(await uploadEpisodeExtra({ ...base, file: file("a.mp4", "video/mp4"), name: "x" })).toEqual({
      ok: false,
      error: "Storage isn't connected here, so the file wasn't saved.",
    });
  });
});

describe("the episode zip's extras/ folder", () => {
  it("names each file with its placement note: extras/act-3-between-8-and-9 - container-drop.mp4", () => {
    expect(episodeExtraPlacementSlug("Act III between 8 and 9")).toBe("act-3-between-8-and-9");
    expect(episodeExtraPlacementSlug("act iv, after line 2")).toBe("act-4-after-line-2");
    expect(episodeExtraZipName(extra())).toBe("extras/act-3-between-8-and-9 - container-drop.mp4");
    expect(episodeExtraZipName(extra({ placement: "" }))).toBe("extras/container-drop.mp4");
    expect(
      episodeExtrasZipEntries([extra(), extra({ id: "container-drop-2", url: `${BLOB}/b.mp4` })]).map((e) => e.name),
    ).toEqual(["extras/act-3-between-8-and-9 - container-drop.mp4", "extras/act-3-between-8-and-9 - container-drop-2.mp4"]);
  });

  it("Shorts: the server zip adds extras after the clips; clip names unchanged; extras alone are fine", () => {
    const clip = { url: `${BLOB}/deck/shorts/episodes/ep01-x/ep01-x-clip-01.mp4`, shot: 1, character: "Skylar" };
    const withExtras = planShortsClipsZip({ episode: "ep01-x", clips: [clip], extras: episodeExtraZipItems([extra()]) });
    expect(withExtras.ok && withExtras.entries.map((e) => e.name)).toEqual([
      "ep01-x-shot-01-skylar.mp4",
      "extras/act-3-between-8-and-9 - container-drop.mp4",
    ]);
    const without = planShortsClipsZip({ episode: "ep01-x", clips: [clip] });
    expect(without.ok && without.entries.map((e) => e.name)).toEqual(["ep01-x-shot-01-skylar.mp4"]);
    const only = planShortsClipsZip({ episode: "ep01-x", clips: [], extras: episodeExtraZipItems([extra()]) });
    expect(only.ok && only.entries.length).toBe(1);
    expect(planShortsClipsZip({ episode: "ep01-x", clips: [] })).toMatchObject({ ok: false });
    expect(planShortsClipsZip({ episode: "ep01-x", clips: [clip], extras: [{ ...extra(), url: "https://evil.example/x.mp4" }] })).toMatchObject({
      ok: false,
    });
  });

  describe("Sunnybank / Skidmarks episode zip", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("puts the extras in extras/ next to video/ and audio/", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => new Response(new TextEncoder().encode(String(url).includes("extras/") ? "extra bytes" : "clip bytes"), { status: 200 })),
      );
      const result = await buildSunnyBanksEpisodeBundle({
        title: "EP00 — Cornish Arsehole",
        defaultLocationId: "town_street",
        actIds: ["I"],
        actScripts: { I: "DAP: Alright?" },
        prompts: [],
        clips: [
          {
            act: "I",
            index: 0,
            characterName: "DAP",
            lineLabel: "Alright?",
            videoUrl: `${BLOB}/${SK_FOLDER}/act-i/clip.mp4`,
          },
        ],
        extras: episodeExtrasZipEntries([extra(), extra({ id: "seagull", name: "seagull scream", placement: "", ext: "wav", kind: "audio", url: `${BLOB}/${SK_FOLDER}/extras/seagull.wav` })]),
      });
      expect(result).toMatchObject({ clipCount: 1, fetchedClipCount: 1, extraCount: 2, fetchedExtraCount: 2 });
      const { names, files } = unzipList(result.zipBytes);
      expect(names).toEqual(expect.arrayContaining(["video/01.mp4", "extras/act-3-between-8-and-9 - container-drop.mp4", "extras/seagull-scream.wav"]));
      expect(files["extras/seagull-scream.wav"]).toBe("extra bytes");
    });

    it("without extras the zip is exactly as before", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(new TextEncoder().encode("clip bytes"), { status: 200 })));
      const input = {
        title: "EP00",
        defaultLocationId: "town_street",
        actIds: ["I"],
        actScripts: { I: "DAP: Alright?" },
        prompts: [],
        clips: [{ act: "I", index: 0, characterName: "DAP", lineLabel: "Alright?", videoUrl: `${BLOB}/x/clip.mp4` }],
      };
      const result = await buildSunnyBanksEpisodeBundle(input);
      expect(result).toMatchObject({ extraCount: 0, fetchedExtraCount: 0 });
      expect(unzipList(result.zipBytes).names.some((n) => n.startsWith("extras/"))).toBe(false);
    });
  });
});
