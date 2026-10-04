import { describe, expect, it } from "vitest";
import { normalizeAdultShortsState, type AdultShortsSaved, type AdultShortsShot } from "./adultShorts";
import {
  parseStudioGenre,
  SHORTS_TALKING_PLATE_LINE,
  STUDIO_GENRES,
  studioCastGroup,
  studioGenreProfile,
  studioPlateEngine,
  studioSilentBackend,
} from "./studioGenre";
import { withTalkingPlateLine } from "./sunnyBanksComposite";
import { ignoredVideoBackendWarning, pickRowVideoBackend } from "./videoBackendRouting";
import { estimateRowVideoCostUsd } from "./clipGeneration";
import { openShortsEpisodeScopeIn, shortsOpenEditor, shortsScriptEditorOpen } from "./shortsEpisodeCast";
import { readFileSync } from "node:fs";
import { episodeNameFirstMessage } from "./episodeCast";
import { sunnybankBeatTarget, sunnybankPlateTarget } from "./deckMediaPaths";
import { buildEmptySunnyBanksLive, normalizeSunnyBanksStudio } from "./sunnyBanksWorkspace";
import { normalizeSkidmarksState } from "./skidmarks";

/**
 * Shorts gets the script studio (2026-10-04). Shorts' own look, Cast,
 * engines and folders; Sunny Banks and Skidmarks unchanged; EP03 left
 * exactly as it is on the shot cards.
 */

const ADULT_LOCK_RE = /\badult\b[a-z ]{0,12}, clearly over 25/i;

describe("the Shorts studio profile", () => {
  it("is a third show with its own name, Cast group and folders", () => {
    expect(STUDIO_GENRES).toContain("shorts");
    expect(parseStudioGenre("shorts")).toBe("shorts");
    const p = studioGenreProfile("shorts");
    expect(p.showName).toBe("Shorts");
    expect(p.builtIns).toBe(false);
    expect(studioCastGroup("shorts")).toBe("adult-shorts");
  });

  it("is live action with the adult lock in every prompt; the cartoon shows don't change", () => {
    expect(studioGenreProfile("shorts").look.styleLock).toMatch(ADULT_LOCK_RE);
    expect(studioGenreProfile("shorts").look.styleLock).toMatch(/photorealistic live-action/);
    expect(studioGenreProfile("sunnybank").look.styleLock).not.toMatch(ADULT_LOCK_RE);
    expect(studioGenreProfile("skidmarks").look.styleLock).not.toMatch(ADULT_LOCK_RE);
  });

  it("engines: Shorts silent rows Siray by default, Grok and H3 offered; plates Siray or Grok", () => {
    expect(studioGenreProfile("shorts").silentBackends).toEqual(["siray", "grok", "h3"]);
    expect(studioGenreProfile("shorts").plateEngines).toEqual(["siray", "grok"]);
    expect(studioSilentBackend("shorts", undefined)).toBe("siray");
    expect(studioSilentBackend("shorts", "grok")).toBe("grok");
    expect(studioPlateEngine("shorts", undefined)).toBe("siray");
    expect(studioPlateEngine("shorts", "grok")).toBe("grok");
    // The other shows: exactly as before.
    expect(studioSilentBackend("sunnybank", undefined)).toBe("grok");
    expect(studioSilentBackend("skidmarks", "siray")).toBe("grok");
    expect(studioPlateEngine("sunnybank", "siray")).toBe("grok");
  });

  it("the talking-plate line (head level, mouth visible) is added on Shorts talking rows only", () => {
    const shorts = studioGenreProfile("shorts");
    expect(withTalkingPlateLine("P.", shorts, true)).toBe(`P. ${SHORTS_TALKING_PLATE_LINE}`);
    expect(withTalkingPlateLine("P.", shorts, false)).toBe("P.");
    expect(withTalkingPlateLine("P.", studioGenreProfile("sunnybank"), true)).toBe("P.");
    expect(withTalkingPlateLine("P.", studioGenreProfile("skidmarks"), true)).toBe("P.");
  });
});

describe("row engines", () => {
  it("[SIRAY] renders a silent Shorts row on Siray; on Sunny Banks it is ignored and says so", () => {
    const offered = studioGenreProfile("shorts").silentBackends;
    expect(pickRowVideoBackend({ kind: "hold", override: "siray", silentOffered: offered })).toEqual({ backend: "siray" });
    expect(pickRowVideoBackend({ kind: "hold", silentDefault: "siray", silentOffered: offered })).toEqual({ backend: "siray" });
    expect(pickRowVideoBackend({ kind: "hold", override: "grok", silentDefault: "siray", silentOffered: offered })).toEqual({ backend: "grok" });
    const sb = pickRowVideoBackend({ kind: "hold", override: "siray" });
    expect(sb).toEqual({ backend: "grok", ignoredOverride: "siray" });
    expect(ignoredVideoBackendWarning("siray", "hold")).toMatch(/\[SIRAY\] ignored/);
    // A talking row stays on LTX whatever it says.
    expect(pickRowVideoBackend({ kind: "speak", override: "siray", silentOffered: offered })).toEqual({ backend: "ltx", ignoredOverride: "siray" });
  });

  it("Siray's silent-row price is the Shorts per-second rate", () => {
    expect(estimateRowVideoCostUsd("siray", 5)).toBe(0.9);
  });
});

describe("Shorts script episode folders", () => {
  it("clips and plates go under deck/shorts/episodes/<episode>", () => {
    expect(sunnybankBeatTarget({ episodeSlug: "night-out", actId: "I", beatNumber: 2, characterName: "Ava", kind: "hold", genre: "shorts" })).toEqual({
      folder: "deck/shorts/episodes/night-out/act-i",
      name: "night-out-act-i-beat-02-ava-hold",
    });
    expect(sunnybankPlateTarget({ episodeSlug: "night-out", actId: "I", beatNumber: 2, castNames: ["Ava"], genre: "shorts" })?.folder).toBe(
      "deck/shorts/episodes/night-out/act-i",
    );
    // Sunny Banks and Skidmarks unchanged.
    expect(sunnybankBeatTarget({ episodeSlug: "ep01", actId: "I", beatNumber: 1, characterName: "Shazza", kind: "speak" })?.folder).toBe(
      "deck/sunnybank/episodes/ep01/act-i",
    );
  });

  it("a name comes from the # EPISODE: line in the script studio", () => {
    expect(episodeNameFirstMessage("adult-shorts", "characters", true)).toBe(
      "Give the episode a name first (the # EPISODE: line), then add its characters.",
    );
    expect(episodeNameFirstMessage("adult-shorts", "characters")).toMatch(/tap \+ New/);
  });
});

/**
 * EP03 Backpackers, the shape it has live (2026-10-04, read-only check):
 * card `short_mutk480k_76eef5fb`, folder `ep03-backpackers`, 10 shots,
 * 10 plates, 4 clips, 5 Lines, the 18+ switch off. The text and URLs here
 * are neutral stand-ins (this repo is public); the shape is the same.
 */
const B = "https://abc123.public.blob.vercel-storage.com/deck/shorts/episodes/ep03-backpackers";
function ep03Shot(n: number): AdultShortsShot {
  const shot: AdultShortsShot = {
    id: `shot_${n}`,
    prompt: `Stand-in prompt for shot ${n}, 16mm film look.`,
    durationSec: 5,
    referenceIndex: 0,
    plateUrl: `${B}/ep03-backpackers-plate-${String(n).padStart(2, "0")}.jpg`,
    clipUrl: n <= 4 ? `${B}/ep03-backpackers-clip-${String(n).padStart(2, "0")}.mp4` : null,
    lastFrameUrl: n <= 4 ? `${B}/ep03-backpackers-clip-${String(n).padStart(2, "0")}-last-frame.jpg` : null,
    sirayTaskId: null,
    chainFromPrevious: false,
  };
  if (n <= 5) shot.line = `Stand-in line ${n}. [pause]`;
  if (n === 4) shot.speakerName = "Kai";
  if (n === 6) shot.castNames = ["Ned"];
  return shot;
}
const STARRING = ["Ned", "Rae", "Lou", "Kai", "Ivy"].map((name) => ({ name, look: "", referenceUrls: [`${B}/characters/${name.toLowerCase()}.jpg`] }));
const EP03: AdultShortsSaved = {
  id: "short_mutk480k_76eef5fb",
  adult: false,
  shots: Array.from({ length: 10 }, (_, i) => ep03Shot(i + 1)),
  title: "Backpackers",
  savedAt: "2026-10-04T08:00:00.000Z",
  starring: STARRING,
  character: STARRING[0],
  mediaSlug: "ep03-backpackers",
  episodeNumber: 3,
} as AdultShortsSaved;
const EP03_OPEN = {
  adult: false,
  saved: [EP03],
  shots: EP03.shots,
  starring: STARRING,
  character: STARRING[0],
  mediaSlug: "ep03-backpackers",
  ageConfirmed: true,
  currentSavedId: EP03.id,
};

describe("EP03 stays exactly as it is, on the shot cards", () => {
  it("the shape matches the live card", () => {
    expect(EP03.shots).toHaveLength(10);
    expect(EP03.shots.filter((s) => s.plateUrl)).toHaveLength(10);
    expect(EP03.shots.filter((s) => s.clipUrl)).toHaveLength(4);
    expect(EP03.shots.filter((s) => s.line)).toHaveLength(5);
  });

  it("loads with every field kept, and saves byte for byte the same each time, through the shot cards and the whole session", () => {
    const normalized = normalizeAdultShortsState(JSON.parse(JSON.stringify(EP03_OPEN)))!;
    expect(normalized.saved).toEqual(EP03_OPEN.saved);
    expect(normalized.shots).toEqual(EP03_OPEN.shots);
    // Saving what was loaded changes nothing, byte for byte.
    expect(JSON.stringify(normalizeAdultShortsState(JSON.parse(JSON.stringify(normalized))))).toBe(JSON.stringify(normalized));
    const session = normalizeSkidmarksState({ adultShorts: EP03_OPEN });
    expect(JSON.stringify(session.adultShorts)).toBe(JSON.stringify(normalized));
    expect(session.shortsStudio ?? null).toBeNull();
  });

  it("opens in the shot cards: no editor saved means shot cards; its Cast scope is unchanged", () => {
    const normalized = normalizeAdultShortsState(EP03_OPEN)!;
    expect("editor" in normalized).toBe(false);
    expect(shortsScriptEditorOpen({ adultShorts: normalized })).toBe(false);
    expect(openShortsEpisodeScopeIn({ adultShorts: normalized })).toEqual({ episode: "ep03-backpackers", legacy: false, tickedIds: [] });
    // Junk never switches editors.
    expect("editor" in normalizeAdultShortsState({ ...EP03_OPEN, editor: "bogus" })!).toBe(false);
  });

  it("with the script studio open, the scope is the script episode's, and EP03's card is untouched", () => {
    const adultShorts = normalizeAdultShortsState({ ...EP03_OPEN, editor: "script" })!;
    expect(adultShorts.editor).toBe("script");
    const shortsStudio = { live: { ...buildEmptySunnyBanksLive("shorts"), mediaSlug: "ep04-night-out" }, workspaces: [], saveSeq: 0 };
    expect(openShortsEpisodeScopeIn({ adultShorts, shortsStudio })).toEqual({ episode: "ep04-night-out", legacy: false, tickedIds: [] });
    expect(adultShorts.saved).toEqual(EP03_OPEN.saved);
    expect(JSON.stringify(adultShorts.saved)).toBe(JSON.stringify(normalizeAdultShortsState(EP03_OPEN)!.saved));
  });

  it("the Shorts studio state round-trips with its engines", () => {
    const studio = normalizeSunnyBanksStudio(
      { live: { ...buildEmptySunnyBanksLive("shorts"), mediaSlug: "ep04-night-out" }, workspaces: [], saveSeq: 0, silentShotBackend: "siray", plateEngine: "grok" },
      "shorts",
    )!;
    expect(studio.live.mediaSlug).toBe("ep04-night-out");
    expect(studio.silentShotBackend).toBe("siray");
    expect(studio.plateEngine).toBe("grok");
  });
});

describe("script episodes are the default; shot-card episodes open as before (2026-10-04)", () => {
  const blank = { ageConfirmed: true, character: { name: "", look: "", referenceUrls: [] }, shots: [], saved: [], currentSavedId: null };

  it("a Shorts with no shot-card episode open opens the script studio", () => {
    expect(shortsOpenEditor(undefined)).toBe("script");
    expect(shortsOpenEditor(null)).toBe("script");
    expect(shortsOpenEditor(blank)).toBe("script");
    // Saved shot-card episodes but none open: still the script studio.
    expect(shortsOpenEditor({ ...blank, saved: EP03_OPEN.saved })).toBe("script");
  });

  it("the live session with EP03 open (nothing ever picked) stays on the shot cards", () => {
    expect(shortsOpenEditor(EP03_OPEN)).toBe("cards");
    expect(shortsOpenEditor(normalizeSkidmarksState({ adultShorts: EP03_OPEN }).adultShorts)).toBe("cards");
  });

  it("the EPISODES row's pick wins either way, and both picks survive a reload", () => {
    expect(shortsOpenEditor({ ...EP03_OPEN, editor: "script" })).toBe("script");
    expect(shortsOpenEditor({ ...blank, editor: "cards" })).toBe("cards");
    expect(normalizeAdultShortsState({ ...EP03_OPEN, editor: "cards" })!.editor).toBe("cards");
    expect(normalizeAdultShortsState({ ...EP03_OPEN, editor: "script" })!.editor).toBe("script");
  });

  it("one EPISODES row like Skidmarks: no editor switch; + New starts a script episode", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    const sheet = read("../components/SkidmarksDetailSheet.tsx");
    expect(sheet).toContain("<ShortsEpisodesRow />");
    expect(sheet).not.toContain("ShortsEditorSwitch");
    const row = read("../components/ShortsEpisodesRow.tsx");
    expect(row).toContain("onNew={script.onNew}");
    expect(row).toContain('useStudioEpisodeCards(\n    "shorts"');
  });
});
