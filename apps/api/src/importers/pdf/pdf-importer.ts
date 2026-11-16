import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { detectKind } from '../../parser/html-parser.js';
import {
  DetectionResult,
  ImportContext,
  Importer,
  ImporterResult,
  UploadedInputFile,
} from '../types.js';
import { parsePdfDocument } from './pdf-parser.js';

const DEFAULT_TIMEOUT_MS = 120_000; // 120 seconds

export class PdfImporter implements Importer {
  readonly id = 'pdf' as const;

  detect(file: UploadedInputFile): DetectionResult | null {
    // Magic bytes check (%PDF-)
    const isPdfMagic =
      file.buffer.length >= 4 &&
      file.buffer[0] === 0x25 &&
      file.buffer[1] === 0x50 &&
      file.buffer[2] === 0x44 &&
      file.buffer[3] === 0x46;

    const isPdfExt = /\.pdf$/i.test(file.originalname);

    if (!isPdfMagic && !isPdfExt) {
      return null;
    }

    const kind = detectKind(file.originalname);

    return {
      origin: 'pdf',
      kind: kind ?? undefined,
      confidence: isPdfMagic ? (kind ? 1.0 : 0.85) : 0.6,
      reason: isPdfMagic
        ? `Fichier PDF valide (octets magiques %PDF détectés, vue : ${kind ?? 'inconnue'})`
        : `Extension .pdf avec vue : ${kind ?? 'inconnue'}`,
    };
  }

  async parse(file: UploadedInputFile, ctx: ImportContext = {}): Promise<ImporterResult> {
    const workerFileUrl = new URL('./pdf-worker.js', import.meta.url);
    const workerPath = fileURLToPath(workerFileUrl);

    // If the compiled worker script exists, run off-thread in Worker
    if (fs.existsSync(workerPath)) {
      return this.runInWorker(workerPath, file, ctx);
    }

    // Direct fallback (e.g. vitest execution directly from source)
    const { parsed, report } = await parsePdfDocument(file.buffer, file.originalname, {
      onProgress: ctx.onProgress,
      signal: ctx.signal,
    });

    return {
      parsed: [parsed],
      report,
    };
  }

  private runInWorker(
    workerPath: string,
    file: UploadedInputFile,
    ctx: ImportContext,
  ): Promise<ImporterResult> {
    return new Promise((resolve, reject) => {
      const timeoutMs = DEFAULT_TIMEOUT_MS;
      let timer: NodeJS.Timeout | null = null;
      let worker: Worker | null = null;

      try {
        worker = new Worker(workerPath, {
          workerData: {
            buffer: file.buffer,
            fileName: file.originalname,
            options: {},
          },
        });
      } catch {
        // Fallback to in-thread execution if worker instantiation fails
        parsePdfDocument(file.buffer, file.originalname, {
          onProgress: ctx.onProgress,
          signal: ctx.signal,
        })
          .then((res) => resolve({ parsed: [res.parsed], report: res.report }))
          .catch(reject);
        return;
      }

      if (ctx.signal?.aborted) {
        worker?.terminate();
        reject(new Error('Importation PDF annulée par l’utilisateur.'));
        return;
      }

      timer = setTimeout(() => {
        worker?.terminate();
        reject(
          new Error(
            `Délai d'attente dépassé (${timeoutMs / 1000}s) lors de l'analyse du fichier PDF « ${file.originalname} ».`,
          ),
        );
      }, timeoutMs);

      if (ctx.signal) {
        ctx.signal.addEventListener('abort', () => {
          if (timer) clearTimeout(timer);
          worker?.terminate();
          reject(new Error('Importation PDF annulée par l’utilisateur.'));
        });
      }

      worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          ctx.onProgress?.(msg.progress);
        } else if (msg.type === 'result') {
          if (timer) clearTimeout(timer);
          resolve({
            parsed: [msg.data.parsed],
            report: msg.data.report,
          });
        } else if (msg.type === 'error') {
          if (timer) clearTimeout(timer);
          reject(new Error(msg.error));
        }
      });

      worker.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });

      worker.on('exit', (code) => {
        if (timer) clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`Le processus d'analyse PDF s'est arrêté de façon inattendue (code ${code}).`));
        }
      });
    });
  }
}
