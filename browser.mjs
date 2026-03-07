import { deCompressObject, compressObject } from "./lib/compression.browser.mjs";
export { createRouter } from "./lib/create-router.mjs";

const isSafePath = (p) => {
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.includes("..")) return false;
  if (p.includes("\0")) return false;
  return true;
};

export const fromArchive = async (buffer, opts = {}) => {
  const { compressed = true, decode } = opts;

  if (compressed) {
    buffer = await deCompressObject(buffer);
  }

  // Use provided decoder or global cbor
  const decoder = decode || (typeof globalThis.cbor !== "undefined" && globalThis.cbor.decode);
  if (!decoder) {
    throw new Error(
      "No CBOR decoder available. Pass options.decode or load a CBOR library globally."
    );
  }

  const obj = await decoder(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
  const files = new Map();

  for (const [key, value] of Object.entries(obj)) {
    if (!isSafePath(key)) continue;

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

export const toArchive = async (map, opts = {}) => {
  const { compressed = true, encode } = opts;

  const encoder = encode || (typeof globalThis.cbor !== "undefined" && globalThis.cbor.encode);
  if (!encoder) {
    throw new Error(
      "No CBOR encoder available. Pass options.encode or load a CBOR library globally."
    );
  }

  const obj = {};
  for (const [key, value] of map) {
    obj[key] = {
      data: value.data,
      size: value.size,
      hash: value.hash,
    };
  }

  let buffer = await encoder(obj);
  if (compressed) {
    buffer = await compressObject(buffer);
  }
  return buffer;
};
