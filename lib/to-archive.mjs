import cbor from "cbor";
import { compressObject } from "./compression.mjs";

export const toArchive = async (map, opts = {}) => {
  const { compress = true, compressionLevel } = opts;

  // Convert Map to plain object for CBOR
  const obj = {};
  for (const [key, value] of map) {
    obj[key] = {
      data: value.data,
      size: value.size,
      hash: value.hash,
    };
  }

  // NOTE: cbor@9's synchronous `cbor.encode()` (and `encodeOne()`) resolve
  // their promise before the internal stream has finished flushing all
  // chunks under recent Node versions (observed on Node 26), silently
  // returning a truncated buffer (sometimes just the 1-byte map header).
  // `encodeAsync()` correctly awaits full stream completion and must be
  // used instead. See toArchive/fromArchive roundtrip tests.
  let buffer = await cbor.encodeAsync(obj);

  if (compress) {
    buffer = await compressObject(buffer, compressionLevel);
  }

  return buffer;
};
