/**
 * Pure-JS MP3 frame parser + time-range slicer — the piece the LTX/
 * Comfy Cloud Vocal-render path needs that nothing else in this repo
 * provides yet: cutting a `[startSec, endSec)` window out of the
 * attached song's **full, durable** MP3 (`SkidmarksMp3Attachment.audioUrl`
 * — see `lib/mp3Blob.ts`) to send as the driving audio track for the
 * LTX 2.3 IA2V graph this app submits to Comfy Cloud
 * (`lib/comfyCloud.ts`, `workflow/LTX_2.3_IA2V_Cloud.json`), whose
 * `LoadAudio` node (`276`) takes a single audio input. The rendered
 * clip's length is set by that graph's own duration input (node
 * `340:331`), which this route feeds the sliced window's real,
 * frame-aligned length — so the slice still decides how long the
 * render runs, just via an explicit graph input rather than implicitly
 * from the audio's own length.
 *
 * **Frame-aligned cut, not a re-encode.** An MP3 file is a sequence of
 * independently-framed chunks (each with its own 4-byte header
 * encoding version/layer/bitrate/sample-rate — see `parseMp3Frames`);
 * this walks that frame list and concatenates the *raw bytes* of
 * whichever frames overlap the requested time range, rather than
 * decoding to PCM and re-encoding. That means no server-side ffmpeg/
 * decoder dependency (same "no binary needed" constraint
 * `lib/audioCompression.ts` already works under, just for the opposite
 * direction — encoding there, cutting here) and no re-encode quality
 * loss. **The one disclosed trade-off**: MPEG-1 Layer III frames can
 * share a "bit reservoir" with the frame(s) immediately before them, so
 * the very first frame of a cut that didn't start at a real frame
 * boundary in the original stream can decode with a brief (a few ms)
 * audible artifact at its very start — an accepted, real trade-off
 * (same "disclosed, not silent" spirit as `lib/audioCompression.ts`'s
 * fidelity/size trade-off), not a bug being hidden.
 *
 * **Never invents a slice it can't actually produce.** If the source
 * bytes don't parse as any valid MP3 frames at all (corrupt file,
 * unsupported container), or the requested time range doesn't overlap
 * any parsed frame, `sliceMp3ToTimeRange` returns an honest `{ error }`
 * — the caller (`app/api/skidmarks/generate-clip/route.ts`'s Comfy/LTX
 * branch) surfaces that verbatim rather than sending Comfy Cloud a
 * bogus/empty audio file and pretending the request was fine.
 *
 * **Never hard-errors over its own outward-rounding, either** — see
 * `sliceMp3ToTimeRange`'s own doc comment for the optional
 * `maxDurationSec` parameter, which trims an over-long slice back down
 * to a hard technical ceiling instead of failing a request that was
 * already correctly clamped by its caller.
 *
 * Only MPEG-1/2/2.5 **Layer III** frames are recognized (this app only
 * ever produces/attaches MP3s — see `SkidmarksMp3Attachment`'s own
 * `.mp3`-only surface); a Layer I/II frame sync is treated the same as
 * any other non-sync byte (skipped, not matched) since nothing in this
 * feature generates those.
 */

/** One parsed MP3 frame's position/timing within the original file.
 * `startSec`/`durationSec` are exact, derived from the frame's own
 * sample-rate + samples-per-frame (1152 for MPEG-1, 576 for MPEG-2/2.5
 * Layer III) — not estimated from an average bitrate, so cumulative
 * timing stays accurate across a VBR file where different frames use
 * different bitrates. */
export interface Mp3Frame {
  /** Byte offset of this frame's own 4-byte header within the original
   * buffer. */
  offset: number;
  /** Total length of this frame (header + payload) in bytes. */
  length: number;
  startSec: number;
  durationSec: number;
}

const SYNC_BYTE_0 = 0xff;

/** MPEG version, decoded from a header's bits 20-19 (within byte 1):
 * `00` MPEG2.5, `01` reserved, `10` MPEG2, `11` MPEG1 — the two real
 * versions this parser cares about map to distinct bitrate/sample-rate
 * tables and a distinct samples-per-frame constant below. */
type MpegVersion = "1" | "2" | "2.5";

/** kbps, index 0 (free-format, unsupported here) through 14; index 15
 * is reserved/invalid. Per the MPEG audio frame header spec — not
 * looked up from a runtime table generator, since this table never
 * changes. */
const MPEG1_LAYER3_BITRATES_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1,
] as const;
const MPEG2_LAYER3_BITRATES_KBPS = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1,
] as const;

const SAMPLE_RATES_HZ: Record<MpegVersion, readonly [number, number, number, number]> = {
  "1": [44100, 48000, 32000, -1],
  "2": [22050, 24000, 16000, -1],
  "2.5": [11025, 12000, 8000, -1],
};

function decodeVersion(versionBits: number): MpegVersion | null {
  if (versionBits === 0b11) return "1";
  if (versionBits === 0b10) return "2";
  if (versionBits === 0b00) return "2.5";
  return null; // 0b01 is reserved
}

/**
 * Reads one candidate frame header at `offset` and returns its length/
 * duration if it's a structurally valid MPEG-1/2/2.5 Layer III header
 * — `null` (never throws) for anything else, so `parseMp3Frames` can
 * treat an invalid/foreign byte sequence as "not a frame here, try the
 * next byte" uniformly.
 */
function readFrameHeader(bytes: Uint8Array, offset: number): { length: number; durationSec: number } | null {
  if (offset + 4 > bytes.length) return null;
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];

  // Sync word: 11 bits, all 1 — byte0 all 1s, byte1's top 3 bits all 1.
  if (b0 !== SYNC_BYTE_0 || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits !== 0b01) return null; // only Layer III — see module doc comment

  const version = decodeVersion(versionBits);
  if (!version) return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;

  const sampleRate = SAMPLE_RATES_HZ[version][sampleRateIndex];
  if (sampleRate <= 0) return null;

  const bitrateTable = version === "1" ? MPEG1_LAYER3_BITRATES_KBPS : MPEG2_LAYER3_BITRATES_KBPS;
  const bitrateKbps = bitrateTable[bitrateIndex];
  if (!bitrateKbps || bitrateKbps <= 0) return null;

  const samplesPerFrame = version === "1" ? 1152 : 576;
  const coefficient = version === "1" ? 144 : 72;
  const length = Math.floor((coefficient * bitrateKbps * 1000) / sampleRate) + padding;
  if (length < 4) return null;

  return { length, durationSec: samplesPerFrame / sampleRate };
}

/** Skips a leading ID3v2 tag (`ID3` magic + a 4-byte synchsafe size at
 * offset 6-9), if present, so frame scanning starts at the real first
 * MPEG frame instead of tripping over tag bytes that happen to contain
 * a byte sequence resembling a frame sync. Returns `0` (no skip) for
 * anything else — including a file with no tag at all, which is the
 * common case for this app's own generated/attached files. */
export function skipLeadingId3v2Tag(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  const size =
    ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size;
}

/**
 * Walks `bytes` from just past any leading ID3v2 tag, collecting every
 * structurally valid Layer III frame it finds in order. A byte that
 * doesn't start a valid frame (tag padding, an ID3v1/APEv2 trailer, a
 * non-MP3 byte) is simply skipped one byte at a time until the next
 * real sync — the same resynchronization strategy real MP3 players and
 * splitters use, so a stray non-frame byte sequence in the middle of
 * an otherwise-valid file doesn't abort parsing early.
 */
export function parseMp3Frames(bytes: Uint8Array): Mp3Frame[] {
  const frames: Mp3Frame[] = [];
  let offset = skipLeadingId3v2Tag(bytes);
  let cumulativeSec = 0;

  while (offset + 4 <= bytes.length) {
    const header = readFrameHeader(bytes, offset);
    if (!header || offset + header.length > bytes.length) {
      offset += 1;
      continue;
    }
    frames.push({ offset, length: header.length, startSec: cumulativeSec, durationSec: header.durationSec });
    cumulativeSec += header.durationSec;
    offset += header.length;
  }

  return frames;
}

export type Mp3SliceOutcome =
  | { ok: true; bytes: Uint8Array; actualStartSec: number; actualEndSec: number }
  | { ok: false; error: string };

/**
 * Cuts `[startSec, endSec)` out of a full MP3's raw bytes, frame-aligned
 * (see this module's doc comment). The returned range
 * (`actualStartSec`/`actualEndSec`) is the *real* boundary of whichever
 * frames were selected — always covers the requested range fully
 * (rounds outward to the nearest frame boundary, never inward), but
 * won't match `startSec`/`endSec` exactly to the millisecond; callers
 * that need to report a real duration to Stuart (the confirm step's
 * dollar estimate, `durationSec` sent to Comfy Cloud) should use this
 * actual range, not the originally requested one.
 *
 * **`maxDurationSec` (optional) — trims, never errors, on overshoot.**
 * A real live-QA'd bug: a caller that clamps its *requested* window to
 * exactly a hard technical ceiling (e.g. Comfy Cloud LTX's driving-
 * audio ceiling, `MAX_LTX_CLIP_DURATION_SEC` in
 * `app/api/skidmarks/generate-clip/route.ts`/`lib/clipGeneration.ts`)
 * could still get a slice back that's a hair *over* that ceiling —
 * because this function always rounds **outward** to fully cover the
 * request, a request for exactly the ceiling can round out to a few
 * milliseconds past it. Stuart hit exactly this at the old 20s ceiling:
 * the error text read `"This plate's audio slice is 20.0s"` (one-
 * decimal display rounding) while the real, unrounded value had
 * already failed a strict `> 20` check. Per this feature's "never a
 * hard error over an arithmetic/rounding technicality — always clamp"
 * rule, passing `maxDurationSec` here drops whole frames off the *end*
 * of the selection (never the start — the requested window's own start
 * point stays intact) until the actual range fits, instead of the
 * caller having to reject an otherwise-valid, already-correctly-
 * clamped request. Never trims below a single frame, so this can't
 * produce an empty slice even if `maxDurationSec` itself is smaller
 * than one frame's own duration (a pathological caller error, not a
 * real scenario for this feature's own `[5, 30]`s range).
 */
export function sliceMp3ToTimeRange(
  bytes: Uint8Array,
  startSec: number,
  endSec: number,
  maxDurationSec?: number
): Mp3SliceOutcome {
  const frames = parseMp3Frames(bytes);
  if (frames.length === 0) {
    return {
      ok: false,
      error: "Could not find any valid MP3 audio frames in this file — it may be corrupt or not really an MP3.",
    };
  }

  const clampedStart = Math.max(0, startSec);
  const clampedEnd = Math.max(clampedStart, endSec);
  const selected = frames.filter((f) => f.startSec < clampedEnd && f.startSec + f.durationSec > clampedStart);
  if (selected.length === 0) {
    return {
      ok: false,
      error:
        `No audio frames fall inside the requested ${clampedStart.toFixed(1)}s-${clampedEnd.toFixed(1)}s ` +
        "range — the attached audio may be shorter than this clip's time range.",
    };
  }

  let trimmed = selected;
  if (typeof maxDurationSec === "number" && Number.isFinite(maxDurationSec)) {
    while (trimmed.length > 1) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if (last.startSec + last.durationSec - first.startSec <= maxDurationSec) break;
      trimmed = trimmed.slice(0, -1);
    }
  }

  const totalLength = trimmed.reduce((sum, f) => sum + f.length, 0);
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const frame of trimmed) {
    out.set(bytes.subarray(frame.offset, frame.offset + frame.length), pos);
    pos += frame.length;
  }

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return { ok: true, bytes: out, actualStartSec: first.startSec, actualEndSec: last.startSec + last.durationSec };
}
