import type { BuildChunk, BuildAsset } from "./build.js";
export interface PackfileOptions { fileName?: string }
export interface PackfilePlugin {
  name: string;
  generateBundle(this: { emitFile(asset: BuildAsset): string }, options: unknown,
    bundle: Record<string, BuildChunk | BuildAsset>): Promise<void>;
}
export function packfile(options?: PackfileOptions): PackfilePlugin;
export default packfile;
