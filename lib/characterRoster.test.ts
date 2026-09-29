import { describe, expect, it } from "vitest";
import { buildCharacterLoraEntry } from "./characterLoras";
import {
  buildCharacterRoster,
  buildFacePrompt,
  buildTrainingPicturePrompts,
  EMPTY_HANDS_LINE,
  minorBlockReason,
  oneTapCost,
  signatureLine,
  startingPictures,
  stripHeldProps,
} from "./characterRoster";
import { buildSdxlTrainingInput } from "./replicateTrainer";
import { getSkidmarksSnapshot, type SkidmarksState } from "./skidmarks";

function stateWith(extra: Partial<SkidmarksState> = {}): SkidmarksState {
  return { ...getSkidmarksSnapshot(), ...extra };
}

describe("buildCharacterRoster", () => {
  it("groups the seeded cast: Jack and Nova in music video, the Sunny Banks locks, no Skidmarks cast yet", () => {
    const r = buildCharacterRoster(stateWith());
    expect(r["music-video"].map((c) => c.name)).toEqual(expect.arrayContaining(["Jack Ash", "Nova"]));
    const jack = r["music-video"].find((c) => c.name === "Jack Ash")!;
    expect(jack.style).toBe("faceless");
    expect(jack.thumbUrl).toBe("/skidmarks/jack-ash-reference.jpg");
    expect(r["music-video"].find((c) => c.name === "Nova")!.thumbUrl).toBeNull();
    expect(r["sunny-banks"].map((c) => c.name)).toEqual(
      expect.arrayContaining(["Shazza", "Dazza", "Nan", "Nuggets", "Ranger Bazza", "Unit 4S"]),
    );
    expect(r.skidmarks).toEqual([]);
  });

  it("uses the single-figure hero crop for Sunny Banks, not the group sheet", () => {
    const shazza = buildCharacterRoster(stateWith())["sunny-banks"].find((c) => c.name === "Shazza")!;
    expect(shazza.thumbUrl).toBe("/skidmarks/sunnybanks/shazza-hero.jpg");
    expect(shazza.style).toBe("cartoon");
  });

  it("locks Nuggets (written as a teen) and leaves the adults open", () => {
    const sb = buildCharacterRoster(stateWith())["sunny-banks"];
    expect(sb.find((c) => c.name === "Nuggets")!.blockedReason).toMatch(/under 18/);
    expect(sb.find((c) => c.name === "Nan")!.blockedReason).toBeNull();
    expect(sb.find((c) => c.name === "Unit 4S")!.blockedReason).toBeNull();
  });

  it("lists Skidmarks episode cast with no picture", () => {
    const r = buildCharacterRoster(
      stateWith({
        skidmarksEpisodes: {
          episodes: [],
          cast: [{ id: "c1", name: "Vince", role: "antihero", look: "tall, scarred, leather coat", fictionalAdultConfirmed: true, createdAt: 1 }],
        },
      }),
    );
    expect(r.skidmarks).toHaveLength(1);
    expect(r.skidmarks[0]).toMatchObject({ sourceKey: "sk:c1", thumbUrl: null, blockedReason: null });
  });
});

describe("minorBlockReason", () => {
  it("catches teen and child wording, not ordinary words", () => {
    expect(minorBlockReason("skinny teen, buzz cut")).not.toBeNull();
    expect(minorBlockReason("a schoolgirl outfit")).not.toBeNull();
    expect(minorBlockReason("tall woman, forties, leather jacket")).toBeNull();
    expect(minorBlockReason("sixteen-wheeler truck driver")).toBeNull();
  });
});

describe("prompts", () => {
  it("keeps every training prompt under the Siray route's 2000 character cap, even for Jack's long lock", () => {
    const r = buildCharacterRoster(stateWith());
    for (const c of [...r["music-video"], ...r["sunny-banks"]]) {
      for (const p of buildTrainingPicturePrompts(c, 15)) expect(p.length).toBeLessThan(2000);
      expect(buildFacePrompt(c).length).toBeLessThan(2000);
    }
  });

  it("gives 15 different angles and continues from startIndex", () => {
    const c = { name: "Skye", look: "", neverShow: "", style: "photo" as const };
    const all = buildTrainingPicturePrompts(c, 15);
    expect(new Set(all).size).toBe(15);
    expect(buildTrainingPicturePrompts(c, 2, 3)).toEqual(all.slice(3, 5));
  });

  it("never asks for a face-forward shot in the faceless set", () => {
    const c = { name: "Jack Ash", look: "", neverShow: "", style: "faceless" as const };
    for (const p of buildTrainingPicturePrompts(c, 15)) expect(p).not.toMatch(/facing the camera|close-up of the face/);
  });

  it("carries the cartoon style lock for Sunny Banks", () => {
    const p = buildTrainingPicturePrompts({ name: "Nan", look: "tiny elderly woman", neverShow: "", style: "cartoon" }, 1)[0];
    expect(p).toMatch(/thick black outlines/);
  });
});

describe("one-tap sums", () => {
  it("prices the Siray top-up plus training", () => {
    expect(oneTapCost(0)).toEqual({ sirayPictures: 15, totalUsd: 0.9 });
    expect(oneTapCost(1)).toEqual({ sirayPictures: 14, totalUsd: 0.86 });
    expect(oneTapCost(20)).toEqual({ sirayPictures: 0, totalUsd: 0.3 });
  });

  it("starts from an approved face before the roster thumbnail", () => {
    const r = buildCharacterRoster(stateWith());
    const nova = r["music-video"].find((c) => c.name === "Nova")!;
    expect(startingPictures(nova, null)).toEqual([]);
    const e = { ...buildCharacterLoraEntry("Nova", []), referenceUrl: "https://x.public.blob.vercel-storage.com/f.jpg" };
    expect(startingPictures(nova, e)).toEqual(["https://x.public.blob.vercel-storage.com/f.jpg"]);
  });
});

describe("trainer input by style", () => {
  it("turns face detection off for cartoon and faceless, and captions cartoons as cartoons", () => {
    expect(buildSdxlTrainingInput({ inputImagesUrl: "u", subjectWord: "woman" })).toMatchObject({
      use_face_detection_instead: true,
      caption_prefix: "a photo of TOK woman, ",
    });
    expect(buildSdxlTrainingInput({ inputImagesUrl: "u", subjectWord: "character", style: "cartoon" })).toMatchObject({
      use_face_detection_instead: false,
      caption_prefix: "a cartoon of TOK character, ",
    });
    expect(buildSdxlTrainingInput({ inputImagesUrl: "u", subjectWord: "man", style: "faceless" })).toMatchObject({
      use_face_detection_instead: false,
    });
  });
});

describe("empty hands in training pictures", () => {
  it("strips held props from a look but keeps the rest", () => {
    expect(stripHeldProps("tiny elderly woman, hair bun, round glasses, purple housecoat, teacup, cricket bat")).toBe(
      "tiny elderly woman, hair bun, round glasses, purple housecoat",
    );
    expect(stripHeldProps("big blonde hair, leopard-print top, cigarette, arms folded")).toBe(
      "big blonde hair, leopard-print top",
    );
    expect(stripHeldProps("short purple alien, antennae, teal bucket hat, holding a pair of thongs, bare feet")).toBe(
      "short purple alien, antennae, teal bucket hat, bare feet",
    );
  });

  it("tells Siray to keep hands empty on every training and face prompt", () => {
    const char = { name: "Nan", look: "tiny elderly woman, teacup, cricket bat", neverShow: "", style: "cartoon" as const };
    for (const p of buildTrainingPicturePrompts(char, 15)) {
      expect(p).toContain(EMPTY_HANDS_LINE);
      expect(p).not.toMatch(/cricket bat,|teacup,/);
      expect(p).not.toMatch(/holding a microphone/);
    }
    expect(buildFacePrompt(char)).toContain(EMPTY_HANDS_LINE);
  });

  it("leaves Hans off the grid", () => {
    const roster = buildCharacterRoster(stateWith());
    expect(roster["sunny-banks"].map((c) => c.name)).not.toContain("Hans");
  });
});

describe("Jack's neon blue lips", () => {
  it("asks for the glowing lips in every one of Jack's training pictures and keeps them in his look", () => {
    const jack = buildCharacterRoster(stateWith())["music-video"].find((c) => c.name === "Jack Ash")!;
    const prompts = buildTrainingPicturePrompts(jack, 15);
    expect(prompts).toHaveLength(15);
    for (const p of prompts) {
      expect(p).toContain("neon blue and are clearly visible");
      expect(p.length).toBeLessThanOrEqual(1900);
    }
    expect(stripHeldProps(jack.look)).toMatch(/lips glow a vivid neon blue/);
  });

  it("adds nothing for characters without the lips", () => {
    expect(signatureLine("big blonde hair, leopard-print top")).toBe("");
  });
});

describe("no extra arms", () => {
  it("drops arm poses from the look and asks for exactly two arms", () => {
    expect(stripHeldProps("big blonde hair, crossed arms, denim shorts")).toBe("big blonde hair, denim shorts");
    expect(EMPTY_HANDS_LINE).toMatch(/exactly two arms and two hands/);
    expect(EMPTY_HANDS_LINE).not.toMatch(/relaxed/);
  });
});

