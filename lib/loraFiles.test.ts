import { describe, expect, it } from "vitest";
import {
  buildStoredZip,
  comfyKeyForDiffusersLoraKey,
  comfyKeyForPtiEmbeddingKey,
  concatBytes,
  convertReplicateTrainedTar,
  crc32,
  parseSafetensors,
  readTarEntries,
  renameSafetensorsKeys,
} from "./loraFiles";

function safetensors(tensors: Record<string, { dtype: string; shape: number[]; bytes: number[] }>): Uint8Array {
  const header: Record<string, unknown> = {};
  const data: number[] = [];
  for (const [k, t] of Object.entries(tensors)) {
    header[k] = { dtype: t.dtype, shape: t.shape, data_offsets: [data.length, data.length + t.bytes.length] };
    data.push(...t.bytes);
  }
  const h = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + h.length + data.length);
  new DataView(out.buffer).setBigUint64(0, BigInt(h.length), true);
  out.set(h, 8);
  out.set(data, 8 + h.length);
  return out;
}

function tarFile(name: string, bytes: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  header.set(enc.encode(name), 0);
  header.set(enc.encode(bytes.length.toString(8).padStart(11, "0")), 124);
  header[156] = 48; // "0" regular file
  const padded = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  padded.set(bytes);
  return concatBytes([header, padded]);
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("buildStoredZip", () => {
  it("writes local headers, a central directory and an end record", () => {
    const zip = buildStoredZip([
      { name: "a.jpg", bytes: new Uint8Array([1, 2, 3]) },
      { name: "b.png", bytes: new Uint8Array([4, 5]) },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cdOffset = v.getUint32(end + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    // First file's stored bytes sit right after its 30-byte header + name.
    expect(Array.from(zip.subarray(35, 38))).toEqual([1, 2, 3]);
  });
});

describe("readTarEntries", () => {
  it("reads regular files and stops at the zero blocks", () => {
    const tar = concatBytes([
      tarFile("lora.safetensors", new Uint8Array([9, 9])),
      tarFile("special_params.json", new TextEncoder().encode('{"TOK":"<s0><s1>"}')),
      new Uint8Array(1024),
    ]);
    const entries = readTarEntries(tar);
    expect(entries.map((e) => e.name)).toEqual(["lora.safetensors", "special_params.json"]);
    expect(Array.from(entries[0].bytes)).toEqual([9, 9]);
  });
});

describe("LoRA key conversion", () => {
  it("maps diffusers attention-processor keys to Comfy's kohya names", () => {
    expect(
      comfyKeyForDiffusersLoraKey("down_blocks.1.attentions.0.transformer_blocks.0.attn1.processor.to_k_lora.down.weight"),
    ).toBe("lora_unet_down_blocks_1_attentions_0_transformer_blocks_0_attn1_to_k.lora_down.weight");
    expect(comfyKeyForDiffusersLoraKey("mid_block.attentions.0.transformer_blocks.3.attn2.processor.to_out_lora.up.weight")).toBe(
      "lora_unet_mid_block_attentions_0_transformer_blocks_3_attn2_to_out_0.lora_up.weight",
    );
  });

  it("refuses a key it doesn't know rather than making a LoRA that does nothing", () => {
    expect(() => comfyKeyForDiffusersLoraKey("text_model.encoder.layers.0.q_proj.weight")).toThrow();
  });

  it("maps the two pivotal-tuning embeddings to clip_l / clip_g", () => {
    expect(comfyKeyForPtiEmbeddingKey("text_encoders_0")).toBe("clip_l");
    expect(comfyKeyForPtiEmbeddingKey("text_encoders_1")).toBe("clip_g");
    expect(() => comfyKeyForPtiEmbeddingKey("text_encoders_2")).toThrow();
  });
});

describe("renameSafetensorsKeys", () => {
  it("renames keys, keeps dtypes/shapes/bytes and pads the header to 8 bytes", () => {
    const src = safetensors({ a: { dtype: "BF16", shape: [1, 2], bytes: [1, 2, 3, 4] } });
    const out = renameSafetensorsKeys(src, (k) => `x_${k}`);
    const view = new DataView(out.buffer);
    expect((8 + Number(view.getBigUint64(0, true))) % 8).toBe(0);
    const p = parseSafetensors(out);
    expect(Object.keys(p.tensors)).toEqual(["x_a"]);
    expect(p.tensors.x_a.dtype).toBe("BF16");
    expect(Array.from(p.data.subarray(...p.tensors.x_a.data_offsets))).toEqual([1, 2, 3, 4]);
  });
});

describe("convertReplicateTrainedTar", () => {
  it("pulls both files out of trained_model.tar and converts them for Comfy", () => {
    const lora = safetensors({
      "up_blocks.0.attentions.1.transformer_blocks.2.attn1.processor.to_v_lora.down.weight": {
        dtype: "F32",
        shape: [1],
        bytes: [0, 0, 128, 63],
      },
    });
    const emb = safetensors({
      text_encoders_0: { dtype: "BF16", shape: [1], bytes: [1, 2] },
      text_encoders_1: { dtype: "BF16", shape: [1], bytes: [3, 4] },
    });
    const tar = concatBytes([tarFile("lora.safetensors", lora), tarFile("embeddings.pti", emb), new Uint8Array(1024)]);
    const out = convertReplicateTrainedTar(tar);
    expect(Object.keys(parseSafetensors(out.lora).tensors)).toEqual([
      "lora_unet_up_blocks_0_attentions_1_transformer_blocks_2_attn1_to_v.lora_down.weight",
    ]);
    expect(Object.keys(parseSafetensors(out.embedding).tensors).sort()).toEqual(["clip_g", "clip_l"]);
  });

  it("says plainly when the tar is missing a file", () => {
    const tar = concatBytes([tarFile("embeddings.pti", new Uint8Array(8)), new Uint8Array(1024)]);
    expect(() => convertReplicateTrainedTar(tar)).toThrow(/lora\.safetensors/);
  });
});
