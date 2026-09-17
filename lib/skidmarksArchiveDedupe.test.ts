import { describe, expect, it } from "vitest";
import {
  archiveSongIdentity,
  collapseArchivedSongsByIdentity,
  isBetterArchivedSong,
  normalizeArchiveFileName,
  songsShareArchiveIdentity,
} from "./skidmarksArchiveDedupe";

function row(
  id: string,
  fileName: string,
  clipCount: number,
  renderedPlateCount: number,
  archivedAt: number,
  bandId = "stuballs"
) {
  return { id, bandId, bandName: "STUBALLS", fileName, clipCount, renderedPlateCount, archivedAt };
}

describe("normalizeArchiveFileName / archiveSongIdentity", () => {
  it("treats the same MP3 name as the same song even with extra spaces or case", () => {
    expect(normalizeArchiveFileName("  Simulation instruments.mp3 ")).toBe("simulation instruments.mp3");
    expect(archiveSongIdentity("stuballs", "Simulation instruments.mp3")).toBe(
      archiveSongIdentity("stuballs", "simulation  instruments.mp3")
    );
  });

  it("keeps the same filename on two bands as two songs", () => {
    expect(songsShareArchiveIdentity({ bandId: "stuballs", fileName: "song.mp3" }, { bandId: "jack-ash", fileName: "song.mp3" })).toBe(
      false
    );
  });
});

describe("collapseArchivedSongsByIdentity", () => {
  it("keeps Simulation instruments' 20-render row over the 16-render copy", () => {
    const { kept, dropped } = collapseArchivedSongsByIdentity([
      row("a", "Simulation instruments.mp3", 20, 16, 200),
      row("b", "Simulation instruments.mp3", 20, 20, 100),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("b");
    expect(dropped.map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps Simulation.mp3's 23/23 row over two empty 11/0 copies", () => {
    const { kept, dropped } = collapseArchivedSongsByIdentity([
      row("empty-1", "Simulation.mp3", 11, 0, 300),
      row("empty-2", "Simulation.mp3", 11, 0, 299),
      row("done", "Simulation.mp3", 23, 23, 200),
    ]);
    expect(kept.map((s) => s.id)).toEqual(["done"]);
    expect(dropped).toHaveLength(2);
  });

  it("collapses three identical My Best Friend rows to the newest", () => {
    const { kept, dropped } = collapseArchivedSongsByIdentity([
      row("m1", "My Best Friend.mp3", 20, 20, 10),
      row("m2", "My Best Friend.mp3", 20, 20, 30),
      row("m3", "My Best Friend.mp3", 20, 20, 20),
    ]);
    expect(kept.map((s) => s.id)).toEqual(["m2"]);
    expect(dropped).toHaveLength(2);
  });

  it("keeps Give Me Something's 27-render row over an older 22 and a twin 27", () => {
    const { kept } = collapseArchivedSongsByIdentity([
      row("g27a", "JACK ASH - GIVE ME SOMETHING V1.mp3", 30, 27, 50, "jack-ash"),
      row("g27b", "JACK ASH - GIVE ME SOMETHING V1.mp3", 30, 27, 40, "jack-ash"),
      row("g22", "JACK ASH - GIVE ME SOMETHING V1.mp3", 30, 22, 10, "jack-ash"),
    ]);
    expect(kept.map((s) => s.id)).toEqual(["g27a"]);
  });

  it("does not merge two different files on the same band", () => {
    const { kept } = collapseArchivedSongsByIdentity([
      row("magician", "Magician requiem.mp3", 24, 24, 400),
      row("heads", "STUBALLS - BANGING MY HEADS.mp3", 16, 16, 100),
    ]);
    expect(kept).toHaveLength(2);
  });
});

describe("isBetterArchivedSong", () => {
  it("prefers more rendered plates before a newer timestamp", () => {
    expect(
      isBetterArchivedSong(
        { id: "old-full", archivedAt: 1, clipCount: 20, renderedPlateCount: 20 },
        { id: "new-partial", archivedAt: 9, clipCount: 20, renderedPlateCount: 16 }
      )
    ).toBe(true);
  });
});
