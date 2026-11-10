import * as fs from 'node:fs';
import * as path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { buildVisualCases, getBaselinePath, VisualCase } from './cases';
import {
  assertVisualStructure,
  checkRendererPrerequisites,
  describeStructuralFailures,
  orderPageFiles,
  renderDocx,
} from './renderer';

const prerequisites = checkRendererPrerequisites();
const failureRoot = path.resolve(__dirname, '../../test-output/visual');
const MAX_DIFFERENCE_RATIO = 0.001;
const caseNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'stress'];

describe('Poppler page file ordering', () => {
  it('orders zero-padded and unpadded page names numerically', () => {
    expect(orderPageFiles([
      'Lundi-10.png',
      'Lundi-02.png',
      'Lundi-1.png',
      'other-1.png',
    ], 'Lundi')).toEqual(['Lundi-1.png', 'Lundi-02.png', 'Lundi-10.png']);
  });
});

async function saveFailureImages(
  name: string,
  expected: Buffer | undefined,
  actual: Buffer,
  additionalPages: Buffer[],
): Promise<void> {
  const outDir = path.join(failureRoot, name);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'actual.png'), actual);
  additionalPages.forEach((page, index) => fs.writeFileSync(path.join(outDir, `actual-page-${index + 2}.png`), page));
  const actualPng = PNG.sync.read(actual);
  const diff = new PNG({ width: actualPng.width, height: actualPng.height });

  if (!expected) {
    diff.data.fill(255);
    for (let offset = 0; offset < diff.data.length; offset += 4) {
      diff.data[offset] = 255;
      diff.data[offset + 1] = 0;
      diff.data[offset + 2] = 255;
      diff.data[offset + 3] = 255;
    }
  } else {
    fs.writeFileSync(path.join(outDir, 'expected.png'), expected);
    const expectedPng = PNG.sync.read(expected);
    if (expectedPng.width === actualPng.width && expectedPng.height === actualPng.height) {
      pixelmatch(expectedPng.data, actualPng.data, diff.data, expectedPng.width, expectedPng.height, { threshold: 0.1 });
    } else {
      for (let offset = 0; offset < diff.data.length; offset += 4) {
        diff.data[offset] = 255;
        diff.data[offset + 1] = 128;
        diff.data[offset + 2] = 0;
        diff.data[offset + 3] = 255;
      }
    }
  }
  fs.writeFileSync(path.join(outDir, 'diff.png'), PNG.sync.write(diff));
}

function compareImages(expectedBuffer: Buffer, actualBuffer: Buffer): { differentPixels: number; totalPixels: number; error?: string } {
  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { differentPixels: 0, totalPixels: 0, error: `image size changed from ${expected.width}x${expected.height} to ${actual.width}x${actual.height}` };
  }
  const diff = new PNG({ width: expected.width, height: expected.height });
  const differentPixels = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    expected.width,
    expected.height,
    { threshold: 0.1 },
  );
  return { differentPixels, totalPixels: expected.width * expected.height };
}

if (!prerequisites.available) {
  if (process.env.CI === 'true') {
    describe('Visual DOCX regression', () => {
      it('has the required rendering tools and font', () => {
        throw new Error(prerequisites.error ?? `Missing required command(s): ${prerequisites.missingRenderers.join(', ')}`);
      });
    });
  } else {
    console.log(`Visual DOCX check skipped: ${prerequisites.error ?? `missing ${prerequisites.missingRenderers.join(', ')}`}`);
    describe('Visual DOCX regression', () => {
      it.skip('requires LibreOffice, Poppler, fontconfig, and Liberation Serif', () => {});
    });
  }
} else {
  describe('Visual DOCX regression', () => {
    const visualCases = buildVisualCases();

    afterAll(() => {
      if (fs.existsSync(failureRoot) && fs.readdirSync(failureRoot).length === 0) fs.rmdirSync(failureRoot);
    });

    for (const name of caseNames) {
      it(`${name} matches its baseline and structural requirements`, async () => {
        const visualCase: VisualCase | undefined = (await visualCases).find((item) => item.name === name);
        if (!visualCase) throw new Error(`Visual fixture did not produce the expected case: ${name}`);
        const images = await renderDocx(visualCase.document, visualCase.name);
        const actual = images[0];
        if (!actual) throw new Error(`${visualCase.name}: renderer returned no page images.`);
        const baselinePath = getBaselinePath(visualCase.name);
        const expected = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath) : undefined;
        const failures: string[] = [];

        if (images.length !== 1) failures.push(`expected 1 rendered page image, got ${images.length}`);
        const assertions = assertVisualStructure(images.length, actual);
        failures.push(...describeStructuralFailures(assertions));

        if (!expected) {
          failures.push(`baseline is missing: ${baselinePath}`);
        } else {
          const comparison = compareImages(expected, actual);
          if (comparison.error) {
            failures.push(comparison.error);
          } else if (comparison.differentPixels > comparison.totalPixels * MAX_DIFFERENCE_RATIO) {
            failures.push(
              `${comparison.differentPixels}/${comparison.totalPixels} pixels differ ` +
              `(${(100 * comparison.differentPixels / comparison.totalPixels).toFixed(4)}%; maximum is 0.1%)`,
            );
          }
        }

        if (failures.length) {
          await saveFailureImages(visualCase.name, expected, actual, images.slice(1));
          throw new Error(`${visualCase.name}: ${failures.join('; ')}. Images saved under ${failureRoot}/${visualCase.name}/`);
        }
      });
    }
  });
}
