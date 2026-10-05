/**
 * Reject blank / empty / nearly-uniform stills (2026-10-05).
 * Cast remakes from prompt were saving grey empty frames; never save those.
 * Works on raw bytes (server) via a light scan — no sharp required.
 */

export const BLANK_IMAGE_ERROR =
  "That picture came back blank (empty or a flat colour). Nothing was saved — try again with a clearer description, or add a reference picture.";

/** Smallest real still we accept (bytes). Below this is empty/corrupt. */
export const MIN_STILL_BYTES = 2_000;

/**
 * True when the buffer is empty, tiny, or a near-uniform JPEG/PNG
 * (almost every sampled byte the same) — the shape Siray/xAI sometimes
 * return when a prompt is refused. Conservative: a real photo almost
 * never trips this; a solid grey/black/white plate does.
 */
export function isBlankImageBytes(bytes: ArrayBuffer | Uint8Array): boolean {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.byteLength < MIN_STILL_BYTES) return true;
  // Sample evenly across the file (compressed: similar neighbouring
  // bytes in a flat plate; a real photo's entropy is much higher).
  const samples = 256;
  const step = Math.max(1, Math.floor(buf.byteLength / samples));
  const counts = new Map<number, number>();
  let n = 0;
  for (let i = 0; i < buf.byteLength && n < samples; i += step, n++) {
    const b = buf[i]!;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  if (n < 32) return true;
  let top = 0;
  for (const c of counts.values()) if (c > top) top = c;
  // ≥92% of samples the same byte → flat / empty plate.
  return top / n >= 0.92;
}

/** Browser: decode a data:/blob: URL and decide if it's blank. */
export async function isBlankImageUrl(src: string): Promise<boolean> {
  try {
    const res = await fetch(src);
    if (!res.ok) return true;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (isBlankImageBytes(buf)) return true;
    // Also check decoded pixels — a tiny compressed JPEG of a flat grey
    // can still have byte entropy from headers/tables.
    if (typeof Image === "undefined" || typeof document === "undefined") return false;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(new Blob([buf]));
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onerror = () => reject(new Error("decode failed"));
      i.onload = () => resolve(i);
      i.src = dataUrl;
    });
    if (!(img.naturalWidth > 8 && img.naturalHeight > 8)) return true;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
    r /= n; g /= n; b /= n;
    let mad = 0;
    for (let i = 0; i < data.length; i += 4) {
      mad += Math.abs(data[i]! - r) + Math.abs(data[i + 1]! - g) + Math.abs(data[i + 2]! - b);
    }
    mad /= n * 3;
    // Flat grey/black/white plate: mean absolute deviation under ~6.
    return mad < 6;
  } catch {
    return true;
  }
}
