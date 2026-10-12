import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fromDirectory } from "./from-directory.mjs";
import { exportFiles } from "./build.mjs";

/** Export a completed build directory, excluding the destination on rebuilds. */
export async function exportDirectory(directory, destination) {
  const root = resolve(directory);
  const target = resolve(destination);
  if (!target.endsWith(".wbn")) throw new TypeError("export destination must end in .wbn");
  const excluded = relative(root, target).split(sep).join("/");
  const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const map = await fromDirectory(root, { ignorePatterns: [`^${escaped}$`] });
  const result = await exportFiles(Object.fromEntries(Array.from(map, ([path, entry]) => [path, entry.data])));
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, result.archive, { flag: "wx" });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  return result;
}
