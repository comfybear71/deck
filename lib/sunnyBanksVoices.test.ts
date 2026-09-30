import { describe, expect, it } from "vitest";
import { normalizeCharacterLoraEntry, normalizeElevenLabsVoiceId } from "./characterLoras";
import type { SkidmarksState } from "./skidmarks";
import { SUNNY_BANKS_CAST } from "./sunnyBanks";
import {
  parseSunnyBanksCharacterCard,
  resolveSpeakBeatCharacter,
  resolveSunnyBanksSpeaker,
  sunnyBanksSpeakerList,
  sunnyBanksSpeakerNames,
  sunnyBanksSpeakerRequestExtras,
} from "./sunnyBanksVoices";

/**
 * Voice ids on character cards (2026-09-30): Hans speaks once his card
 * has a voice, a built-in's card voice wins, and a character added with
 * "+" becomes a speaker once voiced.
 */

const HANS_PIC = "https://abc123.public.blob.vercel-storage.com/deck/sunnybank/characters/arsgl/pictures/arsgl-picture-01.jpg";
const VOICE_A = "21m00Tcm4TlvDq8ikWAM";
const VOICE_B = "AZnzlk1XvdvUeBnXmlld";

function card(name: string, sourceKey: string, voiceId?: string) {
  return { id: `clora_${name.toLowerCase()}`, name, slug: name.toLowerCase(), sourceKey, status: "idle", trainingImageUrls: [], version: 1, createdAt: "2026-09-30T00:00:00.000Z", ...(voiceId ? { voiceId } : {}) };
}

function state(cards: unknown[], extras: unknown[] = []): SkidmarksState {
  return {
    bands: [],
    session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null },
    removedSeedBandIds: [],
    rosterExtras: { "music-video": [], "sunny-banks": extras, "adult-shorts": [] },
    characterLoras: { characters: cards },
  } as unknown as SkidmarksState;
}

const hansExtra = { id: "chr_hans", name: "Hans", look: "tall German tourist", pictureUrls: [HANS_PIC], fictionalAdultConfirmed: true, createdAt: 1 };
const kevExtra = { id: "chr_kev", name: "Kev", look: "", pictureUrls: [HANS_PIC.replace("arsgl", "kev")], fictionalAdultConfirmed: true, createdAt: 1 };

describe("normalizeElevenLabsVoiceId", () => {
  it("keeps a pasted id (trimmed) and refuses anything else", () => {
    expect(normalizeElevenLabsVoiceId(`  ${VOICE_A} `)).toBe(VOICE_A);
    expect(normalizeElevenLabsVoiceId("short")).toBeNull();
    expect(normalizeElevenLabsVoiceId("has space inside id")).toBeNull();
    expect(normalizeElevenLabsVoiceId("https://elevenlabs.io/x")).toBeNull();
    expect(normalizeElevenLabsVoiceId(42)).toBeNull();
  });

  it("is kept on a card only when valid, so older cards save the same as before", () => {
    const base = card("Shazza", "sb:shazza");
    expect(normalizeCharacterLoraEntry({ ...base, voiceId: VOICE_A })?.voiceId).toBe(VOICE_A);
    expect(normalizeCharacterLoraEntry({ ...base, voiceId: "nope!" })).not.toHaveProperty("voiceId");
    expect(normalizeCharacterLoraEntry(base)).not.toHaveProperty("voiceId");
  });
});

describe("Sunny Banks speakers from cards", () => {
  it("Hans speaks with his card's voice and uses the added face's picture", () => {
    expect(resolveSunnyBanksSpeaker("Hans", state([]))?.voiceId).toBeFalsy();
    const s = state([card("Hans", "sbx:chr_hans", VOICE_A)], [hansExtra]);
    const hans = resolveSunnyBanksSpeaker("hans", s)!;
    expect(hans).toMatchObject({ name: SUNNY_BANKS_CAST.Hans?.name ?? "Hans", voiceId: VOICE_A, heroImage: HANS_PIC });
    expect(sunnyBanksSpeakerRequestExtras(hans)).toEqual({ voiceId: VOICE_A, characterCard: { name: hans.name, look: hans.look, heroImageUrl: HANS_PIC } });
  });

  it("a built-in's card voice wins over the hard-coded one; no card, no change", () => {
    const shazza = SUNNY_BANKS_CAST.Shazza;
    expect(resolveSunnyBanksSpeaker("Shazza", state([]))).toBe(shazza);
    const s = state([card("Shazza", "sb:shazza", VOICE_B)]);
    const lock = resolveSunnyBanksSpeaker("Shazza", s)!;
    expect(lock.voiceId).toBe(VOICE_B);
    expect(lock.heroImage).toBe(shazza.heroImage);
    expect(sunnyBanksSpeakerRequestExtras(lock)).toEqual({ voiceId: VOICE_B });
    expect(sunnyBanksSpeakerRequestExtras(shazza)).toEqual({});
  });

  it("an added character becomes a speaker once voiced, and not before", () => {
    const unvoiced = state([card("Kev", "sbx:chr_kev")], [kevExtra]);
    expect(resolveSunnyBanksSpeaker("Kev", unvoiced)).toBeUndefined();
    expect(sunnyBanksSpeakerNames(unvoiced)).not.toContain("Kev");

    const voiced = state([card("Kev", "sbx:chr_kev", VOICE_A)], [kevExtra]);
    const kev = resolveSunnyBanksSpeaker("kev", voiced)!;
    expect(kev).toMatchObject({ name: "Kev", voiceId: VOICE_A, look: "as in their picture", heroImage: kevExtra.pictureUrls[0] });
    expect(sunnyBanksSpeakerNames(voiced)).toContain("Kev");
    expect(sunnyBanksSpeakerList(voiced).map((c) => c.name)).toContain("Kev");
    // Longest first, so "Ranger Bazza" beats "Bazza"-style prefixes.
    const names = sunnyBanksSpeakerNames(voiced);
    expect([...names].sort((a, b) => b.length - a.length)).toEqual(names);
    // A Music video or Shorts card with a voice is not a Sunny Banks speaker.
    expect(resolveSunnyBanksSpeaker("Skye", state([card("Skye", "asx:skye", VOICE_A)]))).toBeUndefined();
  });
});

describe("speak-beat route helpers", () => {
  it("only takes Deck Blob pictures from the request", () => {
    expect(parseSunnyBanksCharacterCard({ name: " Kev ", look: "x", heroImageUrl: HANS_PIC })).toEqual({ name: "Kev", look: "x", heroImageUrl: HANS_PIC });
    expect(parseSunnyBanksCharacterCard({ name: "Kev", heroImageUrl: "https://evil.example/a.jpg" })).toEqual({ name: "Kev", look: "" });
    expect(parseSunnyBanksCharacterCard({ name: "Kev", heroImageUrl: "data:image/png;base64,AAAA" })).toEqual({ name: "Kev", look: "" });
    expect(parseSunnyBanksCharacterCard({ name: "" })).toBeNull();
    expect(parseSunnyBanksCharacterCard("Kev")).toBeNull();
  });

  it("resolves the built-in, Hans with his card picture, and an added character only with a voice", () => {
    expect(resolveSpeakBeatCharacter("Shazza", null, null)).toBe(SUNNY_BANKS_CAST.Shazza);
    const hans = resolveSpeakBeatCharacter("Hans", { name: "Hans", look: "", heroImageUrl: HANS_PIC }, VOICE_A);
    expect(hans?.heroImage).toBe(HANS_PIC);
    expect(resolveSpeakBeatCharacter("Kev", { name: "Kev", look: "" }, null)).toBeUndefined();
    expect(resolveSpeakBeatCharacter("Kev", { name: "Kev", look: "" }, VOICE_A)).toMatchObject({ name: "Kev", voiceId: VOICE_A, look: "as in their picture" });
    expect(resolveSpeakBeatCharacter("Kev", { name: "Other", look: "" }, VOICE_A)).toBeUndefined();
  });
});
