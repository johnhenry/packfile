// Regression fixture for https://github.com/johnhenry/packfile/issues/5:
// `@johnhenry/packfile/browser` must resolve its types through the `exports`
// map when imported by the *published package name* (not a relative path).
import {
  toArchive,
  fromArchive,
  fromFiles,
  toFiles,
  createRouter,
  DEFAULT_LIMITS,
  InvalidPathError,
  ArchiveLimitError,
  InvalidArchiveError,
  PackfileError,
  type FileEntry,
  type Files,
} from "@johnhenry/packfile/browser";

async function assertBrowserTypes(): Promise<void> {
  const files: Files = { "index.html": "<h1>hi</h1>", "a.bin": new Uint8Array([1]) };
  const map: Map<string, FileEntry> = await fromFiles(files);

  // Always a Uint8Array now, compressed or not; both option spellings type-check.
  const compressed: Uint8Array = await toArchive(map);
  const uncompressed: Uint8Array = await toArchive(map, { compressed: false });
  await toArchive(map, { compress: false });

  const roundTripped: Map<string, FileEntry> = await fromArchive(compressed, {
    maxEntries: DEFAULT_LIMITS.maxEntries,
    maxTotalSize: 1024,
    unsafePaths: "skip",
  });
  await fromArchive(uncompressed, { compress: false });
  await fromArchive(new ArrayBuffer(0));

  const back: Record<string, string | Uint8Array> = toFiles(roundTripped, { decodeText: true });
  void back;

  try {
    await fromArchive(compressed);
  } catch (e: unknown) {
    if (e instanceof InvalidPathError) console.log(e.path, e.reason);
    else if (e instanceof ArchiveLimitError) console.log(e.limit, e.max);
    else if (e instanceof InvalidArchiveError || e instanceof PackfileError) console.log(e.code);
  }

  const response: Response = await createRouter(roundTripped)("/index.html");
  void response;
}

void assertBrowserTypes;
