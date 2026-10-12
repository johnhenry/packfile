import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Bundle } from 'wbn';
import { build } from 'vite';
import { rolldown } from 'rolldown';
import { rollup } from 'rollup';
import { exportFiles, exportBuild } from '../lib/build.mjs';
import { exportDirectory } from '../lib/build-node.mjs';
import { fromArchive } from '../index.mjs';
import { fromArchive as browserRead } from '../browser.mjs';
import vitePackfile from '../lib/vite.mjs';
import rollupPackfile from '../lib/rollup.mjs';

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'packfile-export-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('build adapter preserves bytes, paths, MIME and hashes across Node/browser readers', async () => {
  const input = [
    { type: 'chunk', fileName: 'assets/main.js', code: 'export default 42;' },
    { type: 'asset', fileName: 'index.html', source: '<script type="module" src="./assets/main.js"></script>' },
    { type: 'asset', fileName: 'assets/style.css', source: 'body { color: red }' },
    { type: 'asset', fileName: 'assets/日本 #%.wasm', source: new Uint8Array([0, 97, 115, 109, 255]) },
    { type: 'asset', fileName: 'assets/font.woff2', source: new Uint8Array([0, 255, 128]) },
  ];
  const result = await exportBuild(input);
  assert.equal(result.sha256, createHash('sha256').update(result.archive).digest('hex'));
  const wire = new Bundle(gunzipSync(result.archive));
  for (const read of [fromArchive, browserRead]) {
    const files = await read(result.archive);
    assert.equal(files.size, input.length);
    for (const item of input) {
      const original = item.type === 'chunk' ? item.code : item.source;
      const bytes = typeof original === 'string' ? new TextEncoder().encode(original) : original;
      assert.deepEqual(new Uint8Array(files.get(item.fileName).data), bytes);
      assert.equal(files.get(item.fileName).hash, result.files.find(f => f.path === item.fileName).sha256);
    }
  }
  const url = 'https://packfile.invalid/assets/' + encodeURIComponent('日本 #%.wasm');
  assert.equal(wire.getResponse(url).headers['content-type'], 'application/wasm');
  assert.equal(wire.getResponse('https://packfile.invalid/assets/style.css').headers['content-type'], 'text/css');
  assert.deepEqual((await exportBuild([...input].reverse())).archive, result.archive);
});

test('rejects unsafe, colliding, missing and invalid outputs', async () => {
  for (const path of ['../x', '/x', 'a\\b', 'a/./b', 'x\0y']) {
    await assert.rejects(exportFiles({ [path]: '' }), { code: 'ERR_PACKFILE_INVALID_PATH' });
  }
  for (const files of [{ A: '', a: '' }, { a: '', 'a/b': '' }, { A: '', 'a/b': '' }]) {
    await assert.rejects(exportFiles(files), { code: 'ERR_PACKFILE_INVALID_PATH' });
  }
  await assert.rejects(exportFiles({}));
  await assert.rejects(exportFiles({ a: 42 }), TypeError);
  await assert.rejects(exportBuild([{ type: 'chunk', fileName: 'a', code: '' }, { type: 'asset', fileName: 'a', source: '' }]), { reason: 'duplicate' });
  await assert.rejects(exportBuild([{ type: 'unknown' }]), TypeError);
  await assert.rejects(exportBuild({}), TypeError);
  for (const plugin of [vitePackfile, rollupPackfile]) {
    for (const fileName of ['../a.wbn', '/a.wbn', 'a.zip']) assert.throws(() => plugin({ fileName }));
  }
});

test('directory and CLI export exclude prior archive and are repeatable', async t => {
  const dir = await temp(t);
  await writeFile(join(dir, 'index.html'), '<h1>Hello</h1>');
  const target = join(dir, 'app[1].wbn');
  const first = await exportDirectory(dir, target);
  const second = await exportDirectory(dir, target);
  assert.deepEqual(second.archive, first.archive);
  assert.deepEqual(second.files.map(f => f.path), ['index.html']);
  await promisify(execFile)(process.execPath, ['packfile.mjs', 'export', dir, target]);
  assert.deepEqual(new Uint8Array(await readFile(target)), first.archive);
  await assert.rejects(exportDirectory(dir, join(dir, 'index.html')));
});

test('real Vite build includes HTML, CSS, split chunks, binary and public assets; rebuild excludes archive', async t => {
  const root = await temp(t);
  await mkdir(join(root, 'public'));
  await writeFile(join(root, 'public', 'icon.bin'), new Uint8Array([0, 255, 1]));
  await writeFile(join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
  await writeFile(join(root, 'main.js'), 'import "./style.css"; document.body.onclick = () => import("./lazy.js");');
  await writeFile(join(root, 'lazy.js'), 'export const value = 42;');
  await writeFile(join(root, 'style.css'), 'body { color: red; }');
  const config = { root, configFile: false, logLevel: 'silent', plugins: [vitePackfile()], build: { emptyOutDir: false } };
  await build(config);
  const first = await readFile(join(root, 'dist', 'app.wbn'));
  const map = await browserRead(first);
  assert.ok(map.has('index.html'));
  assert.deepEqual(map.get('icon.bin').data, new Uint8Array([0, 255, 1]));
  assert.ok([...map.keys()].some(p => p.endsWith('.css')));
  assert.equal([...map.keys()].filter(p => p.endsWith('.js')).length, 2);
  await build(config);
  assert.deepEqual(await readFile(join(root, 'dist', 'app.wbn')), first);
  for (const config of [{ write: false }, { ssr: 'main.js' }]) {
    await assert.rejects(build({ root, configFile: false, logLevel: 'silent', plugins: [vitePackfile()], build: config }), /packfile:/);
  }
});

for (const [name, bundler] of [['Rollup', rollup], ['Rolldown', rolldown]]) test(`real ${name} generates a readable archive without writing to disk`, async t => {
  const root = await temp(t);
  await writeFile(join(root, 'main.js'), 'export const answer = 42;');
  const builder = await bundler({ input: join(root, 'main.js'), plugins: [
    { name: 'fixture-assets', generateBundle() { this.emitFile({ type: 'asset', fileName: 'index.html', source: '<h1>Hello</h1>' }); } },
    rollupPackfile(),
  ] });
  try {
    const result = await builder.generate({ format: 'es' });
    const archive = result.output.find(o => o.fileName === 'app.wbn');
    const map = await browserRead(archive.source);
    assert.ok(map.has('main.js'));
    assert.ok(map.has('index.html'));
    assert.ok(!map.has('app.wbn'));
  } finally { await builder.close(); }
});

test('Rollup plugin refuses to overwrite an existing output asset', async () => {
  const plugin = rollupPackfile();
  await assert.rejects(plugin.generateBundle.call({ emitFile() { assert.fail(); } }, {}, { 'app.wbn': { type: 'asset', fileName: 'app.wbn', source: '' } }), /already contains/);
});

test('Vite export waits for ordinary closeBundle writers and preserves last archive after a failed build', async t => {
  const root = await temp(t);
  await writeFile(join(root, 'index.html'), '<h1>Hello</h1>');
  const config = {
    root, configFile: false, logLevel: 'silent',
    plugins: [{ name: 'late-file', async closeBundle() {
      await new Promise(resolve => setTimeout(resolve, 20));
      await writeFile(join(root, 'dist', 'late.txt'), 'late');
    } }, vitePackfile()],
  };
  await build(config);
  const target = join(root, 'dist', 'app.wbn');
  const original = await readFile(target);
  assert.equal(new TextDecoder().decode((await browserRead(original)).get('late.txt').data), 'late');
  await assert.rejects(build({
    root, configFile: false, logLevel: 'silent', build: { emptyOutDir: false },
    plugins: [{ name: 'fail-render', generateBundle() { throw new Error('intentional build failure'); } }, vitePackfile()],
  }), /intentional build failure/);
  assert.deepEqual(await readFile(target), original);
});

test('failed directory validation leaves the prior destination untouched', async t => {
  const root = await temp(t);
  const dest = join(root, 'app.wbn');
  await writeFile(dest, 'previous');
  await writeFile(join(root, 'A.txt'), 'a');
  await writeFile(join(root, 'a.txt'), 'b');
  await assert.rejects(exportDirectory(root, dest), { reason: 'case-collision' });
  assert.equal(await readFile(dest, 'utf8'), 'previous');
});
