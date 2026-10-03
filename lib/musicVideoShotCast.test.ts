import { describe, expect, it } from "vitest";
import { castTagNamesIn, prepareMusicVideoExtraCast, resolveMusicVideoShotCast } from "./musicVideoShotCast";
import { buildPlateGenerationRequest } from "./plateGeneration";
import { buildClipGenerationRequest } from "./clipGeneration";
import type { SkidmarksMember } from "./skidmarks";

/** Music video plates and clips through the shared multi-cast helper (2026-10-03). */

const member = (o: Partial<SkidmarksMember>): SkidmarksMember => ({ id: o.name ?? "m", name: "", emoji: "", looks: [], ...o });
const NOVA = member({ name: "Nova", role: "Vocals", avatarImage: "data:image/jpeg;base64,nova" });
const RUSTY = member({ name: "Rusty", role: "Drums", avatarImage: "data:image/jpeg;base64,rusty" });
const MO = member({ name: "Mo", role: "Bass" });
const BAND = [NOVA, RUSTY, MO];

describe("resolveMusicVideoShotCast", () => {
  it("the vocalist alone stays alone (old plate)", () => {
    const shot = resolveMusicVideoShotCast({ members: BAND, vocalist: NOVA, shotPrompt: "Nova sings at the mic" });
    expect(shot.cast.isMulti).toBe(false);
    expect(shot.extras).toEqual([]);
  });

  it("a member named in the shot, or a [Cast:] tag, joins the vocalist; positions come from the text", () => {
    const shot = resolveMusicVideoShotCast({
      members: BAND,
      vocalist: NOVA,
      shotPrompt: "NOVA sings centre; RUSTY on the left behind his kit",
    });
    expect(shot.cast.names).toEqual(["Nova", "Rusty"]);
    expect(shot.vocalistPosition).toBe("centre");
    expect(shot.extras).toEqual([{ name: "Rusty", avatarImage: "data:image/jpeg;base64,rusty", position: "on the left" }]);
    expect(castTagNamesIn("[Cast: Rusty & Mo] wide")).toEqual(["Rusty", "Mo"]);
    const tagged = resolveMusicVideoShotCast({ members: BAND, vocalist: NOVA, shotPrompt: "[Cast: Rusty] wide shot" });
    expect(tagged.cast.names).toEqual(["Nova", "Rusty"]);
  });

  it("a member with no picture refuses the plate before billing", async () => {
    const shot = resolveMusicVideoShotCast({ members: BAND, vocalist: NOVA, shotPrompt: "Nova and Mo share the mic" });
    expect(shot.cast.missingPicture).toEqual(["Mo"]);
    const prepared = await prepareMusicVideoExtraCast(shot, async (s) => s);
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.message).toContain("Mo has no picture yet");
  });
});

describe("buildPlateGenerationRequest with extraCast", () => {
  const base = {
    shotPrompt: "Nova sings centre; Rusty on the left",
    vocal: true,
    model: "ltx-lipsync" as const,
    bandName: "Solar Rebel",
    vocalist: NOVA,
    locationStillDataUrl: "data:image/jpeg;base64,place",
  };

  it("no extras = byte for byte the old request", () => {
    expect(buildPlateGenerationRequest({ ...base, extraCast: [] })).toEqual(buildPlateGenerationRequest(base));
  });

  it("place, vocalist, then each extra; exactly N people, labelled, no 'One person only'", () => {
    const req = buildPlateGenerationRequest({
      ...base,
      vocalistPosition: "centre",
      extraCast: [{ name: "Rusty", avatarImage: "data:image/jpeg;base64,rusty", position: "on the left" }],
    });
    const refs = req.referenceImageDataUrls;
    expect(refs).toEqual(["data:image/jpeg;base64,place", "data:image/jpeg;base64,nova", "data:image/jpeg;base64,rusty"]);
    expect(req.prompt).toContain("Exactly 2 people in frame: Nova and Rusty.");
    expect(req.prompt).toContain("Image 2 (<IMAGE_1>) is Nova, centre");
    expect(req.prompt).toContain("Image 3 (<IMAGE_2>) is Rusty, on the left");
    expect(req.prompt).not.toContain("One person only");
  });

  it("never more than five pictures in one request", () => {
    const extras = ["A", "B", "C", "D", "E"].map((n) => ({ name: n, avatarImage: `data:image/jpeg;base64,${n}` }));
    const req = buildPlateGenerationRequest({ ...base, extraCast: extras });
    expect(req.referenceImageDataUrls).toHaveLength(5);
  });
});

describe("buildClipGenerationRequest with bandMembers", () => {
  const base = {
    vocal: true,
    bandName: "Solar Rebel",
    plateStillDataUrl: "data:image/jpeg;base64,plate",
    durationSec: 5,
    vocalist: NOVA,
  };

  it("a vocal clip naming another member: the vocalist sings, the other listens, mouth closed (positive text only)", () => {
    const { prompt } = buildClipGenerationRequest({
      ...base,
      shotPrompt: "Nova sings centre; Rusty on the left",
      bandMembers: BAND,
    });
    expect(prompt).toContain("Nova, centre, is the only one speaking, mouth and jaw in clear sync with the audio.");
    expect(prompt).toContain("Rusty, on the left, listens silently, lips pressed together, mouth closed the whole clip.");
  });

  it("one person, or no bandMembers passed: prompt unchanged", () => {
    const shotPrompt = "Nova sings at the mic";
    const without = buildClipGenerationRequest({ ...base, shotPrompt });
    const withBand = buildClipGenerationRequest({ ...base, shotPrompt, bandMembers: BAND });
    expect(withBand).toEqual(without);
    expect(without.prompt).not.toContain("listens silently");
  });
});
