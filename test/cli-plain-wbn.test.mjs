// The CLI's `decompress` and `serve` read a plain Web Bundle (no gzip), such
// as sitefile's `EXPORT … AS wbn`, as well as packfile's own gzip archives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const cli = fileURLToPath(new URL("../packfile.mjs", import.meta.url));
const expected = JSON.parse(await readFile(fixture("sitefile-0.0.0.json"), "utf8"));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

async function decompressAndCheck(t, input) {
  const out = await mkdtemp(join(tmpdir(), "packfile-cli-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  await promisify(execFile)(process.execPath, [cli, "decompress", input, out]);
  for (const [path, { size, sha256: digest }] of Object.entries(expected.files)) {
    const data = await readFile(join(out, path));
    assert.equal(data.length, size, path);
    assert.equal(sha256(data), digest, path);
  }
}

test("decompress reads a plain Web Bundle", (t) => decompressAndCheck(t, fixture("sitefile-0.0.0.wbn")));

test("decompress still reads a gzipped one", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "packfile-gz-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gz = join(dir, "site.wbn.gz");
  await writeFile(gz, gzipSync(await readFile(fixture("sitefile-0.0.0.wbn"))));
  await decompressAndCheck(t, gz);
});

test("serve serves a plain Web Bundle", async (t) => {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [cli, "serve", fixture("sitefile-0.0.0.wbn"), String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    let log = "";
    const onData = (d) => {
      log += d;
      if (log.includes("Server running")) resolve();
      if (log.includes("ERROR")) reject(new Error(log));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`exited ${code}: ${log}`)));
  });
  const res = await fetch(`http://127.0.0.1:${port}/style.css`);
  assert.equal(res.status, 200);
  assert.equal(sha256(Buffer.from(await res.arrayBuffer())), expected.files["style.css"].sha256);
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
});
