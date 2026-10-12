/// <reference types="node" />
import { CompileOptions } from "./types.js";

/** `fromDirectory` -> `toArchive`. */
export function compileDirectory(
  directoryPath: string,
  options?: CompileOptions
): Promise<Buffer>;

/** `fromArchive` -> write every entry under `outputPath`. */
export function decompileDirectory(
  compiledData: Buffer | ArrayBuffer | Uint8Array,
  outputPath: string,
  compressed?: boolean
): Promise<void>;
