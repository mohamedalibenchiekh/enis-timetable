import { parentPort, workerData } from 'worker_threads';
import { parsePdfDocument } from './pdf-parser.js';

if (!parentPort) {
  throw new Error('pdf-worker must be run inside a Worker thread.');
}

const port = parentPort;

async function run() {
  const { buffer, fileName, options } = workerData;

  try {
    const result = await parsePdfDocument(Buffer.from(buffer), fileName, {
      ...options,
      onProgress: (prog) => {
        port.postMessage({ type: 'progress', progress: prog });
      },
    });

    port.postMessage({ type: 'result', data: result });
  } catch (err) {
    port.postMessage({
      type: 'error',
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}

run();
