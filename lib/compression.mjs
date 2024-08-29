import { gzip, gunzip, constants } from "zlib";
import { promisify } from "util";

export const compressObject = (buffer, level = constants.Z_DEFAULT_COMPRESSION) => {
  return new Promise((resolve, reject) => {
    gzip(buffer, { level }, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};

export const deCompressObject = promisify(gunzip);
