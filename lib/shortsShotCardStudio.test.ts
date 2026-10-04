import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AdultShortsSaved, AdultShortsShot, AdultShortsState } from "./adultShorts";
import { adoptShortsShotCardLive, getAdultShortsState, getSkidmarksSnapshot, getStudioState, patchAdultShorts, type SkidmarksState } from "./skidmarks";
import { openShortsEpisodeScopeIn } from "./shortsEpisodeCast";
import { shortsShotCardStudioLive, shotCardsSavedAsScript } from "./shortsShotCardStudio";
import { shotCardEpisodeToStudioLive } from "./shortsShotCardScript";

/**
 * Every Shorts episode opens in the script studio (2026-10-05). An older
 * shot-card episode is converted on the fly: opening it saves nothing;
 * the first change saves it as a script episode in its own folder and
 * leaves the shot cards exactly as they were. Made-up content only.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck/shorts/episodes";
const NEW_ID = `short_${Date.UTC(2026, 9, 4, 6).toString(36)}_aaaa1111`;
const OLD_ID = `short_${Date.UTC(2026, 8, 20).toString(36)}_bbbb2222`;

function shot(n: number, slug: string, extra: Partial<AdultShortsShot>): AdultShortsShot {
  return {
    id: `s${n}`,
    prompt: "",
    durationSec: 5,
    referenceIndex: 0,
    plateUrl: `${BLOB}/${slug}/shot-${n}-plate.png`,
    clipUrl: `${BLOB}/${slug}/shot-${n}.mp4`,
    lastFrameUrl: null,
    sirayTaskId: null,
    chainFromPrevious: false,
    ...extra,
  };
}

const TRIP = "ep07-test-trip";
const TRIP_SHOTS = [
  // Starring is Ben + Cleo, but this shot is of Ava: the old cards showed Ben + Cleo, Speaker Ben.
  shot(1, TRIP, { prompt: "Close-up of Ava at a picnic table, looking off at Ben.", line: "I'm heading north tomorrow." }),
  shot(2, TRIP, { prompt: "An empty road at dawn. No people.", clipUrl: null }),
];
const tripCard: AdultShortsSaved = {
  id: NEW_ID,
  title: "Test Trip",
  savedAt: "2026-10-04T08:00:00.000Z",
  character: { name: "Ben", look: "", referenceUrls: [] },
  starring: [
    { name: "Ben", look: "", referenceUrls: [] },
    { name: "Cleo", look: "", referenceUrls: [] },
  ],
  shots: TRIP_SHOTS,
  mediaSlug: TRIP,
  episodeNumber: 7,
  adult: false,
} as AdultShortsSaved;

function stateWith(adult: Partial<AdultShortsState>, extra: Partial<SkidmarksState> = {}): SkidmarksState {
  return {
    bands: [],
    session: { projectKind: "adult-shorts", bandId: null, mp3: null, scriptSequenceDraft: null },
    removedSeedBandIds: [],
    adultShorts: {
      ageConfirmed: true,
      character: tripCard.character,
      starring: tripCard.starring,
      shots: TRIP_SHOTS,
      saved: [tripCard],
      currentSavedId: NEW_ID,
      mediaSlug: TRIP,
      title: "Test Trip",
      ...adult,
    },
    rosterExtras: {
      "music-video": [],
      "sunny-banks": [],
      "adult-shorts": ["Ava", "Ben", "Cleo"].map((name, i) => ({
        id: `chr_${name.toLowerCase()}`,
        name,
        look: "",
        episode: TRIP,
        createdAt: i + 1,
        pictureUrls: [`${BLOB}/${TRIP}/characters/${name.toLowerCase()}.jpg`],
        fictionalAdultConfirmed: true,
      })),
    },
    locations: {
      locations: [
        { id: "loc_adult_shorts_picnic_park", genre: "adult-shorts", key: "picnic_park", name: "Picnic Park", episode: TRIP, pictureUrl: `${BLOB}/${TRIP}/locations/p.png`, createdAt: 1 },
      ],
    },
    ...extra,
  } as unknown as SkidmarksState;
}

describe("a shot-card episode in the script studio", () => {
  it("is converted on the fly while it's the open episode, with the person from the shot, not Starring", () => {
    const live = shortsShotCardStudioLive(stateWith({ editor: "cards" }))!;
    expect(live).not.toBeNull();
    expect(live.workspaceTitle).toBe("EP07 · Test Trip");
    expect(live.mediaSlug).toBe(TRIP);
    expect(live.episodeId).toBeUndefined();
    expect(live.actScripts.I).toContain("Ava: I'm heading north tomorrow.");
    expect(live.actScripts.I).not.toMatch(/^Ben:|^Cleo:/m);
    expect(live.actScripts.I).toContain("Crowd:");
    expect(live.runtimeMap.I[0]).toMatchObject({ status: "done", videoUrl: TRIP_SHOTS[0].clipUrl, plateUrl: TRIP_SHOTS[0].plateUrl });
    expect(live.runtimeMap.I[1]).toMatchObject({ status: "idle", plateUrl: TRIP_SHOTS[1].plateUrl });
  });

  it("is not used while a script episode is open, or once the episode was saved as a script", () => {
    expect(shortsShotCardStudioLive(stateWith({ editor: "script" }))).toBeNull();
    const saved = stateWith(
      { editor: "cards" },
      { shortsStudio: { live: shotCardEpisodeToStudioLive({ title: "x", label: "x", shots: [], cast: [], locations: [] }), workspaces: [{ mediaSlug: TRIP }], saveSeq: 1 } } as never,
    );
    expect(shortsShotCardStudioLive(saved)).toBeNull();
    expect(shotCardsSavedAsScript(saved.adultShorts, [{ mediaSlug: TRIP }])).toEqual(new Set([NEW_ID]));
    expect(shotCardsSavedAsScript(saved.adultShorts, [{ mediaSlug: "ep08-other" }])).toEqual(new Set());
  });
});

describe("the first change saves it as a script episode", () => {
  it("opening saves nothing; an edit saves one script card in the same folder; the shot cards are untouched", () => {
    patchAdultShorts(() => stateWith({ editor: "cards" }).adultShorts as AdultShortsState);
    const before = getSkidmarksSnapshot();
    const adultBefore = structuredClone(getAdultShortsState(before));
    const base = shortsShotCardStudioLive(before)!;
    expect(base).not.toBeNull();
    // A no-op (e.g. tapping the act that's already open) writes nothing.
    adoptShortsShotCardLive(base, (live) => ({ ...live, activeAct: "I" }));
    expect(getSkidmarksSnapshot()).toBe(before);

    adoptShortsShotCardLive(base, (live) => ({ ...live, actScripts: { I: `${live.actScripts.I}\nAva:` } }));
    const after = getSkidmarksSnapshot();
    const studio = getStudioState("shorts", after)!;
    const card = studio.workspaces.find((w) => w.mediaSlug === TRIP)!;
    expect(card).toBeDefined();
    expect(card.label).toBe("EP07 · Test Trip");
    expect(card.runtimeMap.I[0].videoUrl).toBe(TRIP_SHOTS[0].clipUrl);
    expect(studio.live.episodeId).toBe(card.id);
    expect(studio.live.mediaSlug).toBe(TRIP);
    // The script studio is now the open editor; everything else on the shot cards is exactly as it was.
    const adultAfter = getAdultShortsState(after);
    expect(adultAfter.editor).toBe("script");
    expect({ ...adultAfter, editor: adultBefore.editor }).toEqual(adultBefore);
    // It shows once on the EPISODES row, as the script episode.
    expect(shotCardsSavedAsScript(adultAfter, studio.workspaces).has(NEW_ID)).toBe(true);
    expect(shortsShotCardStudioLive(after)).toBeNull();
  });

  it("an older episode (EP01/EP02) keeps its old Cast after it's saved as a script", () => {
    const oldCard = { ...tripCard, id: OLD_ID, mediaSlug: "blonde-test-1", episodeNumber: 1 };
    const live = { ...shotCardEpisodeToStudioLive({ title: "t", label: "t", shots: [], cast: [], locations: [] }), mediaSlug: "blonde-test-1" };
    const scope = openShortsEpisodeScopeIn({
      adultShorts: { ...(stateWith({}).adultShorts as AdultShortsState), saved: [oldCard, tripCard], currentSavedId: null, mediaSlug: undefined, editor: "script" },
      shortsStudio: { live, workspaces: [], saveSeq: 0 },
    });
    expect(scope).toEqual({ episode: "blonde-test-1", legacy: true, tickedIds: [] });
    // A newer one (EP03 on) stays standalone, like every script episode.
    const newer = openShortsEpisodeScopeIn({
      adultShorts: { ...(stateWith({}).adultShorts as AdultShortsState), currentSavedId: null, mediaSlug: undefined, editor: "script" },
      shortsStudio: { live: { ...live, mediaSlug: TRIP }, workspaces: [], saveSeq: 0 },
    });
    expect(newer).toEqual({ episode: TRIP, legacy: false, tickedIds: [] });
  });
});

describe("the Shorts screen", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("shows the script studio for every episode: no shot cards, no Starring / In this shot / Speaker chips", () => {
    const sheet = read("../components/SkidmarksDetailSheet.tsx");
    expect(sheet).not.toContain("<AdultShortsPanel");
    expect(sheet).toContain('session.projectKind === "adult-shorts" && shortsAgeConfirmed && <SkidmarksSunnyBanksPanel genre="shorts" />');
    expect(sheet).toContain('session.projectKind === "adult-shorts" && !shortsAgeConfirmed && <ShortsAgeGate />');
    const gate = read("../components/ShortsAgeGate.tsx");
    expect(gate).toContain("Shorts are 18+ only");
    expect(gate).not.toMatch(/Starring|In this shot|Speaker/);
  });
});
