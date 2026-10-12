import type { PackfileOptions } from "./rollup.js";
export interface PackfileVitePlugin {
  name: string;
  apply: "build";
  enforce: "post";
  configResolved(config: { root: string; build: { outDir: string; write?: boolean; ssr?: boolean | string } }): void;
  buildStart(): void;
  buildEnd(error?: Error): void;
  writeBundle(): void;
  closeBundle: { order: "post"; sequential: true; handler(): Promise<void> };
}
export function packfile(options?: PackfileOptions): PackfileVitePlugin;
export default packfile;
