// Bundle for a real browser smoke test; no Node globals or polyfills.
import { exportBuild } from '../lib/build.mjs';
import { fromArchive } from '../browser.mjs';
export async function verify() {
  const result = await exportBuild([
    { type: 'asset', fileName: 'index.html', source: '<h1>Hello</h1>' },
    { type: 'chunk', fileName: 'main.js', code: 'export const answer = 42;' },
    { type: 'asset', fileName: 'data.bin', source: new Uint8Array([0, 255, 128]) },
  ]);
  const map = await fromArchive(result.archive);
  if (map.size !== 3 || map.get('data.bin').data[1] !== 255) throw new Error('Browser round-trip failed');
  return { files: [...map.keys()], sha256: result.sha256, size: result.archive.length };
}
