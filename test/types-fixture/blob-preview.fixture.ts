// Regression fixture for https://github.com/johnhenry/packfile/issues/5:
// `@johnhenry/packfile/blob-preview` had no `types` condition and no
// `.d.ts` on disk, so this import used to fail with TS7016 under
// `moduleResolution: "nodenext"`/`"bundler"`. Imported by the *published
// package name*, matching how a real consumer would depend on it.
import {
  createBlobPreview,
  type FilesMap,
  type BlobPreview,
} from "@johnhenry/packfile/blob-preview";

async function assertBlobPreviewTypes(): Promise<void> {
  const files: FilesMap = new Map([
    ["index.html", { data: new Uint8Array([1]), size: 1, hash: "x" }],
  ]);

  const preview: BlobPreview = await createBlobPreview(files, {
    rootPath: "index.html",
    strict: false,
    onUnresolvedReference: (info) => {
      const reason: "missing" | "cycle" | "unparseable" = info.reason;
      const targetPath: string = info.targetPath;
      const fromPath: string = info.fromPath;
      void reason;
      void targetPath;
      void fromPath;
    },
  });

  const entryUrl: string = preview.entryUrl;
  const resolved: string | null = preview.resolve("index.html");
  const registeredPaths: string[] = preview.registry.paths();
  preview.dispose();

  void entryUrl;
  void resolved;
  void registeredPaths;
}

void assertBlobPreviewTypes;
