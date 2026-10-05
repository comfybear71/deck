import { describe, expect, it, vi } from "vitest";
import type { AdultShortsShot } from "./adultShorts";
import type { SkidmarksState } from "./skidmarks";

/**
 * Older Shorts shot-card episodes (EP01–EP03) as a script (2026-10-05):
 * one row per shot, the right person on each row (never from Starring),
 * and every plate and clip on its own row. Read back with the studio's
 * own script reader. Made-up names and fake URLs only.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck/shorts/episodes/ep07-test-trip";
const EPISODE = "ep07-test-trip";

const STATE = {
  bands: [],
  session: { projectKind: "adult-shorts", bandId: null, mp3: null, scriptSequenceDraft: null },
  removedSeedBandIds: [],
  adultShorts: { ageConfirmed: true, editor: "cards", character: { name: "", look: "", referenceUrls: [] }, shots: [], saved: [], currentSavedId: null, mediaSlug: EPISODE },
  rosterExtras: {
    "music-video": [],
    "sunny-banks": [],
    "adult-shorts": ["Ava", "Ben", "Cleo"].map((name, i) => ({
      id: `chr_${name.toLowerCase()}`,
      name,
      look: "",
      episode: EPISODE,
      createdAt: i + 1,
      pictureUrls: [`${BLOB}/characters/${name.toLowerCase()}.jpg`],
      fictionalAdultConfirmed: true,
    })),
  },
  locations: {
    locations: [
      { id: "loc_adult_shorts_hostel_city", genre: "adult-shorts", key: "hostel_city", name: "hostel_city", episode: EPISODE, pictureUrl: `${BLOB}/locations/a.png`, createdAt: 1 },
      { id: "loc_adult_shorts_hostel_beach", genre: "adult-shorts", key: "hostel_beach", name: "hostel_beach", episode: EPISODE, pictureUrl: `${BLOB}/locations/b.png`, createdAt: 2 },
      { id: "loc_adult_shorts_highway_qld", genre: "adult-shorts", key: "highway_qld", name: "highway_qld", episode: EPISODE, pictureUrl: `${BLOB}/locations/c.png`, createdAt: 3 },
    ],
  },
  characterLoras: {
    characters: ["Ava", "Ben", "Cleo"].map((name) => ({
      id: `clora_${name}`,
      name,
      slug: name.toLowerCase(),
      sourceKey: `asx:chr_${name.toLowerCase()}`,
      status: "idle",
      trainingImageUrls: [],
      version: 1,
      createdAt: "2026-10-04T00:00:00.000Z",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
    })),
  },
} as unknown as SkidmarksState;

vi.mock("@/lib/skidmarks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skidmarks")>();
  return { ...actual, getSkidmarksSnapshot: () => STATE };
});

const { parseSunnyBanksScriptBlock, sunnyBanksQueueChunks, preserveRenderedRuntimes, collectRenderedClips, inStudioGenre } = await import(
  "@/components/SkidmarksSunnyBanksPanel"
);
const { sunnyBanksCastCards, resolveSunnyBanksSpeaker } = await import("./sunnyBanksVoices");
const { resolveSunnyBanksRowCast } = await import("./sunnyBanksShotCast");
const { castNamesInPrompt, inferShotLocation, resolveShotCardCharacter, shotCardEpisodeToScript, shotCardEpisodeToStudioLive } = await import(
  "./shortsShotCardScript"
);

const CAST = [{ name: "Ava" }, { name: "Ben" }, { name: "Cleo" }];
const LOCATIONS = [
  { key: "hostel_city", name: "hostel_city" },
  { key: "hostel_beach", name: "hostel_beach" },
  { key: "highway_qld", name: "highway_qld" },
];

function shot(n: number, extra: Partial<AdultShortsShot>): AdultShortsShot {
  return {
    id: `s${n}`,
    prompt: "",
    durationSec: 5,
    referenceIndex: 0,
    plateUrl: `${BLOB}/shot-${n}-plate.png`,
    clipUrl: `${BLOB}/shot-${n}.mp4`,
    lastFrameUrl: null,
    sirayTaskId: null,
    chainFromPrevious: false,
    ...extra,
  };
}

const SHOTS: AdultShortsShot[] = [
  shot(1, { prompt: "Night, city backpacker hostel courtyard. Close-up of Ava, looking off at Ben.", line: "[softly] I'm off up north tomorrow." }),
  shot(2, { prompt: "Night, city hostel courtyard. Close-up of Ben alone in frame.", line: "No worries. See ya there.", speakerName: "Ben" }),
  shot(3, { prompt: "Ava walks away along the hostel wall.", castNames: ["Ava"] }),
  shot(4, { prompt: "Low angle on an empty Queensland highway, a white sedan drives away. No people visible.", clipUrl: null }),
  shot(5, { prompt: "Beach hostel verandah. Cleo and Ava laugh at the table.", castNames: ["Cleo", "Ava"], speakerName: "Ava", line: "True that.\n[laughs] Too easy." }),
  shot(6, { prompt: "A faded missing person poster with a photo of Ben. No people around.", plateUrl: null }),
];

const INPUT = { title: "Test Trip", shots: SHOTS, cast: CAST, locations: LOCATIONS };

function parsed(script: string) {
  return inStudioGenre("shorts", () => parseSunnyBanksScriptBlock(script));
}

describe("who each old shot is of", () => {
  it("picks first, then Speaker, then the names in the prompt, never Starring", () => {
    expect(resolveShotCardCharacter(SHOTS[2], CAST)).toMatchObject({ name: "Ava", source: "picks" });
    expect(resolveShotCardCharacter(SHOTS[1], CAST)).toMatchObject({ name: "Ben", source: "speaker" });
    // "Close-up of Ava … at Ben": the camera is on Ava.
    expect(resolveShotCardCharacter(SHOTS[0], CAST)).toMatchObject({ name: "Ava", source: "prompt" });
    expect(resolveShotCardCharacter(SHOTS[0], CAST).doubt).toBeUndefined();
    // Several picks: the Speaker among them speaks, everyone stays in the shot.
    expect(resolveShotCardCharacter(SHOTS[4], CAST)).toMatchObject({ name: "Ava", castNames: ["Cleo", "Ava"], source: "picks" });
    // Nobody named: a Crowd row.
    expect(resolveShotCardCharacter(SHOTS[3], CAST)).toMatchObject({ name: null, source: "none" });
    // No `starring` input exists at all: Starring can't decide anyone.
    expect(Object.keys(INPUT)).not.toContain("starring");
  });

  it("flags the shots worth a second look", () => {
    // A poster of Ben with nobody in shot.
    expect(resolveShotCardCharacter(SHOTS[5], CAST).doubt).toMatch(/nobody is in it/);
    // Two names and no close-up to choose between them.
    const two = resolveShotCardCharacter({ prompt: "Over the shoulder of Ben, Ava stands up and leaves." }, CAST);
    expect(two).toMatchObject({ name: "Ben", source: "prompt" });
    expect(two.doubt).toMatch(/names Ben and Ava/);
    // A Line with nobody named: only an older one-person episode lends its person.
    expect(resolveShotCardCharacter({ prompt: "She smiles.", line: "Hi!" }, CAST, "Cleo")).toMatchObject({ name: "Cleo", source: "only-character" });
    expect(resolveShotCardCharacter({ prompt: "She smiles.", line: "Hi!" }, CAST)).toMatchObject({ name: null, source: "none" });
    expect(resolveShotCardCharacter({ prompt: "She turns to the window." }, CAST, "Cleo")).toMatchObject({ name: "Cleo", source: "only-character" });
    expect(resolveShotCardCharacter({ prompt: "An empty room. No people." }, CAST, "Cleo")).toMatchObject({ name: null, source: "none" });
    // "Nobody" ticked.
    expect(resolveShotCardCharacter({ prompt: "Ava on the road.", nobodyInShot: true }, CAST)).toMatchObject({ name: null });
  });

  it("matches names as whole words only", () => {
    expect(castNamesInPrompt("Benches and avocados by the ocean.", CAST)).toEqual([]);
    expect(castNamesInPrompt("Cleo's face, then Ava.", CAST)).toEqual(["Cleo", "Ava"]);
  });
});

describe("the converted script", () => {
  const converted = shotCardEpisodeToScript(INPUT);

  it("reads as headings, a location, a character line, the action and Name: line per shot", () => {
    const s = converted.script;
    expect(s.startsWith("=== ACT I — SCENE 1 — hostel_city ===")).toBe(true);
    expect(s).toContain("[Location: hostel_city]\n[Cast: Ava]\n[Character Ava: ]\n[Action: Night, city backpacker hostel courtyard. Close-up of Ava, looking off at Ben.]\nAva: [softly] I'm off up north tomorrow.");
    expect(s).toContain("[Cast: Ava]\n[Action: Ava walks away along the hostel wall.]\nAva:\n");
    expect(s).toMatch(/=== ACT I — SCENE 2 — highway_qld ===\n\n\[Location: highway_qld\]\n\[Action: Low angle on an empty Queensland highway[^\]]*\]\nCrowd:/);
    expect(s).toContain("=== ACT I — SCENE 3 — hostel_beach ===");
    // Several people in a shot: [Cast: …]; a Line over two lines is one row.
    expect(s).toContain("[Cast: Cleo, Ava]\n[Character Ava: ]\n[Action: Beach hostel verandah. Cleo and Ava laugh at the table.]\nAva: True that. [laughs] Too easy.");
    // No person-name toggles in a script: just the text.
    expect(s).not.toMatch(/In this shot|Speaker|Starring/);
  });

  it("gives exactly one studio row per shot, with the right person", () => {
    const rows = sunnyBanksQueueChunks(parsed(converted.script));
    expect(rows.map((r) => [r.kind, r.characterName])).toEqual([
      ["speak", "Ava"],
      ["speak", "Ben"],
      ["hold", "Ava"],
      ["hold", "Crowd"],
      ["speak", "Ava"],
      ["hold", "Ben"],
    ]);
    expect(rows[4].castNames).toEqual(["Cleo", "Ava"]);
    expect(rows.map((r) => r.locationId)).toEqual(["hostel_city", "hostel_city", "hostel_city", "highway_qld", "hostel_beach", "hostel_beach"]);
  });

  it("keeps every plate and clip on its own row, so nothing re-renders", () => {
    const chunks = parsed(converted.script);
    const kept = preserveRenderedRuntimes(chunks, converted.runtime);
    SHOTS.forEach((s, i) => {
      expect(kept[i]?.videoUrl ?? null).toBe(s.clipUrl);
      expect(kept[i]?.plateUrl ?? null).toBe(s.plateUrl);
      expect(kept[i]?.status).toBe(s.clipUrl ? "done" : "idle");
    });
    // Talking clips were LTX, silent ones Siray; the plate keeps who was in it.
    expect(kept[0]).toMatchObject({ videoBackend: "ltx", castNames: ["Ava"], durationSec: 5 });
    expect(kept[2]).toMatchObject({ videoBackend: "siray", castNames: ["Ava"] });
    expect(kept[4]?.castNames).toEqual(["Cleo", "Ava"]);
    const clips = inStudioGenre("shorts", () =>
      collectRenderedClips({ actIds: ["I"], actScripts: { I: converted.script }, runtimeMap: { I: converted.runtime }, characterOverrides: {} }),
    );
    expect(clips.map((c) => c.index)).toEqual([0, 1, 2, 4, 5]);
  });

  it("says exactly who is in each picture, the same people the studio sees, so the old plates still count", () => {
    const s = converted.script;
    // Close-up of Ava "looking off at Ben": just Ava.
    expect(s).toContain("[Cast: Ava]\n[Character Ava: ]\n[Action: Night, city backpacker hostel courtyard.");
    const chunks = sunnyBanksQueueChunks(parsed(s));
    const cards = sunnyBanksCastCards(STATE, "shorts");
    chunks.forEach((c, i) => {
      const lock = resolveSunnyBanksSpeaker(c.characterName, STATE, "shorts");
      const rc = inStudioGenre("shorts", () =>
        resolveSunnyBanksRowCast(
          { kind: c.kind, characterName: c.characterName, cutaway: c.kind === "hold" && !lock, action: c.action, sceneAction: c.sceneAction, castNames: c.castNames, castLooks: c.castLooks, sceneSpeakers: c.sceneSpeakers, appearanceModifier: c.appearanceModifier },
          cards,
        ),
      );
      const plateFor = converted.runtime[i].castNames ?? [];
      if (converted.runtime[i].plateUrl && rc.cast.names.length > 0) expect([...rc.cast.names].sort()).toEqual([...plateFor].sort());
    });
  });

  it("places: the one the prompt names, else the shot before's; a tie keeps the current one", () => {
    expect(inferShotLocation("Queensland highway at dusk", LOCATIONS)).toEqual({ key: "highway_qld" });
    expect(inferShotLocation("The hostel kitchen", LOCATIONS).tiedWith).toEqual(["hostel_city", "hostel_beach"]);
    expect(inferShotLocation("Nothing here", LOCATIONS)).toEqual({ key: null });
    const report = converted.rows;
    // "hostel" fits both hostels: the one the shots are already at, no question asked.
    expect(report[2]).toMatchObject({ locationKey: "hostel_city", row: "silent" });
    expect(report[2].locationDoubt).toBeUndefined();
    // No place named: the shot before's, and it says so.
    expect(report[5]).toMatchObject({ locationKey: "hostel_beach" });
    expect(report[5].locationDoubt).toMatch(/same as the shot before/);
    expect(report[3]).toMatchObject({ row: "crowd", character: null, hasClip: false, hasPlate: true });
  });

  it("an episode with no places gets one heading and no [Location:] lines", () => {
    const s = shotCardEpisodeToScript({ ...INPUT, locations: [] }).script;
    expect(s.startsWith("=== ACT I — SCENE 1 — Test Trip ===")).toBe(true);
    expect(s).not.toContain("[Location:");
  });

  it("brackets in a prompt can't turn into script tags", () => {
    const s = shotCardEpisodeToScript({ ...INPUT, shots: [shot(1, { prompt: "Ava [Location: elsewhere] waves" })] }).script;
    expect(s).toContain("[Action: Ava (Location: elsewhere) waves]");
    expect(sunnyBanksQueueChunks(parsed(s))[0].locationId).toBe("hostel_city");
  });

  it("the studio's live copy: one act, the folder kept, no card yet", () => {
    const live = shotCardEpisodeToStudioLive({ ...INPUT, label: "EP07 · Test Trip", mediaSlug: EPISODE });
    expect(live.actIds).toEqual(["I"]);
    expect(live.activeAct).toBe("I");
    expect(live.workspaceTitle).toBe("EP07 · Test Trip");
    expect(live.mediaSlug).toBe(EPISODE);
    expect(live.episodeId).toBeUndefined();
    expect(live.defaultLocationId).toBe("hostel_city");
    expect(live.runtimeMap.I[0].videoUrl).toBe(SHOTS[0].clipUrl);
  });
});
