/**
 * Internal (not in package.json `exports`): turns a parsed `wbn.Bundle`
 * into a `FilesMap`. Shared by `fromWebBundle()` (`lib/web-bundle.mjs`) and
 * the Node `fromArchive()` (`lib/from-archive.mjs`), which parses the bundle
 * itself so it can read the primary URL without decoding twice. The
 * browser reader (`lib/safe-archive.mjs`) has its own loop because it
 * hashes with async Web Crypto and can throw instead of skipping.
 */
import { hashBuffer } from "./hash.mjs";
import { urlToPath } from "./path-safety.mjs";

/**
 * @param {{ urls: string[], getResponse(url: string): { body: Uint8Array } }} bundle
 * @param {{ baseURL?: string, onSkip?: (skipped: { url: string, reason: string }) => void }} options
 */
export const bundleToFiles = (bundle, { baseURL, onSkip } = {}) => {
  if (onSkip !== undefined && typeof onSkip !== "function") {
    throw new TypeError("packfile: onSkip must be a function");
  }
  const files = new Map();
  for (const url of bundle.urls) {
    let relativeKey = url;
    if (baseURL) {
      // Unsafe entries (decoded traversal, backslash, NUL, absolute,
      // foreign origin, query/fragment, collisions) are skipped, not fatal;
      // `onSkip` makes each one observable.
      const result = urlToPath(url, baseURL);
      const reason = result.reason ?? (files.has(result.path) ? "duplicate" : null);
      if (reason) {
        onSkip?.({ url, reason });
        continue;
      }
      relativeKey = result.path;
    }
    const response = bundle.getResponse(url);
    files.set(relativeKey, {
      data: response.body,
      size: response.body.byteLength,
      hash: hashBuffer(response.body),
    });
  }
  return files;
};
