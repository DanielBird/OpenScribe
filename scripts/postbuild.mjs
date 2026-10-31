// Renames Vite's dist/index.html to dist/describe.html (the file colleagues download).
import { existsSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const to = fileURLToPath(new URL('../dist/describe.html', import.meta.url));

if (!existsSync(from)) {
  console.error(`postbuild: ${from} not found. Did "vite build" run?`);
  process.exit(1);
}
rmSync(to, { force: true });
renameSync(from, to);
console.log('postbuild: dist/index.html -> dist/describe.html');
