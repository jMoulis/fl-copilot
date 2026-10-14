import {
  MAX_MERCALYS_BATCH_BYTES,
  MAX_MERCALYS_BATCH_FILES,
  MAX_MERCALYS_BATCH_FILE_BYTES,
} from "@fl-copilot/domain";
export class MercalysZipError extends Error {
  constructor(
    readonly code:
      "INVALID" | "LIMIT" | "UNSAFE_PATH" | "UNSUPPORTED" | "DUPLICATE_PATH",
  ) {
    super(`MERCALYS_ZIP_${code}`);
    this.name = "MercalysZipError";
  }
}
export interface MercalysZipEntry {
  path: string;
  compression: 0 | 8;
  compressedOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
}
/** ZIP32 metadata preflight only. Actual decompressed length/CRC must still be verified by extraction.
 * Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT */
export function inspectMercalysZip(bytes: Uint8Array) {
  const fail = (code: MercalysZipError["code"]): never => {
    throw new MercalysZipError(code);
  };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset: number, size: number) => {
    if (offset < 0 || size < 0 || offset + size > bytes.length) fail("INVALID");
  };
  const u16 = (p: number) => {
    range(p, 2);
    return v.getUint16(p, true);
  };
  const u32 = (p: number) => {
    range(p, 4);
    return v.getUint32(p, true);
  };
  if (bytes.length > MAX_MERCALYS_BATCH_BYTES) fail("LIMIT");
  if (bytes.length < 22) fail("INVALID");
  let footer = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) {
      footer = p;
      break;
    }
  if (footer < 0 || u16(footer + 4) || u16(footer + 6)) fail("UNSUPPORTED");
  const count = u16(footer + 10),
    dirSize = u32(footer + 12),
    dirStart = u32(footer + 16);
  if (count === 65535 || dirSize === 0xffffffff || dirStart === 0xffffffff)
    fail("UNSUPPORTED");
  if (!count || count > 200) fail("LIMIT");
  if (u16(footer + 8) !== count || dirStart + dirSize !== footer)
    fail("INVALID");
  const names = new Set<string>(),
    files: MercalysZipEntry[] = [],
    ignored: string[] = [],
    spans: Array<{ start: number; end: number }> = [];
  let cursor = dirStart,
    expanded = 0;
  const extra = (offset: number, size: number) => {
    range(offset, size);
    const end = offset + size;
    while (offset < end) {
      if (offset + 4 > end) fail("INVALID");
      const tag = u16(offset),
        n = u16(offset + 2);
      offset += 4;
      if (offset + n > end) fail("INVALID");
      if (tag === 1) fail("UNSUPPORTED");
      offset += n;
    }
  };
  for (let n = 0; n < count; n++) {
    range(cursor, 46);
    if (u32(cursor) !== 0x02014b50) fail("INVALID");
    const flags = u16(cursor + 8),
      method = u16(cursor + 10),
      crc32 = u32(cursor + 16),
      compressedSize = u32(cursor + 20),
      uncompressedSize = u32(cursor + 24),
      nameSize = u16(cursor + 28),
      extraSize = u16(cursor + 30),
      commentSize = u16(cursor + 32),
      local = u32(cursor + 42);
    if (
      flags & 0x2041 ||
      u16(cursor + 34) ||
      ![0, 8].includes(method) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      local === 0xffffffff
    )
      fail("UNSUPPORTED");
    const end = cursor + 46 + nameSize + extraSize + commentSize;
    if (end > footer) fail("INVALID");
    if (!nameSize || nameSize > 960) fail("UNSAFE_PATH");
    const raw = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
    let path: string;
    if (flags & 0x800) {
      try {
        path = decodeURIComponent(
          Array.from(raw, (b) => `%${b.toString(16).padStart(2, "0")}`).join(
            "",
          ),
        );
      } catch {
        fail("UNSUPPORTED");
      }
    } else {
      if (raw.some((b) => b > 127)) fail("UNSUPPORTED");
      path = Array.from(raw, (b) => String.fromCharCode(b)).join("");
    }
    const directory = path!.endsWith("/"),
      parts = (directory ? path!.slice(0, -1) : path!).split("/");
    if (
      path!.length > 240 ||
      path!.startsWith("/") ||
      /[\\:]/.test(path!) ||
      Array.from(path!).some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      ) ||
      parts.some((p) => !p || p === "." || p === "..")
    )
      fail("UNSAFE_PATH");
    const key = path!.normalize("NFC").toLowerCase();
    if (names.has(key)) fail("DUPLICATE_PATH");
    names.add(key);
    const kind = (u32(cursor + 38) >>> 16) & 0xf000;
    if (kind && kind !== 0x8000 && kind !== 0x4000) fail("UNSUPPORTED");
    if ((kind === 0x4000 && !directory) || (kind === 0x8000 && directory))
      fail("INVALID");
    if (uncompressedSize > MAX_MERCALYS_BATCH_FILE_BYTES) fail("LIMIT");
    expanded += uncompressedSize;
    if (expanded > MAX_MERCALYS_BATCH_BYTES) fail("LIMIT");
    if (directory && (uncompressedSize || compressedSize)) fail("INVALID");
    if (
      !directory &&
      (!uncompressedSize ||
        !compressedSize ||
        uncompressedSize / compressedSize > 100)
    )
      fail("LIMIT");
    if (method === 0 && compressedSize !== uncompressedSize) fail("INVALID");
    extra(cursor + 46 + nameSize, extraSize);
    range(local, 30);
    if (
      local >= dirStart ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method
    )
      fail("INVALID");
    const localNameSize = u16(local + 26),
      localExtraSize = u16(local + 28);
    if (localNameSize !== nameSize) fail("INVALID");
    range(local + 30, localNameSize);
    if (raw.some((b, i) => bytes[local + 30 + i] !== b)) fail("INVALID");
    extra(local + 30 + localNameSize, localExtraSize);
    const compressedOffset = local + 30 + localNameSize + localExtraSize;
    let localEnd = compressedOffset + compressedSize;
    if (localEnd > dirStart) fail("INVALID");
    if (flags & 8) {
      let descriptor = localEnd;
      if (u32(descriptor) === 0x08074b50) descriptor += 4;
      if (
        u32(descriptor) !== crc32 ||
        u32(descriptor + 4) !== compressedSize ||
        u32(descriptor + 8) !== uncompressedSize
      )
        fail("INVALID");
      localEnd = descriptor + 12;
    } else if (
      u32(local + 14) !== crc32 ||
      u32(local + 18) !== compressedSize ||
      u32(local + 22) !== uncompressedSize
    )
      fail("INVALID");
    if (localEnd > dirStart) fail("INVALID");
    spans.push({ start: local, end: localEnd });
    if (!directory) {
      if (parts[0] === "__MACOSX" || parts.at(-1)!.startsWith("._"))
        ignored.push(path!);
      else {
        if (!path!.toLowerCase().endsWith(".xlsx")) fail("UNSUPPORTED");
        files.push({
          path: path!,
          compression: method as 0 | 8,
          compressedOffset,
          compressedSize,
          uncompressedSize,
          crc32,
        });
      }
    }
    cursor = end;
  }
  if (cursor !== footer || !files.length) fail("INVALID");
  if (files.length > MAX_MERCALYS_BATCH_FILES) fail("LIMIT");
  spans.sort((a, b) => a.start - b.start);
  let last = 0;
  for (const span of spans) {
    if (span.start !== last) fail("INVALID");
    last = span.end;
  }
  if (last !== dirStart) fail("INVALID");
  return { files, ignored, expandedBytes: expanded };
}
