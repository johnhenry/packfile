// Issue #7: `./compat`, `./cache`, `./hash`, `./compression`, `./web-bundle`
// each resolve to their own hand-written `.d.ts`, and those declarations
// match the runtime exports exactly (the key lists below are mirrored by
// test/subpath-exports.test.mjs, which checks the runtime side).
import { Readable } from "node:stream";
import * as wbn from "wbn";
import * as compat from "@johnhenry/packfile/compat";
import * as cache from "@johnhenry/packfile/cache";
import * as hash from "@johnhenry/packfile/hash";
import * as compression from "@johnhenry/packfile/compression";
import * as webBundle from "@johnhenry/packfile/web-bundle";
import { decompileDirectory as rootDecompileDirectory, type FileEntry, type SkippedEntry } from "@johnhenry/packfile";
import type { WithCacheOptions } from "@johnhenry/packfile/cache";
import type {
  ToWebBundleOptions,
  FromWebBundleOptions,
  WebBundleRouterOptions,
} from "@johnhenry/packfile/web-bundle";

// Exact export-name sets (fails in both directions: a missing or an extra name).
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertTrue = <T extends true>(): void => {};
assertTrue<Equal<keyof typeof compat, "compileDirectory" | "decompileDirectory">>();
assertTrue<Equal<keyof typeof cache, "withCache">>();
assertTrue<Equal<keyof typeof hash, "hashBuffer" | "hashStream">>();
assertTrue<Equal<keyof typeof compression, "DEFAULT_COMPRESSION_LEVEL" | "compressObject" | "deCompressObject">>();
assertTrue<Equal<keyof typeof webBundle, "toWebBundle" | "fromWebBundle" | "createWebBundleRouter">>();

async function checkCompat(): Promise<void> {
  const archive: Buffer = await compat.compileDirectory("./site", {
    compress: false,
    compressionLevel: 9,
    ignorePatterns: ["*.map"],
    maxFileSize: 1024,
  });
  await compat.compileDirectory("./site");
  await compat.decompileDirectory(archive, "./out");
  await compat.decompileDirectory(new Uint8Array(archive), "./out", "auto");
  await compat.decompileDirectory(new ArrayBuffer(0), "./out", false);
  await rootDecompileDirectory(archive, "./out", "auto");
  // @ts-expect-error only true, false or "auto"
  await compat.decompileDirectory(archive, "./out", "gzip");
  // @ts-expect-error compressionLevel is a number
  await compat.compileDirectory("./site", { compressionLevel: "max" });
}

async function checkCache(): Promise<void> {
  const options: WithCacheOptions = { cacheControl: "no-cache", weak: false };
  const plain = cache.withCache((req) => new Response(req.url), options);
  const r1: Response = await plain(new Request("http://x/"));
  const withCtx = cache.withCache<{ user: string }>(async (_req, ctx) => new Response(ctx?.user), {});
  const r2: Response = await withCtx(new Request("http://x/"), { user: "a" });
  // @ts-expect-error ctx type is enforced
  await withCtx(new Request("http://x/"), { user: 1 });
  // @ts-expect-error weak is a boolean
  cache.withCache(() => new Response(), { weak: "yes" });
  void [r1, r2];
}

async function checkHash(): Promise<void> {
  const a: string = hash.hashBuffer(new Uint8Array([1, 2]));
  const b: string = hash.hashBuffer(Buffer.from("x"));
  const c: string = await hash.hashStream(Readable.from(["x"]));
  // @ts-expect-error hashStream returns a Promise
  const d: string = hash.hashStream(Readable.from(["x"]));
  void [a, b, c, d];
}

async function checkCompression(): Promise<void> {
  const level: 6 = compression.DEFAULT_COMPRESSION_LEVEL;
  const gz: Buffer = await compression.compressObject(new Uint8Array(1));
  await compression.compressObject(Buffer.from("x"), level);
  const raw: Buffer = await compression.deCompressObject(gz);
  // @ts-expect-error level is a number
  await compression.compressObject(gz, "best");
  void raw;
}

function checkWebBundle(map: Map<string, FileEntry>): void {
  const toOpts: ToWebBundleOptions = {
    baseURL: "isolated-app://abc/",
    primaryURL: "isolated-app://abc/index.html",
    formatVersion: "b1",
    mimeTypes: { ".wasm": "application/wasm" },
    headers: (path) => ({ "X-Path": path }),
  };
  const bytes: Uint8Array = webBundle.toWebBundle(map, toOpts);
  const fromOpts: FromWebBundleOptions = {
    baseURL: "isolated-app://abc/",
    onSkip: (s: SkippedEntry) => void [s.url, s.reason],
  };
  const back: Map<string, FileEntry> = webBundle.fromWebBundle(bytes, fromOpts);
  const byURL: Map<string, FileEntry> = webBundle.fromWebBundle(bytes);

  // A real `wbn.Bundle` satisfies the `bundle` parameter.
  const routerOpts: WebBundleRouterOptions = {
    baseURL: "isolated-app://abc/",
    alias: { "/": "/index.html" },
    tryExtensions: [".html"],
    fallback: () => new Response("nope", { status: 404 }),
  };
  const router = webBundle.createWebBundleRouter(new wbn.Bundle(bytes), routerOpts);
  const p1: Promise<Response> = router("/index.html");
  const p2: Promise<Response> = router.fetch(new Request("isolated-app://abc/"), { any: "ctx" });

  // @ts-expect-error baseURL is required
  webBundle.toWebBundle(map, {});
  // @ts-expect-error only "b1" | "b2"
  webBundle.toWebBundle(map, { baseURL: "https://x/", formatVersion: "b3" });
  // @ts-expect-error baseURL is required
  webBundle.createWebBundleRouter(new wbn.Bundle(bytes), {});
  void [back, byURL, p1, p2];
}

void [checkCompat, checkCache, checkHash, checkCompression, checkWebBundle];
