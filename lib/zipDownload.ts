/**
 * Dependency-free ZIP writer — "store" method only (method `0`, no
 * DEFLATE compression). That's a deliberate choice, not a shortcut:
 * every entry this feature ever zips is already a compressed MP4
 * (`components/SkidmarksClipRender.tsx`'s "Download all rendered
 * clips" bundle, see `lib/clipRenders.ts`), so re-compressing would
 * spend real CPU time in Stuart's browser for close to zero size
 * benefit. Building this by hand instead of adding a zip dependency
 * keeps the "cheap" bundle-download option (per the task's own "if zip
 * of a clip's renders is cheap, add it" framing) genuinely cheap: no
 * new runtime dependency, no bundle-size cost beyond this one small
 * file.
 *
 * **Verified against a real, independent `unzip` extraction in
 * `zipDownload.test.ts`** — not just parsed back by a reader this same
 * file also wrote. A hand-rolled writer that only checks its own
 * matching reader can't catch a shared misunderstanding of the ZIP
 * format; shelling out to the system's actual `unzip` binary (present
 * in this sandbox) to test integrity (`unzip -t`) and byte-for-byte
 * extract each entry is the only way this was actually confirmed to
 * work, not just assumed to.
 */

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** Standard CRC-32 (the same polynomial ZIP, gzip, and PNG all use) —
 * every entry's local *and* central-directory header needs this value,
 * and `unzip -t` recomputes it on extraction to confirm the entry
 * wasn't corrupted, so getting this wrong would fail that real
 * integrity check, not just this module's own tests. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dateEncoded = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dateEncoded };
}

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeUint16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

/**
 * Builds a minimal, valid ZIP archive from a flat list of entries — a
 * local file header + raw bytes per entry (method `0`, "store"), then
 * one central directory record per entry, then a single
 * end-of-central-directory record. No zip64 extension (fine here: a
 * handful of few-megabyte video clips is nowhere near the 4GB total /
 * 65,535 entry limits that would actually require it).
 */
export function buildStoreZip(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    writeUint32LE(lv, 0, 0x04034b50);
    writeUint16LE(lv, 4, 20); // version needed to extract
    writeUint16LE(lv, 6, 0); // general purpose bit flag
    writeUint16LE(lv, 8, 0); // compression method: 0 = store
    writeUint16LE(lv, 10, time);
    writeUint16LE(lv, 12, date);
    writeUint32LE(lv, 14, crc);
    writeUint32LE(lv, 18, size); // compressed size (== uncompressed, store method)
    writeUint32LE(lv, 22, size); // uncompressed size
    writeUint16LE(lv, 26, nameBytes.length);
    writeUint16LE(lv, 28, 0); // extra field length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    writeUint32LE(cv, 0, 0x02014b50);
    writeUint16LE(cv, 4, 20); // version made by
    writeUint16LE(cv, 6, 20); // version needed to extract
    writeUint16LE(cv, 8, 0); // general purpose bit flag
    writeUint16LE(cv, 10, 0); // compression method
    writeUint16LE(cv, 12, time);
    writeUint16LE(cv, 14, date);
    writeUint32LE(cv, 16, crc);
    writeUint32LE(cv, 20, size);
    writeUint32LE(cv, 24, size);
    writeUint16LE(cv, 28, nameBytes.length);
    writeUint16LE(cv, 30, 0); // extra field length
    writeUint16LE(cv, 32, 0); // file comment length
    writeUint16LE(cv, 34, 0); // disk number start
    writeUint16LE(cv, 36, 0); // internal file attributes
    writeUint32LE(cv, 38, 0); // external file attributes
    writeUint32LE(cv, 42, offset); // relative offset of this entry's local header
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);

    offset += localHeader.length + entry.data.length;
  }

  const centralDirSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralDirOffset = offset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  writeUint32LE(ev, 0, 0x06054b50);
  writeUint16LE(ev, 4, 0); // number of this disk
  writeUint16LE(ev, 6, 0); // disk with the start of the central directory
  writeUint16LE(ev, 8, entries.length); // entries on this disk
  writeUint16LE(ev, 10, entries.length); // total entries
  writeUint32LE(ev, 12, centralDirSize);
  writeUint32LE(ev, 16, centralDirOffset);
  writeUint16LE(ev, 20, 0); // comment length

  const result = new Uint8Array(offset + centralDirSize + eocd.length);
  let pos = 0;
  for (const part of localParts) {
    result.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    result.set(part, pos);
    pos += part.length;
  }
  result.set(eocd, pos);

  return result;
}
