// fromArchive({ baseURL, onSkip }) and primary-URL base derivation (#18).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as wbn from "wbn";
import { gzipSync } from "node:zlib";
import * as node from "../index.mjs";
import * as browser from "../browser.mjs";
import { toWebBundle, fromWebBundle } from "../lib/web-bundle.mjs";

const dec = new TextDecoder();
const SITE = "https://example.com/";

const sampleFiles = () => node.fromFiles({
  "index.html": "<h1>hi</h1>",
  "assets/app.js": "console.log(1)",
  "dir with space/a#b.txt": "odd",
});

/** gzip(Web Bundle) for a real site, as e.g. Sitefile's `EXPORT ... AS wbn` writes it. */
const siteArchive = async (opts = {}) =>
  new Uint8Array(gzipSync(toWebBundle(await sampleFiles(), { baseURL: SITE, ...opts })));

/** A bundle with explicit exchange URLs and an optional primary URL (b2 allows none). */
const rawBundle = (urls, primaryURL) => {
  const b = new wbn.BundleBuilder();
  for (const url of urls) b.addExchange(url, 200, { "Content-Type": "text/plain" }, "x");
  if (primaryURL) b.setPrimaryURL(primaryURL);
  return new Uint8Array(gzipSync(b.createBundle()));
};

const expectSite = (map) => {
  assert.deepEqual([...map.keys()].sort(), ["assets/app.js", "dir with space/a#b.txt", "index.html"]);
  assert.equal(dec.decode(map.get("index.html").data), "<h1>hi</h1>");
};

for (const [name, lib] of [["node entry", node], ["browser entry", browser]]) {
  await test(`${name}: fromArchive baseURL / onSkip (#18)`, async (t) => {
    await t.test("a bundle built for https://example.com/ reads back fully with { baseURL }", async () => {
      expectSite(await lib.fromArchive(await siteArchive(), { baseURL: SITE }));
      // A baseURL without the trailing slash is equivalent.
      expectSite(await lib.fromArchive(await siteArchive(), { baseURL: "https://example.com" }));
    });

    await t.test("without baseURL, the base is derived from the primary URL's origin", async () => {
      expectSite(await lib.fromArchive(await siteArchive()));
      // A primary URL deeper in the site still yields origin + "/".
      expectSite(await lib.fromArchive(await siteArchive({ primaryURL: `${SITE}index.html` })));
    });

    await t.test("an explicit baseURL overrides the primary URL", async () => {
      const archive = rawBundle(["https://cdn.example/a.txt"], "https://example.com/");
      const map = await lib.fromArchive(archive, { baseURL: "https://cdn.example/", unsafePaths: "skip" });
      assert.deepEqual([...map.keys()], ["a.txt"]);
    });

    await t.test("default behaviour is unchanged for toArchive output", async () => {
      for (const write of [node.toArchive, browser.toArchive]) {
        const archive = await write(await sampleFiles());
        expectSite(await lib.fromArchive(archive));
        expectSite(await lib.fromArchive(archive, { baseURL: "https://packfile.invalid/" }));
      }
    });

    await t.test("no primary URL falls back to https://packfile.invalid/", async () => {
      const archive = rawBundle(["https://packfile.invalid/a.txt", "https://example.com/b.txt"]);
      const skipped = [];
      const map = await lib.fromArchive(archive, { unsafePaths: "skip", onSkip: (s) => skipped.push(s) });
      assert.deepEqual([...map.keys()], ["a.txt"]);
      assert.deepEqual(skipped, [{ url: "https://example.com/b.txt", reason: "outside-base" }]);
    });

    await t.test("onSkip reports every skipped entry with its reason", async () => {
      const archive = rawBundle([
        `${SITE}ok.txt`,
        `${SITE}a/%2e%2e/%2e%2e/escape.txt`,
        "https://elsewhere.example/x.txt",
        `${SITE}ok%2Etxt`, // collides with ok.txt after decoding
      ], SITE);
      const skipped = [];
      const map = await lib.fromArchive(archive, { unsafePaths: "skip", onSkip: (s) => skipped.push(s) });
      assert.deepEqual([...map.keys()], ["ok.txt"]);
      assert.deepEqual(skipped.map((s) => s.reason).sort(), ["duplicate", "outside-base", "traversal"]);
      assert.ok(skipped.every((s) => typeof s.url === "string"));
    });

    await t.test("throwing from onSkip aborts the read", async () => {
      const archive = await siteArchive();
      await assert.rejects(
        () => lib.fromArchive(archive, {
          baseURL: "https://wrong.example/",
          unsafePaths: "skip",
          onSkip: ({ url, reason }) => { throw new Error(`${reason}: ${url}`); },
        }),
        /outside-base: https:\/\/example\.com\//,
      );
    });

    await t.test("rejects a non-absolute baseURL and a non-function onSkip", async () => {
      const archive = await siteArchive();
      await assert.rejects(() => lib.fromArchive(archive, { baseURL: "/relative/" }), TypeError);
      await assert.rejects(() => lib.fromArchive(archive, { baseURL: 42 }), TypeError);
      await assert.rejects(() => lib.fromArchive(archive, { onSkip: "warn" }), TypeError);
    });

    await t.test("the compressed/compress alias still works alongside baseURL", async () => {
      const raw = toWebBundle(await sampleFiles(), { baseURL: SITE });
      expectSite(await lib.fromArchive(raw, { compressed: false, baseURL: SITE }));
      expectSite(await lib.fromArchive(raw, { compress: false, baseURL: SITE }));
    });
  });
}

await test("node fromArchive: foreign entries are skipped by default (no throw), now observable", async () => {
  const skipped = [];
  const map = await node.fromArchive(await siteArchive(), {
    baseURL: "https://wrong.example/",
    onSkip: (s) => skipped.push(s),
  });
  assert.equal(map.size, 0);
  assert.equal(skipped.length, 3);
  assert.ok(skipped.every((s) => s.reason === "outside-base"));
});

await test("browser fromArchive: a wrong baseURL still throws by default", async () => {
  const archive = await siteArchive();
  await assert.rejects(
    () => browser.fromArchive(archive, { baseURL: "https://wrong.example/" }),
    { code: "ERR_PACKFILE_INVALID_PATH", reason: "outside-base" },
  );
});

await test("fromWebBundle: onSkip reports skipped entries", async () => {
  const bytes = toWebBundle(await sampleFiles(), { baseURL: SITE });
  const skipped = [];
  const map = fromWebBundle(bytes, { baseURL: "https://wrong.example/", onSkip: (s) => skipped.push(s) });
  assert.equal(map.size, 0);
  assert.equal(skipped.length, 3);
  expectSite(fromWebBundle(bytes, { baseURL: SITE }));
});
