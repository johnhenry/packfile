import {
  FileInfo,
  CompiledFiles,
  CompileOptions,
  RouterOptions,
  RouteOptions,
} from "./types";

export { FileInfo, CompiledFiles, CompileOptions, RouterOptions, RouteOptions };

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
  options?: RouterOptions
): (path: string, routeOptions?: RouteOptions) => Promise<Response>;
