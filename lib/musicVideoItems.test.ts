import { describe, expect, it } from "vitest";
import { bandRowData, characterIdForMember, cleanBandItem, cleanSongItem, songItemFromSession, withoutInlineBytes } from "./musicVideoItemData";
import { deskSongItems, withServerBands, withServerDeskSong } from "./musicVideoItems";
import type { SkidmarksBand, SkidmarksMp3Attachment, SkidmarksState } from "./skidmarks";

const jack: SkidmarksBand = {
  id: "jack-ash",
  name: "Jack Ash",
  tagline: "",
  coverSeed: 1,
  editIcon: "pencil",
  members: [{ id: "jack-ash-frontman", name: "Jack Ash", emoji: "🎸", looks: [], avatarImage: "/skidmarks/jack-ash-reference.jpg" }],
};
const big: SkidmarksBand = { ...jack, id: "band_b", name: "BIGSEXY", members: [{ id: "member_1", name: "BIG SEXY", emoji: "🎤", looks: [] }] };
const mp3 = (attachId: string, fileName = "CRACK HAUL.mp3") =>
  ({ attachId, fileName, durationSec: 100, attachedAt: 1, segments: [], segmentsSource: "transcription", analysisStatus: "done", transcriptionStatus: "done" }) as SkidmarksMp3Attachment;

function state(extra: Partial<SkidmarksState> = {}): SkidmarksState {
  return {
    bands: [jack, big],
    removedSeedBandIds: [],
    session: { projectKind: "music-video", bandId: "band_b", mp3: mp3("mp3_a"), scriptSequenceDraft: { script: "mine" } },
    sunnyBanks: null,
    ...extra,
  } as SkidmarksState;
}

describe("cleaning (shared by server, browser and seed)", () => {
  it("withoutInlineBytes drops data: strings and objects whose dataUrl is inline", () => {
    const out = withoutInlineBytes({
      a: "data:image/png;base64,A",
      b: "https://ok",
      still: { dataUrl: "data:x", source: "upload" },
      sleeve: [{ id: "1", dataUrl: "data:x" }, { id: "2", dataUrl: "https://ok" }],
      list: ["data:x", "keep"],
      gone: undefined,
    });
    expect(out).toEqual({ b: "https://ok", sleeve: [{ id: "2", dataUrl: "https://ok" }], list: ["keep"] });
  });

  it("cleanBandItem keeps unknown fields and site-relative pictures, fills defaults, strips references", () => {
    const raw = { ...jack, future: 1, members: [{ ...jack.members[0], characterId: "clora_jack" }], tagline: undefined };
    const out = cleanBandItem(raw)!;
    expect(out).toMatchObject({ id: "jack-ash", tagline: "", future: 1 });
    expect(out.members[0]).not.toHaveProperty("characterId");
    expect(out.members[0].avatarImage).toBe("/skidmarks/jack-ash-reference.jpg");
    expect(cleanBandItem({ name: "no id" })).toBeNull();
    expect(cleanBandItem({ id: "a b" })).toBeNull();
  });

  it("members reference their character row by id; nothing from the card is copied", () => {
    const cards = [{ id: "clora_jack", sourceKey: "mv:jack-ash-frontman", trainingImageUrls: ["https://t"], loraFile: "jack_v1" }];
    expect(characterIdForMember("jack-ash-frontman", cards)).toBe("clora_jack");
    expect(characterIdForMember("member_1", cards)).toBeNull();
    const row = bandRowData(jack, cards)!;
    expect(row.members[0]).toMatchObject({ id: "jack-ash-frontman", characterId: "clora_jack" });
    expect(JSON.stringify(row)).not.toContain("jack_v1");
    expect(JSON.stringify(row)).not.toContain("https://t");
  });

  it("a song is the desk's MP3 keyed by its attach id", () => {
    const s = state();
    const item = songItemFromSession(s.session)!;
    expect(item).toMatchObject({ id: "mp3_a", bandId: "band_b", scriptSequenceDraft: { script: "mine" } });
    expect(cleanSongItem(item)).toEqual(item);
    expect(deskSongItems(state({ session: { ...s.session, mp3: null } }))).toEqual([]);
  });
});

describe("withServerBands", () => {
  it("puts the server's bands on screen", () => {
    const s = state();
    const out = withServerBands(s, [jack, { ...big, name: "BIG SEXY (server)" }], new Set(["jack-ash"]));
    expect(out.bands.map((b) => b.name)).toEqual(["Jack Ash", "BIG SEXY (server)"]);
    expect(out.session).toBe(s.session);
  });

  it("a built-in band deleted elsewhere stays gone, and the desk resets if it was the active band", () => {
    const s = state({ session: { projectKind: "music-video", bandId: "jack-ash", mp3: mp3("mp3_a"), scriptSequenceDraft: null } });
    const out = withServerBands(s, [big], new Set(["jack-ash"]));
    expect(out.removedSeedBandIds).toEqual(["jack-ash"]);
    expect(out.session).toMatchObject({ bandId: null, mp3: null, scriptSequenceDraft: null });
  });
});

describe("withServerDeskSong", () => {
  it("refreshes only the desk's own song", () => {
    const s = state();
    const server = { id: "mp3_a", bandId: "band_b", mp3: { ...mp3("mp3_a"), durationSec: 200 }, scriptSequenceDraft: { script: "server" } };
    const out = withServerDeskSong(s, [server, { id: "mp3_b", bandId: "jack-ash", mp3: mp3("mp3_b", "OTHER.mp3"), scriptSequenceDraft: null }]);
    expect(out.session.mp3?.durationSec).toBe(200);
    expect(out.session.scriptSequenceDraft).toEqual({ script: "server" });
  });

  it("never puts a song on an empty desk", () => {
    const s = state({ session: { projectKind: "music-video", bandId: "band_b", mp3: null, scriptSequenceDraft: null } });
    expect(withServerDeskSong(s, [{ id: "mp3_b", bandId: "band_b", mp3: mp3("mp3_b"), scriptSequenceDraft: null }])).toBe(s);
  });

  it("returns the same state when the engine kept this device's copy", () => {
    const s = state();
    expect(withServerDeskSong(s, deskSongItems(s))).toBe(s);
  });

  it("clears the desk when the server deleted its song", () => {
    const out = withServerDeskSong(state(), []);
    expect(out.session).toMatchObject({ bandId: "band_b", mp3: null, scriptSequenceDraft: null });
  });
});
