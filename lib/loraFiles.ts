/**
 * Character LoRAs (2026-09-29) — the small byte-level helpers the
 * training routes need, written by hand so Deck doesn't pull in a zip,
 * tar or safetensors package for three tiny formats:
 *
 * - `buildStoredZip` — an uncompressed ("stored") zip of the training
 *   pictures, which is what Replicate's SDXL trainer takes as
 *   `input_images`.
 * - `readTarEntries` — Replicate returns the trained weights as one
 *   plain (ustar) `trained_model.tar`.
 * - `convertReplicateSdxlLora` / `convertReplicateSdxlEmbedding` — that
 *   tar holds a diffusers-style LoRA (`…processor.to_k_lora.down.weight`)
 *   and a pivotal-tuning embedding (`text_encoders_0/1`). ComfyUI wants
 *   kohya-style keys (`lora_unet_…_to_k.lora_down.weight`) and an SDXL
 *   embedding with `clip_l` / `clip_g`. Both conversions only rename
 *   keys: the tensor bytes and dtypes are copied through untouched.
 *   This is exactly the conversion the Skye pilot used, whose output
 *   loads in Comfy Cloud (LoraLoader + `embedding:` in the prompt).
 *
 * Pure functions on `Uint8Array`, no Node-only APIs, so they're unit
 * tested directly.
 */

/* ------------------------------------------------------------------ CRC32 */

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------- zip */

export interface ZipInput {
  name: string;
  bytes: Uint8Array;
}

/** An uncompressed zip (method 0). Fine for JPEG/PNG, which don't compress anyway. */
export function buildStoredZip(files: ZipInput[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const size = f.bytes.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, f.bytes);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + size;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concatBytes([...locals, ...centrals, end]);
}

/* -------------------------------------------------------------------- tar */

export interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

/** Reads regular files out of a plain (uncompressed) ustar/GNU tar. */
export function readTarEntries(tar: Uint8Array): TarEntry[] {
  const dec = new TextDecoder();
  const out: TarEntry[] = [];
  let pos = 0;
  let longName: string | null = null;
  while (pos + 512 <= tar.length) {
    const header = tar.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start: number, len: number) => dec.decode(header.subarray(start, start + len)).replace(/\0[\s\S]*$/, "");
    let name = field(0, 100);
    const prefix = field(345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = pos + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    if (type === "L") {
      longName = dec.decode(data).replace(/\0[\s\S]*$/, "");
    } else {
      if (longName) {
        name = longName;
        longName = null;
      }
      if (type === "0" || type === "\0") out.push({ name: name.replace(/^\.\//, ""), bytes: data });
    }
    pos = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

/* ------------------------------------------------------------ safetensors */

export interface SafetensorsTensorInfo {
  dtype: string;
  shape: number[];
  data_offsets: [number, number];
}

export interface ParsedSafetensors {
  metadata: Record<string, string> | null;
  tensors: Record<string, SafetensorsTensorInfo>;
  /** The raw tensor bytes after the header (offsets are relative to this). */
  data: Uint8Array;
}

export function parseSafetensors(bytes: Uint8Array): ParsedSafetensors {
  if (bytes.length < 8) throw new Error("Not a safetensors file (too short).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = Number(view.getBigUint64(0, true));
  if (headerLen <= 0 || 8 + headerLen > bytes.length) throw new Error("Not a safetensors file (bad header length).");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as Record<string, unknown>;
  const metadata = (header.__metadata__ as Record<string, string> | undefined) ?? null;
  const tensors: Record<string, SafetensorsTensorInfo> = {};
  for (const [k, v] of Object.entries(header)) {
    if (k === "__metadata__") continue;
    tensors[k] = v as SafetensorsTensorInfo;
  }
  return { metadata, tensors, data: bytes.subarray(8 + headerLen) };
}

/** Re-writes a safetensors file with renamed keys. Tensor bytes are reused as-is. */
export function renameSafetensorsKeys(
  bytes: Uint8Array,
  rename: (key: string) => string,
  metadata?: Record<string, string>,
): Uint8Array {
  const parsed = parseSafetensors(bytes);
  const header: Record<string, unknown> = {};
  const meta = metadata ?? parsed.metadata;
  if (meta) header.__metadata__ = meta;
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(parsed.tensors)) {
    const nk = rename(k);
    if (seen.has(nk)) throw new Error(`Two tensors would both be called ${nk}.`);
    seen.add(nk);
    header[nk] = v;
  }
  let json = JSON.stringify(header);
  // Pad the header with spaces to an 8-byte boundary, as the format recommends.
  while ((8 + new TextEncoder().encode(json).length) % 8 !== 0) json += " ";
  const headerBytes = new TextEncoder().encode(json);
  const out = new Uint8Array(8 + headerBytes.length + parsed.data.length);
  new DataView(out.buffer).setBigUint64(0, BigInt(headerBytes.length), true);
  out.set(headerBytes, 8);
  out.set(parsed.data, 8 + headerBytes.length);
  return out;
}

const DIFFUSERS_LORA_KEY =
  /^(.*)\.processor\.(to_q|to_k|to_v|to_out)_lora\.(down|up)\.weight$/;

/**
 * `down_blocks.1.attentions.0.transformer_blocks.0.attn1.processor.to_k_lora.down.weight`
 * becomes `lora_unet_down_blocks_1_attentions_0_transformer_blocks_0_attn1_to_k.lora_down.weight`.
 * `to_out` maps to Comfy's `to_out_0`. Throws on any key it doesn't recognise, so
 * a changed trainer output fails loudly instead of producing a LoRA that silently does nothing.
 */
export function comfyKeyForDiffusersLoraKey(key: string): string {
  const m = DIFFUSERS_LORA_KEY.exec(key.replace(/^unet\./, ""));
  if (!m) throw new Error(`Unexpected LoRA tensor name: ${key}`);
  const [, path, proj, dir] = m;
  const target = proj === "to_out" ? "to_out_0" : proj;
  return `lora_unet_${path.replace(/\./g, "_")}_${target}.lora_${dir}.weight`;
}

export function convertReplicateSdxlLora(bytes: Uint8Array): Uint8Array {
  return renameSafetensorsKeys(bytes, comfyKeyForDiffusersLoraKey);
}

export function comfyKeyForPtiEmbeddingKey(key: string): string {
  if (key === "text_encoders_0") return "clip_l";
  if (key === "text_encoders_1") return "clip_g";
  throw new Error(`Unexpected embedding tensor name: ${key}`);
}

export function convertReplicateSdxlEmbedding(bytes: Uint8Array): Uint8Array {
  return renameSafetensorsKeys(bytes, comfyKeyForPtiEmbeddingKey);
}

/** Pulls the two files out of Replicate's `trained_model.tar` and converts both for Comfy. */
export function convertReplicateTrainedTar(tar: Uint8Array): { lora: Uint8Array; embedding: Uint8Array } {
  const entries = readTarEntries(tar);
  const find = (suffix: string) => entries.find((e) => e.name === suffix || e.name.endsWith(`/${suffix}`));
  const lora = find("lora.safetensors");
  const emb = find("embeddings.pti");
  if (!lora) throw new Error("The trained model had no lora.safetensors inside.");
  if (!emb) throw new Error("The trained model had no embeddings.pti inside.");
  return { lora: convertReplicateSdxlLora(lora.bytes), embedding: convertReplicateSdxlEmbedding(emb.bytes) };
}

/* ---------------------------------------------------------------- helpers */

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
