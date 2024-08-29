import { gzip, gunzip } from "zlib";
import { promisify } from "util";
export const compressObject = promisify(gzip);
export const deCompressObject = promisify(gunzip);
