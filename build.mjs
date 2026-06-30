import { mkdir, copyFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const source = join(root, 'outputs', 'dashboard');
const dest = join(root, 'dist');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

for (const entry of await readdir(source)) {
  const from = join(source, entry);
  const info = await stat(from);
  if (info.isFile()) await copyFile(from, join(dest, entry));
}

console.log('Dashboard webapp built into dist/');
