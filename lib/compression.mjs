import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import { normalizeGzipHeader } from "./reproducible.mjs";

/** zlib's default level, pinned explicitly so archives stay byte-stable. */
export const DEFAULT_COMPRESSION_LEVEL = 6;

export const compressObject = (buffer, level = DEFAULT_COMPRESSION_LEVEL) => {
  return new Promise((resolve, reject) => {
    gzip(buffer, { level }, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(normalizeGzipHeader(result));
      }
    });
  });
};

export const deCompressObject = promisify(gunzip);
