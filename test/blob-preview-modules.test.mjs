import { test } from "node:test";
import assert from "node:assert/strict";
import { createBlobPreview } from "../lib/blob-preview.mjs";

const enc = new TextEncoder();
const mapOf = (obj) =>
  new Map(Object.entries(obj).map(([p, c]) => {
    const data = typeof c === "string" ? enc.encode(c) : c;
    return [p, { data, size: data.length, hash: p }];
  }));
const textOf = async (url) => (await fetch(url)).text();
const quiet = () => { const seen = []; return { seen, cb: (i) => seen.push(i) }; };

await test("createBlobPreview: ES module specifier rewriting", async (t) => {
  await t.test("static import, export-from, export-star, side-effect import -> blob URLs", async () => {
    const q = quiet();
    const p = await createBlobPreview(mapOf({
      "index.html": `<script type="module" src="./app.js"></script>`,
      "app.js": `import { a } from "./a.js";\nimport './side.js';\nexport { b } from './lib/b.js';\nexport * from "./lib/c.js";\nexport default a;`,
      "a.js": `export const a = 1;`,
      "side.js": `globalThis.x = 1;`,
      "lib/b.js": `export const b = 2;`,
      "lib/c.js": `import { a } from "../a.js";\nexport const c = a;`,
    }), { onUnresolvedReference: q.cb });
    const app = await textOf(p.resolve("app.js"));
    assert.ok(app.includes(`from "${p.resolve("a.js")}"`), app);
    assert.ok(app.includes(`import '${p.resolve("side.js")}'`), app);
    assert.ok(app.includes(`from '${p.resolve("lib/b.js")}'`), app);
    assert.ok(app.includes(`export * from "${p.resolve("lib/c.js")}"`), app);
    const c = await textOf(p.resolve("lib/c.js"));
    assert.ok(c.includes(`from "${p.resolve("a.js")}"`), "../ resolved against the importing file's directory");
    assert.deepEqual(q.seen, []);
    p.dispose();
  });

  await t.test("dynamic import() with a string literal is rewritten; non-literal is left alone", async () => {
    const p = await createBlobPreview(mapOf({
      "index.html": `<script type="module" src="app.js"></script>`,
      "app.js": "const m = await import('./lazy.js');\nconst n = await import(`./${name}.js`);\nconst o = await import(\"./lazy.js\");",
      "lazy.js": `export const z = 1;`,
    }));
    const app = await textOf(p.resolve("app.js"));
    assert.ok(app.includes(`import('${p.resolve("lazy.js")}')`), app);
    assert.ok(app.includes(`import("${p.resolve("lazy.js")}")`), app);
    assert.ok(app.includes("import(`./${name}.js`)"), "template with substitution untouched");
    p.dispose();
  });

  await t.test("module-graph order: a dependency's blob URL exists before its importer is minted (chain A->B->C)", async () => {
    const p = await createBlobPreview(mapOf({
      "index.html": `<script type="module" src="a.js"></script>`,
      "a.js": `import "./b.js";`,
      "b.js": `import "./c.js";`,
      "c.js": `export const c = 1;`,
    }));
    assert.ok((await textOf(p.resolve("a.js"))).includes(p.resolve("b.js")));
    assert.ok((await textOf(p.resolve("b.js"))).includes(p.resolve("c.js")));
    assert.equal(p.resolve("a.js"), p.registry.resolve("a.js"), "one blob URL per path, owned by the registry");
    p.dispose();
  });

  await t.test("a diamond reuses one blob URL for the shared dependency", async () => {
    const p = await createBlobPreview(mapOf({
      "index.html": `<script type="module" src="top.js"></script>`,
      "top.js": `import "./l.js"; import "./r.js";`,
      "l.js": `import "./shared.js";`,
      "r.js": `import "./shared.js";`,
      "shared.js": `export const s = 1;`,
    }));
    const shared = p.resolve("shared.js");
    assert.ok((await textOf(p.resolve("l.js"))).includes(shared));
    assert.ok((await textOf(p.resolve("r.js"))).includes(shared));
    p.dispose();
  });

  await t.test("cycles: the closing edge is reported and left unrewritten; the rest still resolves", async () => {
    const q = quiet();
    const p = await createBlobPreview(mapOf({
      "index.html": `<script type="module" src="a.js"></script>`,
      "a.js": `import "./b.js";`,
      "b.js": `import "./a.js";\nimport "./leaf.js";`,
      "leaf.js": `export {};`,
    }), { onUnresolvedReference: q.cb });
    assert.deepEqual(q.seen, [{ reason: "cycle", targetPath: "a.js", fromPath: "b.js" }]);
    const b = await textOf(p.resolve("b.js"));
    assert.ok(b.includes(`import "./a.js"`), "closing edge untouched");
    assert.ok(b.includes(p.resolve("leaf.js")));
    assert.ok((await textOf(p.resolve("a.js"))).includes(p.resolve("b.js")));
    p.dispose();
  });

  await t.test("self-import is a cycle too; strict mode throws", async () => {
    const files = () => mapOf({ "index.html": `<script type="module" src="a.js"></script>`, "a.js": `import "./a.js";` });
    const q = quiet();
    (await createBlobPreview(files(), { onUnresolvedReference: q.cb })).dispose();
    assert.equal(q.seen[0].reason, "cycle");
    await assert.rejects(() => createBlobPreview(files(), { strict: true }), /cycle/);
  });

  await t.test("missing targets are reported; bare and absolute specifiers are untouched silently", async () => {
    const q = quiet();
    const src = `import x from "./nope.js";\nimport y from "lodash";\nimport z from "https://cdn.example/z.js";\nimport w from "data:text/javascript,export default 1";`;
    const p = await createBlobPreview(mapOf({ "index.html": `<script type="module" src="a.js"></script>`, "a.js": src }), { onUnresolvedReference: q.cb });
    assert.deepEqual(q.seen, [{ reason: "missing", targetPath: "nope.js", fromPath: "a.js" }]);
    assert.equal(await textOf(p.resolve("a.js")), src);
    p.dispose();
  });

  await t.test("strings/comments that merely look like imports are not touched; unparseable JS is left as-is and reported", async () => {
    const q = quiet();
    const okSrc = `// import "./b.js"\nconst s = 'import x from "./b.js"';\n/* export * from "./b.js" */`;
    const p = await createBlobPreview(mapOf({
      "index.html": `<script src="a.js"></script><script src="bad.js"></script>`,
      "a.js": okSrc, "b.js": "", "bad.js": `import { from "./b.js"; (((`,
    }), { onUnresolvedReference: q.cb });
    assert.equal(await textOf(p.resolve("a.js")), okSrc);
    assert.equal(await textOf(p.resolve("bad.js")), `import { from "./b.js"; (((`);
    assert.deepEqual(q.seen.map((i) => [i.reason, i.fromPath]), [["unparseable", "bad.js"]]);
    p.dispose();
  });

  await t.test("a JS file reachable only through JS (not HTML) is still rewritten and minted", async () => {
    const p = await createBlobPreview(mapOf({
      "index.html": `<h1>hi</h1>`,
      "orphan.js": `import "./dep.js";`,
      "dep.js": `export {};`,
    }));
    assert.ok((await textOf(p.resolve("orphan.js"))).includes(p.resolve("dep.js")));
    p.dispose();
  });

  await t.test("dispose() revokes rewritten JS blobs", async () => {
    const p = await createBlobPreview(mapOf({ "index.html": `<script src="a.js"></script>`, "a.js": `import "./b.js";`, "b.js": "" }));
    const urls = [p.resolve("a.js"), p.resolve("b.js")];
    p.dispose();
    for (const u of urls) await assert.rejects(() => fetch(u));
  });
});
