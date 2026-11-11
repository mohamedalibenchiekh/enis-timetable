import fs from 'node:fs';
import path from 'node:path';

export function publishScreenshots(stagedOutputDir, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const stagedFiles = fs.readdirSync(stagedOutputDir).filter((entry) => entry.endsWith('.png'));
  for (const file of stagedFiles) {
    const destination = path.join(outputDir, file);
    const temporaryFile = `${destination}.tmp-${process.pid}`;
    fs.copyFileSync(path.join(stagedOutputDir, file), temporaryFile);
    fs.renameSync(temporaryFile, destination);
  }
  const published = new Set(stagedFiles);
  for (const file of fs.readdirSync(outputDir).filter((entry) => entry.endsWith('.png'))) {
    if (!published.has(file)) fs.unlinkSync(path.join(outputDir, file));
  }
}
