import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildVisualCases, getBaselinePath } from './cases.js';
import {
  assertVisualStructure,
  checkRendererPrerequisites,
  describeStructuralFailures,
  renderDocx,
} from './renderer.js';
import { PNG } from 'pngjs';

const MAX_BASELINE_BYTES = 150 * 1024;

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    throw new Error('Refusing to overwrite visual baselines. Re-run with --yes to explicitly allow it.');
  }

  const prerequisites = checkRendererPrerequisites();
  if (!prerequisites.available) {
    throw new Error(prerequisites.error ?? `Missing required command(s): ${prerequisites.missingRenderers.join(', ')}`);
  }

  const pendingBaselines: Array<{ path: string; image: Buffer }> = [];
  for (const visualCase of await buildVisualCases()) {
    const images = await renderDocx(visualCase.document, visualCase.name);
    if (images.length !== 1 || !images[0]) {
      throw new Error(`${visualCase.name} must render to exactly one page; got ${images.length}. No baselines were written.`);
    }
    const failures = describeStructuralFailures(assertVisualStructure(images.length, images[0]));
    if (failures.length) {
      throw new Error(`${visualCase.name} failed structural checks: ${failures.join('; ')}. No baselines were written.`);
    }

    const baselinePath = getBaselinePath(visualCase.name);
    const optimizedImage = PNG.sync.write(PNG.sync.read(images[0]), { deflateLevel: 9 });
    if (optimizedImage.length > MAX_BASELINE_BYTES) {
      throw new Error(`${visualCase.name} baseline is ${optimizedImage.length} bytes; maximum ${MAX_BASELINE_BYTES}. No baselines were written.`);
    }
    pendingBaselines.push({ path: baselinePath, image: optimizedImage });
  }

  for (const baseline of pendingBaselines) {
    fs.mkdirSync(path.dirname(baseline.path), { recursive: true });
    fs.writeFileSync(baseline.path, baseline.image);
    console.log(`Updated ${baseline.path} (${baseline.image.length} bytes)`);
  }

  console.log('Reminder: review every generated PNG and the resulting diff before committing baseline changes.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
