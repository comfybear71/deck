import { describe, expect, it } from "vitest";
import {
  availableAntiheroes,
  buildStarterEpisode,
  episodeTotalSec,
  episodeWhereAntiheroDies,
  filledBeatCount,
  formatDuration,
  insertAtSelection,
  nextEpisodeTitle,
  normalizeSkidmarksEpisodesState,
  SKIDMARKS_BEATS,
  skidmarksEpisodesHaveUserContent,
  tagBarEntries,
  type SkidmarksCastMember,
} from "./skidmarksEpisodes";

const cast = (id: string, name: string, role: "antihero" | "supporting", look = ""): SkidmarksCastMember => ({
  id,
  name,
  role,
  look,
  fictionalAdultConfirmed: true,
  createdAt: 1,
});

describe("skidmarks episodes", () => {
  it("has the nine-beat spine between intro and outro, with beat 8 as the death", () => {
    expect(SKIDMARKS_BEATS.map((b) => b.id)).toEqual([
      "intro", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "outro",
    ]);
    expect(SKIDMARKS_BEATS.filter((b) => b.isDeath).map((b) => b.number)).toEqual([8]);
    expect(SKIDMARKS_BEATS[1].label).toBe("He shows up");
  });

  it("starter episode lands inside the 8 to 10 minute target with an opening plate line", () => {
    const ep = buildStarterEpisode("EP05", 10, "ep_x");
    const total = episodeTotalSec(ep);
    expect(total).toBeGreaterThanOrEqual(8 * 60);
    expect(total).toBeLessThanOrEqual(10 * 60);
    expect(ep.beats.b1.script).toContain("[Location: ]");
    expect(ep.antiheroId).toBeNull();
    expect(filledBeatCount(ep)).toBe(0);
  });

  it("counts only beats written past the template", () => {
    const ep = buildStarterEpisode("x");
    ep.beats.b2.script = "He keys a car.";
    ep.beats.b1.script += "Darryl arrives.";
    expect(filledBeatCount(ep)).toBe(2);
  });

  it("numbers the next episode after the highest EP number", () => {
    expect(nextEpisodeTitle([])).toBe("EP01 · New episode");
    const a = buildStarterEpisode("EP04 · Deep Fried");
    const b = buildStarterEpisode("EP02 · Darryl");
    expect(nextEpisodeTitle([a, b])).toBe("EP05 · New episode");
  });

  it("formats durations", () => {
    expect(formatDuration(525)).toBe("8:45");
    expect(formatDuration(5)).toBe("0:05");
  });

  it("an antihero headlines (and dies in) one episode only", () => {
    const darryl = cast("c1", "Darryl", "antihero");
    const kim = cast("c2", "Kim", "antihero");
    const ep1 = { ...buildStarterEpisode("EP01"), id: "e1", antiheroId: "c1" };
    const ep2 = { ...buildStarterEpisode("EP02"), id: "e2" };
    const state = { episodes: [ep1, ep2], cast: [darryl, kim] };
    expect(episodeWhereAntiheroDies("c1", state.episodes)?.id).toBe("e1");
    expect(availableAntiheroes(state, "e2").map((c) => c.id)).toEqual(["c2"]);
    expect(availableAntiheroes(state, "e1").map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("tag bar puts the episode's cast first with their default look", () => {
    const ep = { ...buildStarterEpisode("x"), antiheroId: "c1", castIds: ["c3"] };
    const entries = tagBarEntries(ep, [cast("c1", "Darryl", "antihero", "hi-vis, mullet"), cast("c3", "Clive", "supporting")]);
    expect(entries[0]).toEqual({ label: "[Darryl]", insert: "[Darryl: hi-vis, mullet] " });
    expect(entries[1].insert).toBe("[Clive: look] ");
    expect(entries.map((e) => e.label)).toContain("[Location:]");
  });

  it("inserts tags at the cursor, on a new line mid-text, caret inside empty tags", () => {
    expect(insertAtSelection("", 0, 0, "[Location: ]")).toEqual({ value: "[Location: ]", caret: 11 });
    const r = insertAtSelection("He parks", 8, 8, "[SFX: ]");
    expect(r.value).toBe("He parks\n[SFX: ]");
    expect(r.caret).toBe(r.value.length - 1);
    expect(insertAtSelection("ab", 1, 2, "X")).toEqual({ value: "aX", caret: 2 });
  });

  it("normalize drops unconfirmed characters and dangling cast links", () => {
    const raw = {
      cast: [cast("c1", "Darryl", "antihero"), { id: "c9", name: "Real Person", role: "antihero" }],
      episodes: [{ id: "e1", title: "EP01", antiheroId: "c9", castIds: ["c1", "zz"], beats: { b1: { script: "hi", durationSec: 40 } } }],
    };
    const out = normalizeSkidmarksEpisodesState(raw)!;
    expect(out.cast.map((c) => c.id)).toEqual(["c1"]);
    expect(out.episodes[0].antiheroId).toBeNull();
    expect(out.episodes[0].castIds).toEqual(["c1"]);
    expect(out.episodes[0].beats.b1).toEqual({ script: "hi", durationSec: 40 });
    expect(out.episodes[0].beats.outro.durationSec).toBe(20);
    expect(normalizeSkidmarksEpisodesState(null)).toBeNull();
  });

  it("reports user content", () => {
    expect(skidmarksEpisodesHaveUserContent(null)).toBe(false);
    expect(skidmarksEpisodesHaveUserContent({ episodes: [], cast: [] })).toBe(false);
    expect(skidmarksEpisodesHaveUserContent({ episodes: [buildStarterEpisode("x")], cast: [] })).toBe(true);
  });
});

describe("cast pictures from uploads", () => {
  it("names a character from a file name and groups numbered pictures", async () => {
    const { castNameFromFileName } = await import("./skidmarksEpisodes");
    expect(castNameFromFileName("Clive 3.jpg")).toBe("Clive");
    expect(castNameFromFileName("clive_12.jpeg")).toBe("Clive");
    expect(castNameFromFileName("Street cat.jpg")).toBe("Street cat");
    expect(castNameFromFileName("Lock & chain woman (2).png")).toBe("Lock & chain woman");
    expect(castNameFromFileName("Deep Fried.jpg")).toBe("Deep Fried");
    expect(castNameFromFileName("1234.jpg")).toBe("1234");
  });

  it("keeps https and image data pictures, drops junk, and keeps the animal flag through a reload", async () => {
    const { normalizeSkidmarksEpisodesState } = await import("./skidmarksEpisodes");
    const st = normalizeSkidmarksEpisodesState({
      episodes: [],
      cast: [
        {
          id: "a",
          name: "Owl",
          role: "supporting",
          look: "",
          fictionalAdultConfirmed: true,
          createdAt: 1,
          isAnimal: true,
          pictureUrls: ["https://x.com/a.jpg", "javascript:alert(1)", 5, "https://x.com/a.jpg", "data:image/jpeg;base64,AA"],
        },
      ],
    });
    expect(st?.cast[0].pictureUrls).toEqual(["https://x.com/a.jpg", "data:image/jpeg;base64,AA"]);
    expect(st?.cast[0].isAnimal).toBe(true);
  });
});
