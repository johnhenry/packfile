import cbor from "cbor";
import { deCompressObject } from "./compression.mjs";
import { normalize, isAbsolute } from "node:path";

const isSafePath = (p) => {
  if (isAbsolute(p)) return false;
  const normalized = normalize(p);
  if (normalized.startsWith("..")) return false;
  if (normalized.includes("\0")) return false;
  return true;
};

export const fromArchive = async (buffer, opts = {}) => {
  const { compressed = true } = opts;

  if (compressed) {
    buffer = await deCompressObject(buffer);
  }

  const obj = await cbor.decode(buffer);
  const files = new Map();

  for (const [key, value] of Object.entries(obj)) {
    if (!isSafePath(key)) continue; // skip unsafe paths silently

    // Handle legacy archives that have type: "content" field
    const data = value.data instanceof Uint8Array
      ? value.data
      : new Uint8Array(value.data);
    files.set(key, {
      data,
      size: value.size ?? data.byteLength,
      hash: value.hash,
    });
  }

  return files;
};
