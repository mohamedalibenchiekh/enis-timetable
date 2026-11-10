import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildVisualCases, getBaselinePath } from './cases';
import { checkRendererPrerequisites, renderDocx } from './renderer';
import { PNG } from 'pngjs';

const MAX_BASELINE_BYTES = 150 * 1024;

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    throw new Error('Refusing to overwrite visual baselines. Re-run with an explicit --yes flag.');
  }

  const prerequisites = checkRendererPrerequisites();
  if (!prerequisites.available) {
    throw new Error(prerequisites.error ?? `Missing required command(s): ${prerequisites.missingRenderers.join(', ')}`);
  }

  for (const visualCase of await buildVisualCases()) {
    const images = await renderDocx(visualCase.document, visualCase.name);
    const baselinePath = getBaselinePath(visualCase.name);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    const optimizedImage = PNG.sync.write(PNG.sync.read(images[0]), { deflateLevel: 9 });
    if (optimizedImage.length > MAX_BASELINE_BYTES) {
      throw new Error(`${visualCase.name} baseline is ${optimizedImage.length} bytes; the maximum is ${MAX_BASELINE_BYTES} bytes.`);
    }
    fs.writeFileSync(baselinePath, optimizedImage);
    console.log(`Updated ${baselinePath} (${optimizedImage.length} bytes; ${images.length} page image(s))`);
  }

  console.log('Reminder: review every generated PNG and the resulting diff before committing baseline changes.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
