// #20: createRouter percent-decodes a Request's pathname before lookup.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as node from "../index.mjs";
import * as browser from "../browser.mjs";
import { decodeRequestPath } from "../lib/path-safety.mjs";

const FILES = {
  "docs/ünï/page.html": "<p>ünï</p>",
  "with space.txt": "space",
  "a%20b.txt": "literal percent",
  "docs/index.html": "docs index",
  "index.html": "home",
};

for (const [name, lib] of [["node entry", node], ["browser entry", browser]]) {
  await test(`${name}: createRouter decodes Request pathnames`, async (t) => {
    const fallbackSeen = [];
    const router = lib.createRouter(await lib.fromFiles(FILES), {
      alias: { "/": "index.html", "/ünï": "docs/ünï/page.html" },
      tryExtensions: ["index.html"],
    });
    const get = (path) => router(new Request(`https://site.example${path}`));
    const text = async (path) => {
      const res = await get(path);
      assert.equal(res.status, 200, path);
      return res.text();
    };

    await t.test("non-ASCII, space and literal-% names", async () => {
      assert.equal(await text("/docs/ünï/page.html"), "<p>ünï</p>");
      assert.equal(await text("/docs/%C3%BCn%C3%AF/page.html"), "<p>ünï</p>");
      assert.equal(await text("/with%20space.txt"), "space");
      assert.equal(await text("/a%2520b.txt"), "literal percent");
      assert.equal((await get("/a%20b.txt")).status, 404, "%20 decodes to a space, not a literal %20");
    });

    await t.test("aliases match the decoded path; tryExtensions still apply after a trailing slash", async () => {
      assert.equal(await text("/"), "home");
      assert.equal(await text("/%C3%BCn%C3%AF"), "<p>ünï</p>");
      assert.equal(await text("/docs/"), "docs index");
    });

    await t.test("HEAD works on a decoded path", async () => {
      const res = await router(new Request("https://site.example/with%20space.txt", { method: "HEAD" }));
      assert.equal(res.status, 200);
    });

    await t.test("unsafe or malformed encodings are not found, and reach the fallback", async () => {
      const withFallback = lib.createRouter(await lib.fromFiles(FILES), {
        fallback: (input) => { fallbackSeen.push(new URL(input.url).pathname); return new Response("fb", { status: 418 }); },
      });
      for (const path of ["/docs%2Fünï%2Fpage.html", "/docs/%5C..%5Cindex.html", "/index.html%00", "/%E0%A4%A"]) {
        assert.equal((await get(path)).status, 404, path);
      }
      // The URL parser itself resolves %2e%2e (like ..) before we see it, so
      // it can never climb above the root: this is /index.html.
      assert.equal(await text("/docs/%2e%2e/index.html"), "home");
      assert.equal(await text("/../../index.html"), "home");
      assert.equal((await withFallback(new Request("https://site.example/docs%2Fx"))).status, 418);
      assert.deepEqual(fallbackSeen, ["/docs%2Fx"]);
    });

    await t.test("string input is still a decoded path, used as given", async () => {
      assert.equal((await router("/docs/ünï/page.html")).status, 200);
      assert.equal((await router("/a%20b.txt")).status, 200);
    });
  });
}

await test("decodeRequestPath", () => {
  assert.deepEqual(decodeRequestPath("/a/%C3%BC/"), { path: "/a/ü/" });
  assert.deepEqual(decodeRequestPath("/a%2Fb"), { reason: "encoded-slash" });
  assert.deepEqual(decodeRequestPath("/a%5Cb"), { reason: "backslash" });
  assert.deepEqual(decodeRequestPath("/a%00"), { reason: "control-character" });
  assert.deepEqual(decodeRequestPath("/%zz"), { reason: "malformed-encoding" });
  assert.deepEqual(decodeRequestPath("/a/%2E%2E/b"), { reason: "traversal" });
  assert.deepEqual(decodeRequestPath("/a/%2E/b"), { reason: "dot-segment" });
});
