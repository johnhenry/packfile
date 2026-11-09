// #35: createWebBundleRouter percent-decodes a Request's pathname and matches
// it against the bundle's exchange URLs decoded the same way, like
// createRouter() after #20. Only `./web-bundle` exposes this router (the
// `./browser` entry has no createWebBundleRouter).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as wbn from "wbn";
import { fromFiles } from "../index.mjs";
import { toWebBundle, createWebBundleRouter } from "@johnhenry/packfile/web-bundle";

const FILES = {
  "docs/ünï/page.html": "<p>ünï</p>",
  "with space.txt": "space",
  "a%20b.txt": "literal percent",
  "a@b [1].txt": "reserved chars",
  "docs/index.html": "docs index",
  "index.html": "home",
};

for (const baseURL of ["https://site.example/", "https://site.example/app/"]) {
  await test(`createWebBundleRouter decodes Request pathnames (base ${baseURL})`, async (t) => {
    const bundle = new wbn.Bundle(toWebBundle(await fromFiles(FILES), { baseURL }));
    const fallbackSeen = [];
    const router = createWebBundleRouter(bundle, {
      baseURL,
      alias: { "/": "index.html", "/ünï": "docs/ünï/page.html" },
      tryExtensions: ["index.html"],
    });
    // A Request pathname is relative to baseURL (unchanged), whatever its origin.
    const get = (path) => router(new Request(`https://site.example${path}`));
    const text = async (path) => {
      const res = await get(path);
      assert.equal(res.status, 200, path);
      return res.text();
    };

    await t.test("non-ASCII, space, reserved and literal-% names", async () => {
      assert.equal(await text("/docs/ünï/page.html"), "<p>ünï</p>");
      assert.equal(await text("/docs/%C3%BCn%C3%AF/page.html"), "<p>ünï</p>");
      assert.equal(await text("/docs/%c3%bcn%c3%af/page.html"), "<p>ünï</p>", "lowercase escapes");
      assert.equal(await text("/with%20space.txt"), "space");
      assert.equal(await text("/a@b%20[1].txt"), "reserved chars", "toWebBundle stores a%40b%20%5B1%5D.txt");
      assert.equal(await text("/a%40b%20%5B1%5D.txt"), "reserved chars");
      assert.equal(await text("/a%2520b.txt"), "literal percent");
    });

    await t.test("aliases match the decoded path; tryExtensions apply after a trailing slash", async () => {
      assert.equal(await text("/"), "home");
      assert.equal(await text("/docs/"), "docs index");
      assert.equal(await text("/%C3%BCn%C3%AF"), "<p>ünï</p>");
    });

    await t.test("HEAD works on a decoded path", async () => {
      const res = await router(new Request(`https://site.example/with%20space.txt`, { method: "HEAD" }));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "");
    });

    await t.test("unsafe or malformed encodings are not found, and reach the fallback", async () => {
      for (const path of ["/docs%2Fünï%2Fpage.html", "/docs/%5C..%5Cindex.html", "/index.html%00", "/%E0%A4%A"]) {
        assert.equal((await get(path)).status, 404, path);
      }
      const withFallback = createWebBundleRouter(bundle, {
        baseURL,
        fallback: (input) => {
          fallbackSeen.push(new URL(input.url).pathname);
          return new Response("fb", { status: 418 });
        },
      });
      assert.equal((await withFallback(new Request(`https://site.example/docs%2Fx`))).status, 418);
      assert.deepEqual(fallbackSeen, [`/docs%2Fx`]);
    });

    await t.test("string input is a decoded path; an encoded one still works when nothing decoded matches", async () => {
      assert.equal(await (await router("/docs/ünï/page.html")).text(), "<p>ünï</p>");
      assert.equal(await (await router("a@b [1].txt")).text(), "reserved chars");
      assert.equal(await (await router("/a%20b.txt")).text(), "literal percent", "decoded match wins");
      assert.equal(await (await router("/docs/%C3%BCn%C3%AF/page.html")).text(), "<p>ünï</p>", "legacy encoded string");
    });
  });
}

await test("createWebBundleRouter matches an external bundle's own encoding", async () => {
  const baseURL = "https://ext.example/";
  const builder = new wbn.BundleBuilder("b2");
  const body = (s) => new TextEncoder().encode(s);
  // Written by another tool: literal "@", lowercase escapes.
  builder.addExchange(`${baseURL}a@b.txt`, 200, { "Content-Type": "text/plain" }, body("at"));
  builder.addExchange(`${baseURL}%c3%bc.txt`, 200, { "Content-Type": "text/plain" }, body("u"));
  // Unsafe once decoded: never reachable by path.
  builder.addExchange(`${baseURL}x%2Fy.txt`, 200, { "Content-Type": "text/plain" }, body("slash"));
  builder.addExchange("https://other.example/x.txt", 200, { "Content-Type": "text/plain" }, body("other"));
  builder.setPrimaryURL(baseURL);
  const router = createWebBundleRouter(new wbn.Bundle(builder.createBundle()), { baseURL });

  assert.equal(await (await router(new Request(`${baseURL}a%40b.txt`))).text(), "at");
  assert.equal(await (await router(new Request(`${baseURL}a@b.txt`))).text(), "at");
  assert.equal(await (await router(new Request(`${baseURL}%C3%BC.txt`))).text(), "u");
  assert.equal(await (await router("ü.txt")).text(), "u");
  assert.equal((await router(new Request(`${baseURL}x%2Fy.txt`))).status, 404);
  assert.equal((await router("x/y.txt")).status, 404);
  assert.equal((await router("//other.example/x.txt")).status, 404, "a string can't leave baseURL");
});
