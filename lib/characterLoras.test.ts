import { describe, expect, it } from "vitest";
import {
  CHARACTER_LORA_MIN_IMAGES,
  SKYE_SEED,
  buildCharacterLoraEntry,
  characterLorasHaveUserContent,
  comfyImportedName,
  comfyPromptSnippet,
  emptyCharacterLorasState,
  hfResolveLink,
  isAllowedTrainingImageUrl,
  loraFileNames,
  nextTrainingVersion,
  normalizeCharacterLorasState,
  replicateModelName,
  slugifyCharacterName,
  trainBlocker,
  uniqueSlug,
} from "./characterLoras";
import { buildSdxlTrainingInput } from "./replicateTrainer";

const BLOB = "https://abc123.public.blob.vercel-storage.com/skidmarks/member-photos/x.jpg";

describe("names and links", () => {
  it("slugifies names into file-safe stems", () => {
    expect(slugifyCharacterName("Jack Ash")).toBe("jack_ash");
    expect(slugifyCharacterName("  Big Sexy!! ")).toBe("big_sexy");
    expect(slugifyCharacterName("Zoë")).toBe("zoe");
    expect(slugifyCharacterName("***")).toBe("character");
  });

  it("never reuses a slug another card has", () => {
    expect(uniqueSlug("Jack", ["jack", "jack_2"])).toBe("jack_3");
  });

  it("builds the exact names the Skye pilot used in Hugging Face and Comfy", () => {
    expect(loraFileNames("skye", 1)).toEqual({
      loraFile: "skye_v1.safetensors",
      embeddingFile: "skye_v1_emb.safetensors",
    });
    expect(hfResolveLink("comfybear71/deck-loras", "skye_v1.safetensors")).toBe(
      "https://huggingface.co/comfybear71/deck-loras/resolve/main/skye_v1.safetensors",
    );
    expect(comfyImportedName("comfybear71/deck-loras", "skye_v1.safetensors")).toBe(
      "comfybear71__deck-loras__skye_v1.safetensors",
    );
    expect(comfyPromptSnippet(SKYE_SEED)).toBe("a photo of embedding:comfybear71__deck-loras__skye_v1_emb woman, ");
    expect(replicateModelName("jack_ash")).toBe("deck-lora-jack-ash");
  });

  it("bumps the version on every retrain", () => {
    expect(nextTrainingVersion(SKYE_SEED)).toBe(2);
    expect(nextTrainingVersion(buildCharacterLoraEntry("New", []))).toBe(1);
  });
});

describe("training rules", () => {
  const withImages = (n: number) => ({
    ...buildCharacterLoraEntry("Nova", []),
    trainingImageUrls: Array.from({ length: n }, () => BLOB),
  });

  it("needs enough pictures and the made-up adult tick", () => {
    expect(trainBlocker(withImages(CHARACTER_LORA_MIN_IMAGES - 1))).toBe("images-few");
    expect(trainBlocker(withImages(CHARACTER_LORA_MIN_IMAGES))).toBe("confirm");
    expect(trainBlocker({ ...withImages(12), fictionalAdultConfirmed: true })).toBeNull();
    expect(trainBlocker({ ...withImages(12), fictionalAdultConfirmed: true, status: "training" })).toBe("busy");
    expect(trainBlocker({ ...withImages(12), fictionalAdultConfirmed: true, name: " " })).toBe("name");
  });

  it("only lets the server fetch Deck's own Blob pictures", () => {
    expect(isAllowedTrainingImageUrl(BLOB)).toBe(true);
    expect(isAllowedTrainingImageUrl("data:image/jpeg;base64,AAAA")).toBe(true);
    expect(isAllowedTrainingImageUrl("http://abc.public.blob.vercel-storage.com/x.jpg")).toBe(false);
    expect(isAllowedTrainingImageUrl("https://public.blob.vercel-storage.com/x.jpg")).toBe(false);
    expect(isAllowedTrainingImageUrl("https://abc.public.blob.vercel-storage.com.evil.test/x.jpg")).toBe(false);
    expect(isAllowedTrainingImageUrl("https://user@abc.public.blob.vercel-storage.com/x.jpg")).toBe(false);
    expect(isAllowedTrainingImageUrl("https://169.254.169.254/latest")).toBe(false);
  });

  it("sends Replicate the same settings the Skye pilot trained with", () => {
    expect(buildSdxlTrainingInput({ inputImagesUrl: "https://api.replicate.com/v1/files/x", subjectWord: "Woman" })).toEqual({
      input_images: "https://api.replicate.com/v1/files/x",
      input_images_filetype: "zip",
      token_string: "TOK",
      caption_prefix: "a photo of TOK woman, ",
      use_face_detection_instead: true,
      is_lora: true,
      resolution: 1024,
      max_train_steps: 1000,
      seed: 42,
    });
  });
});

describe("state", () => {
  it("starts with Skye already trained and imported", () => {
    const s = emptyCharacterLorasState();
    expect(s.characters).toHaveLength(1);
    expect(s.characters[0].name).toBe("Skye");
    expect(s.characters[0].status).toBe("ready");
    expect(characterLorasHaveUserContent(s)).toBe(false);
    expect(characterLorasHaveUserContent(null)).toBe(false);
  });

  it("counts adding or removing a character as a real edit", () => {
    expect(characterLorasHaveUserContent({ characters: [] })).toBe(true);
    const s = emptyCharacterLorasState();
    expect(characterLorasHaveUserContent({ characters: [...s.characters, buildCharacterLoraEntry("Jack", ["skye"])] })).toBe(
      true,
    );
  });

  it("normalizes saved rows and drops junk", () => {
    expect(normalizeCharacterLorasState(undefined)).toBeNull();
    expect(normalizeCharacterLorasState({ characters: "nope" })).toBeNull();
    const n = normalizeCharacterLorasState({
      characters: [
        { id: "a", name: "Jack Ash", status: "weird", trainingImageUrls: [BLOB, "javascript:alert(1)", 5] },
        { name: "no id" },
      ],
    });
    expect(n?.characters).toHaveLength(1);
    expect(n?.characters[0].slug).toBe("jack_ash");
    expect(n?.characters[0].status).toBe("draft");
    expect(n?.characters[0].trainingImageUrls).toEqual([BLOB]);
    expect(n?.characters[0].fictionalAdultConfirmed).toBe(false);
  });
});
