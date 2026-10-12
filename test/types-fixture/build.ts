import { exportBuild, exportFiles } from '@johnhenry/packfile/build';
import { exportDirectory } from '@johnhenry/packfile/build-node';
import vitePackfile from '@johnhenry/packfile/vite';
import rollupPackfile from '@johnhenry/packfile/rollup';
import { defineConfig } from 'vite';
import { rolldown } from 'rolldown';
import { rollup } from 'rollup';
const result = await exportBuild([{ type: 'chunk', fileName: 'main.js', code: 'export {}' }]);
const hash: string = result.sha256;
const bytes: Uint8Array = (await exportFiles({ 'index.html': 'Hello' })).archive;
await exportDirectory('./dist', './app.wbn');
defineConfig({ plugins: [vitePackfile({ fileName: 'site.wbn' })] });
await rolldown({ input: 'main.js', plugins: [rollupPackfile()] });
await rollup({ input: 'main.js', plugins: [rollupPackfile()] });
// @ts-expect-error Invalid input data
await exportFiles({ 'bad.bin': 123 });
// @ts-expect-error Invalid output kind
await exportBuild([{ type: 'unknown', fileName: 'a', source: '' }]);
void hash; void bytes;
