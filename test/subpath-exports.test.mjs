// Issue #7: the runtime half of the export-name check in
// test/types-fixture/subpath-exports.fixture.ts. Adding or removing an export
// from one of these subpaths must update its `.d.ts`, the fixture, and this list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const expected = {
  "./compat": ["compileDirectory", "decompileDirectory"],
  "./cache": ["withCache"],
  "./hash": ["hashBuffer", "hashStream"],
  "./compression": ["DEFAULT_COMPRESSION_LEVEL", "compressObject", "deCompressObject"],
  "./web-bundle": ["createWebBundleRouter", "fromWebBundle", "toWebBundle"],
};

for (const [subpath, names] of Object.entries(expected)) {
  await test(`${subpath}: runtime exports and types condition`, async () => {
    const mod = await import(`@johnhenry/packfile/${subpath.slice(2)}`);
    assert.deepEqual(Object.keys(mod).sort(), [...names].sort());
    const target = pkg.exports[subpath];
    assert.equal(typeof target, "object", `${subpath} needs a { types, default } target`);
    assert.match(target.types, /\.d\.ts$/);
    await access(new URL(`../${target.types}`, import.meta.url));
  });
}

await test("./compression: DEFAULT_COMPRESSION_LEVEL matches its declared literal type", async () => {
  const { DEFAULT_COMPRESSION_LEVEL } = await import("@johnhenry/packfile/compression");
  assert.equal(DEFAULT_COMPRESSION_LEVEL, 6);
});
