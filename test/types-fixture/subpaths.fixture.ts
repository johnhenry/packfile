// Issue #7: every `exports` subpath must ship types.
import { withCache } from "@johnhenry/packfile/cache";
import { compileDirectory, decompileDirectory } from "@johnhenry/packfile/compat";
import { hashBuffer, hashStream } from "@johnhenry/packfile/hash";
import { compressObject, deCompressObject } from "@johnhenry/packfile/compression";
import { toWebBundle, fromWebBundle, createWebBundleRouter } from "@johnhenry/packfile/web-bundle";
import { createBlobPreview } from "@johnhenry/packfile/blob-preview";
import { fromFiles, toFiles, toArchive, fromArchive, InvalidPathError, type FileEntry } from "@johnhenry/packfile";

async function check(): Promise<void> {
  const handler = withCache((_req: Request) => new Response("x"), { weak: true });
  const res: Response = await handler(new Request("http://x/"));
  const buf: Buffer = await compileDirectory("./d", { compress: true });
  await decompileDirectory(buf, "./out", true);
  const h: string = hashBuffer(new Uint8Array(1));
  void hashStream;
  const gz: Buffer = await compressObject(new Uint8Array(1), 6);
  const raw: Buffer = await deCompressObject(gz);
  const map: Map<string, FileEntry> = await fromFiles({ "a.txt": "a" });
  const wb: Uint8Array = toWebBundle(map, { baseURL: "https://x.example/" });
  const back: Map<string, FileEntry> = fromWebBundle(wb, { baseURL: "https://x.example/" });
  const archive: Buffer = await toArchive(back, { compressed: false });
  await fromArchive(archive, { compress: false });
  const files: Record<string, string | Uint8Array> = toFiles(map);
  void [res, h, raw, files, createWebBundleRouter, createBlobPreview, InvalidPathError];
  const preview = await createBlobPreview(map, { onUnresolvedReference: (i) => i.reason });
  preview.dispose();
}
void check;
