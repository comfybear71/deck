import { describe, expect, it } from "vitest";
import { stageLocationsFromState, stageMembersFromState } from "./stageLabCast";
import type { SkidmarksState } from "./skidmarks";
import { normalizeSkidmarksState } from "./skidmarks";

function stateWith(partial: Record<string, unknown>): SkidmarksState {
  return normalizeSkidmarksState(partial);
}

describe("Stage lab Cast snapshot", () => {
  it("reads Skidmarks Cast kind + picture without writing", () => {
    const state = stateWith({
      skidmarksEpisodes: {
        episodes: [],
        liveId: null,
        cast: [
          {
            id: "house1",
            name: "House",
            role: "supporting",
            look: "wall speaker, pulsing ring",
            fictionalAdultConfirmed: true,
            createdAt: 1,
            pictureUrls: ["https://example.com/house.jpg"],
            kind: "object",
          },
          {
            id: "arthur1",
            name: "Arthur",
            role: "antihero",
            look: "man in a kitchen",
            fictionalAdultConfirmed: true,
            createdAt: 1,
            pictureUrls: ["https://example.com/arthur.jpg"],
            kind: "person",
          },
        ],
      },
      characterLoras: {
        characters: [
          {
            id: "clora_arthur",
            name: "Arthur",
            slug: "arthur",
            sourceKey: "sk:arthur1",
            voiceId: "21m00Tcm4TlvDq8ikWAM",
            trainingImageUrls: [],
            fictionalAdultConfirmed: true,
            status: "idle",
            version: 1,
            replicateTrainingId: null,
            error: null,
            hfRepo: null,
            loraFile: null,
            embeddingFile: null,
            costUsd: null,
            trainedAt: null,
            importedToComfy: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            trainingStyle: "semireal",
            referenceUrl: null,
            autoPictureTarget: null,
            awaitingReview: false,
            cleanCandidateUrl: null,
            cleanReferenceApproved: false,
            subjectWord: "person",
          },
        ],
      },
      locations: {
        locations: [
          {
            id: "loc_skidmarks_kitchen",
            genre: "skidmarks",
            key: "kitchen",
            name: "Kitchen",
            pictureUrl: "https://example.com/kitchen.jpg",
            createdAt: 1,
          },
        ],
      },
    });
    const actors = stageMembersFromState(state);
    const house = actors.find((a) => a.name === "House");
    const arthur = actors.find((a) => a.name === "Arthur");
    expect(house?.kind).toBe("object");
    expect(house?.pictureUrl).toMatch(/house\.jpg/);
    expect(arthur?.kind).toBe("person");
    expect(arthur?.voiceId).toBe("21m00Tcm4TlvDq8ikWAM");
    const places = stageLocationsFromState(state);
    expect(places.some((l) => l.name === "Kitchen" && l.pictureUrl)).toBe(true);
  });
});
