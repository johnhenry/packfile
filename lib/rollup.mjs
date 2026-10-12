import { exportBuild } from "./build.mjs";
import { checkPath } from "./path-safety.mjs";

export function archiveFileName(fileName = "app.wbn") {
  if (checkPath(fileName) || !fileName.endsWith(".wbn")) {
    throw new TypeError("packfile: fileName must be a safe relative path ending in .wbn");
  }
  return fileName;
}

/** Put this plugin last, after plugins that emit or transform build assets. */
export function packfile(options = {}) {
  const fileName = archiveFileName(options.fileName);
  return {
    name: "packfile",
    async generateBundle(_options, bundle) {
      if (Object.hasOwn(bundle, fileName)) throw new Error(`packfile: output already contains ${fileName}`);
      const { archive } = await exportBuild(Object.values(bundle));
      this.emitFile({ type: "asset", fileName, source: archive });
    },
  };
}
export default packfile;
