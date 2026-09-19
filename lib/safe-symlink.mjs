import { relative, isAbsolute } from "node:path";

/**
 * Returns true if `target` (an absolute, already-resolved path) is equal to
 * or nested inside `root` (an absolute, already-resolved path).
 *
 * Used to keep symlink resolution from escaping the directory being walked:
 * a symlink inside a directory can point anywhere on disk, and following it
 * blindly would let `fromDirectory`/`fromDirectoryLazy` read and package up
 * arbitrary files from outside the target tree.
 */
export const isWithinRoot = (root, target) => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
