/**
 * Tiny shared `data:` URL decoder — pulled out of
 * `app/api/skidmarks/generate-clip/route.ts` (2026-09-15) so
 * `app/api/skidmarks/sunnybank/generate-speak-beat/route.ts` (Sunny
 * Banks' own Comfy Cloud LTX call, same image-reference shape) can
 * reuse the exact same parsing instead of a second copy.
 */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { bytes: new Uint8Array(Buffer.from(match[2], "base64")), mimeType: match[1] };
  } catch {
    return null;
  }
}
