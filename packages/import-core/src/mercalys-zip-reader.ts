import { Inflate } from "fflate";
import { inspectMercalysZip, MercalysZipError } from "./mercalys-zip";
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}
function updateCrc(state: number, bytes: Uint8Array) {
  for (const b of bytes) state = crcTable[(state ^ b) & 255]! ^ (state >>> 8);
  return state;
}
/** Stable in-memory archive snapshot. Extract one declared member at a time; never use paths for filesystem writes. */
export function createMercalysZipReader(input: Uint8Array) {
  const plan = inspectMercalysZip(input),
    bytes = input.slice();
  const files = Object.freeze(
      plan.files.map((entry) => Object.freeze({ ...entry })),
    ),
    entries = new Map(files.map((entry) => [entry.path, entry]));
  return {
    files,
    ignored: Object.freeze([...plan.ignored]),
    async extract(
      path: string,
      options: {
        signal?: { readonly aborted: boolean };
        pause?(): Promise<void>;
      } = {},
    ) {
      const cancel = () => {
        if (options.signal?.aborted) throw new MercalysZipError("CANCELLED");
      };
      cancel();
      const entry = entries.get(path);
      if (!entry) throw new MercalysZipError("INVALID");
      const output = new Uint8Array(entry.uncompressedSize);
      let total = 0,
        state = 0xffffffff,
        finished = false;
      const receive = (chunk: Uint8Array, final: boolean) => {
        cancel();
        if (total + chunk.length > output.length)
          throw new MercalysZipError("LIMIT");
        output.set(chunk, total);
        total += chunk.length;
        state = updateCrc(state, chunk);
        finished = finished || final;
      };
      const decoder =
        entry.compression === 8 ? new Inflate(receive) : undefined;
      try {
        for (
          let offset = 0, tick = 0;
          offset < entry.compressedSize;
          offset += 4096, tick++
        ) {
          cancel();
          const end = Math.min(offset + 4096, entry.compressedSize),
            chunk = bytes.subarray(
              entry.compressedOffset + offset,
              entry.compressedOffset + end,
            ),
            final = end === entry.compressedSize;
          if (decoder) decoder.push(chunk, final);
          else receive(chunk, final);
          if (tick % 16 === 0) {
            await (options.pause?.() ?? Promise.resolve());
            cancel();
          }
        }
      } catch (reason) {
        if (reason instanceof MercalysZipError) throw reason;
        throw new MercalysZipError("CORRUPT");
      }
      cancel();
      if (
        !finished ||
        total !== entry.uncompressedSize ||
        (state ^ 0xffffffff) >>> 0 !== entry.crc32
      )
        throw new MercalysZipError("CORRUPT");
      return output;
    },
  };
}
