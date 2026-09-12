/**
 * One-off manual verification harness — NOT part of `npm run test`.
 *
 * `lib/audioCompression.test.ts` only covers the pure math (no real
 * `AudioContext`/`OfflineAudioContext` exists in this repo's Node-based
 * vitest environment). This script mocks just enough of the Web Audio
 * API for `compressAudioForTranscription` (the real, unmodified function
 * from `lib/audioCompression.ts`) to run end to end — including the
 * *real* `@breezystack/lamejs` encoder, not a stub — against synthetic
 * audio of a few realistic song lengths, so the actual byte-size math
 * this fix depends on is checked against real encoder output, not just
 * asserted.
 *
 * Run with: `npx vite-node scripts/manual-verify-audio-compression.ts`
 */
import {
  compressAudioForTranscription,
  VERCEL_BODY_LIMIT_BYTES,
  DIRECT_UPLOAD_SAFE_BYTES,
} from "../lib/audioCompression";

class FakeAudioBuffer {
  constructor(
    public readonly duration: number,
    public readonly sampleRate: number,
    public readonly numberOfChannels: number,
    private readonly length: number
  ) {}
  getChannelData(channel: number): Float32Array {
    const data = new Float32Array(this.length);
    // A cheap two-tone synthetic stand-in for "some real audio" — not
    // silence, so it exercises the real encoder's normal code path.
    const freq = channel === 0 ? 220 : 330;
    for (let i = 0; i < this.length; i++) {
      data[i] = Math.sin((2 * Math.PI * freq * i) / this.sampleRate) * 0.5;
    }
    return data;
  }
}

class FakeAudioContext {
  async decodeAudioData(_arrayBuffer: ArrayBuffer): Promise<FakeAudioBuffer> {
    // The duration/rate are stashed on the ArrayBuffer by the fake
    // `File.arrayBuffer()` below so this mock can hand back an
    // `AudioBuffer` shaped like whatever the "attached file" claims to
    // be, without needing a real MP3 decoder in this environment.
    const meta = (_arrayBuffer as unknown as { __meta: { durationSec: number } }).__meta;
    const sampleRate = 44100;
    return new FakeAudioBuffer(meta.durationSec, sampleRate, 2, Math.round(meta.durationSec * sampleRate));
  }
  async close() {}
}

class FakeOfflineAudioContext {
  constructor(
    public readonly numberOfChannels: number,
    public readonly length: number,
    public readonly sampleRate: number
  ) {}
  createBufferSource(): {
    buffer: FakeAudioBuffer | null;
    connect: () => void;
    start: () => void;
  } {
    const holder: { buffer: FakeAudioBuffer | null } = { buffer: null };
    return {
      get buffer() {
        return holder.buffer;
      },
      set buffer(b: FakeAudioBuffer | null) {
        holder.buffer = b;
      },
      connect() {},
      start() {},
    };
  }
  async startRendering() {
    const length = this.length;
    const sampleRate = this.sampleRate;
    return {
      getChannelData: () => {
        // Simulates real downmix+resample: same synthetic content,
        // re-rendered directly at the target rate/length instead of
        // literally resampling — good enough to exercise the real
        // pipeline's plumbing and the real encoder's byte output.
        const data = new Float32Array(length);
        for (let i = 0; i < length; i++) {
          data[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5;
        }
        return data;
      },
    };
  }
}

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
(globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext =
  FakeOfflineAudioContext;

function fakeFile(sizeBytes: number, durationSec: number, name: string): File {
  const bytes = new Uint8Array(sizeBytes);
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  const file = new File([blob], name, { type: "audio/mpeg" });
  const realArrayBuffer = file.arrayBuffer.bind(file);
  file.arrayBuffer = async () => {
    const buf = await realArrayBuffer();
    (buf as unknown as { __meta: unknown }).__meta = { durationSec };
    return buf;
  };
  return file;
}

async function main() {
  const cases: Array<{ label: string; sizeMb: number; durationSec: number }> = [
    { label: "tiny test tone (already small)", sizeMb: 0.2, durationSec: 3 },
    { label: 'Jack Ash "Talking To Concrete" (~4:16, 6MB)', sizeMb: 6, durationSec: 256 },
    { label: "a longer ~6:30 track at 8MB", sizeMb: 8, durationSec: 390 },
    { label: "a pathological 90-minute file", sizeMb: 60, durationSec: 90 * 60 },
  ];

  let allOk = true;
  for (const c of cases) {
    const file = fakeFile(Math.round(c.sizeMb * 1024 * 1024), c.durationSec, "test.mp3");
    const outcome = await compressAudioForTranscription(file);
    let ok = false;
    let detail = "";
    if (outcome.kind === "unchanged") {
      ok = file.size <= DIRECT_UPLOAD_SAFE_BYTES;
      detail = `unchanged, ${(outcome.file.size / 1024 / 1024).toFixed(2)}MB`;
    } else if (outcome.kind === "compressed") {
      ok = outcome.compressedBytes < VERCEL_BODY_LIMIT_BYTES;
      detail = `compressed ${outcome.bitrateKbps}kbps -> ${(outcome.compressedBytes / 1024 / 1024).toFixed(2)}MB (limit ${(VERCEL_BODY_LIMIT_BYTES / 1024 / 1024).toFixed(1)}MB)`;
    } else if (outcome.kind === "too_long") {
      ok = true; // expected for the pathological case
      detail = `too_long: ${outcome.message}`;
    } else {
      detail = `FAILED: ${outcome.message}`;
    }
    console.log(`${ok ? "OK  " : "FAIL"} ${c.label}: ${detail}`);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.error("\nManual verification FAILED.");
    process.exit(1);
  }
  console.log("\nManual verification passed.");
}

void main();
