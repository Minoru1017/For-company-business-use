import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'tab-purpose-extension');
const outputDir = path.join(root, 'artifacts');
const outputPath = path.join(outputDir, 'tab-purpose-extension.zip');

const zip = new JSZip();

async function addDirectory(directory, zipPrefix = 'tab-purpose-extension') {
  const entries = await readdir(directory);
  await Promise.all(
    entries
      .filter((entry) => !entry.startsWith('.'))
      .map(async (entry) => {
        const absolutePath = path.join(directory, entry);
        const archivePath = path.posix.join(zipPrefix, entry);
        const fileStat = await stat(absolutePath);

        if (fileStat.isDirectory()) {
          await addDirectory(absolutePath, archivePath);
        } else {
          zip.file(archivePath, await readFile(absolutePath));
        }
      }),
  );
}

await addDirectory(sourceDir);
await mkdir(outputDir, { recursive: true });
await rm(outputPath, { force: true });

const archive = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
await writeFile(outputPath, archive);

console.log(`Created ${path.relative(root, outputPath)} (${(archive.length / 1024).toFixed(1)} KB)`);
