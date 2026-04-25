import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const commonOptions = {
  bundle: true, platform: 'node', target: 'node25', sourcemap: true,
  external: ['@aws-sdk/*'], logLevel: 'info',
};
async function build() {
  await esbuild.build({ ...commonOptions, entryPoints: [join(__dirname, 'src/cli/index.ts')], outfile: join(__dirname, 'dist/cli.js'), format: 'esm', banner: { js: '#!/usr/bin/env node\n' } });
  await esbuild.build({ ...commonOptions, entryPoints: [join(__dirname, 'src/index.ts')], outfile: join(__dirname, 'dist/index.js'), format: 'esm' });
}
build().catch(err => { console.error(err); process.exit(1); });
