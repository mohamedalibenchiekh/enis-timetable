import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const RENDER_TIMEOUT_MS = 60_000;
const DPI = 100;
const COLOR_TOLERANCE = 16;
const REQUIRED_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [0xc2, 0xd6, 0x9b],
  [0xb8, 0xcc, 0xe4],
  [0xff, 0xff, 0x99],
];
const FONT_CONFIG = path.join(__dirname, 'fonts.conf');

export interface VisualAssertions {
  pageCount: number;
  leftMargin: number;
  rightMargin: number;
  colorCounts: number[];
}

export interface RendererPrerequisites {
  available: boolean;
  missingRenderers: string[];
  error?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = RENDER_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} exceeded the ${timeoutMs} ms timeout`));
      } else if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}\n${stderr || stdout}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function executableExists(command: string, versionArgument: string): boolean {
  const result = spawnSync(command, [versionArgument], { stdio: 'ignore', timeout: 5_000 });
  return !result.error && result.status === 0;
}

export function checkRendererPrerequisites(): RendererPrerequisites {
  const missingRenderers = [
    ['soffice', '--version'],
    ['pdftoppm', '-v'],
  ].filter(([command, versionArgument]) => !executableExists(command, versionArgument)).map(([command]) => command);
  if (missingRenderers.length) {
    return { available: false, missingRenderers };
  }
  const missingPdfInfo = !executableExists('pdfinfo', '-v');
  if (missingPdfInfo) {
    return { available: false, missingRenderers: [], error: 'pdfinfo is required (install Poppler utilities).' };
  }
  const fontMatch = spawnSync('fc-match', ['-f', '%{family}', 'Times New Roman'], {
    encoding: 'utf8',
    env: { ...process.env, FONTCONFIG_FILE: FONT_CONFIG },
    timeout: 5_000,
  });
  if (fontMatch.error || fontMatch.status !== 0 || !fontMatch.stdout?.startsWith('Liberation Serif')) {
    return {
      available: false,
      missingRenderers: [],
      error: 'Liberation Serif is missing or the Times New Roman fontconfig alias is not active. Install fonts-liberation and fontconfig.',
    };
  }
  return { available: true, missingRenderers: [] };
}

async function retryCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  retries = 1,
): Promise<CommandResult> {
  let firstError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await runCommand(command, args, env);
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`${command} failed after one retry: ${error instanceof Error ? error.message : String(error)}\nFirst attempt: ${String(firstError)}`);
      }
      firstError = error;
    }
  }
  throw new Error(`Could not run ${command}`);
}

export async function renderDocx(document: Buffer, name: string): Promise<Buffer[]> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `enis-visual-${name}-`));
  const docxPath = path.join(workDir, `${name}.docx`);
  const pdfPath = path.join(workDir, `${name}.pdf`);
  const imagePrefix = path.join(workDir, `${name}`);
  const env = {
    ...process.env,
    TZ: 'UTC',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    FONTCONFIG_FILE: FONT_CONFIG,
  };

  try {
    fs.writeFileSync(docxPath, document);
    let firstConversionError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const profilePath = path.join(workDir, `lo-profile-${attempt}`);
      try {
        await runCommand('soffice', [
          '--headless',
          `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
          '--convert-to', 'pdf',
          '--outdir', workDir,
          docxPath,
        ], env);
        firstConversionError = undefined;
        break;
      } catch (error) {
        if (attempt === 1) {
          throw new Error(
            `soffice failed after one retry: ${error instanceof Error ? error.message : String(error)}\n` +
            `First attempt: ${String(firstConversionError)}`,
          );
        }
        firstConversionError = error;
      }
    }

    const pdfInfo = await retryCommand('pdfinfo', [pdfPath], env);
    const pageMatch = pdfInfo.stdout.match(/^Pages:\s+(\d+)/m);
    if (!pageMatch) throw new Error(`Unable to read PDF page count:\n${pdfInfo.stdout}`);
    const pageCount = Number(pageMatch[1]);

    await retryCommand('pdftoppm', ['-r', String(DPI), '-png', pdfPath, imagePrefix], env);
    const images = Array.from({ length: pageCount }, (_, index) => {
      const imagePath = `${imagePrefix}-${index + 1}.png`;
      if (!fs.existsSync(imagePath)) throw new Error(`Expected rendered page image is missing: ${imagePath}`);
      return fs.readFileSync(imagePath);
    });
    return images;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function countColor(png: PNG, target: readonly [number, number, number]): number {
  let count = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const close = (channel: number, expected: number) => Math.abs(png.data[offset + channel] - expected) <= COLOR_TOLERANCE;
    if (close(0, target[0]) && close(1, target[1]) && close(2, target[2])) count++;
  }
  return count;
}

export function assertVisualStructure(pageCount: number, image: Buffer): VisualAssertions {
  const png = PNG.sync.read(image);
  let firstContentX = png.width;
  let lastContentX = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (png.width * y + x) * 4;
      if (png.data[offset] < 245 || png.data[offset + 1] < 245 || png.data[offset + 2] < 245) {
        firstContentX = Math.min(firstContentX, x);
        lastContentX = Math.max(lastContentX, x);
      }
    }
  }

  const leftMargin = firstContentX;
  const rightMargin = png.width - 1 - lastContentX;
  const colorCounts = REQUIRED_COLORS.map((color) => countColor(png, color));
  return { pageCount, leftMargin, rightMargin, colorCounts };
}

export function describeStructuralFailures(assertions: VisualAssertions): string[] {
  const failures: string[] = [];
  if (assertions.pageCount !== 1) failures.push(`expected exactly 1 PDF page, got ${assertions.pageCount}`);
  if (assertions.leftMargin < 20) failures.push(`left blank margin is ${assertions.leftMargin}px (minimum 20px)`);
  if (assertions.rightMargin < 20) failures.push(`right blank margin is ${assertions.rightMargin}px (minimum 20px)`);
  const colorNames = ['C2D69B', 'B8CCE4', 'FFFF99'];
  assertions.colorCounts.forEach((count, index) => {
    if (count < 50) failures.push(`expected color ${colorNames[index]} at least 50 times, got ${count}`);
  });
  return failures;
}
