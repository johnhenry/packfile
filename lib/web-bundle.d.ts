import { FileEntry } from "../types.js";

export type ToWebBundleOptions = {
  /** Absolute URL each relative path is resolved against (required). */
  baseURL: string;
  primaryURL?: string;
  /** Default `"b2"`. */
  formatVersion?: "b1" | "b2";
  mimeTypes?: Record<string, string>;
  /** Extra response headers per path. */
  headers?: (path: string) => Record<string, string>;
};

export type FromWebBundleOptions = {
  /** If given, exchange URLs are mapped back to `baseURL`-relative paths and
   * unsafe or foreign entries are skipped. Without it, keys are full URLs. */
  baseURL?: string;
};

export type WebBundleRouterOptions = {
  baseURL: string;
  alias?: Record<string, string>;
  tryExtensions?: string[];
  fallback?: (input: string | Request, ctx?: unknown) => Response | Promise<Response>;
};

export function toWebBundle(
  map: Map<string, FileEntry>,
  options: ToWebBundleOptions
): Uint8Array;

export function fromWebBundle(
  buffer: Uint8Array,
  options?: FromWebBundleOptions
): Map<string, FileEntry>;

/** Serves a parsed `wbn.Bundle`'s own baked-in status/headers verbatim. The
 * `bundle` parameter is the `wbn` package's `Bundle` class. */
export function createWebBundleRouter(
  bundle: { urls: string[]; getResponse(url: string): { status: number; headers: Record<string, string>; body: Uint8Array } },
  options: WebBundleRouterOptions
): ((input: string | Request, ctx?: unknown) => Promise<Response>) & {
  fetch: (input: string | Request, ctx?: unknown) => Promise<Response>;
};
