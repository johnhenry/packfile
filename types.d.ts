import {
  FileInfo,
  CompiledFiles,
  CompileOptions,
  RouterOptions,
} from "./types";

export { FileInfo, CompiledFiles, CompileOptions, RouterOptions };

export function compileDirectory(
  directoryPath: string,
  options?: CompileOptions
): Promise<Buffer>;
export function decompileDirectory(
  compiledData: Buffer,
  outputPath: string,
  compressed?: boolean
): Promise<void>;
export function createRouter(
  compiledData: Buffer,
  compressed?: boolean
): (path: string, options?: RouterOptions) => Promise<Response>;
