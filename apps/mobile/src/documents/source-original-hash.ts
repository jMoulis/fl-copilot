import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
/** Runtime-neutral SHA-256; matches the remote Node digest, without an Expo module. */
export function sourceOriginalHash(value: string | Uint8Array) {
  return `sha256:${bytesToHex(sha256(typeof value === "string" ? utf8ToBytes(value) : value))}`;
}
