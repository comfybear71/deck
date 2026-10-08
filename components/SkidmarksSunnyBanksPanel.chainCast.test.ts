import { describe, expect, it, vi } from "vitest";
import type { SkidmarksState } from "@/lib/skidmarks";

/**
 * Live iPhone report: silent `House:` after "Chain from shot N" (Arthur
 * walking out with Pip) showed House+Arthur+Pip chips and would have
 * sent their pictures. Chain only supplies the start frame. Cast and
 * location come from this row's own speaker + [Action]/[Cast:] +
 * [Location:] — never the previous shot.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck/sunnybank/characters";
const HOUSE_PIC = `${BLOB}/house/house-picture-01.jpg`;
const ARTHUR_PIC = `${BLOB}/arthur/arthur-picture-01.jpg`;
const PIP_PIC = `${BLOB}/pip/pip-picture-01.jpg`;

function extra(id: string, name: string, look: string, pictureUrl: string) {
  return {
    id,
    name,
    look,
    pictureUrls: [pictureUrl],
    fictionalAdultConfirmed: true,
    createdAt: 1,
  };
}

function card(name: string, sourceKey: string, referenceUrl: string) {
  return {
    id: `clora_${name.toLowerCase()}`,
    name,
    slug: name.toLowerCase(),
    sourceKey,
    status: "idle",
    trainingImageUrls: [],
    version: 1,
    createdAt: "2026-10-08T00:00:00.000Z",
    referenceUrl,
  };
}

const STATE = {
  bands: [],
  session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null },
  removedSeedBandIds: [],
  rosterExtras: {
    "music-video": [],
    "sunny-banks": [
      extra("chr_house", "House", "weatherboard house", HOUSE_PIC),
      extra("chr_arthur", "Arthur", "thin bloke", ARTHUR_PIC),
      extra("chr_pip", "Pip", "small dog", PIP_PIC),
    ],
    "adult-shorts": [],
  },
  characterLoras: {
    characters: [
      card("House", "sbx:chr_house", HOUSE_PIC),
      card("Arthur", "sbx:chr_arthur", ARTHUR_PIC),
      card("Pip", "sbx:chr_pip", PIP_PIC),
    ],
  },
} as unknown as SkidmarksState;

vi.mock("@/lib/skidmarks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skidmarks")>();
  return { ...actual, getSkidmarksSnapshot: () => STATE };
});

const {
  parseSunnyBanksScriptBlock,
  sunnyBanksQueueChunks,
  sunnyBanksRowBeatArgs,
  sunnyBanksBeatRequestBody,
  resolveSunnyBanksRowLocationId,
  sunnyBanksShotBadgeMarks,
} = await import("./SkidmarksSunnyBanksPanel");
const { resolveSunnyBanksRowCast } = await import("@/lib/sunnyBanksShotCast");
const { sunnyBanksCastCards } = await import("@/lib/sunnyBanksVoices");

const LIVE_SCRIPT = [
  "=== ACT I — SCENE 3 — KITCHEN ===",
  "[Location: arthur_kitchen]",
  "[Action: Arthur walking out with Pip]",
  "Arthur: Come on.",
  "=== ACT I — SCENE 4 — BEDROOM ===",
  "[Location: arthur_bedroom]",
  "[Action: House sits empty]",
  "House:",
].join("\n");

const CARDS = sunnyBanksCastCards(STATE);

function rowCast(chunk: ReturnType<typeof sunnyBanksQueueChunks>[number]) {
  return resolveSunnyBanksRowCast(
    {
      kind: chunk.kind,
      characterName: chunk.characterName,
      cutaway: false,
      action: chunk.action,
      sceneAction: chunk.sceneAction,
      castNames: chunk.castNames,
      castLooks: chunk.castLooks,
      sceneSpeakers: chunk.sceneSpeakers,
      sceneKey: chunk.sceneKey,
      appearanceModifier: chunk.appearanceModifier,
    },
    CARDS,
  );
}

describe("Chain from shot N does not inherit the previous row's Cast or location", () => {
  it("House is a silent one-person hold; Arthur+Pip stay on the kitchen shot", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(LIVE_SCRIPT));
    expect(rows.map((r) => [r.characterName, r.kind, r.sceneKey])).toEqual([
      ["Arthur", "speak", undefined],
      ["House", "hold", undefined],
    ]);
    expect(rowCast(rows[0]).cast.names.sort()).toEqual(["Arthur", "Pip"]);
    expect(rowCast(rows[1]).cast.names).toEqual(["House"]);
    expect(rowCast(rows[1]).cast.isMulti).toBe(false);
  });

  it("House's [Location: arthur_bedroom] beats a stale kitchen dropdown pick", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(LIVE_SCRIPT));
    const house = rows[1];
    expect(house.locationTag).toBe("arthur_bedroom");
    expect(resolveSunnyBanksRowLocationId(house, "arthur_kitchen", undefined, "office_storefront")).toBe(
      "arthur_bedroom",
    );
  });

  it("a chained start sends the last frame as plateUrl and never the previous Cast pictures", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(LIVE_SCRIPT));
    const house = rows[1];
    const cast = rowCast(house);
    const chained = "https://abc123.public.blob.vercel-storage.com/last-frame-shot-12.jpg";
    const args = sunnyBanksRowBeatArgs({
      chunk: house,
      characterName: house.characterName,
      speaker: {},
      location: { id: "arthur_bedroom", label: "Bedroom", image: HOUSE_PIC },
      startImageDataUrl: "data:image/png;base64,xx",
      rowCast: cast,
      videoBackend: "grok",
      act: "I",
      episodeSlug: "ep-house",
      rowNumber: 13,
      sceneFirstRowNumber: 13,
      rowPlateUrl: chained,
      scenePlateUrl: "https://abc123.public.blob.vercel-storage.com/arthur-pip-scene-plate.jpg",
    });
    const body = sunnyBanksBeatRequestBody(args);
    expect(body.plateUrl).toBe(chained);
    expect(body.cast).toBeUndefined();
    expect(body.scenePlateUrl).toBeUndefined();
    expect(body.sceneSpeakers).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/Arthur|Pip/);
  });

  it("idle #N badges land on each shot's [Action:] line, same number as the list", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(LIVE_SCRIPT));
    const marks = sunnyBanksShotBadgeMarks(LIVE_SCRIPT, rows);
    expect(marks).toEqual([
      { shotNumber: 1, lineIndex: 2 },
      { shotNumber: 2, lineIndex: 6 },
    ]);
    expect(LIVE_SCRIPT.split("\n")[2]).toContain("[Action: Arthur walking out with Pip]");
    expect(LIVE_SCRIPT.split("\n")[6]).toContain("[Action: House sits empty]");
  });
});
