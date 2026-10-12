import { resolve } from "node:path";
import { exportDirectory } from "./build-node.mjs";
import { archiveFileName } from "./rollup.mjs";

/** Archive the completed output directory, including Vite's publicDir files. */
export function packfile(options = {}) {
  const fileName = archiveFileName(options.fileName);
  let outDir;
  let failed = false;
  let written = false;
  return {
    name: "packfile:vite",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      if (config.build.ssr) throw new Error("packfile: the Vite exporter requires a client build");
      if (config.build.write === false) throw new Error("packfile: the Vite exporter requires build.write; use exportBuild() for in-memory output");
      outDir = resolve(config.root, config.build.outDir);
    },
    buildStart() { failed = false; written = false; },
    buildEnd(error) { failed = Boolean(error); },
    writeBundle() { written = true; },
    closeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        if (!failed && written && outDir) await exportDirectory(outDir, resolve(outDir, fileName));
      },
    },
  };
}
export default packfile;
